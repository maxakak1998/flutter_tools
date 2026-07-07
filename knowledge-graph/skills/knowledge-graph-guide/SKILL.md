---
name: knowledge-graph-guide
description: "Hub skill for Knowledge Graph MCP tools. Use when starting KG work, unsure which tool to use, or need a quick reference. Triggers: 'which KG tool?', 'how to store knowledge', 'how to query KG', 'what tools are available', starting a session involving domain knowledge or operational learnings."
---

# Knowledge Graph Guide

## Start Here

1. Call `knowledge_list` to see existing domains
2. Match task to a skill below — read that skill
3. Follow the workflow + checklist in the skill

## Routing Table

| Task | Skill |
|------|-------|
| Store domain knowledge (business rules, facts) | `kg-storing` |
| Search/browse existing knowledge | `kg-exploring` |
| Validate or promote knowledge lifecycle | `kg-lifecycle` |
| Store coding mistake/gotcha/workaround | `kg-life-knowledge` |
| Track working state / resume across sessions ("what was I doing?") | `kg-session-state` |
| Track a bug/ticket/issue to DO ("what needs fixing", "what's ready to work") | `kg-beads` |
| Attach VISUAL evidence (screenshot/photo/pdf) to an existing chunk/issue | `attachment_*` tools (see below) |
| Debug KG tool errors | `kg-troubleshooting` |

## Tool Quick Reference

### Domain Knowledge Tools
| Tool | Purpose |
|------|---------|
| `knowledge_store` | Store business rule, domain fact, workflow rationale |
| `knowledge_query` | Semantic search across knowledge graph |
| `knowledge_list` | Browse by filters, check domains before storing |
| `knowledge_validate` | Confirm/refute with evidence |
| `knowledge_promote` | Graduate lifecycle (requires golden evidence) |
| `knowledge_evolve` | Update content, preserve confidence |
| `knowledge_link` | Create relationship between chunks |
| `knowledge_delete` | Remove chunk (reason required for validated+) |

### Operational Learning Tools
| Tool | Purpose |
|------|---------|
| `life_store` | Store coding gotcha, pattern, workaround |
| `life_feedback` | Report success/failure after applying a learning |
| `life_draft_skill` | Generate skill draft from high-score learnings |

### Session-State Tools (volatile working memory — NOT durable knowledge)
| Tool | Purpose |
|------|---------|
| `state_set_context` / `state_get_context` | Record / read current focus + next step (append-only trail) |
| `state_save_plan` / `state_get_plan` | Clone a plan file immutably (v1 = original) / read active or a version |
| `state_task_upsert` / `state_task_list` | Task ledger: status pending/in_progress/blocked/done/deferred |
| `state_checkpoint` / `state_resume` | Fold state into a resume packet / project-scoped "catch me up" |
| `state_projection` | Cross-session focus board (what other live sessions are doing) |
| `state_prune` | READ-ONLY: report orphaned tasks untouched >N days |
| `state_evict_orphans` | DESTRUCTIVE: soft-evict the orphans state_prune surfaces |
| `state_compact` | Fold old context events to bound the stream |
| `state_sessions` | List currently-connected sessions |
| `decision_record` | Durable design decision → Chunk (queryable, SUPERSEDES lineage, bypasses dedup) |

### Issue Tools (kg beads — bug/ticket tracker as first-class graph nodes)
| Tool | Purpose |
|------|---------|
| `issue_create` | Create a durable, team-synced issue with a short ref (e.g. `upcozm-a3f9`) |
| `issue_update` | Change priority (p0-p3) / blocked_by / status among open/in_progress/blocked; optimistic CAS |
| `issue_close` | Close a done issue (dedicated verb; hides from lists but keeps the linked graph; idempotent) |
| `issue_list` | List issues (hides closed by default), priority-sorted |
| `issue_ready` | Ready-to-work: open issues whose blockers are all closed (like `bd ready`) |
| `issue_show` | One issue + its linked decisions/insights/knowledge (closed-loop payoff) |
| `issue_link` | Manually attach a chunk to an issue (for orphans auto-link missed) |
| `issue_orphans` | READ-ONLY: decisions/insights linked to no issue (chunk-side blind spot) |
| `issue_stale` | READ-ONLY: open issues untouched >N days (anti-graveyard, like `state_prune`) |

### Attachment Tools (content-addressed image evidence)
| Tool | Purpose |
|------|---------|
| `attachment_add` | Copy an image/pdf into the KG (dedup by sha256) and attach it to a chunk/issue with a display-only caption; returns `rel_path` to `Read` |
| `attachment_list` | List images on a chunk/issue (`sha256`, `rel_path`, `filename`, `caption`, `mime`, `size`) |
| `attachment_remove` | Detach an image by sha256; bytes are ref-count GC'd when no chunk references it |
| `attachment_gc` | Report (or `evict:true`) orphaned rows/bytes |

**Five-boundary rule** (which module owns a piece of content):
- **Must DO** (bug, ticket, actionable task with an owner) → `issue_create` (**kg beads** — durable, synced, has an ID + status).
- **Where am I** (current focus, resume, "what was I doing") → `state_*` (**kg memory** — volatile, local-only, not embedded).
- **What I KNOW** — business WHY → `knowledge_store`; coding HOW → `life_store`; a design decision → `decision_record` (**kg chunks** — durable, embedded/queryable).
- **Visual EVIDENCE** (screenshot/photo/pdf proving one of the above) → `attachment_add` (**attachment** — content-addressed bytes, git-synced). This is orthogonal to the other four: an attachment NEVER stands alone — it always attaches to a chunk/issue that already exists. Litmus: "what does this image prove?" → that thing is the chunk/issue; the image is evidence. If there's nothing to attach to yet, create it first (`issue_create` / `decision_record`), THEN attach.

**Closed loop (6 screenshots proving one bug):**
```
1. issue_create {title:"force-update dialog wrong copy", priority:"p1"}   → upcozm-xxxx
2. state_set_context {current_issue:"upcozm-xxxx"}                         → anchor the session
3. attachment_add {source:"30_force.png", attach_to:{issue_ref:"upcozm-xxxx"}, caption:"Force EN"}   ×6
4. issue_show upcozm-xxxx  → issue + linked decisions + attachments[].rel_path
5. Read each rel_path to view the image
```
The issue (the work), the attachments (the visual proof), and any decision (what was decided) all orbit one `issue_ref`, and `issue_show` gathers them.

Common mis-routing: a TODO in `state_*` (vanishes, team can't see it) → should be an issue. "Currently fixing X" as an issue (backlog rot) → should be `state_set_context`. Anchor a session to the issue you're working (`state_set_context current_issue:<ref>`) so decisions/insights auto-link back to it — that is the closed loop.

**Anti-graveyard rule for kg beads:** create issues on user request or explicit confirmation — never spawn them speculatively "to resolve later" (that is exactly how the old beads tracker became a 200-item graveyard). Use `issue_stale` to catch backlog nobody returned to.

## Response Format (every tool)

Every tool returns a **unified envelope** — read `ok` first:

```jsonc
{ "ok": true,  "data": <payload> }                                  // success
{ "ok": false, "error": { "code", "message", "retryable", "hint" } } // failure
```

On failure, branch on `error.retryable`:
- **`retryable: true`** (`daemon_unreachable`, `version_conflict`, `ollama_failed`) — transient. For `version_conflict`, re-read (`issue_show`/`issue_list`) to get the current version, THEN retry. Others: just retry shortly.
- **`retryable: false`** (`not_found`, `validation`, `internal`) — do NOT retry blindly. Fix the ref/args/preconditions (`validation`, `not_found`) or surface the error (`internal`). `error.hint` says what to do.

Three things to remember:
1. **`ok:true` ≠ mutation happened.** `data.duplicate_of` (store hit an existing chunk, no-op) and `data.warnings` (advisory, e.g. content too long) still appear on success — read them.
2. **`data` shape still differs per tool** (bare array vs `{results,total}` vs `{latest,trail}`). The envelope unifies only the outer `ok`/`error`/`data` wrapper.
3. **A schema/type error bypasses the envelope.** If you get `isError` but the text is NOT a `{ok:false}` envelope, you passed a wrong-typed param (Zod rejected it before the tool ran) — treat it as a validation failure and fix the argument.

## Domain vs Life Knowledge — Decision Guide

**Litmus test**: Ask "Does this explain a BUSINESS reason, or a CODING technique?"

### `knowledge_store` — Domain Knowledge (the WHY)
Business rules, domain constraints, workflow rationale. Written in natural language, NO code.

Examples:
- "Withdrawals require 3-step verification because the payment gateway rejects single-step flows over $500"
- "Betslip odds must be re-validated within 3 seconds of submission because WebSocket odds can drift"
- "Geo-blocked users can see the app but cannot place bets — legal requirement in AU"
- "User onboarding: signup → email verify → ID upload → manual review (24h SLA) → activated"

### `life_store` — Operational Learnings (the HOW)
Coding gotchas, patterns, workarounds, framework quirks. CAN include code snippets and file paths.

Examples:
- "pumpAndSettle never returns when WebSocket streams are active — use pumpAndSettle with timeout"
- "registerFallbackValue required for custom types in mocktail — add in setUpAll"
- "BaseCubitState IDs must use microsecondsSinceEpoch, not millisecondsSinceEpoch — mixing causes dropped states"
- "Patrol $.tap() fails hit-test on overlapping widgets — use $.tester.tap() instead"

### Common Mistakes

| You discovered... | WRONG tool | RIGHT tool | Why |
|---|---|---|---|
| "The cubit deduplicates by state ID" | `knowledge_store` | `life_store` | Code behavior, not business rule |
| "External writes to betslip store bypass the cubit" | `knowledge_store` | `life_store` | Architecture pattern, not business constraint |
| "Soft-delete is required for products with sales history" | `life_store` | `knowledge_store` | Business rule (data integrity) |
| "Withdrawal limits are tiered by verification level" | `life_store` | `knowledge_store` | Business domain rule |
| "Use registerFactory not registerLazySingleton for repos" | `knowledge_store` | `life_store` | Coding pattern/DI technique |

### Quick Decision Flow

```
Is it about WHY the business works this way?
  YES → knowledge_store (natural language, no code)
  NO → Is it about HOW to code something correctly?
    YES → life_store (can include code, file paths)
    NO → Probably not worth storing
```
