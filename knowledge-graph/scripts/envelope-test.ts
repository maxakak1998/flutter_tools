#!/usr/bin/env npx tsx

/**
 * Envelope test — unified response envelope classification.
 *
 * Proves classifyError() maps REAL handler error messages to the right
 * {code, retryable} and that wrapSuccess/wrapError produce the agreed shape.
 * Pure — no daemon, no Ollama, no stdio. Runs against SOURCE via tsx.
 *
 * The message literals below are pinned to the ACTUAL strings the handlers throw
 * (file:line noted). Adversarial review found two ordering bugs these cases guard:
 *   - "Model … not found. Run: ollama pull" must classify ollama_failed (retry),
 *     NOT not_found (no-retry) — ollama is checked before not_found.
 *   - handler precondition verbs ("Cannot promote/delete/link", "requires …",
 *     "does not exist", "across layers") must classify validation/not_found,
 *     NOT internal — the old /required/ regex missed ~10 of these.
 */

import {
  classifyError,
  wrapSuccess,
  wrapError,
  DaemonUnreachableError,
  callWithRevive,
  isDaemonGoneMessage,
  type ErrorCode,
} from '../src/client.js';
import { MISSING_SESSION_ID_MESSAGE, MISSING_CLIENT_SESSION_ID_MESSAGE } from '../src/session-store.js';
import { DAEMON_SHUTTING_DOWN_MESSAGE } from '../src/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.error(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

interface Case {
  name: string;
  error: unknown;
  code: ErrorCode;
  retryable: boolean;
}

// Each `error` is the REAL string thrown by the cited handler.
const CASES: Case[] = [
  // 1. daemon unreachable — the typed marker error (first branch, wins over message)
  {
    name: 'DaemonUnreachableError instance → daemon_unreachable/retryable',
    error: new DaemonUnreachableError(new Error('fetch failed')),
    code: 'daemon_unreachable',
    retryable: true,
  },
  // 2. version conflict — issue.ts:167 and state-task.ts:50 ("Version conflict …")
  {
    name: 'issue.ts:167 "Version conflict for …" → version_conflict/retryable',
    error: new Error('Version conflict for upcozm-a3f9: expected 2, current 3. Re-read and retry.'),
    code: 'version_conflict',
    retryable: true,
  },
  {
    name: 'state-task.ts:50 "Version conflict on …" → version_conflict/retryable',
    error: new Error('Version conflict on task-1: expected version 1 but current is 2.'),
    code: 'version_conflict',
    retryable: true,
  },
  // 3. ollama — embedder.ts:105 (MUST beat not_found despite "not found" substring)
  {
    name: 'embedder.ts:105 "Model … not found. Run: ollama pull" → ollama_failed/retryable',
    error: new Error('Model bge-m3 not found. Run: ollama pull bge-m3'),
    code: 'ollama_failed',
    retryable: true,
  },
  {
    name: 'embedder.ts:109 "Ollama … failed: 503" → ollama_failed/retryable',
    error: new Error('Ollama embed failed: 503 service unavailable'),
    code: 'ollama_failed',
    retryable: true,
  },
  {
    name: 'embedder.ts timeout "Ollama embed timed out …" → ollama_failed/retryable',
    error: new Error('Ollama embed timed out after 60000ms (backend unresponsive)'),
    code: 'ollama_failed',
    retryable: true,
  },
  // 4. not_found — issue.ts:163 / state-plan.ts:103 ("does not exist")
  {
    name: 'issue.ts:163 "Issue not found: …" → not_found/no-retry',
    error: new Error('Issue not found: upcozm-zzzz'),
    code: 'not_found',
    retryable: false,
  },
  {
    name: 'state-plan.ts:103 "source file does not exist: …" → not_found/no-retry',
    error: new Error('state_save_plan: source file does not exist: /tmp/nope.md'),
    code: 'not_found',
    retryable: false,
  },
  // 5. validation — precondition verbs the old regex missed
  {
    name: 'state-task.ts:173 "requires a title" → validation/no-retry',
    error: new Error('state_task_upsert requires a title when creating a task.'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'life-store.ts:61 "require at least 1 tag" → validation/no-retry',
    error: new Error('Operational learnings require at least 1 tag starting with "life:" (valid: life:gotcha). Got tags: []'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'promote.ts:16 "Cannot promote refuted chunk" → validation/no-retry',
    error: new Error('Cannot promote refuted chunk (confidence: 0.1). Confirm it first.'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'delete.ts:19 "Cannot delete … without a reason" → validation/no-retry',
    error: new Error("Cannot delete validated chunk without a reason. Provide a 'reason' field explaining why this knowledge should be removed."),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'link.ts:29 "Cannot link across layers" → validation/no-retry',
    error: new Error('Cannot link across layers: operational ↔ non-operational. Both chunks must be in the same layer.'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'life-feedback.ts:14 "Not an operational chunk" → validation/no-retry',
    error: new Error('Not an operational chunk — life_feedback only works on operational layer'),
    code: 'validation',
    retryable: false,
  },
  // 5b. attachment source errors — caller-fixable, must beat not_found despite
  //     "(not found)" substring (attachment.ts:126/135)
  {
    name: 'attachment.ts:135 "file too large (max …)" → validation/no-retry',
    error: new Error('file too large (max 10485760 bytes, got 20000000 bytes): /tmp/big.png'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'attachment.ts:126 "invalid source: … (not found)" → validation/no-retry (beats not_found)',
    error: new Error('invalid source: /tmp/nope.png (not found)'),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'attachment.ts:129 "invalid source: … (is a directory …)" → validation/no-retry',
    error: new Error('invalid source: /tmp/somedir (is a directory, not a file)'),
    code: 'validation',
    retryable: false,
  },
  // 6. internal — anything unrecognized
  {
    name: 'unrecognized "boom" → internal/no-retry',
    error: new Error('boom'),
    code: 'internal',
    retryable: false,
  },
  {
    name: 'client: CLAUDE_CODE_SESSION_ID missing → validation/no-retry',
    error: new Error(MISSING_SESSION_ID_MESSAGE),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'daemon: RPC without client_session_id → validation/no-retry',
    error: new Error(MISSING_CLIENT_SESSION_ID_MESSAGE),
    code: 'validation',
    retryable: false,
  },
  {
    name: 'non-Error thrown value → internal/no-retry',
    error: 'some string throw',
    code: 'internal',
    retryable: false,
  },
  // Daemon lifecycle failures (2026-10-27 logs) — the daemon process is going away,
  // not a caller mistake: retryable, never `internal`.
  {
    name: 'daemon-manager.ts "Daemon startup timed out after 15s…" (plain Error) → daemon_unreachable/retryable',
    error: new Error('Daemon startup timed out after 15s\nCheck logs: kg logs'),
    code: 'daemon_unreachable',
    retryable: true,
  },
  {
    name: 'daemon.ts DAEMON_SHUTTING_DOWN_MESSAGE → daemon_unreachable/retryable',
    error: new Error(DAEMON_SHUTTING_DOWN_MESSAGE),
    code: 'daemon_unreachable',
    retryable: true,
  },
  {
    name: 'kuzu.ts "Storage is closing" → daemon_unreachable/retryable',
    error: new Error('Storage is closing'),
    code: 'daemon_unreachable',
    retryable: true,
  },
  {
    name: 'chunk-id.ts "Ambiguous chunk id prefix …" → validation/no-retry',
    error: new Error('Ambiguous chunk id prefix "3ef4b7d0" matches multiple chunks (3ef4b7d0-aaaa, 3ef4b7d0-bbbb) — pass more characters'),
    code: 'validation',
    retryable: false,
  },
];

async function main(): Promise<void> {
  console.error('🧪 Envelope test — classifyError + wrap helpers');
  console.error('═'.repeat(58));

  console.error('\n📋 classifyError() over real handler messages');
  for (const c of CASES) {
    const got = classifyError(c.error);
    const ok = got.code === c.code && got.retryable === c.retryable && got.hint.length > 0;
    assert(ok, c.name, ok ? undefined : `got code=${got.code} retryable=${got.retryable}`);
  }

  console.error('\n📋 isDaemonGoneMessage()');
  assert(isDaemonGoneMessage('Daemon startup timed out after 15s'), 'startup timeout is a daemon-gone message');
  assert(isDaemonGoneMessage('Storage is closing'), '"Storage is closing" is a daemon-gone message');
  assert(!isDaemonGoneMessage('Chunk not found: 3ef4b7d0'), '"Chunk not found" is NOT a daemon-gone message');

  console.error('\n📋 wrapSuccess / wrapError shape');
  const su = wrapSuccess(undefined);
  assert(su.ok === true && su.data === null, 'wrapSuccess(undefined) → {ok:true, data:null}');
  const sa = wrapSuccess([1, 2]);
  assert(sa.ok === true && Array.isArray(sa.data) && (sa.data as number[]).length === 2, 'wrapSuccess([1,2]) → {ok:true, data:[1,2]}');
  const so = wrapSuccess({ issue_ref: 'x' });
  assert(so.ok === true && (so.data as { issue_ref: string }).issue_ref === 'x', 'wrapSuccess(object) preserves payload');
  const we = wrapError(new Error('Issue not found: z'));
  assert(we.ok === false && we.error.code === 'not_found' && we.error.retryable === false && we.error.message === 'Issue not found: z', 'wrapError() → {ok:false, error{code,message,retryable,hint}}');

  console.error('\n📋 callWithRevive: a failed revive stays daemon_unreachable');
  // The 2026-10-27 failure: revive → ensureDaemon() → "Daemon startup timed out"
  // escaped as a plain Error and was classified internal (no-retry).
  let caught: unknown = null;
  try {
    await callWithRevive(
      async () => { throw new DaemonUnreachableError(new Error('fetch failed')); },
      async () => { throw new Error('Daemon startup timed out after 15s'); },
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof DaemonUnreachableError, 'revive failure is rethrown as DaemonUnreachableError');
  const rc = classifyError(caught);
  assert(rc.code === 'daemon_unreachable' && rc.retryable === true, 'revive failure → daemon_unreachable/retryable', `got ${rc.code}`);
  let calls = 0;
  const v = await callWithRevive(
    async () => { if (++calls === 1) throw new DaemonUnreachableError(new Error(DAEMON_SHUTTING_DOWN_MESSAGE)); return 'ok'; },
    async () => {},
  );
  assert(v === 'ok' && calls === 2, 'shutting-down error → revive + exactly one retry', `calls=${calls}`);

  console.error('═'.repeat(58));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
