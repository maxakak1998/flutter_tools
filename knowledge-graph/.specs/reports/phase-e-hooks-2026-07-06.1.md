Done by Judge 1

# Phase E — Hook Lifecycle × 28 MCP Tools: Design Evaluation

Artifact: "PHASE E (NEW, đang design)" section of `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md` (plan lines 13–80).
This is a DESIGN, not code. Every claim below was verified against `scripts/setup-hooks.sh`, `scripts/remove-hooks.sh`, and `src/cli.ts`.

## Executive Summary

The design correctly identifies the load-bearing insight — hook channel capability determines what can be nudged — and it avoids both hard traps (compaction restore is moved to SessionStart(compact); end-checkpoint is on Stop, not SessionEnd). It nudges most golden moments and honestly self-flags the half-wired `kg-state-used` marker triad. It falls short on the zero-edit investigation hole (Stop gated at EDIT_COUNT>=3 misses read-only sessions), which the spec explicitly warns about, and its "12 hook" channel taxonomy is loose. Essential gate is NOT triggered.

## Essential Gate — PASS (not triggered)

Verified none of the four disqualifiers is present:
- **No hook auto-writes via RPC.** All nudges are stderr echoes (`kg-learning-capture-check.sh` setup:326–348) or `additionalContext` injections (`kg prime`/`kg context`). No hook body POSTs to `/rpc` state_/knowledge_. Plan line 20 locks this and line 77 lists a verifying grep.
- **No AI-facing nudge on an observe-only hook.** Plan lines 30, 48–50 classify PreCompact/SessionEnd/SubagentStart/Notification as observe-only; PreCompact→log, SessionEnd→marker cleanup, SubagentStart/Notification→unused.
- **Compaction restore is at SessionStart(trigger=compact), not PreCompact.** Plan line 32/48 explicitly moves restore to SessionStart(compact) and removes the mis-placed `kg prime` from PreCompact.
- **End checkpoint is on Stop, not SessionEnd.** Plan lines 32, 46, 53.

## Dimension Scores

### 1. Capture-Coverage Efficacy — 2/5 (weight 0.30)

Evidence FOUND (golden-moment placements, plan lines 42, 46, 53–57):
- `state_save_plan` + `decision_record` → ExitPlanMode ✓ conceptually correct golden moment.
- `state_checkpoint` → Stop ✓.
- `life_store` → SubagentStop + Stop ✓.
- `state_resume` + `knowledge_briefing` → SessionStart ✓ (already live via `kg prime`, cli.ts:1572–1576 folds resume+briefing).
- `knowledge_query`/briefing → SessionStart + UserPromptSubmit(domain intent) ✓.
- Read/housekeeping tools (query/list/get_*/projection/compact) correctly left un-nudged — plan does not spam them.

Evidence MISSING:
- **The investigation hole is not addressed.** The Stop nudge is gated `EDIT_COUNT>=3` (setup:325) and returns early when no `EDITS_FILE` exists (setup:285). A zero-edit deep-investigation session (all Read/Grep/query, findings worth a `life_store`/`decision_record`/`state_checkpoint`) receives no nudge. The spec calls this out explicitly ("Watch the hole"), and the design's verification list (plan 72–77) does not cover it.
- Full arc is *described* but placement quality is uneven: SubagentStop and the ExitPlanMode plan/decision nudge are listed as "❌ lỗ hổng" (plan 42, 47) — i.e. acknowledged as not-yet-placed, not designed in detail.

The arc is enumerated; several key moments are still "listed" rather than "placed well." Default 2 holds — the design does not yet demonstrate the investigation-session capture and leaves two golden moments as open gaps.

### 2. Hook-Capability Correctness — 3/5 (weight 0.30)

Every AI-facing nudge in the matrix (plan lines 36–50) lands on a channel that can actually reach the AI, and both capability traps are avoided:
- Compaction restore → SessionStart(compact). Verified `kg prime` already handles a `compact` source: cli.ts:1508 reads `parsed.source`, cli.ts:1545–1552 has a dedicated `case 'compact'` header, and cli.ts:1572 includes `'compact'` in the set that fetches the live resume packet. The plan's claim (line 40, 48) that cli.ts already supports this is ACCURATE.
- End checkpoint → Stop (stderr), not SessionEnd. Correct — SessionEnd is observe-only.
- Observe-only hooks used for log/cleanup only (PreCompact log, SessionEnd `kg-session-end-cleanup.sh` setup:712–731).

Imprecision (keeps it off 4): the channel table (plan line 28) lumps `PermissionRequest` and `Setup` into the inject group and asserts "12 hook events," but the design never actually wires those two, and the spec's own hook enumeration counts them among observe/other. The taxonomy is directionally right but the "12" is loose bookkeeping rather than a verified channel map. No hard error found, so 3 is justified over the default.

### 3. Nudge Quality & Anti-Noise — 2/5 (weight 0.10)

Gates that keep nudges rare exist and are real: `kg-tool-used` marker (setup:582, checked 295), `kg-consulted` marker create→check→cleanup (setup:852 / 749 / 727), plan-review marker triad (setup:913 create, 897 check, 956 cleanup). These are correctly wired and traced.

But the state-capture marker is broken exactly as the spec predicts:
- **CHECKER** exists: `kg-learning-capture-check.sh` reads `kg-state-used-${SESSION_ID}` (setup:324).
- **NO CREATOR**: grep finds no PostToolUse hook on `state_*`/`decision_record` that `touch`es it. The mark-used hook (setup:574–585) is only registered for `knowledge_*`/`life_*` (setup:1075–1086), not `state_*`.
- **NO CLEANUP**: SessionEnd cleanup (setup:722–728) does not delete `kg-state-used-*`.

Result: `STATE_USED` is always "false" → the state-checkpoint nudge fires on every ≥3-edit turn even after the AI already checkpointed = noise. The plan honestly self-flags this (lines 44, 80) as "đang dở," which is credit-worthy, but the design is scored on what it specifies, and it currently specifies a half-wired triad plus an over-gate (EDIT_COUNT>=3) that also suppresses legitimate capture. Default 2.

### 4. Principle Adherence (nudge-only) — 3/5 (weight 0.10)

No hook body issues a write-path RPC (verified by reading every hook body in setup-hooks.sh; the only network-ish calls are `kg prime`/`kg context` which inject context, and the daemon fetches in cli.ts are read-only resume/briefing). The implicit "floor" is a stderr suggestion, not an auto-write (setup:326–331). Blocking gates (exit 2: `kg-collect-plan-findings.sh` setup:940, `kg-require-consult-before-edit.sh` setup:804) are genuinely blocking, and the Stop reminder is genuinely non-blocking (exit 0, setup:350).

Minor honesty gap keeping it at 3 not higher: the plan repeatedly labels ExitPlanMode as a "nudge" / "thời điểm vàng" (lines 42, 53), but the *existing* ExitPlanMode hook is a hard exit-2 block (setup:940). If the new save_plan/decision_record nudge is folded into that same gate, "nudge" is the wrong label for a blocking mechanism. The distinction is not drawn cleanly. No auto-write, so no cap applies; 3.

### 5. Lifecycle Completeness & Gaps — 3/5 (weight 0.10)

The three named gaps are all verified ACCURATE against the code:
- ExitPlanMode already gated but only surfaces `knowledge_store`: `kg-collect-plan-findings.sh` block text (setup:918–936) names only `knowledge_store` (line 934) with fact/rule/insight/workflow — no `state_save_plan`/`decision_record`. ✓
- SubagentStop unregistered: grep for `SubagentStop` in both scripts returns nothing. ✓
- PreCompact `kg prime` mis-wired: setup:1115 registers `kg prime` on PreCompact. ✓
- Marker triad creator/checker/cleanup diagnosis: accurate (see dim 3). ✓
- Existing-vs-new attribution (plan "Trạng thái" column): "✅ có (kg prime)", "🔶 sửa", "❌ lỗ hổng" all match reality.

Held at 3 (not 4): the design asserts it covers "toàn bộ 12 hook event" but only substantively reasons about ~9 registered events (setup summary line 1165 says "9 events"); Notification/SubagentStart/PermissionRequest/Setup are hand-waved as "không dùng" without confirming they exist as hook events in this harness. Complete enough to be solid, not exhaustive.

### 6. Feasibility & Reuse — 3/5 (weight 0.10)

Every reuse seam the plan names (lines 65–69) is verified to exist:
- `add_hook` helper: setup:1031–1057.
- `$MARKER_DIR/kg-*-${SESSION_ID}` pattern: setup:38, 280–282, throughout.
- `kg prime`/`kg context`: cli.ts:2564, 2585; injection path cli.ts:1614–1620.
- Stop `EDIT_COUNT`/`AREA_LIST`: setup:291–292, reused by the state nudge at 325–330.
- `fetchDaemonResume`/`fetchDaemonBriefing`: cli.ts:1573–1575.

Buildable against the existing scaffold. Held at 3: remove-hooks symmetry is only listed as a to-do (plan line 62 "gỡ đối xứng"), and `remove-hooks.sh` currently has no entries for the new SubagentStop hook or `kg-state-used` marker — the design flags the need but does not yet specify the symmetric teardown, and the known `pipefail`/`mkdir -p` teardown bug (plan line 408) remains out of scope.

## Weighted Overall

| Dimension | Score | Weight | Contribution |
|---|---|---|---|
| Capture-Coverage Efficacy | 2 | 0.30 | 0.60 |
| Hook-Capability Correctness | 3 | 0.30 | 0.90 |
| Nudge Quality & Anti-Noise | 2 | 0.10 | 0.20 |
| Principle Adherence | 3 | 0.10 | 0.30 |
| Lifecycle Completeness & Gaps | 3 | 0.10 | 0.30 |
| Feasibility & Reuse | 3 | 0.10 | 0.30 |

Raw weighted sum: **2.60**. Essential gate not triggered (no cap). **Final: 2.60 / 5.**

## Strengths
1. Correctly diagnoses the channel-capability constraint and avoids both traps (compact restore→SessionStart, checkpoint→Stop) — verified against cli.ts:1545–1572.
2. All three named gaps and the marker-triad defect are factually accurate against the code — high-quality self-audit.
3. Reuses real seams (`add_hook`, marker pattern, `kg prime`, Stop EDIT_COUNT) rather than reinventing.

## Issues
1. **High** — Zero-edit investigation sessions get no capture nudge (Stop gated EDIT_COUNT>=3, setup:285/325). Directly undercuts the stated goal of maximizing findings capture. Add a findings-based Stop signal (e.g. query/decision activity, not just edits) or a SubagentStop/UserPromptSubmit path for investigation.
2. **High** — `kg-state-used` triad half-wired (checker only; setup:324) → checkpoint nudge fires as noise every ≥3-edit turn. Must add a PostToolUse creator on `state_*`/`decision_record` and a SessionEnd cleanup entry.
3. **Medium** — ExitPlanMode labeled "nudge" but is an exit-2 block (setup:940); the plan/decision addition to that gate needs honest block-vs-nudge framing.
4. **Medium** — remove-hooks.sh symmetry for the new SubagentStop hook and `kg-state-used` marker is only a to-do, risking orphaned registrations on teardown.
5. **Low** — "12 hook event" coverage claim is loose; ~9 events are actually wired.

## Confidence
Level: High. Evidence strength: Strong (every claim cross-checked against setup-hooks.sh / remove-hooks.sh / cli.ts with line numbers). Criterion clarity: Clear. Specification quality: Complete.
