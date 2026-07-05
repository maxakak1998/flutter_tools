#!/usr/bin/env npx tsx
/**
 * Phase-C verification for the resume/briefing subsystem (M6).
 *
 * Verifies handleStateResume (the project-scoped "catch me up" packet) folds the
 * working state correctly against a throwaway KuzuDB. No daemon, no Ollama, no
 * embeddings needed — every path exercised here is storage-level:
 *   - active_context / task / plan rows live in SessionState (volatile, no vector).
 *   - decisions are category='decision' Chunk rows inserted via createChunk with a
 *     dummy zero-vector embedding (no live embedder required).
 *
 * The resume packet must contain:
 *   - the LATEST active context (newest-first, across all sessions of the project)
 *   - only NON-done tasks (the 'done' task is excluded)
 *   - the ACTIVE plan (v2) — with v1 still retrievable as the original via get_plan
 *   - the recent decisions (newest-first)
 *
 * Prints "PHASE C VERIFY: PASS" on success; throws on any assertion failure.
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { EMBEDDING_DIMENSIONS } from '../src/types.js';
import { handleStateSetContext } from '../src/tools/state-context.js';
import { handleStateSavePlan, handleStateGetPlan } from '../src/tools/state-plan.js';
import { handleStateTaskUpsert } from '../src/tools/state-task.js';
import { handleStateResume } from '../src/tools/state-checkpoint.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, mkdirSync, writeFileSync } from 'fs';

const testRoot = join(tmpdir(), `kg-phase-c-${Date.now()}`);
const testDbPath = join(testRoot, 'db');
const kgDir = join(testRoot, 'kg'); // clone root for plan snapshots
const srcDir = join(testRoot, 'src-plans'); // source .md files that get cloned

const PROJECT = 'proj-c';
const SESSION = 'sess-c';

let storage: IStorage;
let checks = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.error(`  ✅ ${name}`);
    checks++;
  } else {
    const msg = `ASSERTION FAILED: ${name}${detail ? ` — ${detail}` : ''}`;
    console.error(`  ❌ ${msg}`);
    throw new Error(msg);
  }
}

/** Distinct, strictly-increasing ISO timestamps so newest-first ordering is deterministic. */
function isoAt(offsetMs: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + offsetMs).toISOString();
}

/** Insert a category='decision' Chunk directly (dummy embedding), with a fixed created_at. */
async function seedDecision(id: string, summary: string, content: string, createdAt: string): Promise<void> {
  await storage.createChunk({
    id,
    sync_id: `${id}-sync`,
    embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
    content,
    summary,
    source: null,
    domain: 'architecture',
    category: 'decision',
    importance: 'high',
    layer: 'core-knowledge',
    keywords: ['decision', 'rollout'],
    entities: [],
    tags: [],
    version: 1,
    confidence: 0.5,
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle: 'active',
    access_count: 0,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

async function seed(): Promise<void> {
  console.error('\n🌱 Seeding working state (contexts, tasks, plan v1→v2, decisions)');

  // --- active_context: a couple of rows; the second is the latest focus. ---
  await handleStateSetContext(
    storage, SESSION, PROJECT,
    'Bootstrap resume subsystem', 'wire handlers', ['src/tools/state-checkpoint.ts'], 'early focus',
  );
  await handleStateSetContext(
    storage, SESSION, PROJECT,
    'Verify resume packet', 'run phase-c-verify', ['scripts/phase-c-verify.ts'], 'latest focus',
  );

  // --- tasks: one done (must be EXCLUDED), one blocked (must be INCLUDED). ---
  const tDone = await handleStateTaskUpsert(storage, SESSION, PROJECT, 'Ship M5 tasks', 'pending', undefined, [], 'foundational');
  await handleStateTaskUpsert(storage, SESSION, PROJECT, '', 'done', tDone.id); // flip to done in place
  await handleStateTaskUpsert(storage, SESSION, PROJECT, 'Finalize M6 resume', 'blocked', undefined, [tDone.id], 'awaiting review');

  // --- plan: save v1 (original), then v2 (supersedes v1). ---
  mkdirSync(srcDir, { recursive: true });
  const planSrc = join(srcDir, 'phase-c-plan.md');
  const title = 'Phase C Plan';
  writeFileSync(planSrc, '# Phase C Plan\n\nStep 1: original.\n');
  await handleStateSavePlan(storage, kgDir, SESSION, PROJECT, planSrc, title, isoAt(1000));
  writeFileSync(planSrc, '# Phase C Plan\n\nStep 1: revised.\nStep 2: added.\n');
  await handleStateSavePlan(storage, kgDir, SESSION, PROJECT, planSrc, title, isoAt(2000));

  // --- decisions: two category='decision' chunks, newest = dec-2. ---
  await seedDecision('dec-1', 'Chose lever A', 'Chose lever A for rollout; failed under load.', isoAt(500));
  await seedDecision('dec-2', 'Retry with tuning succeeded', 'Lever A retry with tuning succeeded.', isoAt(1500));

  console.error('  ✅ seed complete');
}

async function verifyResume(): Promise<void> {
  console.error('\n🔁 M6 — handleStateResume packet assertions');

  const packet = await handleStateResume(storage, PROJECT);

  // Project scoping.
  assert(packet.project_id === PROJECT, 'packet is scoped to the project', packet.project_id);
  assert(packet.since_days === null, 'no time window applied by default');

  // Latest active context (newest-first).
  assert(packet.active_context.length === 2, 'resume folds in both active_context rows', `got ${packet.active_context.length}`);
  assert(
    packet.active_context[0].focus === 'Verify resume packet',
    'latest active context is first (newest-first)',
    packet.active_context[0].focus,
  );
  assert(packet.active_context[0].next_step === 'run phase-c-verify', 'latest context next_step round-trips through resume');
  assert(
    packet.active_context[1].focus === 'Bootstrap resume subsystem',
    'earlier context follows the latest in the trail',
    packet.active_context[1].focus,
  );

  // Only NON-done tasks — the 'done' task must be excluded, the blocked one kept.
  assert(packet.open_tasks.length === 1, 'exactly one open task (done task excluded)', `got ${packet.open_tasks.length}`);
  const open = packet.open_tasks[0];
  assert(open.title === 'Finalize M6 resume', 'the surviving open task is the blocked one', open.title);
  assert(open.status === 'blocked', 'open task carries its blocked status', open.status);
  assert(open.blocked_by.length === 1, 'open task retains its blocked_by dependency', open.blocked_by.join(','));
  assert(
    !packet.open_tasks.some((t) => t.status === 'done'),
    'no done task leaks into the resume packet',
  );

  // Active plan = v2; v1 still retrievable as the original.
  assert(packet.active_plans.length === 1, 'exactly one active plan surfaced', `got ${packet.active_plans.length}`);
  const activePlan = packet.active_plans[0];
  assert(activePlan.version === 2, 'the active plan is v2 (latest)', `v${activePlan.version}`);
  assert(activePlan.title === 'Phase C Plan', 'active plan carries its title', activePlan.title);
  assert(!!activePlan.clone_path && activePlan.clone_path.endsWith('.md'), 'active plan exposes its immutable clone path');

  const original = await handleStateGetPlan(storage, PROJECT, SESSION, 'Phase C Plan', 1);
  assert(original.plan !== null && original.plan.version === 1, 'v1 still retrievable as the original plan', `v${original.plan?.version}`);
  assert(original.plan!.status === 'superseded', 'v1 reports superseded status (v2 took over)', original.plan?.status);
  assert(original.total === 2, 'plan version history spans both v1 and v2', `got ${original.total}`);

  // Recent decisions (newest-first).
  assert(packet.recent_decisions.length === 2, 'both decisions surfaced in resume', `got ${packet.recent_decisions.length}`);
  assert(
    packet.recent_decisions[0].id === 'dec-2',
    'most recent decision (dec-2) is first',
    packet.recent_decisions[0].id,
  );
  assert(
    packet.recent_decisions[1].id === 'dec-1',
    'older decision (dec-1) follows',
    packet.recent_decisions[1].id,
  );
  assert(
    packet.recent_decisions[0].summary === 'Retry with tuning succeeded',
    'decision summary round-trips through resume',
    packet.recent_decisions[0].summary,
  );

  // The markdown briefing is rendered and reflects the folded state.
  assert(packet.markdown.includes('Verify resume packet'), 'markdown briefing includes the latest focus');
  assert(packet.markdown.includes('Finalize M6 resume'), 'markdown briefing lists the open task');
  assert(packet.markdown.includes('Phase C Plan') && packet.markdown.includes('v2'), 'markdown briefing shows the active plan v2');
  assert(!packet.markdown.includes('Ship M5 tasks'), 'markdown briefing omits the done task');
}

async function main(): Promise<void> {
  console.error('\n📦 Phase-C verify — resume/briefing (M6) — kuzu');
  console.error(`  DB: ${testDbPath}\n`);

  try {
    storage = await createStorage('kuzu', testDbPath);
    assert(!!storage, 'createStorage(kuzu) returned a storage instance');

    await seed();
    await verifyResume();

    console.error(`\n📊 ${checks} assertions passed`);
    console.error('\nPHASE C VERIFY: PASS\n');
  } finally {
    if (storage) {
      try { await storage.close(); } catch {}
    }
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error(`\n💥 PHASE C VERIFY: FAIL — ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
