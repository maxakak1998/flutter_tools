# Plan: Ingest betslip_docs.md into Knowledge Graph

## Goal
Break down the large betslip_docs.md (4299 lines, ~50K tokens) into focused, well-structured knowledge chunks and store them via the knowledge-graph MCP tools.

## Pre-conditions
- [x] Read and analyzed the full betslip_docs.md file
- [x] Loaded /knowledge-graph skill for metadata formatting rules
- [x] Queried existing knowledge base -- no betslip chunks exist yet
- [ ] knowledge_store MCP tool permission must be approved

## Chunk Plan (24 chunks)

### Concepts (2 chunks)
1. **Betslip Feature Overview** (concept, high)
   - Core shopping cart for betting, 5 bet types, key concepts (LocalBetslip, BetslipCandidate, Verify/Place APIs, Multi Bet, Secure Storage, Auto-Verify, Auth)

2. **BetslipProgressStatus Lifecycle** (concept, critical)
   - pending/confirm/reuse enum, state transitions, persistence in LocalBetslip via toJson/fromJson, mapping to isPressPlaceBet ValueNotifier

### References (5 chunks)
3. **BetslipCandidate Sealed Class Hierarchy** (reference, high)
   - 7 concrete implementations, shared fields, factory fromJson method
   - code_ref: BetslipCandidate class

4. **Selection Types Taxonomy** (reference, high)
   - Fixed odds, Tote odds, Sport, Exotic, SRM, Quaddie types with API params, odds availability, promotion rules
   - code_ref: SelectionTypes enum

5. **Odds Display Rules (BR-011)** (reference, high)
   - 3 cases: provider change (arrow icon), promotion change (strikethrough), mixed (both)
   - Icon direction logic, comparison base (original odds)

6. **Verify Betslips API** (reference, high)
   - POST /v1/betslips/verifyBetslips request/response structure
   - Integration flow, error handling, LocalBetslip payload builder methods

7. **Place Bet API** (reference, high)
   - POST /v1/betslips/placeBet request/response structure
   - Currency method logic (cash vs bonus), success/error paths

### Rules (9 chunks)
8. **Selection Type Toggle Visibility (AU Only)** (rule, high)
   - Two conditions: isRacing AND isAUCountry
   - Meeting type sub-options for Thoroughbreds vs Harness/Greyhounds

9. **Each Way Bet Rules** (rule, critical)
   - Doubled stake, Bonus Cash only promotion restriction
   - Est. Return = (winOdds + placeOdds) x stake, N/A for Tote

10. **BR-001: Multi Bet Combination Rules** (rule, critical)
    - Multi Racing, Multi Sport, Cross Multi detection
    - Promotion subtypes per multi type

11. **BR-002: Exclusive Bet Types Cannot Combine** (rule, critical)
    - Exotic, SRM, Quaddie are standalone
    - All racing selection types CAN combine in multi, minimum 2 selections, no duplicate legs

12. **BR-004: Promotion Unlinking Before Removal** (rule, critical)
    - 6 scenarios requiring unlink: auto-deselect, manual, clear, remove bet, multi dissolution, bonus cash exclusivity
    - DELETE /v1/betslips/cancel-bulk-promotion-usage API

13. **BR-005: Verify After Promotion Link/Unlink** (rule, high)
    - Must trigger verify to refresh ALL bets (shared promotion pool)
    - _refreshPromotionQuantitiesSilently() for no-blink updates

14. **BR-010: Promotion Unlinking on Selection Type Change** (rule, high)
    - Unlink BEFORE applying type change, type-specific validation
    - Flow: unlink -> update type -> verify -> UI update

15. **BR-017: Odds Change Indicator Visibility Control** (rule, high)
    - Arrow icon controlled by SHOW_ICONS_WHEN_ODD_CHANGED feature flag
    - Error indicator: always show for decreased, whitelist-check for increased
    - Firestore profileShowPriceIncrease/profile/list

16. **Stake Validation Rules (BR-008)** (rule, medium)
    - Min $0.10 (AppConstants.minStake), max varies by bet type/tier
    - Balance check, numeric only, $0 treated as no stake

### Patterns (6 chunks)
17. **BR-003: Auto-Verify on Betslip Changes** (pattern, high)
    - Trigger events: add, remove, stake change, promotion change, bet type switch
    - Non-blocking, debounced, updates odds/returns/errors

18. **BR-013: Dynamic Button Behavior (Add to Betslip vs Clear)** (pattern, high)
    - Mode 1: "Add to Betslip" when count=1 and not previously added
    - Mode 2: "Clear" when count>=2 or previously added
    - SRM/Exotic auto-switch on any close vs regular bets persist

19. **BR-015: Reuse Mode Behavior** (pattern, critical)
    - Post-success betslip retention, promotion clearing on success
    - Reuse Selection action (clear stakes, reset visibility, load fresh promotions)
    - My Bets action (clear all, navigate)
    - Adding new selection during reuse mode

20. **BR-018: OddChangedCandidate Unwrapping on Type Change** (pattern, high)
    - Unwrap wrapper after type change to prevent stale odds indicators
    - Flow: unlink promotions -> update type -> update local odds -> unwrap

21. **BR-019: OddChangedCandidate Property Delegation** (pattern, high)
    - Delegate silk, formatName, selectionType, etc. from currentCandidate
    - Missing delegation causes disappearing runner icons and empty names

22. **BR-021/022/023: Verify Before Confirm and Place Bet** (pattern, critical)
    - BR-021: verifyAndEnterConfirmMode() on first Place Bet tap
    - BR-022: verifyBeforeFinalPlaceBet() on Confirm Bet tap with profile whitelist + odds direction matrix
    - BR-023: acknowledgeOddsChanges() updates baseline to prevent infinite loop

### Learnings (1 chunk)
23. **Known Issue: Multi Dissolution Not Unlinking Promotions** (learning, high)
    - When removing bet causes multi to dissolve (<2 singles), multi promotions not unlinked
    - Proposed fix with remainingCandidates check

### Architecture (1 chunk)
24. **Betslip Technical Architecture** (reference, high)
    - 3-layer: Presentation (SportBetslipVipCubit, SportBetslipVipScreen), Domain (GetSportBetslipVipUseCase, CalculateStatsUseCase), Data (AuthenticatedSportVipRepository, SecureStorageBetslipStoreService)
    - DI registration in sport_betslip_vip_inject.dart using factory pattern

## Execution Steps

1. Store chunks 1-5 (concepts + first references) in parallel
2. Store chunks 6-7 (API references) in parallel
3. Store chunks 8-12 (critical rules) in parallel
4. Store chunks 13-16 (remaining rules) in parallel
5. Store chunks 17-19 (first patterns) in parallel
6. Store chunks 20-22 (remaining patterns) in parallel
7. Store chunks 23-24 (learning + architecture) in parallel
8. Review auto_links from responses
9. Create manual knowledge_link connections between related chunks (e.g., BR-004 <-> BR-005, BR-010 <-> BR-018)
10. Verify with knowledge_query that chunks are retrievable
11. Report results to team lead

## Linking Plan (after storage)

Key relationships to create manually:
- BR-004 (promotion unlinking) relates_to BR-005 (verify after unlink)
- BR-004 relates_to BR-010 (unlink on type change)
- BR-010 relates_to BR-018 (unwrap after type change)
- BR-011 (odds display) relates_to BR-017 (visibility control)
- BR-014 (progress status) relates_to BR-015 (reuse mode)
- BR-015 relates_to BR-016 (blur overlay)
- BR-021 depends_on BR-022 (verify before confirm -> verify before place)
- BR-022 depends_on BR-023 (verify before place -> acknowledge odds)
- Each Way rules relates_to Selection Types
- Multi combination rules relates_to Exclusive bet types
