Done by Judge 3

# Evaluation Report: Session-State / Progress / Decisions Persistence Design Plan

## Metadata
- Artifact: `/Users/kiet.phi/.claude/plans/hi-n-t-i-h-th-ng-eager-lecun.md` (design/architecture plan, Vietnamese + English tech terms — NOT code)
- User goal: Add session-state/progress/active-context/decisions persistence to the KG MCP server so an AI recovers "what it was doing" across sessions; resolve conflicts for up to 5 concurrent sessions and on git-merge.
- Specification source: meta-judge YAML (6 weighted rubric dimensions)

## Executive Summary
This is an unusually well-grounded plan. Every load-bearing file/symbol/line citation resolves against the real codebase and is described faithfully. The concurrency answer reasons from the true infrastructure (single daemon + `AsyncMutex` FIFO — verified that ALL RPC dispatch flows through `rpcMutex.runExclusive`) and layers partition-by-session, append-only streams, read-time projection, CAS-with-reject-and-surface, and gated LLM-merge — matching the spec's ideal answer and correctly separating physical write-safety from logical conflict. The volatile/durable storage split (separate non-embedded `SessionState` table vs decisions in the Chunk table) is committed and justified. Real gaps are limited to under-specified cache-invalidation, cold-start checkpoint bootstrap, and checkpoint packet schema. **Final weighted score: 3.75 / 5.**

---

## Citation Verification (Stage 1-3)

| Plan citation | Verified? | Notes |
|---|---|---|
| `AsyncMutex` FIFO serializes RPC (`src/async-mutex.ts`) | YES | Confirmed FIFO queue, `runExclusive`, `pending`/`isLocked` getters. Header comment confirms single-RPC-at-a-time. |
| ALL RPC through mutex | YES (stronger than stated) | `daemon.ts:654` `rpcMutex.runExclusive(() => dispatchRpc(...))` wraps every tool call. |
| `EXCLUDED_LAYERS=['operational','entity-index']` `auto-export.ts:29` | YES | Exact match at line 29. |
| `clientCount` `daemon.ts:311` | YES | Exact. |
| connect/disconnect `daemon.ts:661-670` | YES | Exact range. |
| `rpc_queue_depth` at `/health` | YES | `daemon.ts:682` `rpc_queue_depth: rpcMutex.pending`. |
| `ChunkCategory` union `types.ts:32-37` | YES | fact/rule/insight/question/workflow at 32-37 exactly. |
| `inferLayer()` `store.ts:14-25` | YES | Exact range and behavior. |
| `content_hash` + `.conflicts.json` sync path | YES | `format.ts:14`, `export.ts:34`, `import.ts:254/270` persist lifecycle conflicts → `.conflicts.json`; `setup-hooks.sh:100-107` installs UserPromptSubmit conflict-check hook. |
| `kg prime` (SessionStart/PreCompact) + `kg context` (UserPromptSubmit) inject `additionalContext` | YES | `cli.ts:172-173, 436-438, 1448-1490, 2306/2327`. |
| `version` field for CAS | YES | Chunk has `version:number` (`types.ts:86`). Plan proposes adding `version` col to new SessionState table. Feasible. |
| Decay rates fact/rule 1.0 | YES | `config.ts:107-108`. Plan proposes `decision:1.0`. Consistent. |
| Size targets | YES | `store.ts:28-29` fact:500/rule:800/insight:600/question:400/workflow:800. |
| IStorage `createChunk`/`updateChunk` | YES | `interface.ts:9,11`. |
| `remove-hooks.sh` bug (pipefail kills before cleanup) | YES (mechanism) | `set -euo pipefail` at line 10; Step 2 `cat > "$HOOKS_DIR/..."` fails if `.claude/hooks/` absent. |

**Minor imprecisions (cosmetic, not misdescriptions):**
- Plan says "3 tool `life_*`" — actual files are `life-store.ts`, `life-feedback.ts`, `life-draft-skill.ts` (3 tools, hyphenated not underscored). Correct count, stylized name.
- Plan says fix `remove-hooks.sh:63` with `mkdir -p`; the failing Step-2 `cat >` block starts around line 17-21. Line number is off but the bug is correctly diagnosed.

No non-existent or misdescribed file was found.

---

## Reference Result (Stage 2 anchor)
A correct plan must: (1) identify single-daemon+mutex as the physical-safety primitive already present; (2) NOT conflate physical write-safety with logical conflict; (3) keep volatile state out of the embedded Chunk table (embedding cost, 0.88 dedup clobber, monthly decay all wrong for state); (4) commit a concrete table/architecture; (5) answer concurrency with partition + append-only + projection + CAS-reject (never silent LWW); (6) answer git-merge (local-only makes state moot; durable decisions ride existing sync); (7) specify both backends + verification incl. concurrency and resume E2E + install.sh sync. The plan hits all seven.

---

## Rubric Scores

### 1. Codebase Fidelity & Evidence Grounding — 4/5 (weight 0.20 → 0.80)
Every concrete citation resolved and was described faithfully, including exact line numbers for the non-obvious ones (`auto-export.ts:29`, `daemon.ts:311/661-670`, `types.ts:32-37`, `store.ts:14-25`). The concurrency premise is actually *stronger* than the plan states (all RPC — not just some — flows through the mutex). Only cosmetic imprecisions (`life_*` naming, remove-hooks line 63). Spec says "reward correctness, not volume" — correctness is near-perfect. Not a 5 because two citations are line-imprecise.
- Improvement: Fix `life-store.ts` naming and the `remove-hooks.sh` line reference.

### 2. Architecture Soundness & Fit-to-Goal — 4/5 (weight 0.20 → 0.80)
Option B committed cleanly: separate non-embedded `SessionState` table + decisions in Chunk table under new `decision` category. Volatile/durable split explicitly justified against all three real hazards ("không tốn Ollama round-trip, không dedup 0.88 clobber, không decay theo tháng. Đây là lý do KHÔNG nhét vào Chunk table"). Taxonomy (active_context/progress/decision/checkpoint) coherent, checkpoint correctly *derived* not stored. Decisions-in-Chunk justified because a decision genuinely *is* durable domain knowledge. End-to-end resume is answerable: `kg prime` folds a project-level checkpoint into session-start context, sidestepping per-session cold-start.
- Gap: "read-time fold + cache, invalidate on write" — invalidation under 5 concurrent writers must itself route through the mutex; plan names it but does not detail. Cold-start bootstrap (which checkpoint prime reads before a session_id exists) is answered only implicitly by "checkpoint của project".
- Improvement: Specify cache-invalidation ordering vs mutex and the exact project-level fold prime consumes.

### 3. Concurrency & Merge-Conflict Correctness — 4/5 (weight 0.20 → 0.80)
Strongest dimension. Reasons correctly: single daemon per project → 5 clients FIFO-serialized (verified); then partition-by-session so the hot path has nothing to merge; append-only event stream ("trivially safe dưới rpcMutex"); read-time projection (most-recent-active for display, UNION for sets); CAS on `version` for rare single-valued cells with **"mismatch → reject + surface conflict cho agent, KHÔNG silent-LWW"**; LLM-merge as gated escape hatch only, keeping both inputs for audit. Explicitly separates physical write-safety (mutex) from logical conflict (partition/CAS) — does NOT conflate them. Git-merge: local-only makes state moot; durable decisions ride existing `content_hash` + `.conflicts.json` path (verified real). This matches the spec's ideal answer point-for-point.
- Not a 5 only because it precisely *meets* the ideal rather than exceeding it (e.g., no discussion of projection staleness bounds or event-ordering across sessions with clock skew).

### 4. Completeness of Design Coverage — 3/5 (weight 0.15 → 0.45)
Covered and mostly specified: taxonomy (4 types + roles + volatility + home); MCP tool surface with the real 3-point wiring pattern (`client.ts` Zod + `daemon.ts` case + `tools/*.ts` handler) and 7 concrete tools; retention/compaction (keep N≈50, fold older → snapshot — directly tied to the measured 119KB bloat); resume mechanism (prime/context reuse); session registry upgrade (`clientCount` → registry keyed on `session_id`); decision-category integration named across union + `inferLayer` + decay + size + docs. Concrete SessionState columns listed.
- Gaps: checkpoint "resume packet" schema not defined; projection module's fold contract only sketched; cache lifecycle light. These are specified enough to name but not enough to implement without decisions.

### 5. Implementation Feasibility & Verification Plan — 4/5 (weight 0.15 → 0.60)
Both backends addressed via `IStorage` (Kuzu SET path / Surreal direct UPDATE), with the no-vector-index rationale correct — since SessionState has no vector index, in-place UPDATE avoids the Kuzu delete+recreate workaround (matches CLAUDE.md's documented Kuzu limitation). Migration via ALTER/CREATE TABLE. Verification is specific, not generic: extend `regression-test.ts` (store/get context, task status transition, projection fold with 2 simulated sessions → UNION, CAS reject on version mismatch); dedicated concurrency script (parallel `state_set_context` from multiple session_ids → assert no lost events, check `rpc_queue_depth`); extend `daemon-integration-test.ts` (multi-session registry); resume E2E (write context → checkpoint → `kg prime` prints packet); and the mandatory `npm run build` + `bash install.sh` sync-to-`~/.knowledge-graph/`. Does not ignore the 2nd backend.
- Improvement: Show one concrete migration statement and the assertion shape for the CAS-reject test.

### 6. Risk Identification & Scope Discipline — 3/5 (weight 0.10 → 0.30)
Explicit out-of-scope quarantine of the `kg remove-hooks` bug with correct root cause and two fixes. Prior-art grounding (Cline/Roo/Serena/mem0/beads/ADR) and pain measured from the user's *actual* memory-bank (996-line activeContext, 2581-line decisionLog) to validate the taxonomy-vs-substrate distinction. Decided-vs-open is stated.
- Mild overclaim: "Không còn câu hỏi mở về kiến trúc" (no open architectural questions) while cache-invalidation ordering and cold-start bootstrap are arguably still open. No embedding-store-pollution risk though — correctly ruled out.

---

## Score Calculation
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Codebase Fidelity & Evidence Grounding | 4 | 0.20 | 0.80 |
| Architecture Soundness & Fit-to-Goal | 4 | 0.20 | 0.80 |
| Concurrency & Merge-Conflict Correctness | 4 | 0.20 | 0.80 |
| Completeness of Design Coverage | 3 | 0.15 | 0.45 |
| Implementation Feasibility & Verification | 4 | 0.15 | 0.60 |
| Risk Identification & Scope Discipline | 3 | 0.10 | 0.30 |
| **Raw weighted sum** | | | **3.75** |
| Checklist/pitfall penalties | | | 0.00 |
| **Final score** | | | **3.75** |

### Essential Gate — ALL PASS (no cap)
1. Cited files/symbols/lines resolve — YES (all verified).
2. Concurrency answered with specific mechanism — YES (daemon+mutex FIFO → partition → append-only → projection → CAS-reject → gated LLM-merge).
3. Git-merge addressed — YES (local-only moots state; decisions ride content_hash/.conflicts.json).
4. Concrete storage architecture committed — YES (Option B).
5. Volatile-state-out-of-Chunk-table justified — YES (no embedding, no 0.88 dedup, no decay).

### Pitfalls — NONE triggered
Silent LWW explicitly rejected; no misdescribed files; volatile state kept out of Chunk table; `AsyncMutex` reused (not reinvented); `install.sh` sync step present.

---

## Key Strengths
1. Exceptional evidence grounding — every load-bearing citation resolves; concurrency premise is verifiably true (all RPC serialized).
2. Concurrency reasoning is textbook-correct and separates physical write-safety from logical conflict, with CAS reject-and-surface instead of silent LWW.
3. Volatile/durable storage split committed and justified against the three concrete Chunk-table hazards.
4. Verification plan is backend-aware (Kuzu + Surreal) and specific (CAS-reject assertion, concurrency lost-event test, resume E2E, install.sh sync).
5. Design validated against the user's real, measured memory-bank pain (bloat + LWW + flat decision log).

## Key Weaknesses
1. Cache-invalidation ordering for the read-time projection under 5 concurrent writers is named but not specified.
2. Cold-start checkpoint bootstrap (what `kg prime` reads before a session_id exists) is only implicit.
3. Checkpoint "resume packet" schema and projection fold contract are sketched, not defined.
4. Mild overclaim of "no open architectural questions" despite (1)-(3).
5. Cosmetic citation imprecision (`life_*` vs `life-store.ts`; remove-hooks line 63).

## Self-Verification
| # | Question | Answer | Adjustment |
|---|---|---|---|
| 1 | Did I check all cited files? | Yes — mutex, EXCLUDED_LAYERS, daemon lines, ChunkCategory, inferLayer, sync conflicts, prime/context, version, decay, size, IStorage, remove-hooks. | None |
| 2 | Am I swayed by the plan's confident bilingual polish? | Scores derive from code verification, not tone; every 4 is citation-backed. | None |
| 3 | Rubric fidelity on concurrency — did I over-reward? | Gave 4 not 5: meets the ideal precisely without exceeding it. Consistent with scale. | None |
| 4 | Is my reference itself correct? | Reference requires exactly the mechanisms the plan lists; verified against CLAUDE.md + code. | None |
| 5 | Proportionality? | Two 3s for genuine gaps, three 4s for verified strengths — 3.75 is proportional, neither harsh nor lenient. | None |
