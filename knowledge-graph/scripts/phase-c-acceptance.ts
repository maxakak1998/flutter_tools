#!/usr/bin/env npx tsx

/**
 * Phase C ACCEPTANCE E2E — the top-level gate.
 *
 * Proves the 4 user acceptance questions are answerable END-TO-END through a
 * REAL daemon (JSON-RPC over HTTP), not just via storage handlers:
 *
 *   Q1 "What did I do (recently)?"   -> state_resume active_context (focus survives across sessions)
 *   Q2 "What's the status?"          -> state_resume open_tasks (in_progress in, done excluded)
 *   Q3 "What was the original plan?" -> state_get_plan version=1 (original clone)
 *   Q4 "What plan am I on now?"      -> state_get_plan active (revised clone)
 *
 * Cross-session design: SESSION A writes state; a DIFFERENT fresh SESSION B
 * (next day / new chat) reads it back project-scoped — B relies on NONE of its
 * own data.
 *
 * IMPORTANT: runs against built dist/ (daemon-manager forks daemon.js). Run
 * `npm run build` first.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ensureDaemon } from '../dist/daemon-manager.js';
import { loadConfig } from '../dist/config.js';

interface ProjectInfo {
  projectId: string;
  projectName: string;
  projectDir: string;
  kgDir: string;
  dbPath: string;
  configPath: string;
  daemonPortFile: string;
  daemonPidFile: string;
  config: unknown;
}

function createTestProject(): ProjectInfo {
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-phase-c-acceptance-'));
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });

  const config = {
    version: 1,
    project_id: randomUUID(),
    project_name: 'phase-c-acceptance',
    created_at: new Date().toISOString(),
    daemon: {
      port_range_start: 0,
      idle_timeout_ms: 60_000,
    },
    overrides: {},
  };

  const configPath = join(kgDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  return {
    projectId: config.project_id,
    projectName: config.project_name,
    projectDir,
    kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'),
    configPath,
    daemonPortFile: join(kgDir, 'daemon.port'),
    daemonPidFile: join(kgDir, 'daemon.pid'),
    config,
  };
}

/** JSON-RPC POST to the real daemon. Throws on RPC error. */
async function rpc(baseUrl: string, method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${baseUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) {
    throw new Error(`RPC ${method} failed: ${body.error.message}`);
  }
  return body.result;
}

async function getHealth(baseUrl: string): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    return (await res.json()) as { status: string };
  } catch {
    return null;
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function shutdownDaemon(baseUrl: string | null): Promise<void> {
  if (!baseUrl) return;
  try {
    await fetch(`${baseUrl}/rpc/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1_500) });
  } catch {
    /* ignore shutdown races */
  }
  await waitFor(async () => (await getHealth(baseUrl)) === null, 10_000);
}

// === Question verdict tracking ===
interface Verdict {
  q: string;
  pass: boolean;
  detail: string;
}
const verdicts: Verdict[] = [];
function record(q: string, pass: boolean, detail: string): void {
  verdicts.push({ q, pass, detail });
}

async function main() {
  console.error('🧪 Phase C ACCEPTANCE E2E (real daemon, cross-session)');
  console.error('═'.repeat(60));

  const project = createTestProject();
  const config = loadConfig();
  let daemonUrl: string | null = null;
  let decisionRan = false;
  let decisionSkipped = false;

  // Distinct session ids: A writes, B (fresh, next-day) reads.
  const sA = `sessA-${randomUUID()}`;
  const sB = `sessB-${randomUUID()}`;

  try {
    daemonUrl = await ensureDaemon(project as any, config);
    console.error(`\n🚀 Daemon up at ${daemonUrl}`);
    console.error(`   SESSION A = ${sA}`);
    console.error(`   SESSION B = ${sB} (fresh, simulating next day / new chat)\n`);

    // ============================================================
    // SESSION A — write working state
    // ============================================================
    console.error('📝 SESSION A: writing context, tasks, plans, decision');

    await rpc(daemonUrl, 'state_set_context', {
      focus: 'Implementing session-state Phase C',
      next_step: 'write acceptance test',
      refs: ['src/cli.ts'],
      session_id: sA,
    });

    await rpc(daemonUrl, 'state_task_upsert', {
      title: 'M6 resume',
      status: 'in_progress',
      session_id: sA,
    });
    await rpc(daemonUrl, 'state_task_upsert', {
      title: 'M7 migration',
      status: 'done',
      session_id: sA,
    });

    // Plan v1 (original), then v2 (revised) under the SAME title.
    const planV1Path = join(project.projectDir, 'plan-v1.md');
    writeFileSync(planV1Path, '# Phase C\n\nORIGINAL PLAN v1\n');
    const saveV1 = await rpc(daemonUrl, 'state_save_plan', {
      source_path: planV1Path,
      title: 'phase-c',
      session_id: sA,
    });
    console.error(`   plan saved v${saveV1.version} -> ${saveV1.clone_path}`);

    const planV2Path = join(project.projectDir, 'plan-v2.md');
    writeFileSync(planV2Path, '# Phase C\n\nREVISED PLAN v2\n');
    const saveV2 = await rpc(daemonUrl, 'state_save_plan', {
      source_path: planV2Path,
      title: 'phase-c',
      session_id: sA,
    });
    console.error(`   plan saved v${saveV2.version} -> ${saveV2.clone_path} (superseded ${saveV2.superseded_id})`);

    // Decision — needs Ollama for embedding. Skip gracefully if it's down.
    try {
      await rpc(daemonUrl, 'decision_record', {
        content: 'Chose project-scoped resume so a fresh session can catch up',
        summary: 'project-scoped resume',
        domain: 'session-state',
        keywords: ['resume', 'session'],
        session_id: sA,
      });
      decisionRan = true;
      console.error('   decision recorded');
    } catch (e) {
      decisionSkipped = true;
      console.error(`   ⏭️  SKIP decision_record (Ollama likely down): ${e instanceof Error ? e.message : e}`);
    }

    // ============================================================
    // SESSION B — fresh session, project-scoped read-back
    // ============================================================
    console.error('\n🔎 SESSION B: project-scoped resume + plan version reads');

    const resume = await rpc(daemonUrl, 'state_resume', { project_id: project.projectId, session_id: sB });

    // --- Q1: recent activity (context survived across sessions) ---
    const focuses = (resume.active_context ?? []).map((c: any) => c.focus);
    const q1Pass = focuses.includes('Implementing session-state Phase C');
    record('Q1 "What did I do recently?"', q1Pass, q1Pass ? `focus present: "${focuses[0]}"` : `focuses=${JSON.stringify(focuses)}`);

    // --- Q2: status (in_progress in, done excluded) ---
    const openTitles = (resume.open_tasks ?? []).map((t: any) => t.title);
    const hasM6 = openTitles.includes('M6 resume');
    const excludesM7 = !openTitles.includes('M7 migration');
    const q2Pass = hasM6 && excludesM7;
    record(
      'Q2 "What\'s the status?"',
      q2Pass,
      q2Pass ? `open=[M6 resume], done M7 excluded` : `open_tasks=${JSON.stringify(openTitles)} (hasM6=${hasM6}, excludesM7=${excludesM7})`,
    );

    // --- Q3: original plan (version 1) ---
    const planV1 = await rpc(daemonUrl, 'state_get_plan', { title: 'phase-c', version: 1, session_id: sB });
    let q3Pass = false;
    let q3Detail = 'no plan returned';
    if (planV1?.plan?.clone_path) {
      const content = readFileSync(planV1.plan.clone_path, 'utf-8');
      q3Pass = planV1.plan.version === 1 && content.includes('ORIGINAL PLAN v1');
      q3Detail = q3Pass ? `v1 clone contains "ORIGINAL PLAN v1"` : `v=${planV1.plan.version}, content=${JSON.stringify(content.slice(0, 60))}`;
    }
    record('Q3 "What was the original plan?"', q3Pass, q3Detail);

    // --- Q4: current/active plan ---
    const planActive = await rpc(daemonUrl, 'state_get_plan', { title: 'phase-c', session_id: sB });
    let q4Pass = false;
    let q4Detail = 'no plan returned';
    if (planActive?.plan?.clone_path) {
      const content = readFileSync(planActive.plan.clone_path, 'utf-8');
      q4Pass = content.includes('REVISED PLAN v2') && planActive.plan.status === 'active';
      q4Detail = q4Pass
        ? `active plan v${planActive.plan.version} contains "REVISED PLAN v2"`
        : `v=${planActive.plan.version}, status=${planActive.plan.status}, content=${JSON.stringify(content.slice(0, 60))}`;
    }
    record('Q4 "What plan am I on now?"', q4Pass, q4Detail);

    // --- Bonus: decision surfaced in resume (only if it ran) ---
    if (decisionRan) {
      const decSummaries = (resume.recent_decisions ?? []).map((d: any) => d.summary);
      const decPass = decSummaries.includes('project-scoped resume');
      record('Bonus: recent_decisions in resume', decPass, decPass ? 'decision surfaced' : `decisions=${JSON.stringify(decSummaries)}`);
    }
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    record('FATAL', false, e instanceof Error ? e.message : String(e));
  } finally {
    await shutdownDaemon(daemonUrl);
    try {
      rmSync(project.projectDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }

  // ============================================================
  // Verdict matrix
  // ============================================================
  console.error('\n' + '═'.repeat(60));
  console.error('📊 ACCEPTANCE MATRIX');
  console.error('─'.repeat(60));
  for (const v of verdicts) {
    console.error(`  ${v.pass ? '✅ PASS' : '❌ FAIL'}  ${v.q}`);
    console.error(`         ${v.detail}`);
  }
  if (decisionSkipped) {
    console.error('  ⏭️  SKIP  decision_record (Ollama down) — optional, not gating');
  }
  console.error('─'.repeat(60));

  const allPass = verdicts.length > 0 && verdicts.every((v) => v.pass);
  if (allPass) {
    console.error('\n✅ PHASE C ACCEPTANCE: PASS\n');
    process.exit(0);
  } else {
    console.error('\n❌ PHASE C ACCEPTANCE: FAIL\n');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
