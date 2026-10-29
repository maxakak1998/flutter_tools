# Session Dictionary — Design

Date: 2026-10-27
Status: approved (design), not implemented

## Goal

Every KG tool call is attributed to one **parent (root) session**. Child sessions — in-process
subagents, pane-hosted teammates, and manually adopted sessions — roll up to that parent.
A machine-wide **session dictionary** lists every session with its id and is editable later.

## Decisions (user-confirmed)

| Topic | Decision |
|---|---|
| Dictionary scope | Machine-wide, all projects, local only (never git-synced) |
| Children that roll up | In-process subagents, pane teammates, manual adopt via CLI. `claude -p` / ccs / codex: manual adopt only |
| After `/clear` / `/resume` | Auto-chain: new id `continues_id` -> old id, same root |
| Durable data (chunk/issue/decision) | Unchanged. Attribution lives in a local audit log, not on chunks (session ids are meaningless on other machines) |
| Strictness | Lenient: only `id` required, extra fields allowed, cycles warned not rejected |
| Approach | Full scope, each piece built on an existing component |

## Verified facts (2026-10-27, CC 2.1.311)

- MCP server processes inherit `CLAUDE_CODE_SESSION_ID` (matches live transcript id). This refutes
  the "no env var" statement in CLAUDE.md's Goal Subsystem section — update that section.
- In-process subagents share the parent's MCP client process (transcripts under `<session>/subagents/`).
- `~/.claude/teams/<team>/config.json` carries `leadSessionId` and `members[].tmuxPaneId`.

## Architecture — requirement to existing component

| Requirement | Extends | New work |
|---|---|---|
| Bind every tool to parent | `client.ts:225` (`sessionId`), `client.ts:273` (session_id injection) | Read env id, resolve root via dictionary, inject `root_id` |
| Dictionary | `goal-store.ts` pattern (one JSON per session, daemon-free reads) | `src/session-store.ts` at `~/.knowledge-graph/sessions/<id>.json` |
| Subagents follow parent | Already share the MCP process | Capture `agent_id` in the audit hook |
| Teammates follow lead | Team config `tmuxPaneId` + `leadSessionId` | On client start: match own `TMUX_PANE` -> lead -> fill `parent_id` |
| Manual linking | `kg goal set/get/list` CLI shape | `kg session list`, `show <id>`, `set <id> key=value...` |
| `/clear` / `/resume` chain | `kg prime` SessionStart hook (already handles `source=compact`) | Branch for `source=clear|resume` -> fill `continues_id` |
| Audit | `kg goal bind` PostToolUse pattern + `setup-hooks.sh` | `kg session audit` hook, matcher `mcp__knowledge-graph__.*` |
| MCP access | `state_sessions`, `wrapSuccess`/`wrapError` envelope | `session_list`, `session_update` handled client-side (machine-wide data, not per-project daemon) |
| Goal follows parent | `goal-store.ts` keyed by CC session id | Key by `root_id` |
| Resume/projection | `state_resume`, `state_projection` | Default filter by `root_id` |

## Data model

`~/.knowledge-graph/sessions/<id>.json` — only `id` required; unknown fields preserved.

```jsonc
{ "id": "...", "name": "...", "parent_id": null, "continues_id": null,
  "project_dir": "...", "worktree": "...", "branch": "...",
  "started_at": "...", "last_seen": "...", "status": "active",  // active | archived
  "note": "free-form" }
```

`root_id` is computed on read, never stored (a stored value goes stale when a mid-chain node is re-parented).

`~/.knowledge-graph/sessions/<id>.audit.jsonl` — one line per KG tool call:

```jsonc
{"ts":"...","session_id":"...","root_id":"...","agent_id":null,"agent_type":null,
 "tool":"knowledge_store","ok":true,"refs":["chunk:...","upcozm-42"]}
```

## Rules

- **Auto only fills empty fields.** Detection (teammate, continuation, branch) never overwrites a
  value already present — this is what keeps manual edits safe without an origin field.
- `resolveRoot(id)`: follow `parent_id ?? continues_id`, max 16 hops, `visited` set. On a cycle or a
  dangling reference, stop and treat the current node as root; log a warning.
- `kg session set` / `session_update` accept arbitrary fields; a cycle-creating link is allowed with a warning.

## Error handling — fail-open

The dictionary must never fail a tool call.

| Case | Behaviour |
|---|---|
| No `CLAUDE_CODE_SESSION_ID` | SUPERSEDED: now an error (see "Session id enforcement") |
| Corrupt / missing file | Treat as a fresh session, rewrite |
| Concurrent writers | Per-session files; tmp + `rename` writes; audit appends kept < 4 KB (truncate `refs`) |
| Hook error | `exit 0`, log to `~/.knowledge-graph/logs/` (except a missing hook `session_id`: exit 1, see "Session id enforcement") |
| Write volume | `last_seen` updated at most once per 60 s |
| Odd characters in id | Reuse `sanitizeSessionId()` (`goal-store.ts:66`) |

Legacy `state_*` rows keyed by random UUIDs become orphans; `state_prune` / `state_evict_orphans` already handle them. No migration.

## Step 0 — verify before coding

1. Capture a PostToolUse hook payload for a KG call made by a subagent: is `agent_id` present?
2. Run `/clear` in a throwaway session: does the MCP process survive with the old env id?
3. Spawn one teammate: does its `TMUX_PANE` match `tmuxPaneId` in the team config?

Each answer may simplify or redirect one row of the architecture table; record the outcome here.

## Testing

`scripts/session-test.ts`, modelled on `scripts/goal-test.ts`:

- Part A (pure): read/write, unknown-field preservation, `resolveRoot` over parent / continuation /
  cycle / dangling chains, auto-fills-empty-only, corrupt file.
- Part B (built `dist/`): `kg session set/list/show`, audit hook writes the expected line,
  `kg prime` with `source=clear` sets `continues_id`, client injects `root_id` when `parent_id` is set.

## Docs to update after implementation

CLAUDE.md (Goal Subsystem env-var claim, tool count, new subsystem section), `docs/tools.md`,
`docs/mcp-server.md` — via the `sync-docs` skill.

## Step 0 outcomes / implementation notes (2026-10-27)

Status: implemented; see `src/session-store.ts`, `scripts/session-test.ts`.

**Env observed** in the builder teammate's Bash tool (CC 2.1.311): `CLAUDE_CODE_SESSION_ID` (a UUID), `CLAUDE_CODE_MESSAGING_SOCKET=/tmp/cc-socks/<pid>.sock` (PID = the Claude process; `ps` confirmed it is the teammate's own `claude ... --agent-id <name>@<team>`), `TMUX_PANE=%10`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ATTENDED=0`. Hook-process env was NOT observed directly (assumed to match, since hooks are spawned by the same process).

**Step 0 answers**
1. Subagent `agent_id` in the PostToolUse payload: not tested. The audit hook records `hook.agent_id` / `hook.agent_type` if present, else null.
2. `/clear` env/MCP survival: not tested. The design does not depend on it: the continuation pointer is keyed by the Claude process, and the SessionStart hook supplies the new id.
3. Teammate pane match: checked statically. This teammate's `TMUX_PANE=%10` equals `tmuxPaneId` of member `session-dict-builder` in `~/.claude/teams/session-c71dd418/config.json` (lead `c71dd418-...`). Stale team configs reuse pane ids (e.g. `%10` also appears in `session-010dfffa`), so the newest matching config wins by mtime. The live client path was not run (the KG MCP was not connected).

**Mechanisms settled**
- Teammate (REVISED after live data): pane matching produced a false positive (stale team config listing a main session's pane). Now `detectTeammate(readProcessArgv(process.ppid))`: only a Claude process launched with `--agent-id <name>@<team>` is a teammate; lead = `leadSessionId` of that team's config; `agent_id` stored fill-empty-only. TMUX_PANE matching dropped entirely (if the flag is present but the config is unreadable, agent_id is kept and parent_id left unset).
- Continuation: pointer `sessions/.proc/<key>`, key = `pid-<PID from CLAUDE_CODE_MESSAGING_SOCKET>`, else `pane-<N>`, else skip. REVISED: `continues_id` is set only for `source=clear`; `startup`/`compact`/`resume` just refresh the pointer (resume reuses the original id, so chaining it made a throwaway session the root of the real one). `kg session set <id> key=` (empty) clears a field.

**Deviations**
- `state_resume` / `state_projection` are project-scoped, not session-filtered, so no change was needed; `state_checkpoint` and all session-keyed writes use the root id because the client now injects it as `session_id`.
- Added `client_session_id` to every RPC so the daemon's liveness registry (keyed by the id registered at `/rpc/connect`) keeps working when `session_id` is the root.
- `kg prime source=clear` deletes the goal of the cleared chain's ROOT (goals are keyed by root).
- Spec Part B item "client injects root_id" is not covered by an automated test (needs a live daemon + Ollama).

## Session id enforcement (strict, 2026-10-27)

Rule: EVERY KG tool call carries a session id; a missing id is an ERROR, never a silent fallback.

**Identity vs filter.** Identity = `client_session_id` (the caller's real Claude Code session id; the daemon requires it on every tool RPC). Attribution key = the resolved ROOT, injected as `session_id`. The optional `session_id` param on read tools (`''` = span all sessions) stays a FILTER — it is never accepted as identity (daemon test: blank `client_session_id` with `session_id` set still errors).

**Enforcement points and error shape**

| Layer | Missing id behaviour |
|---|---|
| MCP client (`client.ts`) | No `randomUUID` fallback. Server still starts; every tool call (proxy AND client-side) returns the envelope `validation` error `no Claude Code session id: CLAUDE_CODE_SESSION_ID is not set ...` |
| Daemon (`daemon.ts` `dispatchRpc`) | Any tool RPC lacking a non-blank `client_session_id` -> JSON-RPC error `client_session_id is required: ...` (classifies `validation`). Exempt: `/rpc/connect`, `/rpc/disconnect`, `/rpc/shutdown`, `/health`, dashboard routes |
| Hooks (`kg prime/context/goal bind/goal pre-edit/session audit`) | stdin has no `session_id` -> stderr `kg <cmd>: hook payload has no session_id ...`, exit 1 (non-blocking hook error, visible) |
| Manual CLI (`kg goal set/get/clear`, `kg session show/set`, `kg list/query`, `kg sync export/import/resolve`, `kg import-memory-bank`) | `--session <id>` else `CLAUDE_CODE_SESSION_ID`, else stderr `Error: no session id ...`, exit 1. `kg session show` / `set k=v` default to the current session |
| Internal robustness (corrupt file, dangling link, cycle) | Unchanged: fail-open — not a "missing session id" |

**Audit: MCP tools (44)** — before: the 42 daemon-proxied tools always sent `session_id` (root of the env id, or of a minted UUID if the env was missing) but the daemon accepted RPCs with no identity at all; the 2 client-side tools needed none. After: all 44 require identity.

| Tools | Carried identity before | After | Missing-id error |
|---|---|---|---|
| knowledge_query/store/link/list/delete/evolve/validate/promote/briefing/export/ingest (11) | yes (fallback UUID allowed) | `client_session_id` mandatory | client: validation (env); daemon: validation |
| life_store/life_feedback/life_draft_skill (3), decision_record (1), goal_set (1) | yes (fallback) | mandatory | same |
| state_set_context/get_context/save_plan/get_plan/task_upsert/task_list/checkpoint/resume/sessions/projection/prune/evict_orphans/compact (13) | yes (fallback) | mandatory (`session_id` stays a filter where it was) | same |
| issue_create/update/close/list/show/link/orphans/ready/stale (9) | yes (fallback) | mandatory | same |
| attachment_add/list/remove/gc (4) | yes (fallback) | mandatory | same |
| session_list, session_update (2, client-side) | no (no check) | env id mandatory | client: validation |

**Audit: CLI daemon-RPC call sites (10) and session-keyed CLI paths**

| Call site | Method | Before | After | Missing-id error |
|---|---|---|---|---|
| `fetchDaemonBriefing` (kg prime) | knowledge_briefing | no | hook `session_id` as `client_session_id` | prime: exit 1 |
| `fetchDaemonResume` (kg prime) | state_resume | no ("project-scoped — no session_id") | yes | prime: exit 1 |
| `fetchDaemonOrphanCount` (kg prime) | issue_orphans | no | yes | prime: exit 1 |
| `runContext` (kg context) | knowledge_query | no | yes | context: exit 1 |
| `runList` (kg list) | knowledge_list | no | `--session`/env | exit 1 |
| `runQuery` (kg query) | knowledge_query | no | `--session`/env | exit 1 |
| `runSyncExport` | sync_export | no | `--session`/env | exit 1 |
| `runSyncImport` | sync_import | no | `--session`/env | exit 1 |
| `runSyncResolve` | sync_resolve | no | `--session`/env | exit 1 |
| `runImportMemoryBank` | decision_record | no | `--session`/env | exit 1 |
| goal bind / pre-edit, session audit (no RPC, but session-keyed) | — | silently skipped | hook `session_id` required | exit 1 |

Not covered / notes: `kg session list` and `kg goal list` read local files and need no caller identity. Other scripts that POST `/rpc` directly (`phase-c-acceptance`, `issue-phase4-acceptance`, `self-heal-test`) were updated to send `client_session_id`. Rollout caveat: MCP clients started before this deploy send no `client_session_id` and fail with a `validation` error until their MCP reconnects (suggestion only, not implemented: a temporary daemon env toggle that logs instead of rejecting).
