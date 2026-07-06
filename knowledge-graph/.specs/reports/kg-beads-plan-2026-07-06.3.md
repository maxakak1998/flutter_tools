Done by Judge 3

# Evaluation Report: "kg beads" Design Plan — Issues as First-Class Graph Nodes

## Metadata
- Artifact: `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md`
- User Prompt: DESIGN PLAN (not code) making bug/issue tickets first-class nodes in an existing KG MCP server to REPLACE beads, unifying 3 modules (kg beads / kg memory / kg chunks) into one closed-loop graph.
- Codebase verified: `src/types.ts`, `src/tools/store.ts`, `src/tools/decision.ts`, `src/tools/link.ts`, `src/tools/state-context.ts`, `src/tools/state-task.ts`, `src/sync/format.ts`, `src/sync/export.ts`, `src/sync/import.ts`, `src/config.ts`, `src/storage/kuzu.ts`, `src/storage/surreal.ts`, `src/client.ts`, `src/daemon.ts`
- Output: `.specs/reports/kg-beads-plan-2026-07-06.3.md`

## Executive Summary
This is a genuinely well-grounded design plan. The single most important finding of this evaluation is that the **hallucination pitfall does NOT trigger** — nearly every cited line number is exact against the live source (store.ts:218 dedup bypass, export.ts:30 exportChunk, config.ts:112 decision:1.0, types.ts:71-94 StoredChunk, store.ts:341 auto-link, client.ts:75 categoryEnum). The sync-field-drop constraint — the highest-risk failure — is correctly and completely captured (all five touch points named). All seven essential checklist items pass, so no essential-gate cap applies. The plan is held to 3s (not 4s) across the four core dimensions by a cluster of **second-order technical completeness gaps** a skeptic surfaces: (1) `listChunks` limit for `issue_ready`/collision-check is unspecified and defaults to 50 — wrong ready-work results past 50 issues; (2) `session_id` threading into `handleStore`/`handleDecisionRecord` (which currently take no sessionId) is not enumerated for the auto-link; (3) `current_issue` lives in append-only `active_context.refs`, and reading "the latest current_issue" is unaddressed; (4) chunk-side orphan detection (knowledge written while `current_issue` was forgotten) is not detectable. Phased delivery is a cut above (specific numeric gates, cross-boundary leak checks) and earns a 4.

---

## Stage 2: Reference Result (what a correct plan must contain)
1. Issue must be a `Chunk` (edges are Chunk→Chunk only) with a new `category:'issue'` mirroring `decision`.
2. New typed columns (status/priority/blocked_by) on BOTH backends AND propagated through the full sync path or they silently drop.
3. blocked_by as a field (not edge) + in-memory O(N) ready-work join (no typed-directed traversal exists).
4. Short human ref separate from UUID PK; collision guard under the RPC mutex.
5. current_issue thread for auto-link; explicit orphan handling when unset.
6. Decision matrix routing AI across 3 modules with a litmus + mis-routing examples.
7. Anti-graveyard per module; confront the beads backlog pain with AI-only-on-confirmation.
8. Phases each ending in a measurable, blocking gate that protects existing subsystems.

## Stage 3: Comparative Analysis
- **Matches**: all 8 reference elements present. Sync path (item 2) is the standout — line 30 names `SyncChunkFile + exportChunk + 3 import helper + hasMetadataChanged`, which is exactly the five points I verified (format.ts SyncChunkFile; export.ts:30 exportChunk; import.ts importNewChunk/importUpdatedChunk/importMetadataUpdate; hasMetadataChanged at import.ts:449).
- **Gaps**: sessionId threading for auto-link; list-limit at scale; current_issue append-only read semantics; chunk-side orphan detection; issue-side staleness detection (no `state_prune` equivalent for rotting OPEN issues).
- **Deviations**: none problematic. "No migration / freeze beads" is a justified, user-confirmed scope cut.
- **Mistakes**: minor line imprecision — client session_id thread cited as 170-174, actual 168-173. state-task.ts is cited as proving "ready-work" but it stores `blocked_by` (BLOCKED_BY_PREFIX at :26) without an actual ready-work computation; the reusable *pattern* is there, but the claim slightly overstates what exists.

## Stage 4: Checklist Results

### Essential (any NO caps overall at 2.0)
```yaml
- q: "Plan is a design doc (not code) making issues first-class nodes to replace beads"
  answer: YES
  evidence: "Markdown design doc, no code. Line 23 'Issue = một Chunk với category: issue'; lines 5-8 replace beads."
- q: "Addresses all four axes (technical, org, closed-loop, maintainability + phased)"
  answer: YES
  evidence: "Kiến trúc (21+), Tổ chức 3 module (41+), Vòng tròn khép kín (57+), Maintain chống 3 bãi rác (75+), Phân phase (123+)."
- q: "EACH phase ends with a mandatory blocking review gate"
  answer: YES
  evidence: "Line 123 'mỗi phase KẾT bằng Review Gate bắt buộc (không sang phase sau nếu gate fail)'; GATE 1/2/3/4 at 140,146,152,158."
- q: "New issue fields propagated through full sync path (SyncChunkFile+export+import+hasMetadataChanged)"
  answer: YES
  evidence: "Line 30 + line 107 name all 5 touch points. VERIFIED exact against format.ts/export.ts:30/import.ts (3 helpers)/import.ts:449."
- q: "Orphan failure mode when current_issue unset described with detection/mitigation"
  answer: YES (with weakness)
  evidence: "Line 73 names the orphan ('decision/insight ghi ra sẽ mồ côi'); line 145 verifies no-garbage-edge; line 83 detection via issue_show. Detection is issue-side only — see Issues #2."
- q: "Decision matrix unambiguously routes AI to correct module of the 3"
  answer: YES
  evidence: "Lines 47-53 table; litmus line 55 'issue=phải LÀM; memory=đang Ở ĐÂU; chunk=đã BIẾT/QUYẾT'."
- q: "Confronts the 200-item graveyard pain with AI-only-creates-issues-on-confirmation"
  answer: YES
  evidence: "Line 85 'AI chỉ tạo issue khi (a) user yêu cầu, hoặc (b) AI đề xuất + user xác nhận ... không lặp lại số phận 200-orphan của beads'; line 80."
```
**Essential gate: NOT tripped (7/7 YES).**

### Important
```yaml
- q: "blocked_by-as-field justified by traversal absence" -> YES (lines 32-34: no typed-directed traversal, no raw-query hatch)
- q: "ready-work O(N) named honestly" -> YES (line 34 'O(N), KHÔNG cần storage primitive mới')
- q: "ID-collision under concurrency guarded" -> YES (line 37 'dưới mutex → không race'; VERIFIED daemon.ts:87 rpcMutex serializes all handlers)
- q: "issue_ref separate from UUID PK" -> YES (line 37 'tách khỏi id (UUID nội bộ) — tránh đụng primary key')
- q: "links survive issue-close" -> YES (lines 65-71 'issue đóng, NHƯNG graph giữ lại toàn bộ')
- q: "full loop has acceptance test" -> YES (line 157 Phase-4 dogfood; GATE 4 ACCEPTANCE line 158; Verification #3 line 163)
- q: "litmus rule + mis-routing examples" -> YES (line 55: TODO→memory and 'đang fix X'→issue both shown)
- q: "anti-graveyard mechanism per module" -> YES (lines 77-81 per-module table)
- q: "honesty that issue guardrail is behavioral" -> YES (line 85 'rule hành vi trong skill, không phải code')
- q: "each phase has verify script + fail conditions" -> YES (issue-phaseN-verify.ts + 'GATE N fail nếu' each phase)
- q: "gates protect existing subsystems" -> YES (lines 128-129 regression 51/51 + daemon 24/24 + self-heal 8/8; line 132 no cross-boundary leak)
```
All 11 important items YES.

### Pitfalls (YES reduces the relevant dimension)
```yaml
- pitfall: "hallucinated codebase grounding"
  answer: NO (not present)
  evidence: "Verified EXACT: store.ts:218, export.ts:18/30/82/155, config.ts:112, types.ts:71-94, store.ts:14-26/29-31/341, kuzu.ts:75-108, surreal.ts:83-109, client.ts:75. Only tiny drift: session line 168-173 vs cited 170-174."
- pitfall: "ambiguous/overlapping module boundaries"
  answer: NO (not present)
  evidence: "Top-level 3-module split is crisp (durable+synced+ID vs volatile+local+7day vs durable-knowledge). Litmus is memorable. Intra-chunk 3-way split is softer but pre-existing and not the task's focus."
```
**No pitfall triggered.** No dimension cap from pitfalls.

## Stage 5: Rubric Scores

```yaml
rubric_scores:
  - criterion: "Technical Soundness"
    weight: 0.28
    evidence:
      found:
        - "Issue-as-Chunk justified by Chunk→Chunk-only edges (line 23-24; VERIFIED link.ts:32 createRelation, cross-layer guard link.ts:28 only blocks operational↔non-op so issue(core-knowledge)↔decision links are legal)."
        - "Sync-field-drop fully captured (line 30) — VERIFIED all 5 points exist and array fields (keywords/entities/tags) already ride sync, so blocked_by[] rides too."
        - "blocked_by-as-field + O(N) join justified by absent typed-directed traversal (32-34); mirror of state-task.ts pattern (BLOCKED_BY_PREFIX :26, in-memory extract :73)."
        - "issue_ref vs UUID PK (line 37) + collision guard under RPC mutex (VERIFIED daemon.ts:87/900 serialize every handler)."
        - "decision template reuse VERIFIED — decision.ts uses skipDedup=true → handleStore bypass at store.ts:218; config.ts:112 decision:1.0."
      missing:
        - "sessionId threading: handleStore/handleDecisionRecord take NO sessionId param (verified signatures). Auto-link 'at store.ts:341' needs sessionId + current_issue lookup + ref→UUID resolution — not enumerated in 'Files sẽ đụng'."
        - "listChunks limit unspecified for issue_ready and collision-check. daemon list default=50 (CLAUDE.md); exportAll uses 10000. Past 50 issues, ready-work and ref-collision checks operate on a truncated set → wrong results."
        - "current_issue stored in append-only active_context.refs (state-context.ts:67 'APPENDS on every call'); reading 'the latest current_issue' across the trail is unaddressed — a later set_context without re-including it loses the anchor."
        - "hasMetadataChanged is named but the status-flip risk isn't reasoned: status changes are content-unchanged metadata-only edits, so a status flip only syncs if hasMetadataChanged compares issue_status (import.ts:449 currently compares 9 fields, none new)."
      verification:
        - "Every cited line verified; no hallucination. Grounding quality is exceptional."
    reasoning: |
      Architecture is correct and the constraints the spec singles out (sync drop,
      traversal absence, dedup mirror, ID collision) are all handled WITH cited,
      verified evidence — clearing the bar for 3. Neither cap fires (no hallucination;
      sync-drop handled). It does NOT reach 4 ('provably could-not-be-lower-risk with
      tradeoffs named') because four real second-order correctness risks (list-limit at
      scale, sessionId threading, append-only current_issue read, status-via-metadata
      sync) are unnamed. These are detail-level, not architectural, so 3 not 2.
    score: 3
    weighted_score: 0.84
    improvement: "Name the sessionId→handleStore threading and ref→UUID resolution for auto-link; specify listChunks({category:'issue'}, 10000) for issue_ready/collision; add issue_status/issue_priority/blocked_by to hasMetadataChanged."

  - criterion: "Closed-Loop Integration"
    weight: 0.22
    evidence:
      found:
        - "6-step cycle (lines 59-71): issue_create → current_issue → work(memory) → distill(chunks, auto-link) → close → re-query returns issue+decision+insight+session."
        - "current_issue framed as the 'sợi chỉ' stitching memory+chunk back to issue (line 73)."
        - "Links survive close (lines 65-71); issue is both entry and lookup exit point."
        - "Orphan-when-unset addressed: no-garbage-edge verify (line 145) + issue_show detects issues lacking links (line 83)."
      missing:
        - "Detection is issue-centric only. A decision written while current_issue was forgotten orphans silently; issue_show (shows what IS linked) cannot surface a chunk that SHOULD have linked. No chunk-side orphan sweep."
        - "How current_issue is read at chunk-store time (append-only trail) unspecified — a mechanical prerequisite for the whole loop."
      verification:
        - "getRelatedChunks VERIFIED (kuzu.ts:696, surreal.ts:464, interface.ts:22) — issue_show neighborhood is real."
    reasoning: |
      The loop is the plan's design centerpiece and the orphan-when-unset cap does NOT
      fire (failure mode named + mitigation via auto-link + partial detection). Handled
      with evidence → 3. Held below 4 by the chunk-side orphan blind spot and the
      unspecified append-only current_issue read — the loop's correctness depends on a
      mechanic left implicit.
    score: 3
    weighted_score: 0.66
    improvement: "Add a chunk-side orphan check (e.g. issue_show or a sweep flags decision/insight created in a session with a current_issue but no RELATES_TO edge), and specify reading the newest current_issue from the active_context trail."

  - criterion: "Organization & Usability"
    weight: 0.20
    evidence:
      found:
        - "5-row decision matrix (47-53) with tool + nature columns."
        - "Litmus 'phải LÀM / đang Ở ĐÂU / đã BIẾT-QUYẾT' (55) + two concrete mis-routing examples."
        - "Routing skill kg-beads + guide update + golden-moment hook nudge (Phase 4, line 156)."
        - "4 content boundaries reconciled with existing CLAUDE.md (line 156)."
      missing:
        - "Intra-chunk 3-way split (knowledge vs life vs decision) shares the single 'đã BIẾT/QUYẾT' litmus — the most likely mis-file zone is less crisply disambiguated than the top-level 3-module split."
      verification:
        - "3 chunk sub-types map to real tools (knowledge_store/life_store/decision_record) confirmed in CLAUDE.md tool table."
    reasoning: |
      Boundaries are NOT ambiguous at the module level (cap not triggered): the three
      modules are separated on durability/sync/scope with a memorable litmus and
      mis-routing examples — this is comprehensive routing, clearing 3. The softer
      intra-chunk boundary and reliance on behavioral discipline keep it from 4.
    score: 3
    weighted_score: 0.60
    improvement: "Add one line disambiguating knowledge_store vs life_store vs decision_record (business truth vs coding gotcha vs design choice-with-rationale) so the highest-risk intra-chunk mis-file is closed."

  - criterion: "Maintainability & Anti-Orphaning"
    weight: 0.18
    evidence:
      found:
        - "Graveyard pain confronted (line 85, explicit '200-orphan of beads') with AI-only-on-confirmation rule — cap NOT triggered."
        - "Per-module anti-graveyard table (77-81): memory prune/evict/compact (exists); issue closed-hidden + confirmation; chunk temporal decay (VERIFIED config.ts decayRates)."
        - "Honesty the guardrail is behavioral not code (line 85)."
        - "No migration / freeze beads (168) avoids importing 50 stale issues into the new store."
      missing:
        - "No issue-side staleness DETECTION — the actual beads graveyard is rotting OPEN issues, and there is no state_prune equivalent for issues (only prevention + closed-hiding). Open-but-abandoned issues have behavioral prevention only."
      verification:
        - "state_prune/state_evict_orphans exist for memory (CLAUDE.md); no analog proposed for issues."
    reasoning: |
      Graveyard pain is confronted head-on with the strongest lever (creation
      discipline) and a per-module table — handled with evidence → 3. The unmitigated
      detection side of stale OPEN issues (no prune/decay analog) is the one gap keeping
      it from 4; prevention is stronger than detection so this is a 3, not a 2.
    score: 3
    weighted_score: 0.54
    improvement: "Add an issue-side staleness surfacer (open issue untouched N days) mirroring state_prune, so prevention is backstopped by detection."

  - criterion: "Phased Delivery with Review Gates"
    weight: 0.12
    evidence:
      found:
        - "4 phases, each with a dedicated verify script (issue-phaseN-verify.ts) AND explicit 'GATE N fail nếu' fail conditions (140,146,152,158)."
        - "Common gate with SPECIFIC numeric criteria: build 0-error, regression 51/51, daemon 24/24, self-heal 8/8, code-review, sync-docs (125-132)."
        - "Cross-boundary leak check protects existing subsystems (line 132: issue must not leak into state_*; state must not leak into knowledge_query)."
        - "Phase 4 is an ACCEPTANCE gate running the full closed-loop dogfood (157-158)."
      missing:
        - "No rollback/remediation path stated if a gate fails; verify-script assertions are sketched (appropriate at plan stage) rather than fully enumerated."
      verification:
        - "regression-test.ts and daemon-integration-test.ts exist (scripts/); the numeric targets are real, checkable gates."
    reasoning: |
      Gates have measurable criteria (cap not triggered) and go beyond the bar: specific
      numeric acceptance thresholds, per-phase fail conditions, AND an explicit
      existing-subsystem protection check. This is 'provably could-not-be-much-lower-risk
      with tradeoffs named' relative to the 0.12-weight dimension — earns 4. Not 5
      (no failure-mode mitigation beyond what was asked, e.g. rollback).
    score: 4
    weighted_score: 0.48
    improvement: "State the rollback action on any gate failure and enumerate each verify script's assertions so the gate is executable, not descriptive."
```

## Stage 6: Score Calculation
- Weighted sum: (3×0.28) + (3×0.22) + (3×0.20) + (3×0.18) + (4×0.12)
  = 0.84 + 0.66 + 0.60 + 0.54 + 0.48 = **3.12**
- Essential-gate cap: not applied (7/7 essential YES).
- Pitfall reductions: none (no hallucination, no ambiguous boundaries).
- Per-dimension caps: none triggered (no sync-drop failure, no hallucination, boundaries clear, orphan-when-unset addressed, graveyard confronted, all gates measurable).
- **Final score: 3.12 / 5**

## Stage 7: Rules Generated
No rules generated. Five Whys on the identified gaps yields root causes that are either task-specific (this plan's auto-link threading detail) or already-covered by existing project rules (the sync-field-drop discipline is documented in CLAUDE.md and the plan itself). None passes the cross-task recurrence + token-justification filter. Creating a rule here would pollute future sessions without broad payoff.

## Stage 8: Self-Verification
| # | Question | Answer | Adjustment |
|---|----------|--------|------------|
| 1 | Evidence completeness — did I read every file the plan cites? | Read types, store, decision, link, state-context, state-task, format, export, import, config, kuzu, surreal, client, daemon. Verified line numbers directly. | None — grounding claims individually checked. |
| 2 | Bias check — am I over-rewarding the impressive line-number accuracy? | Risk: accurate grounding is seductive. But grounding accuracy only means the hallucination pitfall doesn't fire; it does not lift dimension scores by itself. I held 4 dimensions at 3 despite it, penalizing the unnamed second-order risks. | None — kept default-2 discipline; each 3 justified by handled+cited, not by polish. |
| 3 | Rubric fidelity — did I apply the caps as written? | Checked each: Technical cap (sync-drop/hallucination) NOT met; Org cap (ambiguous boundaries) NOT met; Closed-Loop cap (orphan-unset) NOT met; Maintainability cap (graveyard) NOT met; Phased cap (unmeasurable gate) NOT met. Essential gate 7/7. | None. |
| 4 | Comparison integrity — is my own reference correct? | Verified my key claims (edges Chunk→Chunk, no traversal, dedup mirror, session threading absence) against source, not memory. handleStore/handleDecisionRecord genuinely lack sessionId params. | None — the sessionId gap is real, confirmed by reading signatures. |
| 5 | Proportionality — is 3.12 fair, not uniformly harsh/lenient? | Four 3s + one 4 reflects a plan that handles all stated constraints with verified evidence but leaves a consistent band of second-order technical detail unaddressed. Not a 2 (no constraint mishandled), not a 4-avg (real gaps exist). | None — 3.12 is proportional. |

## Strengths
1. **Verified, non-hallucinated grounding** — store.ts:218, export.ts:30, config.ts:112, types.ts:71-94, store.ts:341, client.ts:75 all exact. This is the strongest grounding I would expect from a design plan.
2. **Sync-field-drop fully internalized** — the exact failure the task flagged is named with all five touch points (line 30), and the mechanism (layer-based, one-file-per-chunk, silent drop of unknown fields) is correctly understood.
3. **Phased gates are measurable and protective** — 51/51, 24/24, 8/8, plus a cross-boundary leak check that guards the existing kg chunks/memory subsystems.
4. **Closed loop is coherent** — current_issue as the connective thread, issue as both entry and lookup exit, links surviving close — this is the "why a graph beats beads" argument made concrete.

## Issues
1. **Priority High** — `listChunks` limit unspecified for `issue_ready` and ref-collision check. daemon list default is 50; past 50 issues both operations read a truncated set → ready-work returns wrong issues and collision check can miss an existing ref. Evidence: plan lines 34, 37, 94 vs CLAUDE.md list default 50 / exportAll's 10000. Impact: silent correctness failure at the exact scale (replacing a 200-issue tracker) the plan targets. Suggestion: specify a high explicit limit.
2. **Priority High** — Auto-link integration under-specified: `handleStore`/`handleDecisionRecord` take no sessionId (verified signatures), yet auto-link "at store.ts:341" requires sessionId → current_issue lookup → human-ref→UUID resolution. Not in "Files sẽ đụng." Impact: Phase 2's core value could stall on unplanned signature/threading changes. Suggestion: enumerate the threading and resolution path.
3. **Priority Medium** — Orphan detection is issue-centric only; chunks written with current_issue forgotten orphan silently and are not detectable by issue_show. Suggestion: add a chunk-side orphan sweep.
4. **Priority Medium** — `current_issue` in append-only `active_context.refs` (state-context.ts:67) — reading the latest anchor across the trail is unspecified. Suggestion: define the read semantics.
5. **Priority Medium** — `hasMetadataChanged` named but status-flip-via-metadata-path risk not reasoned; issue_status/priority/blocked_by must be compared there or status changes silently fail to sync. Suggestion: state it explicitly.
6. **Priority Low** — Issue-side staleness has prevention but no detection (no state_prune analog); rotting OPEN issues are the real graveyard. Suggestion: add an open-issue staleness surfacer.

## Confidence
- Level: High
- Evidence strength: Strong (every cited claim verified against source).
- Criterion clarity: Clear.
- Specification quality: Complete.
