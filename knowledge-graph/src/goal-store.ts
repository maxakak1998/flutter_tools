// ============================================================
// Per-session GOAL store — the anti-drift "north star".
//
// A goal is a short, protected objective for a single Claude Code SESSION,
// keyed by the Claude Code hook `session_id` (NOT the MCP-minted id — see
// CLAUDE.md "Goal Subsystem"). It is stored as a flat JSON file under
// `<kgDir>/state/goals/<session_id>.json` so the every-turn injection path
// (`kg context`) can read it with a cheap local file read, no daemon RPC,
// and it survives compaction/resume (the hook session_id is stable).
//
// This module is the single source of truth for the goal file format and the
// injected markdown block, shared by: the daemon `goal_set` handler (validate),
// the CLI hook commands (`kg goal bind` / `kg goal pre-edit`), and the
// injectors (`kg prime` / `kg context`).
// ============================================================

import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from 'fs';

// No hard length cap on goal fields (by user decision). The block is injected
// EVERY turn, so keeping the goal short is still a good convention — but it is
// not enforced. Only a non-empty `goal` is required.

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
