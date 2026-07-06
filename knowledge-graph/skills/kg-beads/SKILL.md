---
name: kg-beads
description: "Track bugs/tickets/issues as first-class graph nodes that replace an external issue tracker, so the KG is one source of truth. Use for 'file a bug', 'what needs fixing', 'what's ready to work', 'what's blocked', 'close this issue', 'what did we decide about this bug'. Anchor a session to an issue so decisions/insights auto-link back to it (the closed loop). Triggers: bug report, ticket, actionable task, backlog review, ready-work, blocked-by, issue status change."
---

# kg beads — Issues as First-Class Graph Nodes

Durable, team-synced bug/issue tracker built INTO the knowledge graph. An issue is a `Chunk` (category `issue`) so it can link to decisions, insights, and the sessions that worked it — something a flat issue tracker cannot do. Issues sync via git (team + CI see them), have short human refs (e.g. `upcozm-a3f9`), status, priority, blocked_by, and ready-work detection.

**This replaces the external `beads` tool.** Do not create beads issues; create kg beads issues.

## The 4 modules — which one owns this content?

| The content is… | Module | Tool |
|---|---|---|
| Something that must be DONE (bug, ticket, task with an owner) | **kg beads** | `issue_create` |
| Where I am right now / resume state | **kg memory** | `state_*` |
| A business rule / domain truth | **kg chunks** | `knowledge_store` |
| A coding gotcha / reusable technique | **kg chunks** | `life_store` |
| A design decision + rationale | **kg chunks** | `decision_record` |

Litmus: **issue = "must DO"; memory = "where am I"; chunk = "what I KNOW/DECIDED".** A TODO does NOT go in `state_*` (it vanishes, team can't see it) — it is an issue. "Currently fixing X" is NOT an issue (backlog rot) — it is `state_set_context`.

## The closed loop (the whole point)

```
1. issue_create {title, priority}           → durable issue, ref upcozm-a3f9
2. state_set_context {current_issue: "upcozm-a3f9"}   → anchor this session to it
3. work → decision_record / knowledge_store / life_store
        → each chunk AUTO-LINKS back to upcozm-a3f9 (because the session is anchored)
4. issue_update {status: "closed"}          → closed, but the graph is kept
5. later:  issue_show upcozm-a3f9           → the bug + why we fixed it + what we learned + who
```

The anchor (`current_issue`) is the thread stitching memory + chunks back to the issue. Without it, decisions written while working are ORPHANED — `issue_orphans` surfaces them so you can `issue_link` them after the fact.

## Autonomous rules

| WHEN | DO |
|---|---|
| User reports a bug / asks to track work | `issue_create` — but only on user request/confirmation, never speculative "resolve later" |
| You start working an issue | `state_set_context {current_issue: <ref>}` — anchor so chunks auto-link |
| You commit to a fix decision while working | `decision_record` (auto-links to the anchored issue) |
| Status changes (start/block/finish) | `issue_update {status}` — update in place, do NOT create a new issue |
| "What can I pick up?" | `issue_ready` (open issues with no open blockers) |
| "What have we forgotten?" | `issue_stale` (open issues untouched > N days) |
| A decision/insight wasn't linked to its issue | `issue_orphans` → `issue_link` |

**Anti-graveyard:** the old beads tracker rotted into 200 unresolved issues because AI created them speculatively. Do NOT repeat that: create issues only when the user wants one tracked. Use `issue_stale` to catch backlog nobody returned to, and close aggressively.

## Answering the classic questions
- "What bugs are open?" → `issue_list`
- "What's ready to work / not blocked?" → `issue_ready`
- "What's blocked?" → `issue_list {status: blocked}`
- "What did we decide about this bug?" → `issue_show <ref>` (linked decisions)
- "What have we abandoned?" → `issue_stale`

## Rules that matter
- `blocked_by` holds **issue_refs** (the short IDs), never internal chunk ids — refs are stable across git sync, chunk UUIDs are re-minted per machine.
- Closing an issue HIDES it from default lists but PRESERVES the whole linked graph — the knowledge survives.
- Two similar bug titles = two issues (dedup is bypassed for issues, on purpose).
