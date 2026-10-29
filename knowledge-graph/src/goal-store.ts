// ============================================================
// Per-session GOAL store — the anti-drift "north star".
//
// A goal is a short, protected objective for a single Claude Code SESSION,
// keyed by the Claude Code hook `session_id` (NOT the MCP-minted id — see
// CLAUDE.md "Goal Subsystem"). It is stored as a flat JSON file under
// `<kgDir>/state/goals/<session_id>.json` so the per-prompt injection path
// (`kg context`) can read it with a cheap local file read, no daemon RPC,
// and it survives compaction/resume (the hook session_id is stable).
//
// This module is the single source of truth for the goal file format and the
// injected markdown block, shared by: the daemon `goal_set` handler (validate),
// the CLI hook commands (`kg goal bind` / `kg goal pre-edit`), and the
// injectors (`kg prime` / `kg context`).
// ============================================================

import { join } from 'path';
import { createHash } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from 'fs';

// No hard length cap on goal fields (by user decision). The block is injected
// at session start, before edits and periodically by `kg context` (see the
// injection ledger below), so keeping the goal short is still a good convention
// — but it is not enforced. Only a non-empty `goal` is required.

export interface GoalRecord {
  goal: string;
  done_criteria?: string;
  non_goals?: string;
  session_id: string;
  set_at: string;
}

export interface GoalInput {
  goal: string;
  done_criteria?: string;
  non_goals?: string;
}

/**
 * Validate + normalize raw goal input (trim, enforce non-empty goal). No length
 * cap. Pure — used by both the daemon handler and the file writer so validation
 * is identical on the tool path and the hook path. Throws on an empty goal.
 */
export function normalizeGoalInput(input: GoalInput): GoalInput {
  const goal = (input.goal ?? '').trim();
  if (!goal) throw new Error('goal is required and cannot be empty');
  const done = (input.done_criteria ?? '').trim();
  const non = (input.non_goals ?? '').trim();
  return {
    goal,
    ...(done ? { done_criteria: done } : {}),
    ...(non ? { non_goals: non } : {}),
  };
}

/**
 * Session ids are UUIDs, but the value comes from hook stdin, so be defensive
 * against path traversal before using it as a filename.
 */
export function sanitizeSessionId(sessionId: string): string {
  return (sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
}

export function goalsDir(kgDir: string): string {
  return join(kgDir, 'state', 'goals');
}

export function goalFilePath(kgDir: string, sessionId: string): string {
  return join(goalsDir(kgDir), `${sanitizeSessionId(sessionId)}.json`);
}

/** Read a session's goal, or null if none / unreadable / malformed. Never throws. */
export function readGoal(kgDir: string, sessionId: string): GoalRecord | null {
  const s = sanitizeSessionId(sessionId);
  if (!s) return null;
  const p = goalFilePath(kgDir, s);
  try {
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as GoalRecord;
    if (!parsed || typeof parsed.goal !== 'string' || !parsed.goal.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write (overwrite) a session's goal file. Latest-wins. Returns the stored record. */
export function writeGoal(kgDir: string, sessionId: string, input: GoalInput): GoalRecord {
  const s = sanitizeSessionId(sessionId);
  if (!s) throw new Error('writeGoal: empty/invalid session_id');
  const normalized = normalizeGoalInput(input);
  const record: GoalRecord = {
    ...normalized,
    session_id: s,
    set_at: new Date().toISOString(),
  };
  mkdirSync(goalsDir(kgDir), { recursive: true });
  writeFileSync(goalFilePath(kgDir, s), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

/** Delete a session's goal file. Returns true if a file was removed. Never throws. */
export function deleteGoal(kgDir: string, sessionId: string): boolean {
  const s = sanitizeSessionId(sessionId);
  if (!s) return false;
  const p = goalFilePath(kgDir, s);
  try {
    if (existsSync(p)) {
      unlinkSync(p);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** List session ids that currently have a goal file (for `kg goal list` / debugging). */
export function listGoalSessions(kgDir: string): string[] {
  try {
    return readdirSync(goalsDir(kgDir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

/**
 * Render the goal as the markdown block that gets injected into context.
 * `antiDrift` appends the strongest reminder — use it on the pre-edit path,
 * right before a file mutation.
 */
export function formatGoalBlock(rec: GoalRecord, opts?: { antiDrift?: boolean }): string {
  const lines: string[] = [];
  lines.push('## 🎯 SESSION GOAL — stay on target');
  lines.push(rec.goal);
  if (rec.done_criteria) lines.push(`Done when: ${rec.done_criteria}`);
  if (rec.non_goals) lines.push(`Not in scope: ${rec.non_goals}`);
  if (opts?.antiDrift) {
    lines.push('');
    lines.push(
      'CHECK BEFORE PROCEEDING: if the change you are about to make drifts from this goal, ' +
        'stop and reconsider — or reconfirm with the user before continuing.',
    );
  }
  return lines.join('\n');
}

// ============================================================
// Goal injection ledger — when `kg context` re-injects the goal.
//
// Re-injecting an unchanged goal on every prompt only re-adds the same block to
// a context that already holds it (measured 2026-10-29: one session carried 130
// identical copies). The goal stays in context after SessionStart, so `kg context`
// re-injects it only when one of these holds:
//   - this session has no ledger entry yet
//   - the goal text changed (hash differs)
//   - the context shrank since the last injection (compact / clear / rewind)
//   - the context grew by >= KG_GOAL_REFRESH_TOKENS (default 100k) since then,
//     so the goal sits near the end of the context again (anti-drift)
//   - the context size cannot be measured (fail-open: old behavior)
// KG_GOAL_EVERY_TURN=1 restores injection on every prompt. The ledger is keyed
// by the session's OWN id (not the root): teammates share the root's goal but
// each has its own context.
// ============================================================

export const DEFAULT_GOAL_REFRESH_TOKENS = 100_000;

export interface GoalInjection {
  hash: string;
  ctx_tokens: number;
  ts: string;
}

export function goalHash(block: string): string {
  return createHash('sha256').update(block).digest('hex').slice(0, 16);
}

function injectionPath(kgDir: string, sessionId: string): string {
  return join(goalsDir(kgDir), '.injected', `${sanitizeSessionId(sessionId)}.json`);
}

/** Last recorded goal injection for a session, or null. Never throws. */
export function readInjection(kgDir: string, sessionId: string): GoalInjection | null {
  if (!sanitizeSessionId(sessionId)) return null;
  try {
    const p = injectionPath(kgDir, sessionId);
    if (!existsSync(p)) return null;
    const rec = JSON.parse(readFileSync(p, 'utf-8')) as GoalInjection;
    return typeof rec?.hash === 'string' && typeof rec?.ctx_tokens === 'number' ? rec : null;
  } catch {
    return null;
  }
}

/** Record a goal injection. Never throws (a lost record only means one extra injection). */
export function writeInjection(kgDir: string, sessionId: string, hash: string, ctxTokens: number | null): void {
  if (!sanitizeSessionId(sessionId)) return;
  try {
    mkdirSync(join(goalsDir(kgDir), '.injected'), { recursive: true });
    const rec: GoalInjection = { hash, ctx_tokens: ctxTokens ?? 0, ts: new Date().toISOString() };
    writeFileSync(injectionPath(kgDir, sessionId), JSON.stringify(rec), 'utf-8');
  } catch {
    /* ignore */
  }
}

/**
 * Context size of the session's latest request (input + cache read + cache write
 * of the last assistant usage in the transcript). 0 when the transcript does not
 * exist yet or has no request; null when it cannot be read (or no path given).
 */
export function lastContextTokens(transcriptPath: string | undefined): number | null {
  if (!transcriptPath) return null;
  if (!existsSync(transcriptPath)) return 0;
  let fd: number | null = null;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, 2_000_000);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"')) continue;
      try {
        const row = JSON.parse(line);
        const u = row?.type === 'assistant' ? row.message?.usage : null;
        if (u) {
          return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        }
      } catch {
        /* partial first line of the tail window */
      }
    }
    return 0;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Pure decision: should `kg context` inject the goal this prompt? */
export function shouldInjectGoal(
  prev: GoalInjection | null,
  hash: string,
  ctxTokens: number | null,
  refreshTokens: number = DEFAULT_GOAL_REFRESH_TOKENS,
): boolean {
  if (!prev || prev.hash !== hash || ctxTokens === null) return true;
  if (ctxTokens < prev.ctx_tokens) return true;
  return ctxTokens - prev.ctx_tokens >= refreshTokens;
}

/** Refresh threshold from KG_GOAL_REFRESH_TOKENS (positive integer), else the default. */
export function goalRefreshTokens(): number {
  const v = Number.parseInt(process.env.KG_GOAL_REFRESH_TOKENS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GOAL_REFRESH_TOKENS;
}
