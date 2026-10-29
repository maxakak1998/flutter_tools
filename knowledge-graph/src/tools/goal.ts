// ============================================================
// goal_set tool handler (daemon side).
//
// This handler is a VALIDATE-AND-ECHO trigger, NOT the authoritative writer.
// An MCP tool handler cannot know the Claude Code hook `session_id` (see
// CLAUDE.md "Goal Subsystem" / "identifier model"), so it cannot key the goal
// to the right session. The authoritative per-session write is done by the
// `kg goal bind` PostToolUse hook, which receives `session_id` on stdin.
//
// The handler's job: reject an invalid goal early (so a bad goal never reaches
// the hook) and echo the normalized goal back so Claude gets confirmation.
// ============================================================

import { normalizeGoalInput, type GoalInput } from '../goal-store.js';

export interface GoalSetResult {
  ok: true;
  goal: GoalInput;
  note: string;
}

export function handleGoalSet(input: GoalInput): GoalSetResult {
  const normalized = normalizeGoalInput(input);
  return {
    ok: true,
    goal: normalized,
    note:
      'Session goal recorded. It will be injected as a north star every turn, ' +
      'before file edits, and after compaction (via the kg goal hooks). ' +
      'Only propose+confirm a goal with the user before calling this.',
  };
}
