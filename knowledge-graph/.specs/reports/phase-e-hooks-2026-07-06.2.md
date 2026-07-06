Done by Judge 2

# Evaluation Report — PHASE E: Hook Lifecycle × 28 MCP Tools (DESIGN)

## Metadata
- Artifact: `PHASE E (NEW, đang design)` section of `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md` (lines 13–80)
- Verified against: `scripts/setup-hooks.sh`, `scripts/remove-hooks.sh`, `src/cli.ts`
- Task: efficacy + system-interaction of wiring KG tools into Claude Code hooks (nudge-only, AI decides, no RPC auto-write)

## Executive Summary
A design, not code. Its hook-capability model is textbook-correct and its self-diagnosis of the three real gaps against `setup-hooks.sh` is accurate down to the line. It passes the essential gate cleanly — no RPC auto-write, no AI-facing nudge on observe-only hooks, compaction restore correctly relocated to SessionStart(compact). The weak spot is capture breadth: the spec-flagged zero-edit investigation hole is not addressed and `knowledge_validate` has no nudged golden moment. Weighted overall **2.60 / 5.0 — PASS (moderate)**.

## Essential Gate — NOT TRIGGERED
- **No hook auto-writes via RPC**: Phase E principle (plan L20) is explicit; matrix L36–50 contains only inject/stderr nudges + `activity.log` (local file append, not RPC). Verification #6 (L77) greps for `POST /rpc state_*` in hook bodies. Pass.
- **No AI-facing nudge on observe-only hooks**: plan classifies PreCompact/SessionEnd/SubagentStart/Notification as observe-only (L30) → log/cleanup only. SubagentStart explicitly "không dùng" (L50). Pass.
- **Compaction restore at SessionStart(compact), NOT PreCompact**: plan L32/L48 explicitly moves restore to `SessionStart(trigger=compact)` and drops the mis-placed PreCompact `kg prime`. Verified `src/cli.ts:1545` already has `case 'compact':` and `cli.ts:1572` fetches the resume packet on compact. Pass.

Gate clear → no 2.0 cap applied.

## Dimension Scores

### 1. Capture-Coverage Efficacy — score 2 (weight 0.30) → 0.60
**Found (strengths):** Golden-moment mapping matches the spec's expected placement exactly — `state_save_plan`+`decision_record`@ExitPlanMode (L42, L53), `state_checkpoint`@Stop (L46, L54), `life_store`@SubagentStop (L47, L56), `state_resume`+`knowledge_briefing`@SessionStart (L38, L57), `knowledge_query`@domain prompt (L40, L57). Full arc covered: start/mid/plan-boundary/subagent/turn-end/resume.

**Missing (evidenced holes):**
- **Zero-edit investigation sessions get ZERO capture.** `setup-hooks.sh:285` — `if [ ! -f "$EDITS_FILE" ]; then exit 0; fi` — the Stop hook exits before any nudge when no file was edited; the state nudge (`setup-hooks.sh:325`) further gates on `EDIT_COUNT >= 3`. A long debugging/reading session (0 edits) — precisely where resume memory is most valuable — is nudged for neither `state_checkpoint` nor `life_store`. Plan L46 doubles down on the `≥3 file` gate and does not acknowledge this hole.
- **`knowledge_validate` has no nudged golden moment.** The only wiring is a *gate on* validate (`kg-require-validate-evidence.sh`, `setup-hooks.sh:1065`), never a nudge *to* validate after code/docs/tests confirm a chunk. Not read/housekeeping — a genuine capture action left un-placed.
- **`life_feedback`** un-nudged (fuzzy moment; minor).

Breadth is claimed as "toàn bộ 28 tool" (L17) but placement is partial; most un-nudged tools are genuinely rare/read (link, evolve, delete, promote, projection, prune, compact), which the spec permits — but the two misses above are real. Meets baseline placement with a spec-named hole → 2.

### 2. Hook-Capability Correctness — score 3 (weight 0.30) → 0.90
**Found:** The channel model (L24–32) is exactly right: A=inject (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure), B=stderr (Stop/SubagentStop), C=observe-only (PreCompact/SessionEnd/SubagentStart/Notification). The "Hệ quả then chốt" (L32) nails both traps the rubric cares about: checkpoint→Stop NOT SessionEnd, and compaction→SessionStart(compact) NOT PreCompact-block. SubagentStop (stderr, nudge life_store) correctly distinguished from SubagentStart (observe-only, unused). No mis-channeled nudge found.
**Minor:** plan L39 marks SessionStart(compact) as "🔶 sửa cli.ts prime", but `cli.ts:1508` already reads `source` and `cli.ts:1545` already handles `case 'compact'` with a resume fetch — the only real fix is dropping the PreCompact registration (`setup-hooks.sh:1115`), not editing cli.ts. Direction correct, work slightly overstated. Solid, evidence-backed correctness → 3.

### 3. Nudge Quality & Anti-Noise — score 2 (weight 0.10) → 0.20
**Found:** Gates are rare (EDIT_COUNT, per-session markers). Marker triad correctly diagnosed as half-wired: checker present (`setup-hooks.sh:324` `[ -f "$MARKER_DIR/kg-state-used-${SESSION_ID}" ]`), **no creator** (no PostToolUse hook writes `kg-state-used`; `kg-mark-tool-used.sh:582` writes `kg-tool-used`, a different marker; state_* tools aren't registered on any PostToolUse), **no cleanup** (`setup-hooks.sh:722–728` omits `kg-state-used`). Plan L80 names all three missing pieces honestly.
**Missing:** the EDIT_COUNT>=3 + exit-on-no-edits over-gating drops capture on investigation sessions (see Dim 1); design leaves it unresolved. → 2.

### 4. Principle Adherence — score 3 (weight 0.10) → 0.30
**Found:** No write-path RPC in any nudge (L20 principle; matrix inject/stderr only). Blocking vs nudge labeled honestly — ExitPlanMode/Edit gates block (exit 2), Stop "NEVER blocks (always exit 0)" (`setup-hooks.sh:270`, and L46 "cân bằng" nudge is stderr). Auto-write count = 0. "Đang sửa dở" admitted (L80). `activity.log` is a local analytics append, not KG state RPC.
**Minor:** the earlier (Phase A–D) "implicit floor auto-append trail" idea (plan L188) would be an RPC write to active_context; Phase E supersedes it with pure nudges + local log, so no contradiction within the artifact under evaluation. → 3.

### 5. Lifecycle Completeness & Gaps — score 3 (weight 0.10) → 0.30
**Found:** All 12 hooks considered (L26–32 taxonomy + L36–50 matrix). All 3 gaps verified accurate against real files:
- ExitPlanMode gated but only knowledge_store: `kg-collect-plan-findings.sh` message (`setup-hooks.sh:934`) nudges `knowledge_store` only — no state_save_plan/decision_record. Plan L42 ✓.
- SubagentStop unregistered: no `add_hook "SubagentStop"` anywhere in `setup-hooks.sh`. Plan L47 ✓.
- PreCompact `kg prime` mis-wired: `setup-hooks.sh:1115`. Plan L48 ✓.
Existing-vs-new status column accurate on all spot checks (SessionStart ✅, UserPromptSubmit 🔶 knowledge-only, PostToolUse ✅, Stop 🔶 đang sửa dở). → 3.

### 6. Feasibility & Reuse — score 3 (weight 0.10) → 0.30
**Found:** Every reuse seam verified present: `add_hook` helper (`setup-hooks.sh:1031`), marker-dir pattern `$MARKER_DIR/kg-*-${SESSION_ID}` (throughout), `kg prime`/`kg context` channel (`cli.ts:438–440`, `2564`, `2585`), Stop `EDIT_COUNT`/`AREA_LIST` reuse (`setup-hooks.sh:291–292`), `fetchDaemonResume`/`fetchDaemonBriefing` (`cli.ts:1300`/`1258`), symmetric `remove-hooks.sh` (`NEW_HOOKS` array L26–45, per-event removers). Design is mostly additive wiring on existing infra. → 3.

## Score Calculation
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Capture-Coverage Efficacy | 2 | 0.30 | 0.60 |
| Hook-Capability Correctness | 3 | 0.30 | 0.90 |
| Nudge Quality & Anti-Noise | 2 | 0.10 | 0.20 |
| Principle Adherence | 3 | 0.10 | 0.30 |
| Lifecycle Completeness & Gaps | 3 | 0.10 | 0.30 |
| Feasibility & Reuse | 3 | 0.10 | 0.30 |
| **Raw weighted sum** | | | **2.60** |
| Essential-gate penalty | | | none |
| **Final** | | | **2.60 / 5.0** |

## Strengths
1. Hook-capability model is exactly correct — channel taxonomy + the two consequence-traps (checkpoint@Stop, compaction@SessionStart(compact)) both nailed (plan L24–32).
2. Gap self-diagnosis is verifiably accurate to the line against `setup-hooks.sh` (3 gaps + marker triad).
3. Honest labeling of blocking vs nudge and of "đang sửa dở" state — no over-claiming; no RPC auto-write anywhere.
4. All reuse seams confirmed to exist; design is low-risk additive wiring.

## Issues
1. **High** — Zero-edit investigation sessions capture nothing. `setup-hooks.sh:285` exits before any nudge when no file edited; state nudge gated at `EDIT_COUNT>=3` (`:325`). This is the single scenario where resume memory pays off most, and the design doubles down on the edit gate (L46) instead of adding a signal-based path (e.g., tool-call volume / query count) for read-heavy turns. Impact: undercuts the stated goal of maximizing captured status/findings.
2. **Medium** — `knowledge_validate` has no nudged golden moment; only a gate on it exists. A capture-adjacent action is left unplaced.
3. **Low** — plan L39 overstates cli.ts work: compact trigger handling already exists (`cli.ts:1545`); the sole fix is removing the PreCompact registration.
4. **Low** — latent tension between Phase E "no RPC auto-write" and the earlier implicit-floor auto-append idea (L188); Phase E supersedes it, but the plan never explicitly retracts L188.

## Self-Verification
1. **Evidence completeness** — read plan Phase E fully, both pages of `setup-hooks.sh`, all of `remove-hooks.sh`, and cli.ts prime/source/context. life_feedback confirmed logged-not-nudged. Adequate.
2. **Bias check** — credit for gap-diagnosis rests on line-level verification (`:934`, `:1115`, `:324`, `:722`), not tone. No length/authority bias.
3. **Rubric fidelity** — zero-edit hole applied under the Capture note that names it explicitly; channel checks applied under Hook-Capability. No drift.
4. **Comparison integrity** — my "cli.ts already handles compact" claim verified at `cli.ts:1508` + `:1545` + `:1572`. Correct.
5. **Proportionality** — scores span 2–3; weakest dimension (coverage hole the spec named) gets 2, verifiably-correct dimensions get 3. Overall 2.60 reflects strong correctness + a real efficacy gap. No adjustment needed.

## Confidence
- Level: High
- Evidence strength: Strong (all claims traced to file:line)
- Criterion clarity: Clear
- Specification quality: Complete
