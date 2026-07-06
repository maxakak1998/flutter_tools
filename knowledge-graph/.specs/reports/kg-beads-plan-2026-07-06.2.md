Done by Judge 2

# Evaluation Report: "kg beads" Design Plan (Issues as first-class graph nodes)

- Artifact: `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md`
- Specification: meta-judge spec (reproduced in task)
- Method: independent grounding verification against the live codebase in `flutter_tools/knowledge-graph/src/`

## Executive Summary

This is a strong, unusually well-grounded design plan. I independently verified every load-bearing codebase citation — `SyncChunkFile`/`exportChunk` fixed-field drop, the three import helpers + `hasMetadataChanged`, decision's dedup-bypass + no-decay template, absence of typed-directed traversal / raw-query hatch, and the `blocked_by:`-prefix in-memory-join precedent — and all are accurate. No hallucinated grounding. All 7 essential items pass, all 11 important items pass, no pitfall triggered. The plan is held back from the top band by three residual gaps: (1) orphan **detection** is issue-centric and misses a decision recorded with `current_issue` entirely unset; (2) the issue module has no stale-**open**-issue pruner parallel to `state_prune`/`state_evict_orphans` — anti-graveyard is inflow-control + hide-closed only; (3) gate test-count targets (51/24/8) are stale vs current assert counts (56/25/9) and phrased as fixed counts rather than "0 fail."

**Final weighted score: 3.48 / 5.**

---

## Grounding Verification (Pitfall #1)

| Plan claim | Cite | Verified in code | Result |
|---|---|---|---|
| SyncChunkFile drops unlisted fields | `sync/format.ts` | `format.ts:11-28` — fixed interface, no passthrough | ✅ TRUE |
| exportChunk drops unlisted fields | `sync/export.ts:30` | `export.ts:30-49` — fixed field map | ✅ TRUE |
| Sync is layer-based | `export.ts:18,82,155` | `EXCLUDED_LAYERS` at `export.ts:18`, filtered at 155/82 | ✅ TRUE |
| 3 import helpers + hasMetadataChanged | `sync/import.ts` | `importNewChunk:346`, `importUpdatedChunk:390`, `importMetadataUpdate:425`, `hasMetadataChanged:449` | ✅ EXACT |
| decision bypasses dedup | `store.ts:218` | `store.ts:218` `category === 'decision'`; `decision.ts:62` skipDedup=true | ✅ EXACT |
| decision no-decay | `config.ts:105-113` | `config.ts:112` `decision: 1.0` | ✅ TRUE |
| Auto-link hook location | `store.ts:341` | `store.ts:341` `linker.autoLink(...)` | ✅ EXACT |
| Edges are Chunk→Chunk only | `link.ts:32` | `link.ts:32` `createRelation`; interface Chunk-only | ✅ TRUE |
| No typed-directed traversal / no raw-query | (design claim) | `interface.ts:22` only `getRelatedChunks(chunkId, depth)`; no rawQuery | ✅ TRUE |
| category enum | `types.ts:32-38` | `types.ts:32-38` (6 categories) | ✅ TRUE |
| blocked_by field + in-memory join precedent | `state-task.ts` | `state-task.ts:26` prefix, ready pattern | ✅ TRUE |

**Pitfall #1 (hallucinated grounding): NO — grounding is exceptionally accurate.**

Only imprecision found: plan asserts regression "51/51", daemon "24/24", self-heal "8/8"; actual `assert()` counts today are 56 / 25 / 9. Not hallucination (tests + pass-counting exist), but the fixed gate numbers are stale.

**Pitfall #2 (ambiguous/overlapping 3-module boundaries): NO.** The matrix (lines 47-53) + litmus (line 55) partition cleanly, and the plan explicitly disambiguates the single genuinely-overlapping seam — memory-task vs issue — at line 55 ("nhét TODO vào memory... → phải là issue"). Residual conceptual overlap (memory `state_task` and issue both carry status + blocked_by) exists but is named and resolved on the durable-vs-volatile / team-visible-vs-local axis. Not triggered.

---

## Checklist Results

### Essential (all must be YES or score caps at 2.0)

```yaml
- item: "Plan is a design doc (not code) for issues-as-first-class-nodes replacing beads"
  answer: YES
  evidence: "Whole doc is design prose; line 23 'Issue = một Chunk với category:issue'; line 13 'bỏ beads hẳn'."
- item: "Addresses all four axes (technical, organization, closed-loop, maintainability)"
  answer: YES
  evidence: "Kiến trúc (21-39 technical); decision matrix (45-55 org); closed loop (57-73); maintain table (75-85)."
- item: "Each phase ends with a mandatory review gate that blocks progression"
  answer: YES
  evidence: "Lines 123-133 common gate; line 123 'không sang phase sau nếu gate fail'; each phase '▣ GATE N fail nếu'."
- item: "New issue fields added to SyncChunkFile+exportChunk+import helpers+hasMetadataChanged"
  answer: YES
  evidence: "Line 30 verbatim '...SyncChunkFile + exportChunk + 3 import helper + hasMetadataChanged... nếu không sẽ mất status/priority khi sync'. Verified correct against code."
- item: "Failure mode: decision/insight orphaned when current_issue never set, with detection/mitigation"
  answer: YES
  evidence: "Line 73 names the orphan ('không có nó, decision/insight ghi ra sẽ mồ côi'); mitigation = auto-link when current_issue set (line 39/64) + hook nudge at golden moment (82,156); detection = issue_show flags issues missing links (line 83). NOTE: detection is issue-centric — a chunk recorded with NO current_issue is not surfaced (no issue to inspect)."
- item: "Decision matrix unambiguously tells AI WHEN to use each of 3 modules"
  answer: YES
  evidence: "Table lines 47-53 (signal→module→tool→nature) + litmus line 55."
- item: "Confronts 200-item graveyard with AI-only-creates-on-user-confirmation rule"
  answer: YES
  evidence: "Line 80 'AI chỉ issue_create khi user xác nhận'; line 85 'lý do kg beads sẽ không lặp lại số phận 200-orphan của beads'."
```

All 7 essential = YES → **no essential-gate cap.**

### Important (NO reduces relevant dimension)

```yaml
- "blocked_by FIELD not edge, justified by no typed-directed traversal": YES (lines 32-35, verified)
- "ready-work acknowledged O(N) in-memory join": YES (line 34)
- "ID-collision for short ref under concurrent creation": YES (line 37, 'check trùng ... dưới mutex → không race') — NOTE: assumes create path runs under async-mutex; not proven that issue_create is serialized.
- "issue_ref separated from UUID primary key": YES (line 37)
- "knowledge graph + links survive after issue closed": YES (lines 65-68)
- "full loop end-to-end with acceptance test": YES (lines 59-71 + Phase 4 ACCEPTANCE gate 157-158)
- "litmus rule + named mis-routing examples": YES (line 55)
- "anti-graveyard for all three modules": YES (table 77-81)
- "honest that issue anti-orphan rule is behavioral not code": YES (line 85)
- "each phase has verify script + explicit fail conditions": YES (per-phase 'Verify riêng' + 'GATE N fail nếu')
- "gates protect existing subsystems, no cross-boundary leak": YES (lines 128-132)
```

All 11 important = YES.

### Pitfall

```yaml
- "Hallucinated codebase grounding": NO (verified extensively)
- "3-module boundaries ambiguous/overlapping": NO (partitioned + hardest seam explicitly disambiguated)
```

No pitfall triggered.

---

## Rubric Scores

### 1. Technical Soundness — weight 0.28 — SCORE 4

**Evidence:** The single most load-bearing constraint (silent field drop on sync) is identified precisely and its fix enumerated exactly matching verified code (`format.ts`/`export.ts`/3 import helpers/`hasMetadataChanged`). `blocked_by`-as-field is justified by the verified absence of typed-directed traversal (`interface.ts:22`). `issue_ref` split from UUID (line 37) avoids the sync-mapping-keyed-on-UUID problem. Category mirrors the verified-clean `decision` template (bypass dedup `store.ts:218`, no-decay `config.ts:112`). Schema on both backends called out (line 106). Tradeoffs named: field-vs-edge (optional `DEPENDS_ON` for viz deferred), migrate-vs-not, O(N) join.

**Why not 5:** (a) The ID-collision safety rests on an unverified assumption that `issue_create`'s read-then-write runs under a mutex ("dưới mutex → không race") — `async-mutex.ts` exists but the plan doesn't cite where the create path is serialized. (b) O(N) in-memory join is acknowledged but with no cost accounting of its scaling ceiling. (c) Stale gate numbers (51/24/8 vs 56/25/9). None mishandle a critical constraint, so it stays well above the "critical constraint mishandled" floor.

### 2. Organization & Usability (3-Module Decision Matrix) — weight 0.20 — SCORE 4

**Evidence:** Clean 5-row matrix across 3 modules with tool + durability nature; memorable litmus ("phải LÀM / đang Ở ĐÂU / đã BIẾT-QUYẾT"); named mis-routing examples in both directions (TODO→memory wrong; "đang fix X"→issue wrong). Boundaries not ambiguous (pitfall #2 NO). The hardest seam (memory `state_task` vs issue, both with status+blocked_by) is explicitly resolved.

**Why not 5:** No worked disambiguation for the subtle "rationale discovered while fixing an issue" case (decision_record vs issue description), and the memory-task/issue overlap, while addressed, still relies on an AI's judgment of "durable enough." Softest 4.

### 3. Closed-Loop Integration — weight 0.22 — SCORE 3

**Evidence:** The orphan-when-current_issue-unset failure mode IS addressed (line 73) → cap does not apply. The 6-step loop (59-71) with `current_issue` as the connective thread, issue as entry+exit, explicit beads contrast (closed issue loses knowledge), and a Phase-4 acceptance test running the full loop is the plan's strongest, most original contribution.

**Why not 4:** Detection of the named orphan is incomplete — `issue_show` surfaces issues *missing* links, but a decision/insight written with `current_issue` entirely unset produces a chunk belonging to no issue, which no issue-centric tool surfaces. Loop integrity therefore depends on a behavioral nudge whose failure is not independently detected. That residual, unmonitored risk is exactly what separates 3 from 4.

### 4. Maintainability & Anti-Orphaning — weight 0.18 — SCORE 3

**Evidence:** The 200-item graveyard pain is confronted with the AI-only-creates-on-confirmation rule (80, 85) → cap does not apply. Anti-graveyard covers all three modules (77-81): memory (`state_prune`/`evict`/compaction — verified to exist), issue (hide-closed + confirmation rule), chunk (temporal decay — verified). Honest that the issue rule is behavioral, not code (line 85).

**Why not 4:** Asymmetry — memory has both inflow control AND active pruning (`state_prune`/`state_evict_orphans`), but the issue module has no stale-**open**-issue sweeper. An abandoned open issue (never worked, never closed) has no cleanup path; anti-graveyard is inflow-control + hide-closed only. A code-side `issue_prune` parallel to `state_prune` is absent.

### 5. Phased Delivery with Review Gates — weight 0.12 — SCORE 3

**Evidence:** Four phases, each blocking, each with a dedicated verify script (`issue-phaseN-verify.ts`) and explicit fail conditions ("GATE N fail nếu…"). The pattern has real precedent (`scripts/phase-a/b/c/d-verify.ts` exist). Common gate includes build, regression, daemon, self-heal, code-review, doc-sync, cross-boundary-leak check.

**Why not 4:** Gate numeric targets are stale (51/24/8 vs actual 56/25/9) and, more importantly, mis-framed: adding issue tests will raise these baselines, so a fixed "51/51" target is fragile — the gate should read "0 fail / ≥ baseline," not a frozen count. Slightly undercuts measurability.

---

## Score Calculation

| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Technical Soundness | 4 | 0.28 | 1.12 |
| Organization & Usability | 4 | 0.20 | 0.80 |
| Closed-Loop Integration | 3 | 0.22 | 0.66 |
| Maintainability & Anti-Orphaning | 3 | 0.18 | 0.54 |
| Phased Delivery w/ Gates | 3 | 0.12 | 0.36 |
| **Raw weighted sum** | | | **3.48** |

- Essential gate: all 7 YES → no cap.
- Pitfall rule: neither pitfall triggered → no reduction.
- **Final score: 3.48 / 5.**

---

## Strengths

1. Grounding is exact and independently verified — the load-bearing sync-drop fix maps one-to-one onto real functions (`format.ts:11`, `export.ts:30`, `import.ts:346/390/425/449`).
2. The closed-loop framing (`current_issue` as the thread stitching memory + chunk back to the issue; issue as both entry and lookup exit) is a genuine architectural insight, not a dashboard reskin.
3. Reuse discipline — riding the verified `decision` category template (bypass dedup + no-decay + 3-point pattern) and the task-ledger in-memory-join avoids inventing storage primitives.

## Issues

1. **[Medium] Orphan detection is one-sided.** `issue_show` finds issues missing links, but a decision recorded with `current_issue` unset is invisible (no issue to show). Add a detector for chunks in linkable categories with zero issue edges, or fold it into a briefing. (Closed-Loop.)
2. **[Medium] No stale-open-issue pruner.** Issue anti-graveyard is inflow + hide-closed only; add an `issue_prune` mirroring `state_prune` for open issues untouched N days. (Maintainability.)
3. **[Low] Gate test counts stale/fragile.** 51/24/8 ≠ current 56/25/9, and fixed counts break when issue tests are added — phrase gates as "0 fail / ≥ baseline." (Phased Delivery.)
4. **[Low] Mutex serialization of `issue_create` unproven.** ID-collision safety assumes the read-check-then-create runs under `async-mutex`; cite/verify the serialization point. (Technical.)

## Confidence

- Level: High
- Evidence strength: Strong (all critical citations verified against source)
- Criterion clarity: Clear
- Specification quality: Complete
