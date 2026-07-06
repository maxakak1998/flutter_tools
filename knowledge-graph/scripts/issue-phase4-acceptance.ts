#!/usr/bin/env npx tsx

/**
 * Phase 4 ACCEPTANCE — kg beads closed loop end-to-end over a REAL daemon (RPC).
 *
 * Proves the whole loop works through the same HTTP JSON-RPC path Claude Code uses:
 *   issue_create → anchor session (state_set_context current_issue)
 *   → decision_record (auto-links) → issue_update close
 *   → issue_show still surfaces the decision (knowledge kept after close)
 *   → issue_ready / issue_list behave.
 *
 * Runs against built dist/ (daemon-manager forks daemon.js). Requires Ollama.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ensureDaemon } from '../dist/daemon-manager.js';
import { loadConfig } from '../dist/config.js';
import { makeRpcRequest } from '../dist/rpc.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function createProject(): any {
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-beads-accept-'));
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });
  const config = {
    version: 1, project_id: randomUUID(), project_name: 'accept',
    created_at: new Date().toISOString(),
    daemon: { port_range_start: 0, idle_timeout_ms: 60_000 }, overrides: {},
  };
  writeFileSync(join(kgDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return {
    projectId: config.project_id, projectName: config.project_name, projectDir, kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'), configPath: join(kgDir, 'config.json'),
    daemonPortFile: join(kgDir, 'daemon.port'), daemonPidFile: join(kgDir, 'daemon.pid'), config,
  };
}

async function main() {
  console.error('🧪 Phase 4 ACCEPTANCE — kg beads closed loop (real daemon)');
  console.error('═'.repeat(58));

  const project = createProject();
  const config = loadConfig();
  let daemonUrl: string | null = null;
  const SESSION = 'accept-session-1';

  const rpc = async (method: string, params: any) => {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRpcRequest(method, { ...params, session_id: SESSION })),
    });
    const json = await res.json() as { result?: any; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };

  try {
    daemonUrl = await ensureDaemon(project, config);
    await fetch(`${daemonUrl}/rpc/connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: SESSION }),
    });

    console.error('\n📋 Step 1: issue_create');
    const issue = await rpc('issue_create', { title: 'Betslip odds gate false positive', description: 'SRM+Boost blocked', priority: 'p0' });
    assert(!!issue.issue_ref, 'issue created with ref', issue.issue_ref);

    console.error('\n📋 Step 2: anchor session to the issue');
    await rpc('state_set_context', { focus: 'Fixing odds gate', current_issue: issue.issue_ref });

    console.error('\n📋 Step 3: decision_record auto-links to the anchored issue');
    const dec = await rpc('decision_record', {
      content: 'Compare boosted odds against boosted baseline, not preBoost, to avoid false drift.',
      summary: 'Odds gate compares boosted vs boosted',
      domain: 'betslip', keywords: ['odds', 'boost', 'gate'],
    });
    assert(!!dec.id, 'decision recorded', dec.id);

    console.error('\n📋 Step 4: issue_show surfaces the linked decision');
    let show = await rpc('issue_show', { issue_ref: issue.issue_ref });
    assert(show.linked.some((l: any) => l.id === dec.id), 'decision linked to issue via auto-link', `${show.linked.length} linked`);

    console.error('\n📋 Step 5: close the issue — knowledge is kept');
    await rpc('issue_update', { issue_ref: issue.issue_ref, status: 'closed' });
    const list = await rpc('issue_list', {});
    assert(!list.some((i: any) => i.issue_ref === issue.issue_ref), 'closed issue hidden from default list');
    show = await rpc('issue_show', { issue_ref: issue.issue_ref });
    assert(show.issue.status === 'closed', 'issue shows closed');
    assert(show.linked.some((l: any) => l.id === dec.id), 'linked decision STILL present after close (knowledge kept)');

    console.error('\n📋 Step 6: fresh query surfaces the decision (re-query works)');
    const q = await rpc('knowledge_query', { query: 'how do we handle boosted odds in the betslip gate' });
    assert(q.total > 0 && JSON.stringify(q).includes('boosted'), 're-query finds the decision', `total=${q.total}`);

    console.error('\n📋 Step 7: ready-work excludes the closed issue');
    const open2 = await rpc('issue_create', { title: 'Another open bug', priority: 'p1' });
    const ready = await rpc('issue_ready', {});
    assert(ready.some((r: any) => r.issue_ref === open2.issue_ref), 'new open issue is ready');
    assert(!ready.some((r: any) => r.issue_ref === issue.issue_ref), 'closed issue not in ready-work');
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    if (daemonUrl) await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
    try { rmSync(project.projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.error('═'.repeat(58));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
