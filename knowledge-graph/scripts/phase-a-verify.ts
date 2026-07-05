#!/usr/bin/env npx tsx
/**
 * Phase-A verification for the session-state subsystem.
 *
 * Verifies module M1 (SessionState storage in IStorage/kuzu) end-to-end against a
 * throwaway KuzuDB. No daemon, no Ollama, no embeddings — SessionState is volatile
 * working-state with NO embedding field and NO vector index, so storage-level CRUD
 * is exercised directly.
 *
 * Covers:
 *   (a) createStorage('kuzu', tmp) + initialize
 *   (b) create (active_context + task) → get → update-in-place → list filters → delete
 *   (c) SessionState carries no embedding (create without embedding succeeds — proves
 *       there is no vector-index requirement on the table)
 *
 * Prints "PHASE A VERIFY: PASS" on success; throws on any assertion failure.
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { SessionStateRow } from '../src/types.js';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';

const testDbPath = join(tmpdir(), `kg-phase-a-${Date.now()}`, 'db');

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

/** Build a SessionStateRow input (created_at/updated_at optional, filled by storage). */
function makeRow(over: Partial<SessionStateRow> & Pick<SessionStateRow, 'id' | 'artifact_type'>): Omit<SessionStateRow, 'created_at' | 'updated_at'> {
  return {
    session_id: 'sess-1',
    project_id: 'proj-1',
    status: 'open',
    title: '',
    body: '',
    refs: [],
    version: 1,
    pinned: false,
    active: true,
    last_touched_at: '',
    ...over,
  };
}

async function main(): Promise<void> {
  console.error('\n📦 Phase-A verify — session-state storage (kuzu)');
  console.error(`  DB: ${testDbPath}\n`);

  try {
    // (a) create + initialize storage
    storage = await createStorage('kuzu', testDbPath);
    assert(!!storage, 'createStorage(kuzu) returned a storage instance');

    // (c) create WITHOUT any embedding field — proves no vector-index requirement.
    //     SessionStateRow has no `embedding` key; a plain row create must succeed.
    const ctxId = await storage.createSessionState(
      makeRow({
        id: 'ss-ctx-1',
        artifact_type: 'active_context',
        status: 'current',
        title: 'Working on Phase A',
        body: 'Verifying session-state storage backend.',
        refs: ['scripts/phase-a-verify.ts'],
        pinned: true,
      }),
    );
    assert(ctxId === 'ss-ctx-1', 'createSessionState(active_context) returned its id without an embedding');

    const taskId = await storage.createSessionState(
      makeRow({
        id: 'ss-task-1',
        artifact_type: 'task',
        status: 'pending',
        title: 'Write verify script',
        refs: ['ss-ctx-1'],
      }),
    );
    assert(taskId === 'ss-task-1', 'createSessionState(task) succeeded');

    // Second session's row — used to prove session_id filtering isolates correctly.
    await storage.createSessionState(
      makeRow({ id: 'ss-task-2', session_id: 'sess-2', artifact_type: 'task', status: 'pending', title: 'Other session task' }),
    );

    // (b) getSessionState returns the rows with all fields intact
    const ctx = await storage.getSessionState('ss-ctx-1');
    assert(ctx !== null, 'getSessionState(active_context) found the row');
    assert(ctx!.artifact_type === 'active_context', 'active_context artifact_type persisted', ctx!.artifact_type);
    assert(ctx!.status === 'current', 'active_context status persisted', ctx!.status);
    assert(ctx!.pinned === true, 'active_context pinned flag persisted');
    assert(ctx!.refs.length === 1 && ctx!.refs[0] === 'scripts/phase-a-verify.ts', 'active_context refs[] persisted');
    assert(!!ctx!.created_at && !!ctx!.updated_at, 'created_at/updated_at auto-populated on create');

    const task = await storage.getSessionState('ss-task-1');
    assert(task !== null && task.artifact_type === 'task', 'getSessionState(task) found the task row');

    // (b) updateSessionState changes status IN PLACE — must not throw, value must change.
    const beforeUpdatedAt = ctx!.updated_at;
    await storage.updateSessionState('ss-ctx-1', { status: 'done' });
    const ctxAfter = await storage.getSessionState('ss-ctx-1');
    assert(ctxAfter !== null, 'row still present after in-place update');
    assert(ctxAfter!.status === 'done', 'updateSessionState changed status in place', ctxAfter!.status);
    // Identity preserved (same primary key, no delete+recreate churn on other fields).
    assert(ctxAfter!.id === 'ss-ctx-1', 'primary key unchanged after update');
    assert(ctxAfter!.title === 'Working on Phase A', 'unrelated fields untouched by partial update');
    assert(ctxAfter!.pinned === true, 'pinned flag survived the update');
    assert(ctxAfter!.updated_at >= beforeUpdatedAt, 'updated_at advanced (or held) after update');

    // (b) listSessionState filters by session_id
    const sess1 = await storage.listSessionState({ session_id: 'sess-1' });
    assert(sess1.length === 2, 'listSessionState(session_id=sess-1) returns exactly the two sess-1 rows', `got ${sess1.length}`);
    assert(sess1.every((r) => r.session_id === 'sess-1'), 'all rows in session_id filter belong to sess-1');

    const sess2 = await storage.listSessionState({ session_id: 'sess-2' });
    assert(sess2.length === 1 && sess2[0].id === 'ss-task-2', 'listSessionState(session_id=sess-2) isolates the other session');

    // (b) listSessionState filters by artifact_type
    const tasks = await storage.listSessionState({ artifact_type: 'task' });
    assert(tasks.length === 2, 'listSessionState(artifact_type=task) returns both task rows', `got ${tasks.length}`);
    assert(tasks.every((r) => r.artifact_type === 'task'), 'all rows in artifact_type filter are tasks');

    // Combined filter — session_id AND artifact_type.
    const sess1Tasks = await storage.listSessionState({ session_id: 'sess-1', artifact_type: 'task' });
    assert(sess1Tasks.length === 1 && sess1Tasks[0].id === 'ss-task-1', 'combined session_id+artifact_type filter narrows correctly');

    const ctxList = await storage.listSessionState({ artifact_type: 'active_context' });
    assert(ctxList.length === 1 && ctxList[0].id === 'ss-ctx-1', 'listSessionState(artifact_type=active_context) returns only the context row');

    // (b) deleteSessionState removes the row
    await storage.deleteSessionState('ss-ctx-1');
    const gone = await storage.getSessionState('ss-ctx-1');
    assert(gone === null, 'deleteSessionState removed the active_context row');
    const remaining = await storage.listSessionState({ session_id: 'sess-1' });
    assert(remaining.length === 1 && remaining[0].id === 'ss-task-1', 'delete only removed the targeted row');

    console.error(`\n📊 ${checks} assertions passed`);
    console.error('\nPHASE A VERIFY: PASS\n');
  } finally {
    if (storage) {
      try { await storage.close(); } catch {}
    }
    try { rmSync(dirname(testDbPath), { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error(`\n💥 PHASE A VERIFY: FAIL — ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
