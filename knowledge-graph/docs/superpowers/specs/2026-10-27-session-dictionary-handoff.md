# Compact handoff: KG session dictionary

## GOAL
Every KG tool call binds to a root (parent) session; subagents, pane teammates and manually adopted
sessions roll up to it; machine-wide editable dictionary of sessions at ~/.knowledge-graph/sessions/.
User wants full scope built on existing components, lenient (not strict).

## STATE
- Spec approved: docs/superpowers/specs/2026-10-27-session-dictionary-design.md (builder appended Step 0 notes).
- Implemented by sonnet builder `session-dict-builder` (user asked for sonnet explicitly). Done, idle.
- Re-verified by lead: build ok; session-test 71/0, goal-test 35/0, envelope-test 23/0, build-artifact-test 7/0.
- DEPLOYED 2026-10-27: install.sh ok; audit hook registered in upcoz-mobile/.claude/settings.local.json.
- Live-tested on temp project via real `kg serve` stdio: root injection, session_list, audit hook (agent_id recorded from payload), prime source=clear chaining -- all passed. NOT committed (user: mix into a later commit is fine).
- NOT tested with real Claude: teammate detection at startup, real /clear (hook env must carry CLAUDE_CODE_MESSAGING_SOCKET), real subagent agent_id in hook payload.

## FILES
- src/session-store.ts -- new dictionary store (fill-empty-only, resolveRoot, audit, .proc pointer, detectLeadSession)
- src/client.ts -- env session id, register entry, inject root as session_id + client_session_id, local tools session_list/session_update
- src/daemon.ts -- liveness keyed by client_session_id || session_id (old clients still work)
- src/cli.ts -- kg session list|show|set|audit; goals keyed by root; prime chains continues_id on source=clear|resume
- scripts/setup-hooks.sh, remove-hooks.sh -- audit PostToolUse hook
- scripts/session-test.ts -- new tests

## DECISIONS
- Dictionary file-per-session (goal-store pattern), machine-wide, never synced -- concurrency + daemon-free reads.
- Chunks unchanged; attribution only in local audit jsonl -- session ids meaningless on other machines.
- /clear continuation key = PID from CLAUDE_CODE_MESSAGING_SOCKET -- stable across /clear.
- state_resume/state_projection left project-scoped (already unfiltered).

## CONSTRAINTS
- install.sh kills KG daemons -> other live sessions (panes %0, %2 in upcoz-mobile) self-heal but keep OLD client code until their MCP restarts. Ask user before deploying.
- Working tree also holds uncommitted goal-subsystem work; never revert.

## NEXT
-1. DONE by lead: /clear no longer deletes root goal (cli.ts prime; goal-test test 9; CLAUDE.md ~253); deployed; live-checked teammate + post-clear main both see root goal.
-0. DONE: strict session-id enforcement (builder). Lead re-ran suites (session 101, goal 35, envelope 25, build-artifact 7, daemon-integration 24, self-heal 8), cleaned client.ts, fixed stale docs, DEPLOYED, live-verified on upcoz daemon. Acceptance scripts phase-c/issue-phase4 edited but NOT run. Builder idle, done.
0. DONE: both live bugs fixed (argv --agent-id teammate detection; chain only on source=clear), suites 76/35/23/7 green, redeployed, 3 bad links cleared in real dictionary.
1. Acceptance scripts run: phase-c PASS, issue-phase4 9/0. Live-verified on real sessions: post-deploy call accepted (a877a305 09:38Z, self-healed), 0 'client_session_id is required' rejections, audit line written, REAL /clear chain 075d8b8d -> c751ffc3.
2. WAITING (user will ask in a few hours, do not poll): re-check upcoz-mobile logs. Commands: grep -c 'client_session_id is required' upcoz-mobile/.knowledge-graph/logs/daemon.log; kg session list; tail ~/.knowledge-graph/sessions/*.audit.jsonl for non-null agent_id (subagent) and any session with parent_id (teammate); hook errors 'payload has no session_id'.

## DROP
- Earlier worktree-isolation analysis (separate topic, not being built now).
- MCP CONNECTION_CLOSED in this session (user said ignore).

## LOG REVIEW 2026-10-27 (upcoz-mobile, today) -- improvement candidates, none started
1. HIGH: daemon startup blocked by sync delta import 48-127 s (06:06, 06:26, 06:48, 09:36Z) > client 15 s timeout -> 6 tool errors "Daemon startup timed out", classified `internal` (non-retryable). Fix idea: listen first, import in background; classify as retryable.
2. MED: "Storage is closing" (3 RPCs during shutdown, issue_orphans waited 7.2 s) fail instead of self-heal retry. Fix: classify as daemon_unreachable.
3. MED: activity.log 62 MB / 283k lines since 2026-03-19, no rotation; `session_stop` logged per turn (804 vs 44 session_start today).
4. LOW: knowledge_store zod errors (summary>200 x3, bad category x2, missing metadata x1); knowledge_evolve with 8-char id prefix -> not_found x3 (accept unique prefix?).
5. LOW: shutdown logged clients=13/6 (count leak on revive re-register?); audit.log last write 2026-03-19 (dead).
Also kg prime trimmed 14069 -> 1047 chars (request from ac-project-54), deployed; backup /tmp/kg-prime-backup-174544.
6. DONE: kg-log-fixer fixed all 5 (suites 101/35/35/7/37/8/16/14 + regression 61), lead re-ran, DEPLOYED + kg setup-hooks in upcoz (settings backup /tmp/settings.local.json.pre-setup-hooks). Live: daemon start->listen 0.47 s, health startup_import=done. Open (not fixed): every restart re-imports full sync dir (manifest last_import_at older than own exports) + 1 chunk "created new (sync_id: undefined)" each restart -- investigate next.
7. IN FLIGHT: kg-log-fixer investigating+fixing (A) full sync re-import on every restart, (B) 'created new chunk (sync_id: undefined)' each restart; live dup chunks must NOT be deleted, only reported. When done: rerun suites, review, install.sh, live-check daemon.log restart has no Delta import + no new chunk.
8. DONE A+B deployed. User approved cleanup: backup /tmp/kg-upcoz-db-backup-205912 (396M), deleted 2783 dup chunks (7793->5010), kg sync import created the single synced copy (sync_id 65daefe9), 2nd import new=0 updated=0.
9. Session check 2026-10-28: teammate detection, subagent agent_type, /clear chains all verified LIVE. Fixed: removed probe-0000 + hijacked .proc/pid-8795 (moved to /tmp/kg-sessions-removed). Open: MCP env id stale after /clear (harmless via shared root); cross-project chain upcoz->w360-hub (a3783007) via EnterWorktree+/clear; nothing committed yet.
