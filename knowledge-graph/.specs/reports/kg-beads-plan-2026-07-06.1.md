Done by Judge 1

# Evaluation Report: "kg beads" Design Plan (Issues as first-class KG nodes)

## Metadata
- User Prompt: Evaluate a DESIGN PLAN (not code) for "kg beads" — making bug/issue tickets first-class nodes in an existing knowledge-graph MCP server to replace an external issue tracker (beads). Judge on technical soundness, organization (3-module routing), closed-loop integration, maintainability (avoiding 3 graveyards), and phased delivery with mandatory review gates.
- Artifact: /Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md (markdown design plan, Vietnamese)
- Codebase verified: /Users/kiet.phi/Documents/AC_Project/upcoz-mobile/flutter_tools/knowledge-graph

## Executive Summary
This is a genuinely solid, exceptionally well-grounded design plan. Its single most load-bearing claim — that new issue fields silently vanish on sync unless propagated through `SyncChunkFile` + `exportChunk` + three import helpers + `hasMetadataChanged` — is verified precisely accurate against the code, and every other cited line reference I checked (17+ of them) is correct with zero hallucination. It addresses all four required axes, defines a 4-phase delivery with blocking review gates and phase-specific verify scripts, and directly confronts the user's stated graveyard pain with an AI-only-on-confirmation rule. Two real but secondary technical gaps hold it back from exemplary: (1) cross-machine `issue_ref` collision after git sync is not handled (the cited mutex is local-only), and (2) `blocked_by` referential integrity across sync is left ambiguous given `importNewChunk` mints a fresh UUID per machine. Overall: strong work, final score 3.00/5.

---

## Stage 2: Reference Result (what a correct plan must contain)
- Issue = Chunk with new `issue` category mirroring `decision` (bypass dedup, no-decay) — enables Chunk→Chunk edges.
- New typed columns on BOTH KuzuDB and SurrealDB.
- Full sync-path field propagation with an explicit silent-drop warning (the critical check).
- `blocked_by` as a field (not edge) justified by absence of typed-directed traversal / raw-query hatch.
- Ready-work as an honest O(N) in-memory join over listChunks, not a graph primitive.
- Human `issue_ref` separated from internal UUID PK, with a collision guard (ideally covering the distributed/sync case).
- 3-module decision matrix + litmus + mis-routing counter-examples.
- Closed loop create→anchor→auto-link→close→re-query, with orphan-when-current_issue-unset detection/mitigation, links surviving close, acceptance test.
- Per-module anti-graveyard mechanisms; direct answer to the 200-item pain; honesty about behavioral vs coded enforcement.
- Phases each ending in a blocking gate with measurable criteria protecting existing subsystems.

## Stage 3: Comparative Analysis
### Matches (verified against code)
- `ChunkCategory` union at types.ts:32-38 (no `issue` yet) — plan's "add 'issue'" is correct. ✓
- Edges Chunk→Chunk only: link.ts:32 `createRelation`, RELATION_TABLE_MAP — plan's "issue MUST be a Chunk to link" is correct. ✓
- **Sync silent-drop (the load-bearing claim)**: `SyncChunkFile` fixed field list (format.ts:11-28) + `exportChunk` explicit field map (export.ts:30-49) + `importNewChunk` (import.ts:346-383), `importUpdatedChunk` (390-419), `importMetadataUpdate` (425-444), `hasMetadataChanged` (449-464) all enumerate fields explicitly. New fields WOULD vanish unless added to every one. Plan states this exactly. ✓ (strongest section)
- Sync is layer-based: `EXCLUDED_LAYERS = ['operational','entity-index']` (export.ts:18); category is pass-through — issue at `core-knowledge` rides sync. ✓
- Decision template: dedup bypass `metadata.category === 'decision'` (store.ts:218); no-decay `decision: 1.0` (config.ts:112); inferLayer decision→core-knowledge (store.ts:14-26). ✓
- Auto-link hook `linker.autoLink` at store.ts:341. ✓
- refs prefix precedent: `BLOCKED_BY_PREFIX = 'blocked_by:'` (state-task.ts:26) — supports proposed `current_issue:<ref>`. ✓
- In-memory ready-work join + `casUpdateSessionState` (state-task.ts:38, 159). ✓
- Schema: Kuzu Chunk PRIMARY KEY (id), ALTER TABLE migration pattern (kuzu.ts:75-108); Surreal DEFINE FIELD pattern (surreal.ts:83-109). ✓
- client.ts categoryEnum at line 75; session_id threaded with caller-override at client.ts:170-174. ✓

### Gaps / Deviations / Mistakes
- **Cross-machine ref collision (technical gap):** Line 37 claims collision safety "dưới mutex → không race." The mutex (async-mutex.ts) is per-daemon/local; two machines creating issues offline then syncing via git can mint the same `base36(4)` ref (~1.6M space → birthday collisions plausible for a synced tracker). Distributed collision is unaddressed.
- **`blocked_by` referential integrity on sync (technical gap):** `importNewChunk` sets `localId = randomUUID()` (import.ts:353) — internal UUIDs are regenerated per machine. If `blocked_by` stores internal `id` (line 29 says "issue-id"; line 34 says "map id→status"), it breaks after sync. The plan should state `blocked_by` must hold the stable synced `issue_ref` (or sync_id), not the UUID. This is left ambiguous.
- **Orphan mitigation is detection-only:** Orphan-when-current_issue-unset is acknowledged (line 73) and detected via `issue_show` flagging missing links (line 83) plus a "hook nudge" — but there is no proactive prevention beyond a behavioral nudge. Present but light.
- No factual errors or hallucinated files/functions/lines found.

## Stage 4: Checklist Results
```yaml
checklist_results:
  - question: "Plan exists as design doc (not code), addresses issues-as-first-class-nodes to replace beads?"
    importance: essential
    answer: YES
    evidence: "Markdown plan; title line 1 + lines 5-19, 23 'Issue = một Chunk với category issue'."
  - question: "Explicitly addresses all four axes (technical soundness, organization/usability, closed-loop, maintainability)?"
    importance: essential
    answer: YES
    evidence: "Kiến trúc (21-39) tech; decision matrix (45-55) org; closed loop (57-73); maintain/anti-graveyard (75-85)."
  - question: "Phased delivery, each phase ends with a mandatory review gate that blocks progression?"
    importance: essential
    answer: YES
    evidence: "Lines 123-158: 4 phases, each '▣ GATE N fail nếu...'; common gate 125-132 'không sang phase sau nếu gate fail'."
  - question: "States new issue fields must be added to SyncChunkFile + exportChunk + import helpers + hasMetadataChanged, warns of drop?"
    importance: essential
    answer: YES
    evidence: "Line 30: 'SyncChunkFile + exportChunk + 3 import helper + hasMetadataChanged ... nếu không sẽ mất status/priority khi sync.' Verified accurate."
  - question: "Justifies blocked_by as FIELD (not edge) citing absence of typed-directed traversal?"
    importance: important
    answer: YES
    evidence: "Lines 32-34: 'không typed-directed traversal, không raw-query hatch' → field + in-memory join."
  - question: "Acknowledges ready-work is O(N) in-memory join, not graph primitive?"
    importance: important
    answer: YES
    evidence: "Line 34: 'in-memory join ... O(N), KHÔNG cần storage primitive mới.'"
  - question: "Addresses ID-collision for short human ref under concurrent creation?"
    importance: important
    answer: YES
    evidence: "Line 37: 'Sinh ref + check trùng ... dưới mutex → không race.' NOTE: covers local concurrency only, not cross-machine sync collision."
  - question: "Separates human-readable issue_ref from internal UUID PK?"
    importance: important
    answer: YES
    evidence: "Line 37: 'Thêm field issue_ref (human ID) tách khỏi id (UUID nội bộ).'"
  - question: "[PITFALL] Claims changes without grounding (hallucinated files/functions/lines)?"
    importance: pitfall
    answer: NO
    evidence: "All 17+ cited references verified accurate (link.ts:32, store.ts:218/341, config.ts:112, format.ts/export.ts/import.ts, client.ts:75/170-174, schemas). No pitfall."
  - question: "Describes orphan failure mode when current_issue unset, offers detection/mitigation?"
    importance: essential
    answer: YES
    evidence: "Line 73: 'không có nó, decision/insight ghi ra sẽ mồ côi'; line 83: 'issue_show phát hiện issue thiếu link' + hook nudge."
  - question: "Guarantees knowledge graph + links survive after an issue is closed?"
    importance: important
    answer: YES
    evidence: "Lines 65-68: 'issue đóng, NHƯNG graph giữ lại toàn bộ: issue —RELATES_TO→ decision/insight/session.'"
  - question: "Shows full loop end-to-end with a verifiable acceptance test?"
    importance: important
    answer: YES
    evidence: "Closed loop 59-71; Phase 4 GATE (ACCEPTANCE) 157-158 + Verification 163 run create→current_issue→decision→close→re-query."
  - question: "Provides decision matrix unambiguously telling AI WHEN to use each of 3 modules?"
    importance: essential
    answer: YES
    evidence: "Table lines 47-53 (5 rows, distinct signal/module/tool/nature)."
  - question: "Gives a concise litmus rule plus named mis-routing examples?"
    importance: important
    answer: YES
    evidence: "Line 55: 'issue = phải LÀM; memory = đang Ở ĐÂU; chunk = đã BIẾT/QUYẾT' + mis-routing 'TODO vào memory', '\"đang fix X\" vào issue'."
  - question: "[PITFALL] Leaves 3-module boundaries ambiguous/overlapping?"
    importance: pitfall
    answer: NO
    evidence: "Boundaries crisp: matrix + litmus + counter-examples; also splits knowledge/life/decision within chunks. No pitfall."
  - question: "Directly confronts stated pain (200-item graveyard) with rule that AI only creates issues on user confirmation?"
    importance: essential
    answer: YES
    evidence: "Line 80: 'AI chỉ issue_create khi user xác nhận, không tự tạo để làm sau'; line 85: 'lý do kg beads sẽ không lặp lại số phận 200-orphan.'"
  - question: "Provides anti-graveyard mechanisms for all three modules?"
    importance: important
    answer: YES
    evidence: "Table lines 77-83: memory prune/evict/7-day/compaction; beads closed-hiding + confirmation; chunks decay."
  - question: "Honestly notes anti-orphaning for issues is behavioral (skill/policy) not code-enforced?"
    importance: important
    answer: YES
    evidence: "Line 85: 'Đây là rule hành vi trong skill, không phải code.'"
  - question: "Each phase includes phase-specific verification script AND explicit fail conditions?"
    importance: important
    answer: YES
    evidence: "issue-phase1..4-verify.ts named (139,145,151,157) + 'GATE N fail nếu' (140,146,152,158)."
  - question: "Gates protect existing subsystems (regression 51/51, daemon 24/24, self-heal 8/8, no cross-boundary leak)?"
    importance: important
    answer: YES
    evidence: "Lines 128-132: regression 51/51, daemon 24/24, self-heal 8/8, 'KHÔNG rò rỉ cross-boundary'. Scripts exist and use passed/failed counters (exact totals not asserted in-script but plausible)."
```

Checklist summary: total 20, passed 20, failed 0, essential_failures 0, pitfall_triggers 0.

## Stage 5: Rubric Scores
```yaml
rubric_scores:
  - criterion_name: "Technical Soundness"
    weight: 0.28
    score: 3
    weighted_score: 0.84
    evidence:
      found:
        - "Sync field-drop chain enumerated exactly (line 30) — verified against format.ts:11-28, export.ts:30-49, import.ts:346/390/425/449."
        - "Both backends addressed (kuzu.ts:75-108, surreal.ts:83-109) with correct ALTER TABLE / DEFINE FIELD patterns."
        - "issue = Chunk mirroring decision: bypass dedup (store.ts:218), no-decay (config.ts:112), inferLayer (store.ts:14-26)."
        - "blocked_by-as-field justified by real traversal limits (verified: link.ts is Chunk→Chunk, no raw-query hatch); O(N) named (line 34)."
        - "issue_ref separated from UUID PK (line 37)."
      missing:
        - "Cross-machine ref collision after git sync — cited mutex is local-only; base36(4) collision across offline machines unhandled."
        - "blocked_by referential integrity on sync — importNewChunk mints fresh UUID (import.ts:353); plan does not specify blocked_by must hold stable issue_ref, not internal id."
    reasoning: |
      The single most load-bearing check (sync silent field-drop) is handled with rare precision and is verifiably correct, and grounding is not hallucinated — this clears the two cap conditions (field-drop, hallucination). All critical constraints are handled with evidence, placing it well above the default 2. It falls short of 4 ("impossible to do better") due to two genuine secondary gaps in a system that explicitly syncs via git: distributed ref collision and blocked_by UUID referential integrity across import.
    improvement: "State explicitly that blocked_by stores the synced issue_ref (never the internal UUID) and add a cross-machine collision strategy (e.g. embed sync_id-derived suffix or content-hash ref) since git sync defeats a local mutex."
  - criterion_name: "Organization & Usability (3-Module Decision Matrix)"
    weight: 0.20
    score: 3
    weighted_score: 0.60
    evidence:
      found:
        - "Decision matrix (47-53): 5 mutually-distinct rows; also separates knowledge/life/decision within chunks."
        - "Litmus rule (55): 'phải LÀM / đang Ở ĐÂU / đã BIẾT-QUYẾT'."
        - "Named mis-routing counter-examples (55): TODO→memory, 'đang fix X'→issue."
        - "Routing surfaced in skill + hook (82, 156)."
      missing:
        - "No explicit tie-breaker for genuinely overlapping cases (e.g. a durable design decision discovered mid-issue — decision_record vs issue_link ordering)."
    reasoning: |
      Boundaries are crisp and non-overlapping with a concise litmus and concrete counter-examples surfaced in both skill and hook — cannot be capped at 2. Strong, solid work; a 4 would require worked tie-breaker examples for the fuzzy middle.
    improvement: "Add 1-2 borderline tie-breaker examples (decision-during-issue, gotcha-during-issue) showing the exact routing call order."
  - criterion_name: "Closed-Loop Integration"
    weight: 0.22
    score: 3
    weighted_score: 0.66
    evidence:
      found:
        - "Full 6-step loop create→anchor→auto-link→derive→close→re-query (59-71)."
        - "current_issue thread reuses refs-prefix precedent (39, verified state-task.ts:26)."
        - "Orphan-when-unset addressed (73) + detection via issue_show (83) — no cap applies."
        - "Wrong-target auto-link handled: GATE 2 fails if 'auto-link tạo edge sai target'; Phase 2 verify asserts no edge when current_issue absent (145-146)."
        - "Links-lost-on-close explicitly guaranteed (65-68); re-query demonstrated by Phase 4 acceptance (157)."
      missing:
        - "Orphan mitigation is detection + behavioral nudge only; no proactive block/prompt when a decision is recorded with no current_issue set."
    reasoning: |
      Every named break point is covered and orphan-when-unset is explicitly handled, so no cap. The loop is concrete and testable. Held to 3 because orphan handling is reactive (flag after the fact) rather than preventive.
    improvement: "On decision_record/knowledge_store with no current_issue, surface a soft prompt ('no issue anchored — link to an issue?') so orphans are prevented, not just detected later."
  - criterion_name: "Maintainability & Anti-Orphaning"
    weight: 0.18
    score: 3
    weighted_score: 0.54
    evidence:
      found:
        - "Per-module anti-graveyard table (77-83): memory prune/evict/7-day/compaction; beads closed-hiding + AI-only-on-confirmation; chunks decay."
        - "Directly confronts 200-item pain with confirmation rule (80, 85) — no cap."
        - "Honest behavioral-vs-coded note (85: 'rule hành vi trong skill, không phải code')."
      missing:
        - "No periodic review/GC ritual for closed issues (analogous to state_compact) — closed issues are hidden but accumulate durably and sync forever."
    reasoning: |
      Confronts the graveyard pain head-on with the exact confirmation rule the spec demands and is honest about enforcement being behavioral — clears the cap. Solid. A 4 would add a bounded lifecycle for closed issues so the durable+synced store cannot itself become a slow graveyard.
    improvement: "Add a closed-issue compaction/archival ritual (mirror state_compact) so closed issues don't accumulate unbounded in the synced graph."
  - criterion_name: "Phased Delivery with Review Gates"
    weight: 0.12
    score: 3
    weighted_score: 0.36
    evidence:
      found:
        - "4 phases, each ending in a blocking gate with explicit fail conditions (140,146,152,158)."
        - "Phase-specific verify scripts named (139,145,151,157)."
        - "Common gate protects subsystems: build clean, regression 51/51, daemon 24/24, self-heal 8/8, no cross-boundary leak, code-review, docs (125-132)."
        - "Coherent dependency order: node/sync → link/auto-link → ready-work → orchestration/teardown."
      missing:
        - "No rollback/abort criteria if a gate fails mid-phase; no perf budget for the O(N) ready-work join at scale."
    reasoning: |
      Every gate has measurable, blocking criteria and protects existing subsystems, so it clears the default-2 condition comfortably. Strong. Short of 4 for lack of rollback handling and a scale budget.
    improvement: "Add per-gate rollback criteria and a rough scale ceiling for the O(N) ready-work join (e.g. acceptable up to N issues)."
```

## Stage 6: Score Calculation
- Raw weighted sum: 0.84 + 0.60 + 0.66 + 0.54 + 0.36 = 3.00
- Essential gate: no essential item = NO → no cap applied.
- Pitfall rule: both pitfalls = NO → no penalty.
- Final score: **3.00 / 5**

## Stage 7: Observed Issues (no rules generated — see rationale)
```yaml
issues:
  - issue: "blocked_by referential integrity is ambiguous across sync."
    evidence: "Line 29 'blocked_by (string[] issue-id)' + line 34 'map id→status' vs import.ts:353 localId=randomUUID() regenerates internal UUID per machine."
    priority: High
    impact: "If blocked_by holds internal UUIDs, ready-work joins break after any team sync — the core beads-replacement feature fails silently cross-machine."
    suggestion: "Specify blocked_by stores the stable synced issue_ref (or sync_id), never Chunk.id."
  - issue: "Short-ref collision guard covers local concurrency only."
    evidence: "Line 37 'dưới mutex → không race'; mutex is per-daemon, but issues sync via git across machines."
    priority: Medium
    impact: "Two machines can independently mint the same base36(4) ref, colliding on sync."
    suggestion: "Derive ref suffix from sync_id/content-hash, or reconcile collisions at import."
  - issue: "Orphan handling and closed-issue accumulation are reactive/behavioral only."
    evidence: "Lines 83, 85; no closed-issue compaction analogous to state_compact."
    priority: Low
    impact: "Durable+synced issue store could itself slowly become a graveyard."
    suggestion: "Add proactive anchor prompt + closed-issue archival ritual."
```
Rule-generation rationale: Root-cause analysis places all three issues as **task-specific gaps in this design artifact**, not systemic agent anti-patterns that would recur across unrelated tasks. Per the candidacy filter, no `.claude/rules/` rule is warranted — creating one would pollute every future session for a plan-specific omission. No rules created.

## Stage 8: Self-Verification
| # | Question | Answer | Adjustment |
|---|----------|--------|------------|
| 1 | Did I examine all relevant files? | Yes — types, link, sync trio (format/export/import), store, config, both schemas, state-context/task, client, test scripts. | None |
| 2 | Am I biased by length/tone/language? | The plan is dense Vietnamese; I judged substance and verified every citation. | None |
| 3 | Did I apply score_definitions and caps exactly? | Yes — confirmed no field-drop/hallucination cap (Tech), no ambiguity cap (Org), no orphan-unset cap (Loop), no pain-unconfronted cap (Maint), measurable gates (Phase). | None |
| 4 | Is my own reference correct? | The blocked_by UUID-regeneration concern is grounded in import.ts:353 (verified), so my key deduction is sound. | None |
| 5 | Are scores proportional (not uniformly harsh/lenient)? | Uniform 3s reflect uniformly strong-but-not-flawless dimensions with the same gap character (secondary omissions). Justified, not lazy convergence. | None |

## Strengths
1. The sync silent-drop analysis (line 30) is exact and verified against format.ts/export.ts/import.ts — the highest-risk correctness trap is the plan's strongest point.
2. Zero hallucination: every one of 17+ cited line references checks out.
3. Directly confronts the user's 200-item graveyard pain with the AI-only-on-confirmation rule (80, 85) and is honest it is behavioral, not coded.
4. Closed loop is concrete, testable, and explicitly guarantees links survive issue close (65-68).
5. Every phase ends in a blocking, measurable gate that also protects existing subsystems.

## Issues (prioritized)
1. High — blocked_by referential integrity ambiguous across sync (import.ts:353 UUID regen). Fix: store issue_ref, not UUID.
2. Medium — short-ref collision guard is local-only; git sync defeats the mutex.
3. Low — orphan/closed-issue handling reactive; add proactive anchor prompt + closed-issue archival.

## Confidence
- Level: High
- Evidence strength: Strong (all critical claims verified in source)
- Criterion clarity: Clear
- Specification quality: Complete
