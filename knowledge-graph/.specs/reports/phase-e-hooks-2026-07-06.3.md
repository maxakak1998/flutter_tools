Done by Judge 3

# Evaluation Report — Phase E: Hook Lifecycle × 28 MCP Tools (Judge 3)

## Metadata
- Artifact: "PHASE E (NEW, đang design)" section of `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md` (lines 13–80)
- Type: DESIGN (not code)
- Repo verified against: `scripts/setup-hooks.sh`, `scripts/remove-hooks.sh`, `src/cli.ts`, `src/client.ts`
- User goal: maximize captured project status/memory/findings via right-moment nudges; principle: hooks NUDGE only, AI decides, NO RPC auto-write.

## Executive Summary
The design is architecturally sound and correctly honors all three essential-gate constraints: no hook writes via RPC, no AI-facing nudge on observe-only hooks, and compaction restore relocated to `SessionStart(trigger=compact)`. Its hook-capability taxonomy (inject vs stderr vs observe-only) is correct and its three named gaps (ExitPlanMode, SubagentStop, kg-state-used triad) are all verified accurate against the real scripts. However, judged against the stated efficacy goal — *maximize* capture — the design is a strong incremental patch, not a maximal one: it leaves four spec-named capture holes open (zero-edit research sessions, life_feedback on failure, validate-after-read, deferred-task orphan surfacing), and its central Stop nudge is edit-count-gated, structurally biasing capture toward code-editing sessions and away from pure research/investigation sessions — precisely the "findings" the user wants tracked.

## Reference Result (what maximal capture would look like)
A maximal design would nudge every tool with a genuine golden moment, including a research-session capture path independent of file edits (e.g., Stop nudge triggered by N knowledge_query/Read calls with zero state writes → suggest state_set_context/knowledge_store), a life_feedback nudge when a previously-stored learning's domain reappears in a failure, and a validate-after-read nudge when a chunk surfaced by kg context is contradicted by code just read. It would also route the deferred-orphan surfacing through an active nudge, not only the passive resume packet.

## Stage 4: Checklist Results (derived from spec dimensions)
```yaml
checklist_results:
  - question: "Any hook auto-writes via RPC?"
    importance: essential
    answer: NO
    evidence: "Design line 20 + Verification #6 (grep no POST /rpc state_*). Existing hooks confirm log/marker-only pattern (activity.log, marker touch)."
  - question: "Any AI-facing nudge on observe-only hook (PreCompact/SessionEnd/SubagentStart/Notification)?"
    importance: essential
    answer: NO
    evidence: "Design line 30/32/48 explicitly reclassifies PreCompact to log-only and drops kg prime there; SessionEnd = cleanup only (matches kg-session-end-cleanup.sh)."
  - question: "Compaction restore at SessionStart(compact), not PreCompact?"
    importance: essential
    answer: YES
    evidence: "Design line 32 + runPrime cli.ts:1545 case 'compact' already handles restore; design removes the current PreCompact kg prime (setup-hooks.sh:1115)."
  - question: "Are all 28 tools accounted for (nudge vs read vs housekeeping)?"
    importance: important
    answer: NO
    evidence: "Design matrix (lines 36-50) covers session-state + core knowledge tools but does not enumerate all 28; validate/life_feedback holes unaddressed."
  - question: "Are the 3 named gaps accurate vs setup-hooks.sh?"
    importance: important
    answer: YES
    evidence: "SubagentStop absent (grep NONE); kg-state-used read at setup-hooks.sh:324 but never created/cleaned; ExitPlanMode gate exists for KG-knowledge but not for state_save_plan/decision_record."
  - question: "Does the design maximize capture on zero-edit research sessions?"
    importance: important
    answer: NO
    evidence: "Stop hook exits early if no EDITS_FILE (kg-learning-capture-check.sh:285); state nudge gated on EDIT_COUNT>=3 (line 325). Research-only sessions get zero capture nudge."
  - question: "Is remove-hooks.sh symmetry maintained for new hooks?"
    importance: optional
    answer: NO
    evidence: "Committed as intent (design line 62) but not yet done; current remove-hooks.sh NEW_HOOKS[] lacks ExitPlanMode/SubagentStop state additions — acceptable for a design, flagged."
```
Essential failures: 0. Important failures: 3 (capture holes). Pitfall triggers: 0.

## Stage 5: Rubric Scores
```yaml
rubric_scores:
  - criterion_name: Capture-Coverage Efficacy
    weight: 0.30
    score: 2
    weighted_score: 0.60
    evidence:
      found:
        - "Lifecycle arc covered SessionStart→UserPromptSubmit→PreToolUse→PostToolUse→Stop→SubagentStop→cleanup."
        - "Golden moments correctly placed: state_save_plan+decision_record@ExitPlanMode; life_store@SubagentStop; state_checkpoint@Stop; resume@SessionStart+UPS (design lines 52-57)."
      missing:
        - "Zero-edit research/investigation sessions: Stop nudge is edit-gated (kg-learning-capture-check.sh:285,325) → findings from pure-read sessions never nudged. This is the single biggest efficacy hole for a goal literally about capturing 'findings'."
        - "life_feedback on failure: PostToolUseFailure (kg-tool-failure.sh) only classifies tool errors; never nudges life_feedback when a stored learning's domain reappears in a real failure."
        - "knowledge_validate after read: no nudge to confirm/refute a chunk that kg context surfaced and code just contradicted."
        - "deferred-task orphan surfacing: only passive (resume packet); no active state_prune nudge."
    reasoning: |
      The design meets the baseline (arc covered, golden moments for the high-frequency
      tools) but the goal is MAXIMIZE. Four spec-named high-value capture paths remain
      open, and the load-bearing Stop nudge is structurally biased to code edits — the
      opposite of maximal for a research/findings goal. This is refined, adequate work
      with clear holes, not comprehensive coverage. Score 2.
    improvement: "Add an edit-independent Stop capture path keyed on query/read volume so research sessions get a state_set_context/knowledge_store nudge."
  - criterion_name: Hook-Capability Correctness
    weight: 0.30
    score: 3
    weighted_score: 0.90
    evidence:
      found:
        - "3-channel taxonomy (inject / stderr / observe-only) at design lines 24-32 is correct for Claude Code hook semantics."
        - "Hard calls correct: checkpoint@Stop not SessionEnd; restore@SessionStart(compact) not PreCompact; life_store@SubagentStop (stderr)."
        - "Verified runPrime distinguishes source startup/compact/resume (cli.ts:1539-1567); fetchDaemonResume/Briefing are read-only (cli.ts:1258,1300)."
      missing:
        - "Setup/PermissionRequest listed in group A (inject-capable) but design never assigns them a role — harmless but incomplete classification."
    reasoning: |
      Every capability-critical decision is correct and matches actual hook channels and
      the existing prime plumbing. No AI-facing nudge is placed on an observe-only hook.
      This is genuinely solid; no correctness error found. Score 3.
    improvement: "Explicitly note why Setup/PermissionRequest carry no nudge (avoids future misplacement)."
  - criterion_name: Nudge Quality & Anti-Noise
    weight: 0.10
    score: 2
    weighted_score: 0.20
    evidence:
      found:
        - "Rare + fully-wired marker discipline (create/check/clean) is the stated intent; SessionEnd cleanup pattern verified (kg-session-end-cleanup.sh:722-728)."
        - "kg-state-used triad correctly diagnosed half-wired (read@324, no writer, no cleaner)."
      missing:
        - "Over-gating: EDIT_COUNT>=3 threshold + marker suppression means legitimate 1-2 file findings sessions get no nudge → anti-noise tuned so tight it drops capture (design acknowledges 'over-gating drops capture' but does not resolve it)."
    reasoning: |
      Noise control is thoughtful but the balance point sacrifices capture. Adequate. Score 2.
    improvement: "Lower/branch the threshold: nudge state_checkpoint at >=1 substantive artifact OR >=N queries, not only >=3 edits."
  - criterion_name: Principle Adherence
    weight: 0.10
    score: 3
    weighted_score: 0.30
    evidence:
      found:
        - "No write-path RPC in any hook (Verification #6 grep; existing hooks are marker/log only)."
        - "block-vs-nudge honest: Stop/SubagentStop stderr = suggestion (exit 0); PreToolUse gates = block (exit 2) — consistent with existing scripts."
    reasoning: |
      The floor-nudge/no-RPC principle is upheld cleanly and the block/nudge distinction
      is honest. Score 3.
    improvement: "State explicitly that ExitPlanMode state nudge must be exit-0 stderr, not a blocking gate (the existing KG-knowledge one blocks — do not copy that for state)."
  - criterion_name: Lifecycle Completeness & Gaps
    weight: 0.10
    score: 3
    weighted_score: 0.30
    evidence:
      found:
        - "All 12 hook events enumerated and classified (design lines 26-30, 36-50)."
        - "3 named gaps VERIFIED accurate: SubagentStop absent (grep NONE); ExitPlanMode has KG-knowledge gate but no state_save_plan/decision_record nudge; kg-state-used triad half-wired (setup-hooks.sh:324)."
        - "existing-vs-new status column matches reality (kg prime exists; PreCompact kg prime currently mis-placed at :1115)."
    reasoning: |
      Gap analysis is accurate against the actual scripts — a strong, verifiable audit.
      Score 3.
    improvement: "Add remove-hooks.sh NEW_HOOKS[] entries for the new ExitPlanMode/SubagentStop state scripts to the gap list explicitly."
  - criterion_name: Feasibility & Reuse
    weight: 0.10
    score: 3
    weighted_score: 0.30
    evidence:
      found:
        - "add_hook helper (setup-hooks.sh:1031), marker-dir pattern, EDIT_COUNT/AREA_LIST tracking (kg-learning-capture-check.sh:291-292) all exist and are reusable as claimed."
        - "prime/context injection channel + fetchDaemonResume/Briefing verified reusable (cli.ts:1258,1300,1495)."
        - "remove-hooks.sh symmetric-removal pattern exists (remove_hook_command/remove_matcher_entry)."
    reasoning: |
      Every reuse claim checks out against real code; the implementation surface is small
      and well-understood. Score 3.
    improvement: "Commit the remove-hooks.sh symmetry as a DoD item so new hooks are not orphaned (recall prior pipefail orphan bug, design line 76)."
```

## Stage 6: Score Calculation
- Raw weighted sum: (2×0.30)+(3×0.30)+(2×0.10)+(3×0.10)+(3×0.10)+(3×0.10) = 0.60+0.90+0.20+0.30+0.30+0.30 = **2.60**
- Essential gate: PASS (no cap applied — all 3 constraints honored)
- Pitfall penalties: 0
- **Final score: 2.60 / 5**

## Strengths
1. Correct hook-capability taxonomy; all essential hard calls right (checkpoint@Stop, restore@SessionStart(compact)) — verified against cli.ts runPrime.
2. Gap analysis is accurate and verifiable: SubagentStop truly absent, kg-state-used marker truly half-wired (read at setup-hooks.sh:324, never written/cleaned).
3. Principle discipline is clean and honest — no RPC write path, block vs nudge correctly separated.
4. High reuse, low new surface — add_hook, marker pattern, prime channel all confirmed reusable.

## Issues
1. Priority: High | Zero-edit research sessions capture nothing | Stop nudge exits early without EDITS_FILE and state nudge requires EDIT_COUNT>=3 (kg-learning-capture-check.sh:285,325) | Directly undercuts the "capture findings" goal for investigation-heavy sessions | Add an edit-independent capture trigger keyed on query/read volume.
2. Priority: High | life_feedback never nudged | PostToolUseFailure hook only classifies tool infra errors, not domain-learning failures | The learning feedback loop (score adjustment) stays cold → learnings stale | Nudge life_feedback when a failure recurs in a domain with stored learnings.
3. Priority: Medium | validate-after-read + deferred-orphan surfacing not actively nudged | No hook connects kg-context-surfaced chunks to knowledge_validate; state_prune surfacing is passive-only | Confidence lifecycle and orphan GC underused | Add a lightweight validate nudge and an active orphan-surface nudge.
4. Priority: Low | remove-hooks.sh symmetry not yet reflected | NEW_HOOKS[] lacks the new ExitPlanMode/SubagentStop state scripts | Risk of orphaned hooks on teardown (prior pipefail bug precedent) | Make symmetric removal a DoD item.

## Stage 8: Self-Verification
| # | Question | Answer | Adjustment |
|---|----------|--------|------------|
| 1 | Did I examine the real files, not just the plan? | Yes — read setup-hooks.sh (full), remove-hooks.sh, cli.ts runPrime, client.ts tool list. | None |
| 2 | Length/tone bias? | No — scored on verified holes, not plan verbosity. Plan is confident but I checked each claim. | None |
| 3 | Applied score defs (default 2, justify up)? | Yes — 2s where holes exist, 3s only where verification confirmed correctness. No 4/5. | None |
| 4 | Is my reference (research-session hole) correct? | Yes — confirmed Stop hook edit-gating at lines 285/325 makes research capture impossible without a new path. | None |
| 5 | Proportional, not uniformly harsh? | Correctness/gap/reuse earned 3 (verified accurate); efficacy earned 2 (real holes). Balanced. | None |

## Confidence
- Level: High
- Evidence strength: Strong (all load-bearing claims verified at file:line)
- Criterion clarity: Clear
- Specification quality: Complete
