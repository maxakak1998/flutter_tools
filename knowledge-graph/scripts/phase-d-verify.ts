#!/usr/bin/env npx tsx
/**
 * Phase-D verification — scale + anti-orphaning subsystem (M8–M11).
 *
 * Exercises, against a throwaway KuzuDB (no daemon, no Ollama, no embeddings):
 *   - M9  projection — buildProjection folds >1 session, UNIONs refs, one focus
 *         per session, combined open-task board.
 *   - M9  CAS — casUpdateSessionState throws on a stale expectedVersion and
 *         succeeds (bumping version) on the correct one.
 *   - M10 prune — anti-orphaning GC: a backdated (>7d) live/unpinned/unfinished
 *         task is surfaced (read-only), then evicted (active=false); pinned rows,
 *         'done' rows, and plan rows are NEVER surfaced or evicted.
 *   - M10 resume orphan section — handleStateResume flags the same backdated task
 *         in its separate `orphaned` field.
 *   - M11 compact — 60 active_context rows with keepRecent=50 fold the older 10
 *         into ONE summary event; originals go active=false; the newest 50 are
 *         untouched; a pinned old row survives.
 *
 * Prints "PHASE D VERIFY: PASS" on success; throws on any assertion failure.
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { SessionStateRow } from '../src/types.js';
import { handleStateSetContext } from '../src/tools/state-context.js';
import { handleStateTaskUpsert, casUpdateSessionState } from '../src/tools/state-task.js';
import { buildProjection } from '../src/engine/projection.js';
import { handleStatePrune } from '../src/tools/state-prune.js';
import { handleStateResume } from '../src/tools/state-checkpoint.js';
import { handleStateTaskList } from '../src/tools/state-task.js';
import { handleStateCompact } from '../src/tools/state-compact.js';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';

const testRoot = join(tmpdir(), `kg-phase-d-${Date.now()}`);
const testDbPath = join(testRoot, 'db');

const PROJ_PROJECTION = 'proj-d-projection';
const PROJ_CAS = 'proj-d-cas';
const PROJ_PRUNE = 'proj-d-prune';
const PROJ_COMPACT = 'proj-d-compact';

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

async function assertThrows(fn: () => Promise<unknown>, name: string): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, name);
}

/** ISO timestamp N whole days before now. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Insert a SessionState row directly with full control over timestamps/flags. */
async function seedRow(row: Partial<SessionStateRow> & Pick<SessionStateRow, 'project_id' | 'session_id' | 'artifact_type'>): Promise<string> {
  const id = row.id ?? randomUUID();
  const ts = row.created_at ?? new Date().toISOString();
  await storage.createSessionState({
    id,
    session_id: row.session_id,
    project_id: row.project_id,
    artifact_type: row.artifact_type,
    status: row.status ?? 'pending',
    title: row.title ?? '',
    body: row.body ?? '',
    refs: row.refs ?? [],
    version: row.version ?? 1,
    pinned: row.pinned ?? false,
    active: row.active ?? true,
    created_at: ts,
    updated_at: row.updated_at ?? ts,
    last_touched_at: row.last_touched_at ?? ts,
  });
  return id;
}

// ============================================================
// M9 — projection: fold >1 session
// ============================================================
async function verifyProjection(): Promise<void> {
  console.error('\n🗂  M9 — buildProjection folds multiple sessions');

  const A = 'sess-A';
  const B = 'sess-B';

  // Session A: two context rows (latest focus wins), refs a.ts + shared.ts.
  await handleStateSetContext(storage, A, PROJ_PROJECTION, 'A early focus', 'a-step-1', ['a.ts', 'shared.ts']);
  await handleStateSetContext(storage, A, PROJ_PROJECTION, 'A latest focus', 'a-step-2', ['a.ts', 'shared.ts']);
  // Session B: one context row, refs b.ts + shared.ts.
  await handleStateSetContext(storage, B, PROJ_PROJECTION, 'B focus', 'b-step-1', ['b.ts', 'shared.ts']);

  // One open task per session + one done task (excluded from open board).
  await handleStateTaskUpsert(storage, A, PROJ_PROJECTION, 'A open task', 'pending');
  await handleStateTaskUpsert(storage, B, PROJ_PROJECTION, 'B blocked task', 'blocked');
  const doneTask = await handleStateTaskUpsert(storage, A, PROJ_PROJECTION, 'A done task', 'pending');
  await handleStateTaskUpsert(storage, A, PROJ_PROJECTION, '', 'done', doneTask.id);

  const view = await buildProjection(storage, PROJ_PROJECTION);

  // One folded focus per session.
  assert(view.sessions.length === 2, 'projection folds exactly 2 sessions', `got ${view.sessions.length}`);
  const focA = view.sessions.find((s) => s.session_id === A);
  const focB = view.sessions.find((s) => s.session_id === B);
  assert(!!focA && focA.focus === 'A latest focus', "session A's latest focus wins the fold", focA?.focus);
  assert(!!focB && focB.focus === 'B focus', "session B's focus is present", focB?.focus);
  assert(!!focA && focA.next_step === 'a-step-2', 'per-session next_step round-trips from latest row', focA?.next_step ?? 'null');

  // UNION of edited-file refs across all sessions' active_context rows.
  const files = view.edited_files;
  assert(
    files.length === 3 && files.includes('a.ts') && files.includes('b.ts') && files.includes('shared.ts'),
    'edited_files is the UNION of refs across sessions (deduped)',
    files.join(','),
  );

  // Combined open-task board (done excluded).
  assert(view.open_tasks.length === 2, 'open_tasks combines both sessions, done excluded', `got ${view.open_tasks.length}`);
  assert(!view.open_tasks.some((t) => t.status === 'done'), 'no done task leaks into the projection board');
  const sessionsInBoard = new Set(view.open_tasks.map((t) => t.session_id));
  assert(sessionsInBoard.has(A) && sessionsInBoard.has(B), 'open tasks attributed to their owning sessions');
}

// ============================================================
// M9 — CAS: optimistic concurrency
// ============================================================
async function verifyCAS(): Promise<void> {
  console.error('\n🔒 M9 — casUpdateSessionState optimistic concurrency');

  const task = await handleStateTaskUpsert(storage, 'sess-cas', PROJ_CAS, 'CAS target', 'pending');
  const created = await storage.getSessionState(task.id);
  assert(!!created && created.version === 1, 'freshly-created task starts at version 1', `v${created?.version}`);

  // Stale expectedVersion -> conflict throw, and no write applied.
  await assertThrows(
    () => casUpdateSessionState(storage, task.id, 99, { status: 'blocked' }),
    'stale expectedVersion (99) THROWS a version conflict',
  );
  const afterStale = await storage.getSessionState(task.id);
  assert(!!afterStale && afterStale.version === 1 && afterStale.status === 'pending', 'failed CAS leaves the row untouched (still v1, pending)', `v${afterStale?.version}/${afterStale?.status}`);

  // Correct expectedVersion -> succeeds and bumps version.
  const bumped = await casUpdateSessionState(storage, task.id, 1, { status: 'in_progress' });
  assert(bumped.version === 2, 'correct expectedVersion succeeds and bumps version to 2', `v${bumped.version}`);
  assert(bumped.status === 'in_progress', 'CAS write applied the status update', bumped.status);
  const afterOk = await storage.getSessionState(task.id);
  assert(!!afterOk && afterOk.version === 2, 'version bump is persisted', `v${afterOk?.version}`);

  // Re-using the now-stale original version throws again.
  await assertThrows(
    () => casUpdateSessionState(storage, task.id, 1, { status: 'done' }),
    're-using the consumed version (1) THROWS after the bump',
  );
}

// ============================================================
// M10 — prune (anti-orphaning) + resume orphan section
// ============================================================
async function verifyPruneAndOrphan(): Promise<void> {
  console.error('\n🧹 M10 — state_prune anti-orphaning + resume orphan section');

  const S = 'sess-prune';
  const old = daysAgoIso(10); // > 7-day cutoff

  // The orphan: a live, unpinned, unfinished task untouched for 10 days.
  const orphanId = await seedRow({
    project_id: PROJ_PRUNE, session_id: S, artifact_type: 'task',
    status: 'pending', title: 'Forgotten task', pinned: false, active: true,
    created_at: old, last_touched_at: old,
  });

  // Controls that must NEVER be surfaced/evicted.
  const pinnedId = await seedRow({
    project_id: PROJ_PRUNE, session_id: S, artifact_type: 'task',
    status: 'pending', title: 'Pinned task', pinned: true, active: true,
    created_at: old, last_touched_at: old,
  });
  const doneId = await seedRow({
    project_id: PROJ_PRUNE, session_id: S, artifact_type: 'task',
    status: 'done', title: 'Done task', pinned: false, active: true,
    created_at: old, last_touched_at: old,
  });
  const planId = await seedRow({
    project_id: PROJ_PRUNE, session_id: S, artifact_type: 'plan',
    status: 'active', title: 'Old plan', pinned: false, active: true,
    created_at: old, last_touched_at: old,
  });
  // A fresh task (touched today) must not be an orphan either.
  const freshId = await seedRow({
    project_id: PROJ_PRUNE, session_id: S, artifact_type: 'task',
    status: 'pending', title: 'Fresh task', pinned: false, active: true,
  });

  // --- surface mode: read-only, returns only the orphan ---
  const surfaced = await handleStatePrune(storage, PROJ_PRUNE, undefined, 'surface');
  assert(surfaced.mode === 'surface', 'surface mode reported', surfaced.mode);
  assert(surfaced.evicted_count === 0, 'surface mode evicts nothing', String(surfaced.evicted_count));
  assert(surfaced.orphaned.length === 1, 'exactly one orphan surfaced', `got ${surfaced.orphaned.length}`);
  assert(surfaced.orphaned[0].id === orphanId, 'the surfaced orphan is the backdated task', surfaced.orphaned[0].id);
  assert(surfaced.orphaned[0].age_days >= 7, 'orphan age_days is past the cutoff', String(surfaced.orphaned[0].age_days));
  const surfacedIds = new Set(surfaced.orphaned.map((o) => o.id));
  assert(!surfacedIds.has(pinnedId), 'pinned row is NEVER surfaced');
  assert(!surfacedIds.has(doneId), 'done row is NEVER surfaced');
  assert(!surfacedIds.has(planId), 'plan row is NEVER surfaced');
  assert(!surfacedIds.has(freshId), 'freshly-touched row is NOT an orphan');

  // surface mode must not have mutated anything.
  const orphanAfterSurface = await storage.getSessionState(orphanId);
  assert(!!orphanAfterSurface && orphanAfterSurface.active === true, 'surface mode left the orphan active (read-only)');

  // --- resume orphan section: same backdated task flagged in `orphaned` ---
  const resume = await handleStateResume(storage, PROJ_PRUNE);
  const resumeOrphanIds = new Set(resume.orphaned.map((o) => o.id));
  assert(resumeOrphanIds.has(orphanId), 'resume flags the backdated task in its orphaned field');
  assert(!resumeOrphanIds.has(pinnedId) && !resumeOrphanIds.has(doneId) && !resumeOrphanIds.has(planId), 'resume orphaned excludes pinned/done/plan rows');
  assert(!resume.open_tasks.some((t) => t.id === orphanId) || resume.orphaned.some((o) => o.id === orphanId), 'orphan is tracked distinctly in the orphaned section');

  // --- evict mode: soft-evicts only the orphan ---
  const evicted = await handleStatePrune(storage, PROJ_PRUNE, undefined, 'evict');
  assert(evicted.mode === 'evict', 'evict mode reported', evicted.mode);
  assert(evicted.evicted_count === 1, 'evict mode soft-evicts exactly the one orphan', String(evicted.evicted_count));
  assert(evicted.orphaned[0].id === orphanId, 'the evicted row is the orphan', evicted.orphaned[0].id);

  const orphanAfterEvict = await storage.getSessionState(orphanId);
  assert(!!orphanAfterEvict && orphanAfterEvict.active === false, 'evicted orphan is now active=false');

  // Regression guard: an evicted row MUST disappear from the working ledger
  // read surfaces — not just carry active=false at the storage layer.
  const ledgerAfterEvict = await handleStateTaskList(storage, PROJ_PRUNE);
  assert(
    !ledgerAfterEvict.tasks.some((t) => t.id === orphanId),
    'evicted orphan no longer surfaces in state_task_list',
  );
  const resumeAfterEvict = await handleStateResume(storage, PROJ_PRUNE);
  assert(
    !resumeAfterEvict.open_tasks.some((t) => t.id === orphanId),
    'evicted orphan no longer surfaces in state_resume open_tasks',
  );

  // Controls remain live and untouched.
  const pinnedAfter = await storage.getSessionState(pinnedId);
  const doneAfter = await storage.getSessionState(doneId);
  const planAfter = await storage.getSessionState(planId);
  assert(!!pinnedAfter && pinnedAfter.active === true, 'pinned row is NEVER evicted (still active)');
  assert(!!doneAfter && doneAfter.active === true, 'done row is NEVER evicted (still active)');
  assert(!!planAfter && planAfter.active === true, 'plan row is NEVER evicted (still active)');
}

// ============================================================
// M11 — compact: bound the working-memory stream
// ============================================================
async function verifyCompact(): Promise<void> {
  console.error('\n📦 M11 — state_compact folds older working memory');

  const S = 'sess-compact';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

  // 60 regular unpinned active_context rows, strictly-increasing created_at.
  const regularIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const ts = new Date(base + (i + 1) * 1000).toISOString();
    const id = await seedRow({
      project_id: PROJ_COMPACT, session_id: S, artifact_type: 'active_context',
      status: 'current', title: `focus ${i}`, refs: [`f${i}.ts`],
      pinned: false, active: true, created_at: ts, updated_at: ts, last_touched_at: ts,
    });
    regularIds.push(id);
  }
  // One PINNED old row (oldest of all) — must survive compaction.
  const pinnedOldId = await seedRow({
    project_id: PROJ_COMPACT, session_id: S, artifact_type: 'active_context',
    status: 'current', title: 'pinned old focus', refs: ['pinned.ts'],
    pinned: true, active: true,
    created_at: new Date(base).toISOString(), // older than every regular row
    updated_at: new Date(base).toISOString(),
    last_touched_at: new Date(base).toISOString(),
  });

  // newest-first: 60 regular (newest→oldest) then the pinned old row last.
  // keepRecent=50 protects the newest 50 regular rows; the older window is the
  // 10 oldest regular rows + the pinned row. Pinned is dropped from fold set,
  // leaving exactly 10 to fold.
  const result = await handleStateCompact(storage, PROJ_COMPACT, { keepRecent: 50 });

  assert(result.compacted_count === 10, 'exactly 10 older events folded', String(result.compacted_count));
  assert(result.sessions_affected === 1, 'compaction affected exactly one session', String(result.sessions_affected));
  assert(result.summaries.length === 1, 'one summary snapshot produced', String(result.summaries.length));
  const summaryId = result.summaries[0].summary_id;
  assert(result.summaries[0].folded === 10, 'summary records 10 folded rows', String(result.summaries[0].folded));

  // The 10 oldest regular rows are the folded ones (originals soft-evicted).
  const oldest10 = regularIds.slice(0, 10);
  for (const id of oldest10) {
    const row = await storage.getSessionState(id);
    assert(!!row && row.active === false, `folded original ${id.slice(0, 8)} is now active=false`);
  }

  // The newest 50 regular rows are untouched (still active).
  const newest50 = regularIds.slice(10);
  let untouched = 0;
  for (const id of newest50) {
    const row = await storage.getSessionState(id);
    if (row && row.active === true) untouched++;
  }
  assert(untouched === 50, 'the newest 50 rows are untouched (still active)', String(untouched));

  // The pinned old row survives (never compacted).
  const pinnedRow = await storage.getSessionState(pinnedOldId);
  assert(!!pinnedRow && pinnedRow.active === true && pinnedRow.pinned === true, 'pinned old row survives compaction (active & pinned)');

  // The summary is a new active 'event' row recording the fold.
  const summaryRow = await storage.getSessionState(summaryId);
  assert(!!summaryRow && summaryRow.artifact_type === 'event' && summaryRow.active === true, 'fold summary is an active event row');
  const body = JSON.parse(summaryRow!.body) as { compacted?: boolean; count?: number };
  assert(body.compacted === true && body.count === 10, 'summary body records the compacted count (10)', JSON.stringify(body));
}

async function main(): Promise<void> {
  console.error('\n📦 Phase-D verify — scale + anti-orphaning (M8–M11) — kuzu');
  console.error(`  DB: ${testDbPath}\n`);

  try {
    storage = await createStorage('kuzu', testDbPath);
    assert(!!storage, 'createStorage(kuzu) returned a storage instance');

    await verifyProjection();
    await verifyCAS();
    await verifyPruneAndOrphan();
    await verifyCompact();

    console.error(`\n📊 ${checks} assertions passed`);
    console.error('\nPHASE D VERIFY: PASS\n');
  } finally {
    if (storage) {
      try { await storage.close(); } catch {}
    }
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error(`\n💥 PHASE D VERIFY: FAIL — ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
