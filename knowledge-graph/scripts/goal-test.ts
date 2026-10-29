#!/usr/bin/env npx tsx

/**
 * Goal test — per-session anti-drift north star.
 *
 * Part A (pure): goal-store read/write/delete/list/format/normalize + session
 *   isolation. Runs against SOURCE via tsx, no daemon, no Ollama.
 * Part B (integration): spawns the BUILT `dist/cli.js` goal hooks + injectors
 *   with synthetic hook stdin (no daemon) and asserts the file/injection
 *   behavior — the exact plumbing Claude Code drives:
 *     - `kg goal bind`      (PostToolUse) writes goals/<session>.json
 *     - `kg goal pre-edit`  (PreToolUse Edit/Write) injects goal + anti-drift
 *     - `kg context`        (UserPromptSubmit) injects the goal when the injection
 *                           ledger says so (first time, goal changed, context
 *                           shrank / grew >= refresh, size unknown)
 *     - `kg prime` clear    keeps the root's goal (goals follow the /clear chain)
 *   Run `npm run build` first (Part B runs against dist/).
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  normalizeGoalInput,
  writeGoal,
  readGoal,
  deleteGoal,
  listGoalSessions,
  formatGoalBlock,
  goalFilePath,
  shouldInjectGoal,
  lastContextTokens,
} from '../src/goal-store.js';

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

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const cliJs = join(repoRoot, 'dist', 'cli.js');

function makeTempKgDir(): string {
  // A bare kgDir for Part A (goal-store operates on a kgDir directly).
  const base = mkdtempSync(join(tmpdir(), 'kg-goal-store-'));
  return join(base, '.knowledge-graph');
}

function makeTempProject(): string {
  // A full project dir with .knowledge-graph/config.json for Part B (the CLI
  // discovers the project from cwd, exactly like the real hooks).
  const dir = mkdtempSync(join(tmpdir(), 'kg-goal-proj-'));
  mkdirSync(join(dir, '.knowledge-graph'), { recursive: true });
  writeFileSync(
    join(dir, '.knowledge-graph', 'config.json'),
    JSON.stringify({ project_id: 'goal-test', project_name: 'goal-test' }),
    'utf-8',
  );
  return dir;
}

/** Run a cli.js hook command with JSON on stdin; return stdout. Never throws on exit 0. */
function runCli(args: string[], stdin: string, cwd: string, env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [cliJs, ...args], {
    input: stdin,
    cwd,
    encoding: 'utf-8',
    // Never touch the real ~/.knowledge-graph/sessions/ (prime/clear registers sessions).
    env: { ...process.env, KG_SESSIONS_DIR: join(cwd, '.sessions'), ...env },
  });
}

/** Write a one-request transcript whose last request carried the given token counts. */
function writeTranscript(path: string, input: number, cacheRead: number, cacheWrite: number): void {
  const usage = { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 10 };
  const rows = [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', content: [], usage } },
  ];
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

// ============================================================
// Part A — pure goal-store
// ============================================================
function partA(): void {
  console.error('\nPart A — goal-store (pure)');
  const kgDir = makeTempKgDir();

  // normalize: trim + require non-empty + cap
  const norm = normalizeGoalInput({ goal: '  ship csv export  ', done_criteria: ' streaming ' });
  assert(norm.goal === 'ship csv export', 'normalize trims goal');
  assert(norm.done_criteria === 'streaming', 'normalize trims done_criteria');
  assert(normalizeGoalInput({ goal: 'x'.repeat(500) }).goal.length === 500, 'normalize does NOT cap goal length (no limit)');
  let threw = false;
  try { normalizeGoalInput({ goal: '   ' }); } catch { threw = true; }
  assert(threw, 'normalize throws on empty goal');

  // write + read round-trip
  const rec = writeGoal(kgDir, 'S1', { goal: 'goal one', done_criteria: 'tests pass', non_goals: 'no UI' });
  assert(existsSync(goalFilePath(kgDir, 'S1')), 'writeGoal creates the file');
  const read = readGoal(kgDir, 'S1');
  assert(read?.goal === 'goal one', 'readGoal returns the goal');
  assert(read?.done_criteria === 'tests pass' && read?.non_goals === 'no UI', 'readGoal returns optional fields');
  assert(read?.session_id === 'S1' && !!read?.set_at, 'readGoal returns session_id + set_at');
  assert(rec.session_id === 'S1', 'writeGoal returns the record');

  // overwrite — latest wins
  writeGoal(kgDir, 'S1', { goal: 'goal one v2' });
  assert(readGoal(kgDir, 'S1')?.goal === 'goal one v2', 'writeGoal overwrites (latest wins)');
  assert(readGoal(kgDir, 'S1')?.done_criteria === undefined, 'overwrite drops old optional fields');

  // isolation between two sessions
  writeGoal(kgDir, 'S2', { goal: 'goal two' });
  assert(readGoal(kgDir, 'S1')?.goal === 'goal one v2', 'S1 unaffected by S2 write');
  assert(readGoal(kgDir, 'S2')?.goal === 'goal two', 'S2 has its own goal');
  assert(listGoalSessions(kgDir).sort().join(',') === 'S1,S2', 'listGoalSessions lists both');

  // missing / malformed
  assert(readGoal(kgDir, 'S3') === null, 'readGoal returns null for missing session');
  writeFileSync(goalFilePath(kgDir, 'S4'), 'not json', 'utf-8');
  assert(readGoal(kgDir, 'S4') === null, 'readGoal returns null for malformed file');

  // path-traversal defense
  assert(readGoal(kgDir, '../../etc/passwd') === null, 'readGoal sanitizes session id');

  // delete
  assert(deleteGoal(kgDir, 'S1') === true, 'deleteGoal removes an existing goal');
  assert(readGoal(kgDir, 'S1') === null, 'deleted goal reads back null');
  assert(deleteGoal(kgDir, 'S1') === false, 'deleteGoal on missing returns false');

  // format block
  const block = formatGoalBlock({ goal: 'do X', done_criteria: 'green', non_goals: 'not Y', session_id: 'S', set_at: 't' });
  assert(block.includes('SESSION GOAL') && block.includes('do X') && block.includes('Done when: green') && block.includes('Not in scope: not Y'), 'formatGoalBlock renders all fields');
  assert(!block.includes('CHECK BEFORE PROCEEDING'), 'formatGoalBlock omits anti-drift by default');
  const blockAD = formatGoalBlock({ goal: 'do X', session_id: 'S', set_at: 't' }, { antiDrift: true });
  assert(blockAD.includes('CHECK BEFORE PROCEEDING'), 'formatGoalBlock antiDrift adds the reminder');

  // injection decision (pure)
  const prev = { hash: 'h1', ctx_tokens: 50_000, ts: 't' };
  assert(shouldInjectGoal(null, 'h1', 50_000) === true, 'shouldInjectGoal: no ledger entry → inject');
  assert(shouldInjectGoal(prev, 'h2', 50_000) === true, 'shouldInjectGoal: goal changed → inject');
  assert(shouldInjectGoal(prev, 'h1', null) === true, 'shouldInjectGoal: size unknown → inject (fail-open)');
  assert(shouldInjectGoal(prev, 'h1', 40_000) === true, 'shouldInjectGoal: context shrank → inject');
  assert(shouldInjectGoal(prev, 'h1', 149_999) === false, 'shouldInjectGoal: grew < 100k → skip');
  assert(shouldInjectGoal(prev, 'h1', 150_000) === true, 'shouldInjectGoal: grew >= 100k → inject');
  assert(shouldInjectGoal(prev, 'h1', 60_000, 10_000) === true, 'shouldInjectGoal: custom refresh threshold');

  // context size from a transcript
  const tr = join(kgDir, '..', 't.jsonl');
  assert(lastContextTokens(undefined) === null, 'lastContextTokens: no path → null');
  assert(lastContextTokens(tr) === 0, 'lastContextTokens: missing file → 0 (fresh session)');
  writeTranscript(tr, 1000, 20_000, 300);
  assert(lastContextTokens(tr) === 21_300, 'lastContextTokens: sums input + cache read + cache write of the last request');

  rmSync(join(kgDir, '..'), { recursive: true, force: true });
}

// ============================================================
// Part B — CLI hooks + injectors (integration, no daemon)
// ============================================================
function partB(): void {
  console.error('\nPart B — CLI hooks + injectors (integration)');
  if (!existsSync(cliJs)) {
    console.error(`  ⚠️  ${cliJs} missing — run \`npm run build\` first. Skipping Part B.`);
    return;
  }
  const proj = makeTempProject();
  const kgDir = join(proj, '.knowledge-graph');

  // 1. goal bind writes the file keyed by the stdin session_id (SET bridge)
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S1', tool_input: { goal: 'ship csv export', done_criteria: 'green tests' } }), proj);
  assert(readGoal(kgDir, 'S1')?.goal === 'ship csv export', 'goal bind writes goals/S1.json');

  // 2. goal bind overwrites (latest wins)
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S1', tool_input: { goal: 'ship csv export v2' } }), proj);
  assert(readGoal(kgDir, 'S1')?.goal === 'ship csv export v2', 'goal bind overwrites');

  // 3. isolation — a second session's bind does not touch S1
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S2', tool_input: { goal: 'other work' } }), proj);
  assert(readGoal(kgDir, 'S1')?.goal === 'ship csv export v2' && readGoal(kgDir, 'S2')?.goal === 'other work', 'goal bind isolates sessions');

  // 4. context injects the goal every turn (trivial prompt → no daemon needed)
  const ctxOut = runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S1' }), proj);
  assert(ctxOut.includes('ship csv export v2') && ctxOut.includes('SESSION GOAL'), 'kg context injects the session goal');
  assert(!ctxOut.includes('other work'), 'kg context does not leak another session’s goal');

  // 5. pre-edit injects goal + anti-drift for a normal file
  const preOut = runCli(['goal', 'pre-edit'], JSON.stringify({ session_id: 'S1', tool_input: { file_path: 'lib/x.dart' } }), proj);
  assert(preOut.includes('ship csv export v2') && preOut.includes('CHECK BEFORE PROCEEDING'), 'kg goal pre-edit injects goal + anti-drift');
  assert(preOut.replace(/\s/g, '').includes('"hookEventName":"PreToolUse"'), 'pre-edit emits a PreToolUse hook payload');

  // 6. pre-edit is silent for exempt (generated) files
  const preExempt = runCli(['goal', 'pre-edit'], JSON.stringify({ session_id: 'S1', tool_input: { file_path: 'lib/x.g.dart' } }), proj);
  assert(preExempt.trim() === '', 'kg goal pre-edit is silent for exempt paths');

  // 7. pre-edit is silent when the session has no goal (item 4: goal is optional)
  const preNoGoal = runCli(['goal', 'pre-edit'], JSON.stringify({ session_id: 'S-none', tool_input: { file_path: 'lib/x.dart' } }), proj);
  assert(preNoGoal.trim() === '', 'kg goal pre-edit is silent when no goal set');

  // 8. context is silent when no goal + trivial prompt (nothing to inject)
  const ctxNone = runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S-none' }), proj);
  assert(ctxNone.trim() === '', 'kg context is silent when no goal + trivial prompt');

  // 9. prime clear must NOT delete the goal: goals are keyed by the root and shared
  // with teammates, and /clear chains to the same root.
  const goalBeforeClear = readGoal(kgDir, 'S1')?.goal;
  runCli(['prime'], JSON.stringify({ source: 'clear', session_id: 'S1' }), proj);
  assert(goalBeforeClear !== undefined && readGoal(kgDir, 'S1')?.goal === goalBeforeClear, 'kg prime source=clear keeps the goal');
  assert(readGoal(kgDir, 'S2')?.goal === 'other work', 'prime clear leaves other sessions untouched');

  // 10. injection ledger: kg context re-injects only when needed
  const tr = join(proj, 's3.jsonl');
  const ctx3 = (env: Record<string, string> = {}) =>
    runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S3', transcript_path: tr }), proj, env);
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S3', tool_input: { goal: 'ledger goal' } }), proj);
  writeTranscript(tr, 0, 40_000, 0);
  assert(ctx3().includes('ledger goal'), 'context: first prompt injects the goal');
  assert(ctx3().trim() === '', 'context: same context, unchanged goal → no re-injection');
  writeTranscript(tr, 0, 120_000, 0);
  assert(ctx3().trim() === '', 'context: grew 80k (< 100k) → no re-injection');
  writeTranscript(tr, 0, 140_000, 0);
  assert(ctx3().includes('ledger goal'), 'context: grew 100k → re-injects');
  assert(ctx3({ KG_GOAL_EVERY_TURN: '1' }).includes('ledger goal'), 'context: KG_GOAL_EVERY_TURN=1 → injects every prompt');
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S3', tool_input: { goal: 'ledger goal v2' } }), proj);
  assert(ctx3().includes('ledger goal v2'), 'context: goal changed → re-injects');
  writeTranscript(tr, 0, 30_000, 0);
  assert(ctx3().includes('ledger goal v2'), 'context: context shrank (compact/clear) → re-injects');
  assert(ctx3({ KG_GOAL_REFRESH_TOKENS: '1' }).trim() === '', 'context: KG_GOAL_REFRESH_TOKENS respected (0 growth < 1)');
  writeTranscript(tr, 0, 30_001, 0);
  assert(ctx3({ KG_GOAL_REFRESH_TOKENS: '1' }).includes('ledger goal v2'), 'context: KG_GOAL_REFRESH_TOKENS respected (1 growth >= 1)');

  // 11. no transcript_path → fail-open: injects on every prompt (old behavior)
  const ctxNoTr = () => runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S3' }), proj);
  assert(ctxNoTr().includes('ledger goal v2') && ctxNoTr().includes('ledger goal v2'), 'context: no transcript_path → injects every prompt');

  // 12. prime injects the goal and records it, so the first prompt does not repeat it
  const tr4 = join(proj, 's4-not-yet-written.jsonl');
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S4', tool_input: { goal: 'prime goal' } }), proj);
  const primeOut = runCli(['prime'], JSON.stringify({ source: 'clear', session_id: 'S4', transcript_path: tr4 }), proj,
    { TMUX_PANE: '', CLAUDE_CODE_MESSAGING_SOCKET: '' }); // no /clear chaining: S4 keeps its own root
  assert(primeOut.includes('prime goal'), 'prime: injects the goal');
  const afterPrime = runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S4', transcript_path: tr4 }), proj);
  assert(afterPrime.trim() === '', 'context: first prompt after prime does not repeat the goal');

  // 13. the ledger is per session id: a second session with the same goal still gets it
  const tr5 = join(proj, 's5.jsonl');
  writeTranscript(tr5, 0, 40_000, 0);
  runCli(['goal', 'bind'], JSON.stringify({ session_id: 'S5', tool_input: { goal: 'ledger goal v2' } }), proj);
  assert(runCli(['context'], JSON.stringify({ prompt: 'ok', session_id: 'S5', transcript_path: tr5 }), proj).includes('ledger goal v2'),
    'context: ledger is per session (another session with the same goal still gets it)');
  assert(listGoalSessions(kgDir).every((s) => !s.startsWith('.')), 'listGoalSessions ignores the .injected ledger dir');

  rmSync(proj, { recursive: true, force: true });
}

console.error('=== goal-test ===');
partA();
partB();
console.error(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
