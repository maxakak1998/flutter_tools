---
name: kg-session-state
description: "Track volatile working memory so an AI can resume across sessions. Use for 'what was I doing', 'where did I leave off', saving a plan, tracking task status, or catching up a fresh/post-compaction session. Triggers: session start, plan finalized, task status change, 'resume', 'catch me up', 'what's the status', 'what was the original plan'."
---

# Session State — Working Memory Across Sessions

Volatile per-work-session scratch: current focus, plans, tasks, checkpoints. Stored in a separate `SessionState` table — NOT embedded, NOT semantically searched, NOT synced between machines. This is DISTINCT from durable knowledge (`knowledge_store`) and operational learnings (`life_store`).

**When NOT to use:** a durable business rule → `knowledge_store`. A reusable coding gotcha → `life_store`. A design decision you'll want to find later → `decision_record` (a durable Chunk, not session state).

## Core workflow

**At session start (resume):** call `state_resume` (project-scoped — works even on a brand-new session with no history). It answers: what was I doing, current status, active plan. `kg prime` also injects this automatically at SessionStart.

**While working:**
- `state_set_context` when you start or pivot a task — record focus + next step + files being touched. Append-only, so it builds a trail.
- `state_task_upsert` to track subtasks with status (`pending`/`in_progress`/`blocked`/`done`/`deferred`). Use `deferred` for "someday/maybe" — these are prime orphan candidates.
- `state_save_plan <path>` right after finalizing a plan `.md` — clones it immutably. Version 1 is always the original ("what was the original plan?").
- `decision_record` when you commit to a design choice — goes to the durable Chunk graph with SUPERSEDES lineage (bypasses dedup, so iterative near-identical decisions each persist).

**At boundaries (before a long pause / compaction):** `state_checkpoint` folds everything into a resume packet.

## Answering the classic questions
- "What did I do recently?" → `state_get_context` or `state_resume`.
- "What's the status?" → `state_task_list` or `state_resume` open tasks.
- "What was the original plan?" → `state_get_plan` with `version: 1`.
- "What plan am I on now?" → `state_get_plan` (active).
- "What did I mean to do but forgot?" → `state_prune` (read-only) — or watch the "orphaned" section in `state_resume`. To actually clear them, call `state_evict_orphans` (destructive) afterward.

## Concurrency + hygiene
- Multiple sessions run against one daemon (serialized, no torn writes). Each session's context is its own; `state_projection` shows what all live sessions are focused on.
- Orphaned tasks (untouched > 7 days, not done, not pinned) resurface in resume and can be pruned. Keep the ledger clean — mark done, defer, or let prune evict.
- Plans and pinned rows are never pruned or compacted.
