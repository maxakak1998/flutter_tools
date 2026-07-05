#!/usr/bin/env npx tsx
/**
 * Phase-B verification for the session-state + decision subsystems.
 *
 * Verifies modules M2 (active_context), M3 (decision persistence at storage level),
 * M4 (plan versioning), and M5 (task upsert/list) against a throwaway KuzuDB.
 * No daemon, no Ollama, no embeddings needed — these paths are all storage-level:
 *   - M2/M4/M5 use SessionState (volatile, no embedding, no vector index).
 *   - M3 decision persistence is proven at the STORAGE layer by inserting two
 *     category='decision' Chunk rows with distinct ids and near-identical content
 *     via createChunk (dummy zero-vector embedding) and asserting both persist —
 *     this proves the Chunk table accepts iterative decisions side by side.
 *     The dedup-BYPASS logic itself lives in handleStore (needs a live embedder),
 *     so full dedup-bypass is covered by scripts/phase-b-decision-check.ts (daemon
 *     / Ollama level), which this script intentionally does NOT duplicate.
 *
 * Exercises the real Phase-B tool handlers wherever they are storage-only:
 *   M2 → handleStateSetContext / handleStateGetContext
 *   M4 → handleStateSavePlan / handleStateGetPlan
 *   M5 → handleStateTaskUpsert / handleStateTaskList
 *
 * Prints "PHASE B VERIFY: PASS" on success; throws on any assertion failure.
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { EMBEDDING_DIMENSIONS } from '../src/types.js';
import {
  handleStateSetContext,
  handleStateGetContext,
} from '../src/tools/state-context.js';
import {
  handleStateSavePlan,
  handleStateGetPlan,
} from '../src/tools/state-plan.js';
import {
  handleStateTaskUpsert,
  handleStateTaskList,
} from '../src/tools/state-task.js';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { rmSync, mkdirSync, writeFileSync } from 'fs';

const testRoot = join(tmpdir(), `kg-phase-b-${Date.now()}`);
const testDbPath = join(testRoot, 'db');
const kgDir = join(testRoot, 'kg'); // used as the clone root for plan snapshots
const srcDir = join(testRoot, 'src-plans'); // source .md files that get cloned

const PROJECT = 'proj-b';
const SESSION = 'sess-b';

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

/** Small helper to guarantee distinct, strictly-increasing ISO timestamps. */
function isoAt(offsetMs: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + offsetMs).toISOString();
}

async function verifyM2Context(): Promise<void> {
  console.error('\n🧭 M2 — active_context set/get (append-only trail, newest-first)');

  // Append three context entries. handleStateSetContext appends a NEW row each call.
  const c1 = await handleStateSetContext(
    storage, SESSION, PROJECT,
    'Investigate build errors', 'run npm run build', ['src/client.ts'], 'first focus',
  );
  const c2 = await handleStateSetContext(
    storage, SESSION, PROJECT,
    'Write verify script', 'exercise M2/M4/M5', ['scripts/phase-b-verify.ts'],
  );
  const c3 = await handleStateSetContext(
    storage, SESSION, PROJECT,
    'Run decision check', undefined, undefined, 'needs Ollama',
  );
  assert(c1.id !== c2.id && c2.id !== c3.id, 'each set_context call mints a distinct row (append-only, no overwrite)');
  assert(c1.focus === 'Investigate build errors' && c1.next_step === 'run npm run build', 'set_context returns normalized focus + next_step');

  // Distinct sessions must not bleed into this session's trail.
  await handleStateSetContext(storage, 'other-sess', PROJECT, 'Unrelated work');

  const got = await handleStateGetContext(storage, SESSION, PROJECT);
  assert(got.session_id === SESSION, 'get_context defaults to caller session id');
  assert(got.total === 3, 'get_context trail counts exactly this session\'s 3 rows (isolation from other-sess)', `got ${got.total}`);
  assert(got.trail.length === 3, 'trail returns all 3 entries within default limit');
  assert(got.latest !== null && got.latest.focus === 'Run decision check', 'latest = most-recently-appended context', got.latest?.focus);
  // Newest-first ordering across the whole trail.
  assert(
    got.trail[0].focus === 'Run decision check' &&
    got.trail[1].focus === 'Write verify script' &&
    got.trail[2].focus === 'Investigate build errors',
    'trail is ordered newest-first',
    got.trail.map((t) => t.focus).join(' | '),
  );
  assert(got.trail[2].next_step === 'run npm run build' && got.trail[2].note === 'first focus', 'JSON body (next_step + note) round-trips through get_context');
  assert(got.trail[2].refs.length === 1 && got.trail[2].refs[0] === 'src/client.ts', 'refs[] round-trips through get_context');

  // limit trims the trail but total still reflects the full count.
  const limited = await handleStateGetContext(storage, SESSION, PROJECT, undefined, 2);
  assert(limited.trail.length === 2 && limited.total === 3, 'limit trims trail length but total reflects all rows', `len=${limited.trail.length} total=${limited.total}`);
  assert(limited.trail[0].focus === 'Run decision check', 'limited trail still newest-first');

  // Explicit empty session id spans all sessions of the project.
  const allSessions = await handleStateGetContext(storage, SESSION, PROJECT, '');
  assert(allSessions.session_id === null, 'empty session id → cross-session scope (session_id null)');
  assert(allSessions.total === 4, 'cross-session scope sees all 4 context rows (both sessions)', `got ${allSessions.total}`);
}

async function verifyM4PlanVersioning(): Promise<void> {
  console.error('\n📋 M4 — plan versioning (immutable clones, supersede, both survive)');

  mkdirSync(srcDir, { recursive: true });
  const planV1Src = join(srcDir, 'rollout-plan.md');
  const planV2Src = join(srcDir, 'rollout-plan.md'); // same file path, edited in place before v2 save
  writeFileSync(planV1Src, '# Rollout Plan\n\nStep 1: original.\n');

  const title = 'Rollout Plan';

  // Save v1 (original plan).
  const v1 = await handleStateSavePlan(storage, kgDir, SESSION, PROJECT, planV1Src, title, isoAt(1000));
  assert(v1.version === 1, 'first save_plan is version 1 (the original plan)', `v${v1.version}`);
  assert(v1.superseded_id === null, 'first plan supersedes nothing');
  assert(!!v1.clone_path && v1.clone_path.endsWith('.md'), 'v1 produced an immutable clone path');

  // Edit the source and save v2 — same title → version increments, v1 superseded.
  writeFileSync(planV2Src, '# Rollout Plan\n\nStep 1: revised.\nStep 2: added.\n');
  const v2 = await handleStateSavePlan(storage, kgDir, SESSION, PROJECT, planV2Src, title, isoAt(2000));
  assert(v2.version === 2, 'second save_plan increments to version 2', `v${v2.version}`);
  assert(v2.superseded_id === v1.id, 'v2 supersedes v1 (records the superseded id)', `${v2.superseded_id} vs ${v1.id}`);
  assert(v1.clone_path !== v2.clone_path, 'v2 clone path is distinct from v1 (immutable snapshots)');

  // Both rows survive at the storage level (nothing deleted on supersede).
  const rows = await storage.listSessionState({ project_id: PROJECT, artifact_type: 'plan' });
  const sameTitle = rows.filter((r) => r.title === title);
  assert(sameTitle.length === 2, 'both plan versions persist after supersede (no delete)', `got ${sameTitle.length}`);
  const v1Row = sameTitle.find((r) => r.id === v1.id)!;
  const v2Row = sameTitle.find((r) => r.id === v2.id)!;
  assert(v1Row.status === 'superseded' && v1Row.active === false, 'v1 row marked superseded + inactive', `status=${v1Row.status} active=${v1Row.active}`);
  assert(v2Row.status === 'active' && v2Row.active === true, 'v2 row is the active plan', `status=${v2Row.status} active=${v2Row.active}`);

  // get_plan default → active (highest) version; version=1 → the original.
  const latest = await handleStateGetPlan(storage, PROJECT, SESSION, title);
  assert(latest.plan !== null && latest.plan.version === 2, 'get_plan default returns the active v2', `v${latest.plan?.version}`);
  assert(latest.total === 2 && latest.versions.length === 2, 'get_plan exposes full version history');
  assert(latest.versions[0].version === 1 && latest.versions[1].version === 2, 'version history ascending (v1 original first)');

  const original = await handleStateGetPlan(storage, PROJECT, SESSION, title, 1);
  assert(original.plan !== null && original.plan.version === 1, 'get_plan version=1 returns the original plan', `v${original.plan?.version}`);
  assert(original.plan!.status === 'superseded', 'original plan reports its superseded status');
}

async function verifyM5Tasks(): Promise<void> {
  console.error('\n✅ M5 — task upsert (create + in-place update) + list filters + blocked_by');

  // Create two tasks; t2 is blocked by t1.
  const t1 = await handleStateTaskUpsert(storage, SESSION, PROJECT, 'Implement storage layer', 'pending', undefined, [], 'foundational');
  const t2 = await handleStateTaskUpsert(storage, SESSION, PROJECT, 'Wire up handlers', 'pending', undefined, [t1.id], undefined);
  assert(t1.id !== t2.id, 'each created task gets a distinct id');
  assert(t1.status === 'pending' && t1.note === 'foundational', 'task create returns status + note');
  assert(t2.blocked_by.length === 1 && t2.blocked_by[0] === t1.id, 'blocked_by round-trips through refs on create', t2.blocked_by.join(','));

  // In-place status update: same id, status flips, id/session unchanged.
  const t1done = await handleStateTaskUpsert(storage, SESSION, PROJECT, '', 'done', t1.id);
  assert(t1done.id === t1.id, 'update reuses the same task id (in-place, no new row)');
  assert(t1done.status === 'done', 'update flipped status todo → done', t1done.status);
  assert(t1done.note === 'foundational', 'update preserved existing note when none supplied');
  assert(t1done.title === 'Implement storage layer', 'empty title on update preserves existing title');

  // Confirm only one row exists per task (update did not append a duplicate).
  const allTasks = await handleStateTaskList(storage, PROJECT, SESSION);
  assert(allTasks.total === 2, 'exactly 2 task rows after 1 update (update was in place, not append)', `got ${allTasks.total}`);

  // Update blocked_by in place and verify it overwrites.
  const t2unblocked = await handleStateTaskUpsert(storage, SESSION, PROJECT, '', 'in_progress', t2.id, []);
  assert(t2unblocked.blocked_by.length === 0, 'explicit empty blocked_by clears the refs', t2unblocked.blocked_by.join(','));
  assert(t2unblocked.status === 'in_progress', 'blocked_by update also flipped status');

  // list-by-status filter.
  const doneOnly = await handleStateTaskList(storage, PROJECT, SESSION, 'done');
  assert(doneOnly.total === 1 && doneOnly.tasks[0].id === t1.id, 'list filters by status=done', `got ${doneOnly.total}`);
  const inProgress = await handleStateTaskList(storage, PROJECT, SESSION, 'in_progress');
  assert(inProgress.total === 1 && inProgress.tasks[0].id === t2.id, 'list filters by status=in_progress', `got ${inProgress.total}`);
  const todoOnly = await handleStateTaskList(storage, PROJECT, SESSION, 'pending');
  assert(todoOnly.total === 0, 'no tasks remain in todo after both moved on', `got ${todoOnly.total}`);

  // Upsert with a bad id must fail loudly (not silently create).
  let threw = false;
  try {
    await handleStateTaskUpsert(storage, SESSION, PROJECT, 'ghost', 'pending', 'no-such-id');
  } catch {
    threw = true;
  }
  assert(threw, 'updating a non-existent task id throws (no silent create)');
}

async function verifyM3DecisionPersistence(): Promise<void> {
  console.error('\n🏛️  M3 — decision persistence at storage level (two near-identical decisions coexist)');
  console.error('     NOTE: dedup-BYPASS logic lives in handleStore (needs an embedder).');
  console.error('           Full dedup-bypass is covered by scripts/phase-b-decision-check.ts.');

  const zeroVec = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const base = {
    embedding: zeroVec,
    source: null,
    domain: 'architecture',
    importance: 'high',
    layer: 'core-knowledge',
    keywords: ['lever', 'retry'],
    entities: [],
    tags: [],
    version: 1,
    confidence: 0.5,
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle: 'active',
    access_count: 0,
  };

  const id1 = await storage.createChunk({
    ...base,
    id: 'dec-1',
    sync_id: 'dec-sync-1',
    content: 'Chose lever A for the rollout. Lever A failed under load, reverting.',
    summary: 'Lever A attempt failed',
    category: 'decision',
  });
  const id2 = await storage.createChunk({
    ...base,
    id: 'dec-2',
    sync_id: 'dec-sync-2',
    content: 'Chose lever A for the rollout. Lever A retry with tuning succeeded.',
    summary: 'Lever A retry succeeded',
    category: 'decision',
  });

  assert(id1 === 'dec-1' && id2 === 'dec-2', 'both decision chunks created with distinct ids');

  const c1 = await storage.getChunk('dec-1');
  const c2 = await storage.getChunk('dec-2');
  assert(c1 !== null && c2 !== null, 'both decision chunks persist side by side (table accepts iterative decisions)');
  assert(c1!.category === 'decision' && c2!.category === 'decision', 'category=decision persisted on both chunks');
  assert(c1!.content !== c2!.content, 'near-identical decisions retain their distinct content (not merged)');

  // SUPERSEDES lineage edge (as handleDecisionRecord would create) round-trips.
  await storage.createRelation('dec-2', 'dec-1', 'SUPERSEDES', { reason: 'retry supersedes failed attempt' });
  const edges = await storage.getAllEdges();
  const supersede = edges.find((e) => e.from === 'dec-2' && e.to === 'dec-1' && e.relation === 'supersedes');
  assert(!!supersede, 'SUPERSEDES lineage edge dec-2 → dec-1 persists (queryable decision lineage)');
}

async function main(): Promise<void> {
  console.error('\n📦 Phase-B verify — session-state (M2/M4/M5) + decision persistence (M3) — kuzu');
  console.error(`  DB: ${testDbPath}\n`);

  try {
    storage = await createStorage('kuzu', testDbPath);
    assert(!!storage, 'createStorage(kuzu) returned a storage instance');

    await verifyM2Context();
    await verifyM4PlanVersioning();
    await verifyM5Tasks();
    await verifyM3DecisionPersistence();

    console.error(`\n📊 ${checks} assertions passed`);
    console.error('\nPHASE B VERIFY: PASS\n');
  } finally {
    if (storage) {
      try { await storage.close(); } catch {}
    }
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error(`\n💥 PHASE B VERIFY: FAIL — ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
