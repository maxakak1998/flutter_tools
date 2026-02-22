# Betslip Documentation

> **Template Version:** 2.0  
> **Last Updated:** June 20, 2025  
> **Author:** Development Team

---

## 🎯 Quick Reference

| Aspect | Details |
|--------|---------|
| **Feature ID** | FEAT-BETSLIP-001 |
| **Priority** | High (Core Feature) |
| **Status** | ⏳ In Progress (Reuse Mode) |
| **Dependencies** | Authentication, Sport/Racing APIs, Promotions Feature |
| **Target Release** | v1.0 |
| **Owner** | Sports Betting Team |
| **Figma Link** | [Betslip Design](https://www.figma.com/design/Q1iF5BerghqTpPEXOb0Y2x/UPC-NEW-HOST?node-id=7472-9303&t=7BKabUFqfQLBG1eC-4) |
| **API Docs** | `lib/core/api/api_routes/betslips_route/api_routes.json` |

### Related Documentation

| Document | Description |
|----------|-------------|
| `promotion_docs.md` | Promotion types, eligibility rules, and compatibility |
| `same_race_multi_rules.md` | SRM bet building and combo rules |
| `quaddie_docs.md` | Quaddie (Early/Late) betting rules |
| `win_place_docs.md` | Win/Place feature, More Places chip, Fixed Place betting |
| `race_docs.md` | Race detail screen, runner widgets, bet type tabs |
| `betslip_canmulti_integration.md` | betTypeConfig.canMulti integration for server-controlled multi-bet validation |

---

## 📖 Overview

### What is Betslip?
The Betslip is the core betting feature that allows users to add racing and sport selections, manage their wagers, and place bets. It acts as a shopping cart for betting, supporting five different bet types: Single (Racing/Sport), Multi, Exotic, Same Race Multi (SRM), and Quaddie. The betslip provides real-time verification of odds, automatic promotion integration, and secure bet placement through encrypted storage and validated API calls.

**Authentication:** Unauthenticated users can add selections to betslip and view odds, but must sign in to place bets.

---

### User Stories

#### US-001: Add Selections to Betslip
**As a** user (authenticated or unauthenticated)  
**I want to** add racing and sport selections to my betslip  
**So that** I can prepare bets before placing them

**Priority:** High  
**Status:** ✅ Complete

---

#### US-002: Manage Betslip Contents
**As a** user (authenticated or unauthenticated)  
**I want to** view, remove, and adjust stakes for my betslip selections  
**So that** I can control my wagers before placing

**Priority:** High  
**Status:** ✅ Complete

---

#### US-003: Automatic Verification
**As a** user  
**I want** my betslip to automatically verify odds and eligibility  
**So that** I know my bets are valid before placing

**Priority:** High  
**Status:** ✅ Complete

---

#### US-004: Place Bets
**As an** authenticated user  
**I want to** place all bets in my betslip with one action  
**So that** I can submit my wagers efficiently

**Priority:** High  
**Status:** ✅ Complete

**Note:** Unauthenticated users must sign in before placing bets

---

#### US-005: Apply Promotions to Bets
**As an** authenticated user  
**I want to** apply available promotions to my betslip selections  
**So that** I can maximize returns or reduce risk

**Priority:** High  
**Status:** ✅ Complete

**Note:** Promotions only available for authenticated users

**See:** `promotion_docs.md` for detailed promotion functionality

---

#### US-006: Reuse Selections After Successful Bet
**As an** authenticated user  
**I want to** retain my betslip selections after successfully placing a bet  
**So that** I can quickly re-bet on the same selections without re-adding them

**Priority:** High  
**Status:** ⏳ In Progress

**Note:** This feature introduces the "Reuse Mode" which transforms the betslip UI after successful placement, allowing users to either reuse selections with new stakes or navigate to My Bets.

**See:** BR-014 (Betslip Progress Status Lifecycle), BR-015 (Reuse Mode Behavior), BR-016 (Blur Overlay Success Dialog)

---

### Acceptance Criteria

#### AC-001: Add Selection to Betslip
**Given** I am viewing a race or sport event (authenticated or unauthenticated)  
**When** I tap a selection to add to betslip  
**Then** the selection should be added and automatically verified

**And** the betslip should open automatically (if configured)

**Success Metrics:**
- Selection added within 200ms
- Auto-verify completes within 500ms
- No data loss on app restart

**Linked User Story:** US-001

---

#### AC-002: Remove Selection from Betslip
**Given** I have a selection in my betslip  
**When** I remove that selection  
**Then** the selection should be removed and any linked promotions should be unlinked

**And** multi bet should dissolve if fewer than 2 selections remain

**Success Metrics:**
- Immediate UI update
- Promotion unlinking completes successfully
- Storage updated correctly

**Linked User Story:** US-002

---

#### AC-003: Clear Entire Betslip
**Given** I have multiple selections in my betslip  
**When** I tap the Clear button  
**Then** all selections should be removed and all promotions should be unlinked

**And** betslip should return to empty state
**And** no loading overlay/spinner should appear after Clear (empty state is immediate)
**And** betslip should close after Clear

**Success Metrics:**
- Bulk unlink API completes successfully
- All data cleared from storage
- UI resets to empty state
- No loading overlay is shown after Clear
- Betslip closes after Clear

**Linked User Story:** US-002

---

#### AC-004: Verify Betslip on Changes
**Given** I have selections in my betslip  
**When** I add, remove, or modify stakes  
**Then** betslip should automatically re-verify with backend

**And** odds and errors should update in real-time

**Success Metrics:**
- Verification triggered within 100ms of change
- Updated odds displayed within 500ms
- No blocking UI interactions

**Linked User Story:** US-003

---

#### AC-004a: Verify Betslip Before Entering Confirm Mode
**Given** I have selections in my betslip (pending status)  
**When** I tap the "Place Bet" button for the first time  
**Then** the betslip should call the Verify API before entering confirm mode

**And** a "Verifying..." loading indicator should be shown during the API call  
**And** odds change indicators (arrows + messages) should be displayed if odds changed  
**And** the user should see updated odds on the confirm screen

**Rationale:** Users may leave the betslip open for extended periods (e.g., 2+ minutes) while odds change on the backend. Without this verification, users would enter confirm mode with stale odds and no indication that odds have changed.

**Success Metrics:**
- Verification completes within 2s
- Loading indicator dismissed after verification
- OddChangedCandidate wrappers created for changed odds
- Odds change indicators visible on confirm screen

**Linked User Story:** US-003

**Implementation:**
- `SportPlaceBetVipCubit.verifyAndEnterConfirmMode()` calls verify before entering confirm mode
- `_verifyAndEnterConfirmMode()` in screen shows loading indicator during verification

---

#### AC-004b: Verify Before Final Place Bet (Confirm Screen)
**Given** I am on the confirm screen (already tapped Place Bet once)  
**When** I tap the "Confirm Bet" button  
**Then** the betslip should acknowledge any previously seen odds changes first  
**And** then call the Verify API to check for new changes  
**And** apply decision logic to proceed or stay

**Acknowledgment Flow (Prevents False Positives):**
1. User sees odds changed (e.g., 3.5 → 3.0), stays in confirm mode
2. User taps "Confirm Bet" again
3. System acknowledges the previous change (updates baseline from 3.5 to 3.0)
4. System calls Verify API
5. If new odds = 3.0 (same as acknowledged) → **CONTINUE** (no new change)
6. If new odds = 2.8 (different from acknowledged) → **STAY** (new change detected)

**Decision Logic based on Profile Whitelist + Odds Direction:**

| Profile Status | Odds Direction | Action |
|----------------|----------------|--------|
| ✅ In whitelist | Increased | **STAY** in confirm (show updated odds) |
| ✅ In whitelist | Decreased | **STAY** in confirm (show updated odds) |
| ❌ NOT in whitelist | Increased | **CONTINUE** to place bet (user doesn't see indicator) |
| ❌ NOT in whitelist | Decreased | **STAY** in confirm (show updated odds) |
| Any | No change | **CONTINUE** to place bet |

**Rationale:** 
- Users in the whitelist see all odds change indicators, so they must acknowledge any change
- Users NOT in whitelist only see decreased odds indicators, so they can proceed if odds only increased (they wouldn't see it anyway)
- This prevents the "infinite loop" of constantly seeing odds changes while also respecting the A/B test for price increase visibility
- Acknowledgment ensures users aren't blocked repeatedly for the SAME odds change they already saw

**Worst Case Scenario (Loop Until Stable):**
1. User is in confirm mode
2. User taps "Confirm Bet"
3. Verify shows odds changed (3.5 → 3.0) → User stays in confirm, sees new odds
4. User taps "Confirm Bet" again
5. System acknowledges 3.0 as baseline, verifies → If still 3.0, **CONTINUE**
6. If odds changed again to 2.8 → User stays in confirm, sees newer odds
7. Repeat until odds are stable (no NEW change on verify)

**Success Metrics:**
- Verification completes within 2s
- User never places bet with unexpected odds
- Profile whitelist check performed correctly
- Loop prevention works (user can eventually place bet when odds stabilize)
- **Second confirm tap proceeds if no NEW odds changes (acknowledgment works)**

**Linked User Story:** US-003, US-004

**Implementation:**
- `SportPlaceBetVipCubit.verifyBeforeFinalPlaceBet()` - acknowledge + verify + decision logic
- `IAcknowledgeOddsChangesUseCase` - updates baseline odds in storage
- `SportPlaceBetVipCubit._checkOddsChangedWithDirection()` - detect increased/decreased
- `_verifyAndPlaceBet()` in screen handles the verify → place bet flow
- `VerifyBeforeFinalPlaceBetState` - state with canProceed, hasOddsChanged flags

**Test Scenarios:**

| # | Scenario | Setup | Action | Expected Result |
|---|----------|-------|--------|-----------------|
| 1 | First confirm tap, odds changed | Odds: 3.5 → 3.0 | Tap Confirm | Stay in confirm, show new odds |
| 2 | Second confirm tap, no new change | Odds still 3.0 | Tap Confirm again | **Proceed to place bet** |
| 3 | Second confirm tap, new change | Odds: 3.0 → 2.8 | Tap Confirm again | Stay in confirm, show newer odds |
| 4 | First confirm tap, no change | Odds unchanged | Tap Confirm | **Proceed to place bet** |
| 5 | Profile whitelist + increase only | Profile in whitelist, 3.0 → 3.5 | Tap Confirm | Stay in confirm |
| 6 | Profile NOT whitelist + increase only | Profile NOT in whitelist, 3.0 → 3.5 | Tap Confirm | **Proceed to place bet** |
| 7 | Profile NOT whitelist + decrease | Profile NOT in whitelist, 3.5 → 3.0 | Tap Confirm | Stay in confirm |

---

#### AC-005: Place Bet Successfully
**Given** I have a verified betslip with valid selections  
**When** I tap Place Bet  
**Then** the bet should be submitted to the backend

**And** on success, betslip should clear and show confirmation  
**And** on error, betslip should remain with error message

**Success Metrics:**
- Place bet API completes within 2s
- 99.9% success rate for valid bets
- Clear error messages for failures

**Linked User Story:** US-004

---

#### AC-006: Transform to Reuse Screen on Successful Bet
**Given** I have placed a bet successfully  
**When** the Place Bet API returns success  
**Then** the betslip should NOT close and NOT clear selections

**And** the betslip should transform to "Reuse Screen" layout  
**And** `progressStatus` should change from `confirm` to `reuse`  
**And** success indicators should display for each bet item  
**And** Multi section should show success status above its header

**Success Metrics:**
- Transformation completes within 100ms of success response
- All bet selections retained in storage
- UI correctly reflects Reuse state

**Linked User Story:** US-006

---

#### AC-007: Display BetPlacedSuccessOverlay
**Given** the betslip has transformed to Reuse Screen  
**When** the success state is entered  
**Then** the `BetPlacedSuccessOverlay` appears at the bottom with a "Reuse" button

**And** the overlay auto-dismisses after 3 seconds  
**And** auto-dismiss clears the betslip and resets `progressStatus` to `pending` unless Reuse is tapped

**Success Metrics:**
- Success overlay displays for ~3 seconds and animates out cleanly
- Reuse action opens the betslip and skips cleanup
- Auto-dismiss resets betslip to pending with cleared selections

**Linked User Story:** US-006

---

#### AC-008: Reuse Selection Action
**Given** I am viewing the Reuse Screen (with or without blur dialog)  
**When** I tap "Reuse Selection" button  
**Then** all stake values should be cleared (set to 0 or empty)

**And** `progressStatus` should change from `reuse` to `pending`  
**And** blur dialog should dismiss (if visible)  
**And** betslip should return to normal edit mode with Place Bet button  
**And** all bet selections should be retained

**Success Metrics:**
- Stake clearing completes within 50ms
- UI transitions smoothly to pending state
- User can immediately enter new stakes

**Linked User Story:** US-006

---

#### AC-009: My Bets Action
**Given** I am viewing the Reuse Screen (with or without blur dialog)  
**When** I tap "My Bets" button  
**Then** `progressStatus` should change from `reuse` to `pending`

**And** all betslip candidates should be cleared from storage  
**And** betslip screen should close  
**And** user should navigate to My Bets screen (`/mybet` route)

**Success Metrics:**
- Navigation completes within 200ms
- Betslip storage cleared correctly
- My Bets screen displays correctly

**Linked User Story:** US-006

---

#### AC-010: Add New Selection During Reuse Mode
**Given** the betslip is in Reuse mode (`progressStatus == reuse`)  
**When** I add a new selection from race/sport screen  
**Then** all existing betslip candidates should be cleared

**And** the new selection should be added to the betslip  
**And** `progressStatus` should change from `reuse` to `pending`  
**And** betslip should open in normal edit mode

**Success Metrics:**
- Existing selections cleared before new addition
- New selection added correctly
- Verify API triggered for new selection

**Linked User Story:** US-006

---

### Key Concepts

- **LocalBetslip:** Core data model that stores all betslip candidates, multi promotion data, and provides methods to build API payloads for verify and place bet operations.

- **BetslipCandidate:** Sealed class representing an individual bet in the betslip. Has 7 concrete implementations (RacingSingle, SportSingle, Exotic, SameRaceMulti, Quaddie, Multi, OddChanged) with polymorphic behavior.

- **Verify API:** Backend endpoint (`POST /v1/betslips/verifyBetslips`) that validates all betslip selections, returns current odds, checks promotion eligibility, and identifies errors before allowing bet placement.

- **Place Bet API:** Backend endpoint (`POST /v1/betslips/placeBet`) that submits the final wager, debits user balance, and returns transaction confirmation.

- **Multi Bet:** Combination bet type automatically created from 2+ single bets from **different races/events** in the betslip. Can mix Racing and Sport selections (Cross Multi), or contain only Racing (Multi Racing) or only Sport (Multi Sport). Odds are multiplied together for higher potential returns. **Restriction:** All bets must be from different races/events - cannot combine multiple selections from the same race/event.

- **Promotion Integration:** Betslip stores promotion UUIDs and linked promotion data for each candidate. Supports single-bet promotions and multi-bet promotions with automatic unlinking when bets are removed.

- **Currency Method:** Field indicating payment method - "cash" (real money) or "bonus" (bonus balance). Automatically set to "bonus" when Bonus Cash promotion is selected.

- **Secure Storage:** Betslip data persisted in FlutterSecureStorage with encryption. Thread-safe operations using `Lock` from synchronized package.

- **Auto-Verify:** Automatic verification triggered on betslip changes (add, remove, stake update) to ensure odds and eligibility are current.

- **BetslipProgressStatus:** Enum tracking the betslip lifecycle state. Three values: `pending` (default state, user can edit selections and stakes), `confirm` (user is about to place bet, maps to existing `isPressPlaceBet` ValueNotifier), `reuse` (bet placed successfully, betslip transforms to Reuse screen). Persisted within `LocalBetslip` data model via `toJson()`/`fromJson()` for app restart survival.

- **Reuse Mode:** Special betslip state after successful bet placement where selections are retained (not cleared), UI transforms to show success indicators per bet, and user can choose to "Reuse Selection" (clear stakes, return to pending) or "My Bets" (clear all, navigate to bet history).

---

### Selection Types Reference

**Purpose:** This section defines the complete taxonomy of bet selection types and their relationships, enabling proper bet categorization, promotion eligibility filtering, and UI toggle behavior.

**Status:** ✅ Documented | 🔜 International rules pending

#### Meeting Types

Racing meetings are categorized by type, which determines available selection options:

| Code | Meeting Type | Description |
|------|--------------|-------------|
| `R` | Thoroughbreds | Horse racing |
| `H` | Harness | Harness racing |
| `G` | Greyhounds | Greyhound racing |

**Technical Reference:**
- Enum: `MeetingType` with values `R`, `H`, `G`
- Used by: Selection type toggle logic, promotion eligibility checks

---

#### Selection Type Categories

##### 1. Fixed Odds Types
**Description:** Fixed odds are determined at bet placement time.

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Fixed Win | `win` | ✅ Yes | Shows value | ✅ Full |
| Fixed Place | `place` | ✅ Yes | Shows value | ✅ Full |
| Each Way Fixed | `each-way-fixed` | ✅ Yes | Shows value | 💰 Bonus Cash only |

##### 2. Tote Odds Types
**Description:** Tote odds are pool-based and determined at race settlement.

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Best Div + SP | `best-div-sp` | ❌ No | N/A | 💰 Bonus Cash only |
| Mid Div (Win) | `mid-div-win` | ❌ No | N/A | 💰 Bonus Cash only |
| Mid Div (Place) | `mid-div-place` | ❌ No | N/A | 💰 Bonus Cash only |
| SP | `sp` | ❌ No | N/A | 💰 Bonus Cash only |
| Each Way Best Div Mid Place | `each-way-best-div-mid-place` | ❌ No | N/A | 💰 Bonus Cash only |
| Each Way Mid Div Mid Div Place | `each-way-mid-div-mid-div-place` | ❌ No | N/A | 💰 Bonus Cash only |

##### 3. Multi Bet Type

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Multi | `multi` | ✅ Combined | Depends on legs | ✅ Yes (Multi-specific) |

##### 4. Exotic Bet Types (Standalone)

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Quinella | `quinella` | ❌ Pool | N/A | See exotic rules |
| Exacta | `exacta` | ❌ Pool | N/A | See exotic rules |
| Trifecta | `trifecta` | ❌ Pool | N/A | See exotic rules |
| First Four | `first4` | ❌ Pool | N/A | See exotic rules |

##### 5. Same Race Multi (SRM)

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| SRM | `srm` | ✅ Combined | Shows value | ✅ Yes (SRM-specific) |

**See:** `same_race_multi_rules.md` for detailed SRM rules.

##### 6. Quaddie Types

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Early Quaddie | `earlyQuaddie` | ❌ Pool | N/A | See quaddie rules |
| Late Quaddie | `lateQuaddie` | ❌ Pool | N/A | See quaddie rules |

**See:** `quaddie_docs.md` for detailed Quaddie rules.

##### 7. Sport Selection Type

| Selection Type | API Param | Has Odds | Est. Return | Promotions Allowed |
|----------------|-----------|----------|-------------|-------------------|
| Event | `event` | ✅ Yes | Shows value | ✅ Yes |

**Technical Reference:**
- Enum: `SelectionTypes` in `lib/features/race_detail/domain/enums/selection_type.dart`
- Each type has `name()`, `nameOdd()`, and `param()` methods

---

#### Selection Type Toggle in Betslip (Racing Bets Only)

**Purpose:** Allow users to change selection type (Fixed/Tote) after adding a racing bet to betslip.

**Visibility Rules (CRITICAL):**

The selection type toggle row should **ONLY be displayed** when:

| Rule | Condition | Check |
|------|-----------|-------|
| **Rule 1** | Bet is a Racing bet | `isRacing == true` (category != 'event') |
| **Rule 2** | Bet belongs to AU meeting | `meetingDetail?.country?.toLowerCase() == 'au'` |

**Both conditions MUST be true** for the dropdown to appear.

**Implementation:**
```dart
// In sport_single_betslip_item_vip_widget.dart
bool get isRacing => _selectionModel?.category != 'event';

bool get isAUCountry {
  final candidate = widget.betslipModel;
  if (candidate is RacingBetslipCandidate) {
    return candidate.meetingDetail?.country?.toLowerCase() == 'au';
  }
  return false;
}

bool get shouldShowSelectionTypeToggle => isRacing && isAUCountry;
```

**Expected Behavior:**
- ✅ **Should show toggle:** AU Racing bets (Thoroughbreds, Harness, Greyhounds)
- ❌ **Should NOT show toggle:** International Racing bets (UK, NZ, HK, etc.)
- ❌ **Should NOT show toggle:** Sport bets (category == 'event')
- ❌ **Should NOT show toggle:** Exotic, SRM, Quaddie bets

**Availability Summary:**

| Bet Type | Country | Show Toggle? |
|----------|---------|--------------|
| Racing Single | AU | ✅ Yes |
| Racing Single | Non-AU (UK, NZ, HK, etc.) | ❌ No |
| Sport Single | Any | ❌ No |
| Multi Bet | Any | ❌ No |
| Exotic (Quinella, Exacta, etc.) | Any | ❌ No |
| Same Race Multi | Any | ❌ No |
| Quaddie | Any | ❌ No |

---

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Fixed ▼]  │  Win  │  Place  │ E/W  │                 │
├─────────────────────────────────────────────────────────┤
│  [Stake Input]                                    [🗑️]  │
└─────────────────────────────────────────────────────────┘
       ↑              ↑
  Dropdown      Sub-options (3 buttons)
```

**User Interactions:**
1. User clicks the dropdown to select **Fixed** or **Tote**
2. The 3 sub-option buttons change based on the dropdown selection
3. User taps a sub-option to set the final selection type

**Implementation:**
- Widget: `sport_single_betslip_item_vip_widget.dart` → `_buildDropdown()`
- Orchestrator: `BetslipOrchestrator.updateSelectionTypeWithPromotionSync()`
- Cubit: `SportPlaceBetVipCubit.updateSelectionTypeForSingleRacing()`

---

#### Selection Type Rules by Meeting Type (AU Meetings)

##### Thoroughbreds (R) - AU Meetings

| Odds Type | Sub-Option 1 | Sub-Option 2 | Sub-Option 3 |
|-----------|--------------|--------------|--------------|
| **Fixed** | Win (`win`) | Place (`place`) | Each Way (`each-way-fixed`) |
| **Tote** | Best Div SP (`best-div-sp`) | Mid Div Place (`mid-div-place`) | Each Way (`each-way-best-div-mid-place`) |

##### Harness (H) & Greyhounds (G) - AU Meetings

| Odds Type | Sub-Option 1 | Sub-Option 2 | Sub-Option 3 |
|-----------|--------------|--------------|--------------|
| **Fixed** | Win (`win`) | Place (`place`) | Each Way (`each-way-fixed`) |
| **Tote** | Mid Div Win (`mid-div-win`) | Mid Div Place (`mid-div-place`) | Each Way (`each-way-mid-div-mid-div-place`) |

##### International Meetings

**Status:** 🔜 Rules pending - currently uses same rules as AU Thoroughbreds.

---

#### 🚫 Each Way Bet Rules (CRITICAL)

**What is Each Way?**
An Each Way bet is essentially **two bets in one**: a Win bet and a Place bet on the same selection. The stake is doubled (e.g., $10 Each Way = $20 total: $10 Win + $10 Place).

**What this means:**
- Each Way is a compound bet combining Win + Place on the same runner
- The stake entered by user is DOUBLED (half to Win, half to Place)
- Payout depends on whether the runner Wins or just Places

**Implementation Requirements:**
- Display doubled stake to user before confirmation
- Calculate estimated return based on Win + Place odds combination
- Limit promotion selection to Bonus Cash only for Each Way types

**Promotion Restriction:**
> ⚠️ **Only Bonus Cash can be applied to Each Way selection types.**

This applies to ALL Each Way variants:
- ✅ `each-way-fixed` - Bonus Cash only
- ✅ `each-way-best-div-mid-place` - Bonus Cash only
- ✅ `each-way-mid-div-mid-div-place` - Bonus Cash only

**Rationale:** Each Way bets have complex payout calculations that are incompatible with standard promotion modifiers (Boost, Price, Money Back). Bonus Cash is allowed as it only affects payment method.

**Expected Behavior:**
- ✅ **Should display:** Stake input with doubled total shown
- ✅ **Should calculate:** Combined Win + Place estimated return
- ✅ **Should allow:** Bonus Cash promotion selection
- ❌ **Should prevent:** Boost, Price, Money Back promotion selection
- ⚠️ **Edge case:** If user switches from Win to Each Way with non-Bonus-Cash promotion applied → auto-unlink promotion

**Each Way Estimated Return Calculation:**

**Formula (Fixed Odds Only):**
```
Est. Return = (winOdds + placeOdds) × stake
```

**Important Notes:**
- This calculation applies **ONLY to Fixed odds Each Way** (`each-way-fixed`)
- Tote odds Each Way types (`each-way-best-div-mid-place`, `each-way-mid-div-mid-div-place`) should display **"N/A"** for Est. Return (pool-based, no fixed odds available)
- The stake is the user-entered amount (not doubled in the calculation display)
- Win odds and Place odds are retrieved from the runner's price data

**Examples:**

| Stake | Win Odds | Place Odds | Est. Return |
|-------|----------|------------|-------------|
| $10 | @3.50 | @1.25 | (3.50 + 1.25) × 10 = **$47.50** |
| $20 | @5.00 | @1.80 | (5.00 + 1.80) × 20 = **$136.00** |
| $10 | N/A (Tote) | N/A (Tote) | **N/A** |

**Implementation:**
- File: `sport_single_betslip_item_vip_widget.dart` → `_calculateEstReturn()`
- File: `sport_betslip_vip_cubit.dart` → `calculateSingleEstimatedReturn()`

**See:** `promotion_docs.md` → Bet Eligibility for promotion restriction details (Error Code `E012`).

---

#### Selection Type Change Behavior

**Purpose:** Define the system behavior when user changes selection type via the dropdown.

**When a user changes selection type:**

| Step | Action | Reference |
|------|--------|-----------|
| 1 | Unlink any linked promotions | BR-010 |
| 2 | Update selection type in storage | `updateSelectionTypeForSingleUseCase` |
| 3 | Trigger Verify API for new odds | BR-003 |
| 4 | Recalculate estimated return | "N/A" for tote types |
| 5 | Refresh promotion UI | Clear highlighted cards |

**Implementation:**
- Orchestrator: `BetslipOrchestrator.updateSelectionTypeWithPromotionSync()`
- See: BR-010 for detailed promotion unlinking rules

**Expected Behavior:**
- ✅ **Should unlink:** Promotions before changing type (Win → Tote)
- ✅ **Should update:** Odds display based on new type
- ✅ **Should show:** "N/A" for tote types without fixed odds
- ✅ **Should refresh:** Promotion cards after type change

---

### Feature Variations

#### Bet Types

1. **Single Racing Bet**
   - **Description:** Win or Place bet on a single horse/greyhound in a race
   - **Requirements:** One selection from racing catalog
   - **Promotions:** Supports all single racing promotion types

2. **Single Sport Bet**
   - **Description:** Bet on a single sport market outcome
   - **Requirements:** One selection from sport catalog
   - **Promotions:** Supports all single sport promotion types

3. **Multi Bet**
   - **Description:** Combines 2+ single selections into one bet with multiplied odds
   - **Requirements:** All selections must be same category (racing OR sport)
   - **Business Rule:** Cannot mix racing and sport selections
   - **Promotions:** Supports multi-specific promotions stored in `multiPromotionUuid` and `multiLinkedPromotions`

4. **Exotic Bet**
   - **Description:** Complex racing bets (Quinella, Exacta, Trifecta, First Four)
   - **Requirements:** Multiple selections within same race
   - **See:** Exotic-specific documentation

5. **Same Race Multi (SRM)**
   - **Description:** Multiple outcomes within the same race combined into one bet
   - **Requirements:** Must quote via API before adding to betslip
   - **See:** `same_race_multi_rules.md` for detailed rules

6. **Quaddie Bet**
   - **Description:** Pick winner across 4 consecutive races (legs)
   - **Requirements:** 1+ selections in each of 4 designated races
   - **See:** `quaddie_docs.md` for detailed rules

7. **OddChanged Bet** (Internal)
   - **Description:** Wrapper candidate type for handling odds change detection
   - **Purpose:** Allows user to accept/reject odds changes before placing

---

### Pre-conditions & Dependencies

**System Pre-conditions:**
**System Pre-conditions:**
- Betslip storage service initialized
- Network connection available for verify API (optional for place bet)

**User Pre-conditions (Add to Betslip):**
- No authentication required - unauthenticated users can add selections
- Selections are from currently active races/events

**User Pre-conditions (Place Bet):**
- **User must be authenticated** - sign in required to place bets
- User has sufficient balance (cash or bonus) for bet stakes
- Betslip must be verified successfully
- User accepts any odds changes if prompted

**Data Dependencies:**
- Selection data from race/sport catalog APIs
- Promotion data (authenticated users only) - See `promotion_docs.md`
- User balance from account APIs (authenticated users only)

---

## 🎨 UI/UX Design

### Layout & Components

#### Betslip Bottom Sheet
- **Type:** Modal bottom sheet that overlays main content
- **Trigger:** Auto-opens after adding selection (configurable), or tap betslip icon
- **Layout:** 
  - Header with title
  - Scrollable list of bet candidates
  - Bottom action bar with two buttons:
    - **Clear/Add to Bet Slip button** (left) - See **BR-013** for dynamic behavior
    - **Place Bet button** (right)
- **States:**
  - Empty state: "Your betslip is empty" message
  - Populated state: List of bet candidates
  - Loading state: Spinner during verify/place bet
  - Error state: Error messages displayed per candidate or global

**Note:** The "Clear" button at the bottom left dynamically changes its label to "Add to Bet Slip" based on bet count, bet type, and user interactions. See **BR-013: Dynamic Button Behavior** for complete logic.

---

#### Bet Candidate Widgets

Each bet type has a dedicated widget displaying relevant information:

1. **Racing Single Widget**
   - Horse/greyhound name and number
   - Race name and time
   - Bet type (Win/Place)
   - Stake input field
   - Current odds
   - Potential return
   - Linked promotions (if any)

2. **Sport Single Widget**
   - Team/player names
   - Market type
   - Event name and time
   - Stake input field
   - Current odds
   - Potential return
   - Linked promotions (if any)

3. **Multi Bet Widget**
   - List of included selections (compact view)
   - Combined odds (multiplied)
   - Total stake input
   - Potential return
   - Multi promotions (if any)
   - Expand/collapse toggle

4. **Exotic/SRM/Quaddie Widgets**
   - Type-specific layouts showing legs, combinations, or boxes
   - **See respective feature docs for details**

---

#### Visual States

- **Default State:** White background, black text, active controls
- **Pending Verification State:** Loading spinner, "Verifying..." text
- **Verified State:** Green checkmark, current odds displayed
- **Error State:** Red border, error icon, error message text
- **Disabled State:** Greyed out, cannot interact (e.g., during bet placement)
- **Odds Changed State:** Yellow highlight, "Odds changed" warning, accept/reject buttons
- **Reuse State:** Success indicators per bet item, stakes disabled, CTA interactions blocked except "Reuse Selection" and "My Bets" buttons. See **BR-015: Reuse Mode Behavior** for details.

---

#### Reuse Screen Layout

**Trigger:** Displayed when `progressStatus == reuse` after successful bet placement.

**Layout:**
- Same betslip structure but in read-only success mode
- Each bet item shows success indicator (checkmark or "Bet Placed" text)
- Multi section displays success status above its header
- Stake input fields disabled (non-interactive)
- All CTAs blocked except "Reuse Selection" and "My Bets"
- Bottom action bar shows two buttons:
  - **"Reuse Selection"** (left) - Clears stakes, returns to pending mode
  - **"My Bets"** (right with badge showing bet count) - Clears betslip, navigates to My Bets screen

**Blur Overlay Dialog (feature-flagged):**
- Displayed on top of Reuse Screen immediately after entering reuse mode when `SHOW_BET_PLACED_SUCCESS_DIALOG` is enabled
- Uses `BackdropFilter` with `ImageFilter.blur()` to blur the Reuse Screen behind
- Contains existing success dialog content (Bet Receipt)
- Auto-dismisses after 3 seconds
- See **BR-016: Blur Overlay Success Dialog** for implementation details

**Bet Placed Success Overlay (bottom):**
- Appears at the bottom with a "Reuse" button
- Auto-dismisses after 3 seconds
- On dismiss, clears betslip and resets `progressStatus` to `pending`
- If Reuse is tapped, opens betslip and skips cleanup

**State Persistence:**
- Reuse state is temporary until the success overlay dismisses
- After overlay dismiss, betslip clears and `progressStatus` resets to `pending`
- If Reuse is tapped before dismiss, the betslip opens and transitions to pending with selections retained

---

#### Mini Betslip Bottom Bar (Reuse Mode)

- Shows bet count as before (no change to existing behavior)
- Tapping opens betslip in Reuse Screen layout while the success overlay is active
- After overlay dismiss, betslip is cleared and opens in pending mode
- See **BR-015** for details on retained behavior

---

#### Navigation Flow

1. User views race or sport event
2. User taps selection (e.g., horse, team)
3. Selection converted to `BetslipCandidate`
4. Candidate added to `LocalBetslip` in storage
5. Verify API automatically called
6. Betslip bottom sheet opens (if auto-open enabled)
7. User views selection with verified odds
8. User optionally:
   - Adds more selections
   - Adjusts stakes
   - Applies promotions (see `promotion_docs.md`)
   - Removes selections
9. User taps "Place Bet"
10. Place Bet API called
11. **Success Path (NEW - Reuse Mode):**
    - Betslip transforms to Reuse Screen (NOT cleared)
    - `progressStatus` changes to `reuse`
    - Bet placed success overlay shows at bottom
    - User chooses action:
      - **"Reuse Selection":** Clears stakes → returns to pending mode → user enters new stakes → can place bet again
      - **"My Bets":** Clears betslip → closes screen → navigates to My Bets
      - **Success overlay auto-dismiss (3s):** Overlay dismisses → betslip clears and `progressStatus` resets to `pending` (unless Reuse is tapped)
    - See **BR-014**, **BR-015**, **BR-016** for detailed rules
12. **Error Path:** Error displayed, betslip remains for corrections

#### Bet Placement Success Dialog (UI/UX)

- **Trigger:** Displayed by `ShowDialogPlaceBetCoordinator` immediately after a successful `Place Bet` response (`PlaceBetsLoadedState.state == succeed`) when `SHOW_BET_PLACED_SUCCESS_DIALOG` is enabled. Dialog is rendered through `CommonLoadingWidget.showWidget(...)` so it overlays the entire betslip bottom sheet.
- **Layout:**
  - Sticky yellow header with "Bet Placed" title, center-aligned, and a close icon on the right.
  - Body shows `BET ID # <id>` in bold, followed by two supportive copy blocks:
    1. "You have successfully placed your bet."
    2. "Check your bet history in Transaction History in the Settings button."
  - Card uses 10px corner radius, charcoal border, and centered copy exactly as per Figma.
- **Dismissal mechanics:**
  - **Manual:** User can tap the ✕ icon to dismiss instantly (delegates to `CommonLoadingWidget.dismiss()`).
  - **Automatic:** The dialog auto-closes after **3 seconds**.
- **Rationale:** Keeps the success confirmation visible long enough for reassurance while preventing the modal from blocking follow-up actions (e.g., adding new bets). Auto-dismiss timing is aligned with UX guidance for transient confirmations (2–3 seconds window).
- **Implementation Notes:** Logic lives in `show_dialog_place_bet_coodinator.dart`. The timer should call `CommonLoadingWidget.dismiss()` only if the dialog is still visible to avoid exceptions.

---

## 📜 Business Rules & Constraints

### BR-001: Multi Bet Combination Rules (CRITICAL)

**Status:** ✅ Implemented

**What this means:**
Multi bets support **three distinct combination types** based on selection categories. The system automatically detects the multi type and applies appropriate promotion rules.

#### 1. **Multi Racing** (Racing-only)
- **Definition:** All selections must be from Racing events
- **Promotion Type:** `PromotionSubtype.multiRacing`
- **Example:** 3 racing Win selections across different races
- **Use Case:** Traditional racing multi bets

#### 2. **Multi Sport** (Sport-only)
- **Definition:** All selections must be from Sport events  
- **Promotion Type:** `PromotionSubtype.multiSport`
- **Example:** 4 sport selections from different matches
- **Use Case:** Traditional sport multi bets

#### 3. **Cross Multi** (Mixed Racing + Sport)
- **Definition:** Combines both Racing AND Sport selections in a single multi bet
- **Promotion Type:** `PromotionSubtype.crossMulti`
- **Example:** 2 racing selections + 1 sport selection
- **Use Case:** Advanced multi bets spanning both categories
- **Note:** May have different promotion rules than pure racing or sport multis

**Implementation Details:**
- Detection logic in `lib/features/promotions/domain/useCases/get_promotions_for_bet_use_case.dart`
- Promotion types defined in `lib/features/promotions/domain/models/promotion_subtype_enum.dart`
- Validation occurs during verify API call
- Client automatically determines multi type based on selection composition

**Expected Behavior:**
- ✅ **Should allow:** 3 racing Win selections → Multi Racing
- ✅ **Should allow:** 4 sport selections → Multi Sport  
- ✅ **Should allow:** 2 racing + 1 sport → Cross Multi
- ⚠️ **Note:** Different promotion offers may apply to each multi type

---

### BR-002: Bet Types That Cannot Combine into Multi Bets (CRITICAL)

**Status:** ✅ Implemented

**What this means:**
The following **specialized bet types are EXCLUSIVE** and cannot be combined with each other or with regular single bets into a multi bet. These bet types are standalone products with their own specific rules.

#### ❌ **Cannot Combine:**

1. **Exotic Bets** (Exacta, Quinella, Trifecta, First Four, etc.)
   - Must be placed as standalone bets
   - Cannot mix with single Win/Place selections
   - Cannot mix with SRM or Quaddie

2. **Same Race Multi (SRM)**
   - Multiple selections within the same racing event
   - Cannot mix with selections from other races
   - Cannot mix with Exotic or Quaddie bets
   - See `same_race_multi_rules.md` for SRM-specific rules

3. **Quaddie**
   - Across 4 designated consecutive races
   - Cannot mix with any other bet type
   - See `quaddie_docs.md` for Quaddie-specific rules

#### 📊 **Selection Type Background:**

> **See:** [Selection Types Reference](#selection-types-reference) for complete taxonomy and rules.

**Racing Bets** support these selection types:

| Category | Selection Types |
|----------|-----------------|
| **Fixed Odds** | Win, Place, Each Way Fixed |
| **Tote Odds** | Best Div + SP, Mid Div (Win), Mid Div (Place), SP, Each Way Best Div Mid Place, Each Way Mid Div Mid Div Place |

**Sport Bets** support only:
- Event

**Each Way Restriction:**
> ⚠️ Each Way types (`each-way-fixed`, `each-way-best-div-mid-place`, `each-way-mid-div-mid-div-place`) **can only use Bonus Cash promotions**.

#### ✅ **All Racing Selection Types Can Combine:**

Multi bets (Multi Racing, Multi Sport, Cross Multi) **accept ALL racing selection types**:

| Selection Type | API Param | Has Odds | Est. Return | Promotions |
|----------------|-----------|----------|-------------|------------|
| **Win** | `win` | ✅ Yes | Shows value | ✅ Full |
| **Place** | `place` | ✅ Yes | Shows value | ✅ Full |
| **Best Div + SP** | `best-div-sp` | ❌ No | N/A | 💰 Bonus Cash only |
| **Mid Div (Win)** | `mid-div-win` | ❌ No | N/A | 💰 Bonus Cash only |
| **Mid Div (Place)** | `mid-div-place` | ❌ No | N/A | 💰 Bonus Cash only |
| **SP** | `sp` | ❌ No | N/A | 💰 Bonus Cash only |
| **Each Way Fixed** | `each-way-fixed` | ✅ Yes | Shows value | 💰 Bonus Cash only |
| **Each Way Best Div Mid Place** | `each-way-best-div-mid-place` | ❌ No | N/A | 💰 Bonus Cash only |
| **Each Way Mid Div Mid Div Place** | `each-way-mid-div-mid-div-place` | ❌ No | N/A | 💰 Bonus Cash only |
| **Event** (Sport) | `event` | ✅ Yes | Shows value | ✅ Full |

**Why "N/A" for some types?**
- Best Div, Mid Div, SP, and Tote Each Way selections don't have fixed odds at bet placement time
- System allows them in multi bet but cannot calculate estimated return
- Multi estimated return shows "N/A" when any selection lacks odds

#### 🔒 **Multi Bet Restrictions:**

1. **No Duplicate Legs**: Cannot have multiple selections from the same race/event (different "leg")
   - ❌ **Invalid**: Horse #3 Win + Horse #5 Win in Race 1 → Cannot create multi
   - ✅ **Valid**: Horse #3 Win in Race 1 + Horse #5 Win in Race 2 → Multi Racing
   - ✅ **Valid**: Horse #3 Win in Race 1 + Team A Event in Match 1 → Cross Multi
   - ✅ **Valid**: Horse #3 Best Div+SP in Race 1 + Horse #5 Win in Race 2 → Multi Racing (Est. Return: N/A)

2. **Minimum 2 Selections**: Multi bet requires at least 2 valid selections from different races/events
   - If user removes a bet causing multi to drop below 2 selections, multi automatically dissolves

**Technical Reference:**
- Validation logic: `lib/core/services/betslip_store_service/models/local_betslip.dart` (lines 354-421)
- `isValidSelectionType` check: Only affects estimated return display ("N/A"), doesn't prevent multi creation
- Selection types enum: `lib/features/race_detail/domain/enums/selection_type.dart`
- **betTypeConfig.canMulti Integration:** See [`betslip_canmulti_integration.md`](betslip_canmulti_integration.md) for server-controlled multi-bet validation

> 📝 **Note:** Each Way types (`each-way-fixed`, `each-way-best-div-mid-place`, `each-way-mid-div-mid-div-place`) may need to be added to the `SelectionTypes` enum if not already present.

**User Experience:**
- All racing selection types can be added to multi bets
- When multi contains Best Div, Mid Div, SP, or Tote Each Way selections, estimated return shows "N/A"
- When the betslip includes Quaddie or Accumulator (AC) bets, total estimated returns show "TBD"
- When SRM multi-combo bets have stake, total estimated returns show "TBD" (single-combo SRM uses minOdds × stake)
- Each Way bets cannot have promotions applied
- User can still place the bet, returns calculated at settlement time

---

### BR-003: Auto-Verify on Betslip Changes

**Status:** ✅ Complete

**What this means:**
- Any change to betslip triggers automatic verification via `POST /v1/betslips/verifyBetslips`
- Ensures odds and eligibility are always current before placing bet

**Trigger Events:**
- Add new selection to betslip ✅
- Remove selection from betslip ✅
- Change stake amount ✅
- Apply or remove promotion ✅
- Switch between bet types (e.g., Win to Place) ✅

**Behavior:**
- Non-blocking operation (user can continue interacting with betslip)
- Debounced to avoid excessive API calls during rapid stake changes
- Updates odds, potential returns, and error states
- Invalid promotions automatically removed (see `promotion_docs.md`)

**Implementation:**
- Method: `AuthenticatedSportVipRepository.verifyBetslips()`
- Called from: `GetSportBetslipVipUseCase.verifyBetslips()`
- Response handler: `handleResponseAfterVerify()`

---

### BR-004: Promotion Unlinking Before Bet Removal (CRITICAL)

**Status:** ✅ Complete

**What this means:**
- Before removing any bet that has linked promotions, must call unlink API (`DELETE /v1/betslips/cancel-bulk-promotion-usage`)
- Prevents orphaned promotion usage records on backend
- Applies to both single-bet promotions and multi-bet promotions

**When Promotions Must Be Unlinked:**

| Scenario | Trigger | Required Action | Status |
|----------|---------|-----------------|--------|
| **1. Auto-Deselect Incompatible** | User selects promotion that conflicts with existing ones | Unlink incompatible promotions before linking new one | ✅ Implemented |
| **2. Manual Deselection** | User taps a selected promotion card to remove it | Unlink that promotion | ✅ Implemented |
| **3. Betslip Clear Button** | User presses "Clear" button in betslip | Unlink ALL promotions from all bets + multi | ✅ Implemented |
| **4. Remove Individual Bet** | User removes a bet that has linked promotions | Unlink promotions attached to that bet | ✅ Implemented |
| **5. Multi Bet Dissolution** | Removing a bet causes multi to dissolve (< 2 bets remain) | Unlink multi promotions before removing bet | ✅ Implemented |
| **6. Bonus Cash Exclusivity** | User selects Bonus Cash while other promotions active | Unlink ALL other promotions | ✅ Implemented |

**Implementation Requirements:**
- Use `DELETE /v1/betslips/cancel-bulk-promotion-usage` API
- Pass all promotion usage IDs to unlink
- Handle errors gracefully (prevent action if unlink fails)
- Log all unlink operations for debugging

**Expected Behavior:**
- ✅ **Should unlink:** Before removing any bet with linked promotions
- ✅ **Should unlink:** Before clearing entire betslip
- ✅ **Should unlink:** When selecting incompatible promotion
- ✅ **Should unlink:** When multi dissolves to < 2 selections

**Implementation:**
- `SportBetslipVipCubit.removeBetslip()` - Handles individual bet unlinking and multi dissolution
- `PromotionsCubit.clearAllPromotions()` - Handles betslip clear unlinking
- `SelectPromotionUseCase._unlinkIncompatiblePromotions()` - Handles auto-deselect unlinking

**See:** `promotion_docs.md` - Promotion Unlinking Scenarios for detailed implementation

---

### BR-005: Verify API Trigger After Promotion Link/Unlink (CRITICAL)

**Status:** ✅ Complete

**What this means:**
After any promotion link or unlink operation, the system must trigger verify API to refresh promotion data for ALL bets in the betslip, not just the affected bet.

**Why This is Required:**
- All bets in betslip share the same promotion pool (same list of available promotions)
- When a promotion is used/freed on one bet, it affects availability and amounts for ALL other bets
- Verify API returns updated promotion amounts and eligibility for the entire betslip

**Implementation:**

| Scenario | Implementation | Status |
|----------|---------------|--------|
| **Scenario 1 (Auto-Deselect)** | `selectPromotion()` → link → `_refreshPromotionQuantitiesSilently()` | ✅ Complete |
| **Scenario 2 (Manual Deselection)** | `deselectPromotion()` → unlink → `_refreshPromotionQuantitiesSilently()` | ✅ Complete |
| **Scenario 3 (Clear Betslip)** | No verify needed (betslip empty) | ✅ N/A |
| **Scenario 4 (Remove Bet)** | `removeBetslip()` → unlink → `verifyBetslips()` | ✅ Complete |
| **Scenario 5 (Multi Dissolution)** | `removeBetslip()` → unlink multi → `verifyBetslips()` | ✅ Complete |
| **Scenario 6 (Bonus Cash)** | `selectPromotion()` → unlink others → `_refreshPromotionQuantitiesSilently()` | ✅ Complete |

**Behavior:**
After ANY promotion link/unlink operation:
1. Call unlink API (if unlinking)
2. Call link API (if linking)
3. **Trigger verify API** via `_refreshPromotionQuantitiesSilently()` or `verifyBetslips()` to refresh:
   - Latest promotion amounts for ALL bets
   - Updated odds/returns
   - Promotion eligibility status
   - Error states

**Key Feature:**
- Uses `_refreshPromotionQuantitiesSilently()` to avoid UI blink when updating promotion quantities
- Non-blocking operation that updates promotion data in background
- No loading indicators shown to user

---

### BR-006: Auto-Open Betslip After Add

**Status:** ✅ Implemented

**What this means:**
- After successfully adding a selection to betslip, the betslip bottom sheet automatically opens
- Configuration can be toggled by user preference

**Behavior:**
- Only opens on successful add (not on errors)
- Does not open if betslip is already open
- Animation: Slide up from bottom with fade-in

---

### BR-007: Clear Betslip on Successful Bet Placement

**Status:** ✅ Implemented

**What this means:**
- After successful place bet API response, all betslip candidates are removed
- Multi promotion data cleared
- Storage reset to empty state

**Behavior:**
- Confirmation message displayed
- Transaction details shown (bet ID, amount, etc.)
- User can start fresh betslip immediately

---

### BR-008: Stake Validation

**Status:** ✅ Complete

**Validation Rules:**

| Rule | Specification | Error Message |
|------|---------------|---------------|
| Minimum Stake | $0.10 per bet (configurable via `AppConstants.minStake`) | "Minimum stake is $0.10" |
| Maximum Stake | Varies by bet type and user tier | "Maximum stake exceeded" |
| Balance Check | User balance ≥ total stake | "Insufficient balance" |
| Numeric Only | Must be valid number | "Please enter a valid amount" |

**Implementation:**
- Minimum stake defined in `AppConstants.minStake` (default: $0.10)
- Can be overridden by backend via `UserConfig.minStake`
- Validated on stake entry and before place bet
- Error messages displayed inline on bet cards

**Edge Cases:**
- $0 stake treated as "no stake entered" - bet cannot be placed
- Empty stake field - bet cannot be placed
- Decimal precision: Rounded to 2 decimal places

---

  ### BR-009: Total Estimated Return Calculation

**Status:** ✅ Implemented

**What this means:**
The total estimated return displayed at the bottom of the betslip must dynamically recalculate whenever any individual bet's estimated return changes.

**Calculation Formula:**
```
Total Est. Return = Sum of all individual bet estimated returns
```

**Trigger Events:**
When any of the following occur for ANY bet in the betslip:
- **Promotion applied/removed** - Changes odds or bonus percentage
- **Stake amount changed** - Affects potential return calculation
- **Odds changed** - Updates from verify API with new market odds
- **Bet added/removed** - Changes number of bets contributing to total
- **Bet type changed** - e.g., Win to Place (different odds)

**Implementation Requirements:**
- Real-time calculation on every betslip state change
- Use `CalculateStatsUseCase` to aggregate returns
- Handle edge cases:
  - Bet with "N/A" estimated return (excluded from total)
  - Empty betslip (show $0.00 or empty state)
  - Multi bet estimated return (included if valid selection types)

**Expected Behavior:**
```
Single Bet A: $10 stake @ 3.00 odds = $30.00 est. return
Single Bet B: $5 stake @ 2.50 odds = $12.50 est. return
Multi Bet: $20 stake @ 5.00 combined odds = $100.00 est. return
─────────────────────────────────────────────────────
Total Est. Return = $30.00 + $12.50 + $100.00 = $142.50
```

**When Total Changes:**
- User applies promotion to Bet A → Bet A return increases → Total increases
- User changes stake on Bet B → Bet B return changes → Total recalculates
- Odds change detected for Multi → Multi return updates → Total updates
- User removes Bet A → Bet A excluded from total → Total decreases

**Display Rules:**
- Format: "$XXX.XX" with 2 decimal places
- Show $0.00 if no bets or all bets have N/A returns
- Update immediately (no loading state for calculation)

---

### BR-010: Promotion Unlinking on Selection Type Change

**Status:** ✅ Complete

**What this means:**
When a user changes the selection type of a racing bet (e.g., Win → Mid Div, Place → Best Div+SP), any promotions linked to that bet MUST be automatically unlinked BEFORE applying the type change.

**Why Required:**
- Promotions are **type-specific** - they require the `type` parameter when applying
- A promotion valid for "Win" may not be valid for "Mid Div" 
- Old promotion parameters are now invalid for the new selection type
- Prevents applying promotions with mismatched types

**Implementation:**
- `SportPlaceBetVipCubit.updateSelectionTypeForSingleRacing()` checks for linked promotions
- If promotions exist, unlinks them via `unlinkPromotionUseCase` before changing type
- Then calls `updateSelectionTypeForSingle()` which triggers verify API (BR-003)
- Verify API returns updated odds for new selection type

**Flow:**
1. User changes selection type (e.g., Win → Mid Div)
2. Cubit checks if candidate has linked promotions
3. If yes: Call unlink API to remove promotions
4. Update selection type in storage
5. Call verify API to get new odds (BR-003)
6. UI updates with new type, no promotion badge

**Expected Behavior:**

**Scenario 1: Win → Mid Div with Promotion**
```
Before:
- Bet: Horse #5 Win @ $10 stake
- Promotion: "10% Bonus" linked
- Est. Return: $33.00 (boosted)

User changes: Win → Mid Div

After:
- Bet: Horse #5 Mid Div @ $10 stake  
- Promotion: UNLINKED (no promotion badge)
- Est. Return: "N/A" (no odds for Mid Div yet)
```

**Scenario 2: Place → Win without Promotion**
```
Before:
- Bet: Horse #5 Place @ $10 stake
- Promotion: None
- Est. Return: $25.00

User changes: Place → Win

After:
- Bet: Horse #5 Win @ $10 stake
- Promotion: None (no change)
- Est. Return: $30.00 (new Win odds)
```

**What Does NOT Happen:**
- ❌ Promotion does NOT automatically re-apply to new selection type
- ❌ User is NOT prompted to select new promotion
- ❌ Old promotion parameters are NOT carried over

**User Flow:**
1. User changes selection type
2. System automatically unlinks promotion (if any)
3. System fetches new odds via verify API
4. User sees updated bet with new type, no promotion
5. User can manually select new promotion if eligible

**Edge Cases:**
- **Multi bet with promotion**: Changing type may invalidate multi → unlink promotion, potentially convert to singles
- **Type change during verify loading**: Cancel previous verify request, unlink promotion, then trigger new verify
- **Rapid type switching**: Debounce type changes to avoid multiple unlink operations

**Related Business Rules:**
- See **BR-005**: Verify API Trigger After Promotion Link/Unlink (should trigger after unlinking)
- See **BR-004**: Promotion Unlinking Scenarios (manual unlink flow)
- See **BR-002**: Selection type validation for multi bets

---

### BR-011: Odds Display Rules with Provider/Promotion Changes

**Status:** ✅ Implemented

**What this means:**
The odds display on every bet in the betslip must visually indicate when odds have changed from the provider OR been modified by promotions, using specific layouts and icons to communicate the type and direction of change.

**Applies To:**
- All bet displays showing odds values in the betslip UI
- Single bets, multi bets (combined odds), same race multi
- Race detail screens showing betslip selections

**Display Rules by Scenario:**

#### **Case 1: Odds Changed by Provider**

**When:** Verify API returns different odds than originally added

**Visual Layout:**
```
[↑ or ↓ icon] @$13.0
```

**Example Flow:**
1. User adds bet: Horse #5 Win @ **12.0** odds
2. User reopens betslip → verify API called
3. API returns updated odds: **13.0** (provider changed odds)
4. Display: **[↑]** @$13.0 (green up icon, odds increased)

**Icon Rules:**
- **↑ (Up arrow)**: New odds > original odds (12.0 → 13.0) - favorable to user
- **↓ (Down arrow)**: New odds < original odds (12.0 → 10.0) - unfavorable to user
- Icon positioned to the LEFT of the odds value
- Icon color: Green (up), Red (down)

**Comparison Base:**
- Compare against **original odds when bet was first added**
- NOT against last known odds
- NOT against promotion-modified odds

---

#### **Case 2: Odds Changed by Promotion**

**When:** User applies promotion that modifies odds/bonus percentage

**Visual Layout:**
```
~~@$12.0~~  (strikethrough)
@$15.0
```

**Example Flow:**
1. User adds bet: Horse #5 Win @ **12.0** odds
2. User applies promotion: "25% Odds Boost"
3. New odds calculated: 12.0 × 1.25 = **15.0**
4. Display:
   - Line 1: ~~@$12.0~~ (original odds with strikethrough)
   - Line 2: @$15.0 (new boosted odds)

**Promotion Unlink:**
When user removes promotion:
- Revert to single-line display: @$12.0
- Remove strikethrough layout
- Show original odds only

---

#### **Case 3: Odds Changed by BOTH Provider AND Promotion (Mixed)**

**When:** Provider odds changed + promotion applied

**Visual Layout:**
```
~~@$14.0~~  (strikethrough)
[↑ or ↓ icon] @$17.5
```

**Example Flow:**
1. User adds bet: Horse #5 Win @ **12.0** odds (ORIGINAL)
2. User applies promotion: "25% Odds Boost" → 15.0 boosted odds
3. User reopens betslip → verify API called
4. API returns updated provider odds: **14.0** (provider changed from 12.0 → 14.0)
5. Apply promotion to new provider odds: 14.0 × 1.25 = **17.5**
6. Display:
   - Line 1: ~~@$14.0~~ (strikethrough - latest provider odds without promotion)
   - Line 2: [↑] @$17.5 (icon + new boosted odds)

**CRITICAL: Icon Direction Logic**
- Icon compares: **Original odds (12.0)** vs **Latest provider odds (14.0)**
- Example above: 12.0 → 14.0 = **↑ (Up)** icon (favorable change)
- Icon does NOT compare promotion-modified odds (15.0 vs 17.5)
- Icon does NOT compare old boosted odds (15.0) vs new boosted odds (17.5)

**Another Example:**
1. Original: 12.0
2. Apply promotion: 15.0 boosted
3. Provider changes: 12.0 → 10.0
4. New boosted: 10.0 × 1.25 = 12.5
5. Display:
   - Line 1: ~~@$10.0~~
   - Line 2: [↓] @$12.5 (down icon because 12.0 → 10.0 is unfavorable)

---

**Expected Behavior:**

| Scenario | Original | Promotion | Provider Changed To | Display |
|----------|----------|-----------|---------------------|---------|
| Simple | 12.0 | No | 12.0 (no change) | `@$12.0` |
| Provider Up | 12.0 | No | 13.0 | `[↑] @$13.0` |
| Provider Down | 12.0 | No | 10.0 | `[↓] @$10.0` |
| Promotion Only | 12.0 | +25% | 12.0 (no change) | `~~@$12.0~~`<br>`@$15.0` |
| Mixed (Provider Up) | 12.0 | +25% | 14.0 | `~~@$14.0~~`<br>`[↑] @$17.5` |
| Mixed (Provider Down) | 12.0 | +25% | 10.0 | `~~@$10.0~~`<br>`[↓] @$12.5` |

---

**Edge Cases:**

- **Provider odds unchanged but promotion applied**: Show Case 2 layout (no icon, strikethrough format)
- **Promotion removed after provider change**: Revert to Case 1 layout (icon + single odds: `[↑] @$13.0`)
- **Multiple verify API calls**: Always compare against `originalOdds`, not previous `currentProviderOdds`
- **Rapid promotion link/unlink**: Update display immediately on each action
- **Multi bet combined odds**: Apply same logic to combined odds display (always include `@$` prefix)

---

**User Experience Goals:**
- **Transparency**: Users see exactly how odds changed (provider vs promotion)
- **Quick Scanning**: Icons enable fast visual identification of favorable/unfavorable changes
- **Trust**: Clear strikethrough shows boost amount from promotions
- **Consistency**: Same display rules across all bet displays in app

---

**Related Business Rules:**
- See **BR-003**: Auto-Verify on Changes (triggers provider odds updates)
- See **BR-004**: Promotion Unlinking (affects Case 2 → Case 1 transition)
- See **BR-010**: Promotion Unlinking on Type Change (can trigger odds display changes)
- See **BR-009**: Total Estimated Return Calculation (uses displayed odds for calculation)

---

### BR-012: Auto-Focus First Incomplete Stake on Betslip Open

**Status:** ✅ Implemented

**What this means:**
When the betslip bottom sheet opens, the client automatically scrolls to—and focuses—the first stake input that is either empty, below the minimum stake, or marked as invalid for multi combination. The custom numeric keyboard is opened and the cursor is placed at the end of the field so the user can enter a stake immediately.

**Trigger Points:**
- `SportPlaceBetVipCubit.initControllers()` emits `InitControllerLoaded` with the controller returned by `_findIncompleteTextField()`
- `_findIncompleteTextField` prioritizes single bet controllers, then the multi stake controller, and stores the matching key in `keyboardIndex`
- `SportBetslipVipScreen` listens for `InitControllerLoaded`, calls `_openKeyboard`, and binds `CustomKeyboardWidget` to `keyboardIndex`

**Implementation Details:**
- `_findIncompleteTextField` (file `lib/features/sport_vip/presentation/cubit/sport_place_bet_vip_cubit/sport_place_bet_vip_cubit.dart`) sets `keyboardIndex` before returning the controller so UI layers know which field to highlight
- `_openKeyboard` (file `lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart`) defers `Scrollable.ensureVisible` and `requestFocus` via `WidgetsBinding.instance.addPostFrameCallback` to ensure the field is mounted before we scroll/focus
- `CustomKeyboardWidget` reads `sportPlaceBetVipCubit.keyboardIndex` to route numeric input into the correct text controller

**Expected Behavior:**
- ✅ First empty or under-stake single bet gains focus and shows the cursor when betslip opens
- ✅ Multi stake field gains focus when the multi bet is present but stake is missing/invalid
- ✅ Keyboard remains closed when every stake already meets minimum requirements

**Edge Cases:**
- If all stakes are valid, `_findIncompleteTextField` returns `null` so the keyboard stays closed and no scrolling occurs
- If the focused bet is removed before the frame completes (e.g., verify response), the deferred focus callback exits safely because the focus node context is null or unmounted
- Manual taps on another stake field update `keyboardIndex`, allowing the custom keyboard to follow the user’s selection

**Related Business Rules:**
- See **BR-006**: Auto-Open Betslip After Add (entry point that triggers auto-focus)
- See **BR-008**: Stake Validation (criteria used to mark a stake as incomplete)
- See **BR-003**: Auto-Verify on Betslip Changes (refresh triggered after the user enters a stake)

---

### BR-013: Dynamic Button Behavior - "Add to Bet Slip" vs "Clear"

**Status:** ✅ Complete

**What this means:**
The existing "Clear" button in the betslip header dynamically changes its **label and behavior** based on the number and type of bets in the betslip. When there's exactly 1 bet, it shows "Add to Bet Slip" and closes the betslip. When there are 2+ bets (or special cases), it shows "Clear" and removes all bets. This provides an optimized UX where users can quickly close the betslip when they have a single bet, or clear all bets when they have multiple selections.

**Display Rules:**

#### **Mode 1: "Add to Bet Slip" Mode**

**When to Display:**
- Betslip contains **exactly 1 bet**
- User has **NOT** previously pressed "Add to Bet Slip" button
- **For Regular Bets (Single Racing/Sport):** Button persists across betslip close/reopen
- **For SRM/Exotic Bets:** Button shows only on first open after adding

**Button Label:** "Add to Bet Slip"

**Button Behavior:**
- **Action:** Close the betslip bottom sheet
- **State Change:** Mark betslip as "added" (persist flag in storage or state)
- **Next Time:** When betslip reopens, show "Clear" label instead

---

#### **Mode 2: "Clear" Mode**

**When to Display:**
- Betslip contains **2 or more bets** (any combination of types)
- OR betslip contains **1 bet** AND user has previously pressed "Add to Bet Slip" button
- OR betslip contains **1 SRM/Exotic bet** AND betslip was closed and reopened (special case)

**Button Label:** "Clear"

**Button Behavior:**
- **Action:** Remove all bets from betslip
- **Confirmation:** May show confirmation dialog (optional)
- **Unlink Promotions:** Automatically unlink all promotions before clearing (see BR-004)
- **Reset State:** Clear "added" flag and return to empty betslip state

---

**Special Cases:**

#### **SRM/Exotic Bets Auto-Switch to "Clear" on Reopen**
**Rule:** SRM and Exotic bets automatically switch to "Clear" label after betslip is closed and reopened, even without tapping "Add to Bet Slip" button.

**Behavior:**
- **First Open:** When betslip contains only 1 SRM/Exotic bet and opens for the first time
  - Button shows "Add to Bet Slip" label
  - This gives user option to tap button or close betslip
- **After ANY Close:** User closes betslip by any method (tap button, swipe down, tap outside)
  - System automatically marks as "added" 
- **Next Open:** User reopens betslip
  - Button shows "Clear" label (even though user didn't tap "Add to Bet Slip")
  - User can tap to remove all bets

**Rationale:** SRM/Exotic are complex multi-selection bets. After user reviews and closes betslip, they likely want "Clear" action rather than repeatedly closing with "Add to Bet Slip".

**Example Flow:**
```
Step 1: User creates SRM in Race 5
→ Betslip opens, count = 1 (SRM)
→ Button label: "Add to Bet Slip" (first time only)

Step 2: User closes betslip (swipe down, tap outside, OR tap button)
→ Betslip closes
→ Flag: added = true (auto-set for SRM/Exotic)

Step 3: User reopens betslip
→ Still has SRM (count = 1)
→ Button label: "Clear" (auto-switched)
```

**Contrast with Regular Bets:**
- Regular Single bets keep "Add to Bet Slip" label across multiple close/reopen cycles
- Only switch to "Clear" when user taps button OR adds 2nd bet

---

#### **Regular Bets Persist "Add to Bet Slip" Across Sessions**
**Rule:** Single Racing and Single Sport bets keep "Add to Bet Slip" label until user explicitly taps button or adds 2nd bet.

**Behavior:**
- User can close and reopen betslip multiple times
- Button continues showing "Add to Bet Slip" label
- Label only changes when:
  - (a) User taps "Add to Bet Slip" button, OR
  - (b) User adds a 2nd bet (count becomes 2+)

**Example Flow:**
```
Step 1: User adds Horse #5 Win
→ Betslip opens, count = 1
→ Button label: "Add to Bet Slip"

Step 2: User closes betslip (swipe down or tap outside)
→ Betslip closes
→ Flag: added = false (NOT auto-set for regular bets)

Step 3: User reopens betslip
→ Still has Horse #5 Win (count = 1)
→ Button label: "Add to Bet Slip" (persists)

Step 4: User closes and reopens again
→ Button label: "Add to Bet Slip" (still persists)

Step 5: User taps "Add to Bet Slip" button
→ Betslip closes
→ Flag: added = true

Step 6: User reopens betslip
→ Button label: "Clear" (finally switched)
```

---

#### **Auto-Open Betslip on First Bet**
**Rule:** When adding a bet and betslip count becomes exactly 1, automatically open the betslip bottom sheet.

**Purpose:** Show user the "Add to Bet Slip" button label immediately so they can close the betslip with one tap.

**Flow:**
1. User taps selection (Horse #5 Win or SRM)
2. Bet added to empty betslip → count = 1
3. Betslip automatically opens
4. Button shows "Add to Bet Slip" label (first time)
5. User interacts based on bet type (see Special Cases above)

**Related:** See BR-006 (Auto-Open Betslip After Add)

---

**Decision Table:**

| Bet Count | Bet Type | Previously "Added"? | Betslip Closed & Reopened? | Button Label |
|-----------|----------|---------------------|---------------------------|--------------|
| 0 | N/A | N/A | N/A | Hidden (empty state) |
| 1 | Single Racing/Sport | No | Yes (any times) | **Add to Bet Slip** |
| 1 | Single Racing/Sport | No | No (first open) | **Add to Bet Slip** |
| 1 | Single Racing/Sport | Yes | Any | **Clear** |
| 1 | SRM or Exotic | No | No (first open) | **Add to Bet Slip** |
| 1 | SRM or Exotic | No | Yes (reopened) | **Clear** (auto-set) |
| 1 | SRM or Exotic | Yes | Any | **Clear** |
| 2+ | Any combination | Any | Any | **Clear** |

**Key Difference:**
- **Regular Bets:** "Add to Bet Slip" persists across close/reopen until user taps button or adds 2nd bet
- **SRM/Exotic:** "Add to Bet Slip" only shows on first open, auto-switches to "Clear" after any close

---

**Implementation Requirements:**

1. **State Management:**
   - Track "betslip added" flag in `LocalBetslip` or cubit state
   - Track "first open" flag for SRM/Exotic bets specifically
   - Persist flags across app restarts (use secure storage)
   - Reset flags when betslip is cleared or all bets removed
   - **Different flag logic:**
     - Regular bets: Set "added" only when user taps "Add to Bet Slip" button
     - SRM/Exotic: Auto-set "added" on ANY betslip close (first time)

2. **Button Component:**
   - **Modify existing Clear button** to conditionally change label and behavior
   - Switch button text between "Add to Bet Slip" and "Clear"
   - Handle button tap events in `SportBetslipVipCubit` with mode-specific logic
   - Detect bet type (regular vs SRM/Exotic) to apply correct flag logic
   - Animate button transition when switching modes (optional)

3. **"Clear" Mode Logic:**
   - Call promotion unlink API for all linked promotions (BR-004)
   - Clear all betslip candidates from storage
   - Reset multi promotion data
   - Reset "added" and "first open" flags
   - Emit empty betslip state

4. **"Add to Bet Slip" Mode Logic:**
   - Close betslip bottom sheet
   - Set "added" flag to true (all bet types when button tapped)
   - Do NOT clear betslip contents
   - Next betslip open shows "Clear" label

5. **Betslip Close Detection (SRM/Exotic Only):**
   - Detect when betslip closes by any method (swipe, tap outside, button)
   - If betslip contains only 1 SRM/Exotic bet and "added" is false:
     - Auto-set "added" flag to true
   - Do NOT auto-set for regular single bets
   - Track "first open" state to show "Add to Bet Slip" once

**Expected Behavior:**

**Scenario 1: Regular Single Bet Flow**
```
Step 1: Add Horse #5 Win
→ Betslip opens, count = 1
→ Button label: "Add to Bet Slip"

Step 2: User closes betslip (swipe down or tap outside)
→ Betslip closes
→ Flag: added = false (NOT auto-set for regular bets)

Step 3: Reopen betslip
→ Still has Horse #5 Win (count = 1)
→ Button label: "Add to Bet Slip" (persists)

Step 4: Close and reopen multiple times
→ Button label: "Add to Bet Slip" (still persists)

Step 5: Tap "Add to Bet Slip" button
→ Betslip closes
→ Flag: added = true (now set)

Step 6: Reopen betslip
→ Button label: "Clear" (finally switched)
```

**Scenario 2: SRM Bet Flow**
```
Step 1: Create SRM in Race 5
→ Betslip opens, count = 1 (SRM)
→ Button label: "Add to Bet Slip" (first open only)

Step 2: User closes betslip (swipe down, tap outside, OR tap button)
→ Betslip closes
→ Flag: added = true (auto-set for SRM/Exotic)

Step 3: Reopen betslip
→ Still has SRM (count = 1)
→ Button label: "Clear" (auto-switched after first close)

Step 4: Tap "Clear" button
→ Confirmation: "Remove all bets?" (optional)
→ SRM removed, betslip empty
→ Button: Hidden (empty state)
→ Flag: added = false (reset)
```

**Scenario 3: Adding 2nd Bet Switches to "Clear"**
```
Step 1: Add Horse #5 Win
→ Betslip opens, count = 1
→ Button label: "Add to Bet Slip"

Step 2: Close and reopen betslip (without tapping button)
→ Button label: "Add to Bet Slip" (still persists)

Step 3: Add Horse #3 Place
→ Count = 2
→ Button label: "Clear" (auto-switched on 2+ bets)

Step 4: Remove Horse #3 Place
→ Count = 1 (back to 1 bet)
→ Button label: "Clear" (stays Clear, added = true now set)
```

---

**Edge Cases:**

- **Rapid Add/Remove:** If user adds bet (count = 1), then immediately adds another (count = 2), button label should change to "Clear" and "added" flag should be set
- **Regular Bet Close Without Button:** If user closes betslip by swiping/tapping outside (NOT tapping button), "added" flag remains false and "Add to Bet Slip" label persists on reopen
- **SRM/Exotic Close Any Method:** If user closes betslip by any method (button, swipe, tap outside), "added" flag auto-sets to true for SRM/Exotic bets
- **App Restart:** "Added" flag should persist across app restarts via secure storage
- **Betslip Auto-Open Disabled:** Button logic still applies even if auto-open is disabled in settings
- **Button State Transition:** Button label should update immediately when bet count changes (no delay or loading state)
- **Mixed Bet Types:** If betslip has 1 regular bet + 1 SRM (count = 2), always show "Clear" label

---

**Related Business Rules:**
- See **BR-006**: Auto-Open Betslip After Add (triggers button display on first bet)
- See **BR-004**: Promotion Unlinking Before Bet Removal (Clear button must unlink promotions)
- See **BR-007**: Clear Betslip on Successful Bet Placement (resets "added" flag after bet placed)
- See **BR-003**: Auto-Verify on Betslip Changes (verify triggered after adding/removing bets)

---

**Implementation Details:**

**Critical Fix (November 19, 2025):**
- **Issue:** "Add to Bet Slip" button was calling `context.pop()`, which popped navigation routes and caused underlying screens to disappear
- **Root Cause:** The betslip is displayed as a `DraggableScrollableSheet` within a route, not a standalone modal. Calling `context.pop()` removed routes from the Navigator stack instead of just closing the betslip sheet
- **Solution:** 
  - Removed `context.pop()` call from `_onAddToBetslipButton()` method
  - Instead, animate `DraggableScrollableSheet` to closed position (size 0.0) using `draggableScrollableCtl.animateTo()`
  - This properly dismisses the betslip while preserving all underlying screens
- **File:** `lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart`
- **Method:** `_onAddToBetslipButton()` (line ~1440)
- **Status:** ✅ Fixed

**Implementation Code:**
```dart
Future<void> _onAddToBetslipButton() async {
  await sportBetslipVipCubit.markAddButtonAcknowledged();
  sportPlaceBetVipCubit.handleAddToBetslipEvent(true);
  _closeKeyboard();
  
  // BR-013: Close only the betslip bottom sheet, not the underlying screen
  // Animate the DraggableScrollableSheet to closed position
  if (context.mounted && sportPlaceBetVipCubit.draggableScrollableCtl.isAttached) {
    await sportPlaceBetVipCubit.draggableScrollableCtl.animateTo(
      0.0, // Animate to minimum size (closed)
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }
  // Do NOT call context.pop() - we only want to close the betslip modal, not remove any routes
}
```

**Testing:**
- ✅ Verify "Add to Bet Slip" button closes only the betslip, not underlying screens
- ✅ Test with regular single bets (Racing/Sport)
- ✅ Test with SRM/Exotic bets
- ✅ Verify betslip can be reopened after closing with "Add to Bet Slip" button
- ✅ Verify underlying screen remains fully functional after betslip closes

---

### BR-014: Betslip Progress Status Lifecycle (CRITICAL)

**Status:** ⏳ In Progress

**What this means:**
The betslip tracks its lifecycle state through `BetslipProgressStatus` with three values: `pending`, `confirm`, and `reuse`. Status is persisted in `LocalBetslip`, but the success overlay cleanup resets `reuse` back to `pending` if the user does not tap Reuse.

#### Status Values:

| Status | Description | UI State | User Actions |
|--------|-------------|----------|--------------|
| `pending` | Default state. User is editing selections and stakes | Normal betslip with editable fields | Add/remove bets, enter stakes, apply promotions, place bet |
| `confirm` | User is about to place bet (mapped from `isPressPlaceBet`) | Confirm mode with final review | Confirm or cancel bet placement |
| `reuse` | Bet placed successfully (temporary until overlay dismiss or user action) | Success indicators, disabled editing, Reuse/My Bets buttons | Reuse Selection, My Bets, add new selection, or overlay auto-dismiss |

---

#### State Transitions:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│    ┌─────────┐                                                   │
│    │ pending │◄──────────────────────────────────────────────┐   │
│    └────┬────┘                                               │   │
│         │                                                    │   │
│         │ User taps "Place Bet"                              │   │
│         ▼                                                    │   │
│    ┌─────────┐                                               │   │
│    │ confirm │                                               │   │
│    └────┬────┘                                               │   │
│         │                                                    │   │
│         ├── Place Bet API fails ─────────────────────────────┤   │
│         │                                                    │   │
│         │ Place Bet API succeeds                             │   │
│         ▼                                                    │   │
│    ┌─────────┐                                               │   │
│    │  reuse  │                                               │   │
│    └────┬────┘                                               │   │
│         │                                                    │   │
│         ├── Overlay auto-dismiss ───► Clear all ──────────────┤   │
│         │                                                    │   │
│         ├── "Reuse Selection" ───► Clear stakes ─────────────┤   │
│         │                                                    │   │
│         ├── "My Bets" ───► Clear all + Navigate ─────────────┤   │
│         │                                                    │   │
│         └── Add new selection ───► Clear all + Add new ──────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

#### Mapping to `isPressPlaceBet` ValueNotifier:

**Current Implementation:**
- `isPressPlaceBet.value = true` → Confirm mode active
- `isPressPlaceBet.value = false` → Normal edit mode

**New Mapping:**
- `isPressPlaceBet` ValueNotifier continues to function as before
- `isPressPlaceBet.value` reads from/writes to `progressStatus`:
  - `isPressPlaceBet.value = true` → `progressStatus = confirm`
  - `isPressPlaceBet.value = false` → `progressStatus = pending`
- `reuse` status is independent of `isPressPlaceBet`

**Implementation:**
```dart
// In SportPlaceBetVipCubit
void setIsPressPlaceBet(bool value) {
  isPressPlaceBet.value = value;
  if (value) {
    localBetslip.progressStatus = BetslipProgressStatus.confirm;
  } else if (localBetslip.progressStatus != BetslipProgressStatus.reuse) {
    localBetslip.progressStatus = BetslipProgressStatus.pending;
  }
  _saveBetslipToStorage();
}
```

---

#### Persistence:

**Storage:** `BetslipProgressStatus` is persisted within `LocalBetslip` via `toJson()`/`fromJson()`.

**File:** `lib/core/services/betslip_store_service/models/local_betslip.dart`

**Serialization:**
```dart
enum BetslipProgressStatus {
  pending,
  confirm,
  reuse;
  
  static BetslipProgressStatus fromString(String value) {
    return BetslipProgressStatus.values.firstWhere(
      (e) => e.name == value,
      orElse: () => BetslipProgressStatus.pending,
    );
  }
}

class LocalBetslip {
  // ... existing fields
  BetslipProgressStatus progressStatus;
  
  Map<String, dynamic> toJson() {
    return {
      // ... existing fields
      'progressStatus': progressStatus.name,
    };
  }
  
  factory LocalBetslip.fromJson(Map<String, dynamic> json) {
    return LocalBetslip(
      // ... existing fields
      progressStatus: BetslipProgressStatus.fromString(
        json['progressStatus'] ?? 'pending',
      ),
    );
  }
}
```

---

**Expected Behavior:**

| Scenario | Current Status | Action | New Status |
|----------|---------------|--------|------------|
| User enters stakes | `pending` | Tap Place Bet | `confirm` |
| Confirm mode | `confirm` | Place Bet API succeeds | `reuse` |
| Confirm mode | `confirm` | Place Bet API fails | `pending` |
| Reuse mode | `reuse` | Tap "Reuse Selection" | `pending` |
| Reuse mode | `reuse` | Tap "My Bets" | `pending` (then clear + navigate) |
| Reuse mode | `reuse` | Success overlay auto-dismiss | `pending` (clear betslip) |
| Reuse mode | `reuse` | Add new selection | `pending` (after clearing existing) |
| App restart | Any | App opens | Restored from storage |

---

**Related Business Rules:**
- See **BR-015**: Reuse Mode Behavior (details of reuse state)
- See **BR-016**: Blur Overlay Success Dialog (UI during reuse transition)
- See **BR-007**: Clear Betslip on Successful Bet Placement (DEPRECATED for reuse flow)

---

### BR-015: Reuse Mode Behavior (CRITICAL)

**Status:** ⏳ In Progress

**What this means:**
After successful bet placement, the betslip transforms to "Reuse Mode" instead of clearing. This allows users to quickly re-bet on the same selections without re-adding them from race/sport screens.

---

#### Key Behavioral Changes:

| Aspect | Previous Behavior | New Behavior (Reuse Mode) |
|--------|-------------------|---------------------------|
| **On Success** | Clear all betslips + hide screen | Keep all betslips + show Reuse Screen |
| **Success Overlay** | Displayed after closing betslip | BetPlacedSuccessOverlay appears at bottom |
| **User Actions** | Start fresh with empty betslip | Choose: Reuse Selection OR My Bets |
| **State Persistence** | N/A (cleared) | Reuse is temporary until success overlay dismisses |
| **Promotions** | Cleared with betslip | **Consumed & removed** - promotion cards are completely hidden in reuse mode |

---

#### Promotion Clearing on Success (CRITICAL):

**Why promotions must be cleared:**
- Promotions are **consumed** by the successful bet placement
- `remainingUses` count decreases after bet is placed
- Showing promotion cards is misleading since they're no longer applicable
- When user taps "Reuse Selection", fresh promotions are fetched from verify API

**What must be cleared:**
1. **Per-candidate promotions:**
   - Clear `linkedPromotions` list for all candidates
   - Clear `promotionUuid` for all candidates
   - Revert `newOdds` to `preBoostOdds` (removes boost styling)
   - Clear `preBoostOdds` and `preBoostFractionalPercent`
2. **Multi-bet promotions:**
   - Clear `multiLinkedPromotions`
   - Clear `multiPromotionUuid`
   - Revert multi boost odds similarly
3. **UI State (PromotionsCubit):**
   - Clear `_promotionsPerBet` cache - removes all promotion cards
   - Clear `_selectedPromotions` and `_usageIds` maps
   - Emit empty promotions state to trigger UI rebuild

**Implementation Timing:**
- Clear promotions **immediately after** Place Bet API returns success
- Clear **before** transitioning `progressStatus` to `reuse`
- No API unlink call needed (promotions already consumed by backend)

**Note:** No `DELETE /v1/betslips/cancel-bulk-promotion-usage` API call is required because the promotions were already consumed by the successful bet placement. Only local data needs to be cleared.

---

#### Reuse Screen UI Behavior:

**1. Bet Item Display:**
- Each bet item shows success indicator (e.g., ✅ checkmark, "Bet Placed" text)
- Success text displayed for each bet item individually
- Multi section shows success status above the "Multi" header
- **Multi leg count displays ALL legs** - not just legs that were placed as singles. Example: If user adds 2 racing bets, enters stake for bet A (single) + multi bet, but NOT for bet B (single), the reuse screen shows "2 legs multi" because the multi combination contains 2 legs regardless of individual single bet placements
- All bet details visible (horse name, **original odds** without boost, stake, potential return)
- **Promotions are hidden** - No promotion cards displayed since bet was placed
- **Error indicators are HIDDEN** - No error messages or error styling displayed for any bet type (single racing, single sport, exotic, SRM, quaddie, multi). Since bets were successfully placed, error states are not applicable.

**2. Disabled Interactions:**
- Stake input fields are non-editable
- Cannot remove individual bets
- Cannot change bet types (Win/Place)
- Cannot apply/remove promotions
- All CTA buttons blocked EXCEPT:
  - "Reuse Selection" button
  - "My Bets" button

**3. Bottom Action Bar:**
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  [Reuse Selection]              [My Bets 🔢]            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
- **"Reuse Selection"** (left): Clears stakes, returns to pending
- **"My Bets"** (right): Shows badge with bet count, clears all + navigates

---

#### Betslip Screen Initialization in Reuse Mode (CRITICAL):

**When betslip screen opens/reopens:**
1. Call `sportPlaceBetVipCubit.refresh()` **first** to restore `progressStatus`
2. Check `isInReuseMode` to determine initialization behavior
3. **If in reuse mode:**
   - **Skip `promotionsCubit.loadPromotions()`** - promotions were cleared on success
   - No verify API call - bets are already placed
   - Display reuse mode UI with success indicators
4. **If NOT in reuse mode (pending mode):**
   - Call `promotionsCubit.loadPromotions()` normally
   - Fetch fresh promotions from verify API
   - Display normal betslip edit UI

**Implementation:**
```dart
// In _initState():
sportPlaceBetVipCubit.refresh(); // Restore progressStatus first

if (!sportPlaceBetVipCubit.isInReuseMode) {
  promotionsCubit.loadPromotions(); // Only load in pending mode
}
```

---

#### Action: "Reuse Selection"

**Trigger:** User taps "Reuse Selection" button (in dialog or bottom bar)

**Behavior:**
1. Dismiss blur dialog (if visible)
2. Clear all stake values:
   - Set `rawStake = 0` for all candidates
   - Clear stake text controllers
   - **Clear all "Stake All" fields** for each bet section (Single, Multi, Exotic, SRM, Quaddie)
3. **Reset visibility map for all items** (CRITICAL):
   - Call `forceVisibleAllItem()` to set `singleBetslipVisibleMap[id] = true` for all candidates
   - This ensures all candidates are visible in pending mode, even if they didn't have stakes when originally placed
4. Change `progressStatus` from `reuse` to `pending`
5. Save to storage
6. **Call `promotionsCubit.loadPromotions()`** to fetch fresh promotions
7. UI transitions to normal edit mode:
   - Stake fields become editable
   - Place Bet button appears
   - Success indicators removed
   - **Promotion cards appear** with fresh data
   - All CTAs re-enabled

**Stake All Text Controllers (Presentation Logic):**

Each bet section has a "Stake All" field that applies a stake to all items in that section:

| Controller | Purpose |
|------------|---------|
| `textStakeAllSingle` | Stake all single racing/sport bets |
| `textStakeAllMulti` | Multi bet stake input |
| `textStakeAllExotic` | Stake all exotic bets |
| `textStakeAllSrm` | Stake all Same Race Multi bets |
| `textStakeAllQuaddie` | Stake all Quaddie bets |

These are cleared in `onReuseSelection()` to ensure a clean slate when returning to pending mode.

**Visibility Map (Presentation Logic):**

The `singleBetslipVisibleMap` is a **presentation-layer** state in `SportPlaceBetVipCubit` that controls which bet items are rendered on screen:

| Function | Purpose | When Called |
|----------|---------|-------------|
| `hideAllItemUnValid()` | Hides items without valid stakes | Before entering confirm mode |
| `forceVisibleAllItem()` | Shows all items | Returning to pending mode, after reuse |
| `isVisibleItem(id)` | Checks if item should render | During UI build |

```dart
// singleBetslipVisibleMap structure
Map<String, bool> singleBetslipVisibleMap = {
  'candidateId1': true,  // Visible
  'candidateId2': false, // Hidden
};
```

**Why visibility reset is needed after reuse:**
- When user places bet, items without stakes are hidden via `hideAllItemUnValid()`
- After "Reuse Selection", ALL items should be visible for new stake entry
- Without `forceVisibleAllItem()`, items that had no stakes remain hidden

**User Flow After Reuse:**
```
User taps "Reuse Selection"
       ↓
Stakes cleared (all selections retained)
       ↓
Visibility map reset (all items visible)
       ↓
Fresh promotions fetched via verify API
       ↓
Betslip in pending mode
       ↓
User enters new stakes
       ↓
User taps "Place Bet"
       ↓
Normal place bet flow
```

---

#### Action: "My Bets"

**Trigger:** User taps "My Bets" button (in dialog or bottom bar)

**Behavior:**
1. Dismiss blur dialog (if visible)
2. Change `progressStatus` from `reuse` to `pending`
3. Clear all betslip candidates from storage
4. Close betslip screen
5. Navigate to My Bets screen (`/mybet` route)

**Note:** Promotions should already be consumed by the successful bet, so no unlink needed.

---

#### Adding New Selection During Reuse Mode:

**Trigger:** User adds a new selection from race/sport screen while betslip is in reuse mode

**Behavior:**
1. Detect `progressStatus == reuse`
2. Clear ALL existing candidates from storage
3. Add the new selection to betslip
4. Change `progressStatus` from `reuse` to `pending`
5. Open betslip in normal edit mode
6. Trigger verify API for new selection

**Implementation Location:** `SecureStorageBetslipStoreService.addCandidate()`

```dart
Future<void> addCandidate(BetslipCandidate candidate) async {
  await _lock.synchronized(() async {
    final betslip = await _loadBetslipFromStorage();
    
    // NEW: Clear existing if in reuse mode
    if (betslip.progressStatus == BetslipProgressStatus.reuse) {
      betslip.candidates.clear();
      betslip.progressStatus = BetslipProgressStatus.pending;
    }
    
    betslip.candidates.add(candidate);
    await _saveBetslipToStorage(betslip);
  });
}
```

---

#### State Persistence Across Close/Reopen:

**Requirement:** If user closes betslip during Reuse mode, reopening should restore Reuse state.

**Behavior:**
- `progressStatus` persisted in storage (see BR-014)
- On betslip reopen, check `progressStatus`:
  - If `reuse`: Display Reuse Screen layout
  - Blur dialog does NOT re-show (only on first success)
- User can still tap "Reuse Selection" or "My Bets"

**Edge Case:** User force-closes app during Reuse mode
- On next app launch, betslip loads with `progressStatus = reuse`
- Betslip displays in Reuse mode
- No blur dialog (was already dismissed or app closed)

---

**Expected Behavior:**

| Scenario | Action | Result |
|----------|--------|--------|
| Bet placed successfully | API returns success | Transform to Reuse Screen, show success overlay |
| User closes betslip (swipe/tap) | Close gesture | Betslip closes; overlay auto-dismiss still clears betslip |
| User reopens betslip | Tap mini betslip | Opens in Reuse Screen while overlay is active; otherwise pending/empty |
| User taps "Reuse Selection" | Button tap | Clear stakes, return to pending, can edit |
| User taps "My Bets" | Button tap | Clear all, close, navigate to My Bets |
| User adds new selection | Tap selection on race screen | Clear existing, add new, return to pending |
| App restart during reuse window | Launch app | Reuse can restore if overlay cleanup has not run |

---

**Related Business Rules:**
- See **BR-014**: Betslip Progress Status Lifecycle (status enum and transitions)
- See **BR-016**: Blur Overlay Success Dialog (blur effect details)
- See **AC-006** through **AC-010**: Acceptance criteria for each behavior

---

### BR-016: Blur Overlay Success Dialog (CRITICAL)

**Status:** ✅ Complete

**What this means:**
When a bet is placed successfully, an optional blur overlay dialog may be shown (feature-flagged). This dialog highlights the bet receipt while the Reuse Screen is blurred behind it.

---

#### Visual Design:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ╔═══════════════════════════════════════════════════╗  │
│  ║                                                   ║  │
│  ║     ┌─────────────────────────────────────┐       ║  │
│  ║     │       Bet Placed              ✕     │       ║  │
│  ║     ├─────────────────────────────────────┤       ║  │
│  ║     │                                     │       ║  │
│  ║     │   BET ID # O/0950436/0035025/D      │       ║  │
│  ║     │                                     │       ║  │
│  ║     │   You have successfully placed      │       ║  │
│  ║     │   your bet.                         │       ║  │
│  ║     │                                     │       ║  │
│  ║     │   Check your bet history in         │       ║  │
│  ║     │   Transaction History in the        │       ║  │
│  ║     │   Settings button                   │       ║  │
│  ║     │                                     │       ║  │
│  ║     └─────────────────────────────────────┘       ║  │
│  ║                                                   ║  │
│  ║              (Blurred Background)                 ║  │
│  ║                                                   ║  │
│  ╚═══════════════════════════════════════════════════╝  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

#### Implementation Details:

**Blur Effect:**
- Use `BackdropFilter` widget with `ImageFilter.blur(sigmaX: 5.0, sigmaY: 5.0)`
- Blur applies to the background behind the dialog
- Dialog itself is NOT blurred, only the background

**Implementation Pattern:**
```dart
Widget _buildBlurOverlayDialog({
  required Widget dialog,
}) {
  return BackdropFilter(
    filter: ImageFilter.blur(sigmaX: 5.0, sigmaY: 5.0),
    child: dialog,
  );
}
```

---

#### Dialog Content:

**Uses existing success dialog** with blur background:
- "Bet Placed" header with close button
- Bet ID display
- Success message
- Transaction history instruction

**Implementation Location:** `show_dialog_place_bet_coodinator.dart`

---

#### Auto-Dismiss Behavior:

**Timer:** 3 seconds after dialog appears

**Behavior:**
1. Timer starts when dialog is shown
2. After 3 seconds, dialog auto-dismisses
3. Timer cancelled if user taps close button (✕)
4. Dialog dismissal does **not** clear the betslip (cleanup is handled by `BetPlacedSuccessOverlay`)

**Implementation:**
```dart
Timer? _autoDismissTimer;

void initState() {
  _autoDismissTimer = Timer(const Duration(seconds: 3), () {
    _dismissDialog();
  });
}

void _onCloseTapped() {
  _autoDismissTimer?.cancel();
  _dismissDialog();
}
```

---

#### Display Rules:

| Condition | Show Blur Dialog? |
|-----------|-------------------|
| Feature flag enabled (`SHOW_BET_PLACED_SUCCESS_DIALOG`) | ✅ Yes |
| Feature flag disabled | ❌ No |
| Multiple bets placed (multi) | ✅ Yes (single dialog for all bets) |

**Key Rule:** Blur dialog is shown exactly ONCE per successful bet placement, immediately after Place Bet API succeeds.

---

#### Flow:

```
Place Bet → API Success → Show Blur Dialog → Auto-dismiss (3s) or User closes
```

---

**Expected Behavior:**

| Scenario | Blur Dialog |
|----------|-------------|
| Initial success | Visible with blur background |
| After 3s auto-dismiss | Hidden |
| User taps ✕ button | Dismisses |

---

**Related Business Rules:**
- See **BR-014**: Betslip Progress Status Lifecycle (reuse state trigger)
- See **BR-015**: Reuse Mode Behavior (Reuse Screen layout and actions)
- See **AC-007**: Acceptance criteria for blur dialog display

---

### BR-017: Odds Change Indicator Visibility Control

**Status:** ✅ Complete

**What this means:**
The odds change error indicator (red banner with warning icon) visibility for racing bets is controlled based on the direction of odds change and a profile whitelist stored in Firestore. The arrow icon visibility is controlled by a feature flag.

---

#### Overview:

**Components:**
1. **Arrow Icon** (↑/↓): Shows odds change direction next to the odds value
2. **Error Indicator** (red banner): Shows message like "Odds have increased/decreased for this bet"

**Control Mechanisms:**
1. **Feature Flag**: Controls arrow icon visibility
2. **Firestore Profile List**: Controls error indicator visibility for price increases only

---

#### Arrow Icon Display Rules:

| Control | Setting | Arrow Behavior |
|---------|---------|----------------|
| Feature Flag | `SHOW_ICONS_WHEN_ODD_CHANGED: true` | ✅ Show arrow |
| Feature Flag | `SHOW_ICONS_WHEN_ODD_CHANGED: false` | ❌ Hide arrow |

**Feature Flag Location:** 
- Dart Define: `BETSLIP_SHOW_ICONS_WHEN_ODD_CHANGED` in `env/*.env.json`
- FlavorValues: `FlavorValues.betslipShowIconsWhenOddChanged`
- Getter: `MobileConfig.showIconsWhenOddChanged`

**Applies To:**
- Single racing bets (`sport_single_betslip_item_vip_widget.dart`)
- Single sport bets (event type) (`sport_single_betslip_item_vip_widget.dart`)
- SRM bets (`srm_betslip_item_vip_widget.dart`)

**Exception:**
- Each Way Fixed bets do NOT show arrow icons (regardless of feature flag)

---

#### Error Indicator Display Rules:

| Odds Direction | Display Rule |
|----------------|--------------|
| **Decreased** (new < old) | ✅ Always show error indicator |
| **Increased** (new > old) | ✅ Show only if user profile is in Firestore whitelist |

**Firestore Path:** `profileShowPriceIncrease/profile/list`

**Profile Matching:**
- Checks `currentUser?.profile` against the Firestore list
- If profile matches, error indicator is shown for price increases

---

#### Implementation Details:

**FireStoreService:**
```dart
// Collection name
static const String _profileShowPriceIncreaseCollection = 'profileShowPriceIncrease';

// Cached list of profiles
List<String> _profilesShowPriceIncrease = [];

// Fetch on init
Future<void> fetchProfilesShowPriceIncrease() async {
  final snapshot = await firestore
      .collection(_profileShowPriceIncreaseCollection)
      .doc('profile')
      .get();
  // Parse 'list' field from document
}

// Check if profile should show price increase indicator
bool isProfileShowPriceIncrease(String? profileIdentifier) {
  return _profilesShowPriceIncrease.contains(profileIdentifier);
}
```

**Widget Logic (`_getMessage`):**
```dart
String? get _getMessage {
  final candidate = widget.betslipModel;
  
  if (candidate is OddChangedCandidate &&
      candidate.status == CandidateStatus.oddChanged) {
    // isIncreaseOdds = true → preBoostOdds > oldOdds → price INCREASED → check profile list
    // isIncreaseOdds = false → preBoostOdds <= oldOdds → price DECREASED → always show
    if (isIncreaseOdds) {
      // Price increased - only show if profile is in Firestore list
      final currentUser = GetIt.I<MainAppCubit>().currentUserNotifier.value;
      final fireStoreService = GetIt.I<ManagerEnvService>().firebaseService.fireStoreService;
      if (!fireStoreService.isProfileShowPriceIncrease(currentUser?.profile)) {
        return null; // Hide error indicator for price increases when profile not in list
      }
    }
    // Price decreased (isIncreaseOdds = false) - always show message to all users
  }
  return widget.betslipModel?.statusMessage;
}
```

**Profile Matching:**
- Checks `currentUser?.profile` against the Firestore list

---

#### Expected Behavior:

| Scenario | Arrow Icon | Error Indicator |
|----------|------------|-----------------|
| Price decreased, feature flag ON | ✅ Show | ✅ Show |
| Price decreased, feature flag OFF | ❌ Hide | ✅ Show |
| Price increased, feature flag ON, profile in list | ✅ Show | ✅ Show |
| Price increased, feature flag ON, profile NOT in list | ✅ Show | ❌ Hide |
| Price increased, feature flag OFF, profile in list | ❌ Hide | ✅ Show |
| Price increased, feature flag OFF, profile NOT in list | ❌ Hide | ❌ Hide |

---

#### Firestore Document Structure:

**Path:** `profileShowPriceIncrease/profile`

**Document Fields:**
```json
{
  "list": ["username1", "username2", "userId123", ...]
}
```

---

#### Files Modified:

| File | Changes |
|------|---------|
| `firebase_firestore_service.dart` | Added `fetchProfilesShowPriceIncrease()` and `isProfileShowPriceIncrease()` |
| `manager_env_service.dart` | Added `showIconsWhenOddChanged` getter |
| `sport_single_betslip_item_vip_widget.dart` | Updated `_buildOddChange()` and `_buildMessage()` |
| `srm_betslip_item_vip_widget.dart` | Updated `_buildOddChangeArrow()` and `_buildMessage()` |

---

**Related Business Rules:**
- See **BR-011**: Odds Display Rules with Provider/Promotion Changes
- See **BR-014**: Betslip Progress Status Lifecycle

---

### BR-018: OddChangedCandidate Unwrapping on Selection Type Change

**Status:** ✅ Complete

**What this means:**
When a user changes the selection type of a racing bet that is wrapped in `OddChangedCandidate`, the wrapper MUST be removed (unwrapped) after the type change to prevent stale odds values from triggering false "odds changed" indicators.

**Why Required:**
- `OddChangedCandidate` stores `preBoostOdds` and `newOdds` from the verify API response
- These values become **stale** when selection type changes (e.g., Win → Tote, Place → Each Way Fixed)
- Different selection types have different odds structures
- Keeping the wrapper causes false "odds changed" indicators because stale `preBoostOdds` ≠ new local `odds`

**Trigger:**
- User changes selection type via dropdown (e.g., Win → Mid Div, Place → Each Way Fixed, Fixed Win → Tote)

**Implementation:**

**File:** `secure_storage_betslip_store_service.dart`

**Method:** `updateSelectionTypeForSingle()`

```dart
// After updating selection type and odds...
if (candidate is OddChangedCandidate) {
  logApp(
    'SecureStorageBetslipStoreService: Unwrapping OddChangedCandidate after type change to: $selectionType',
  );
  localBetslip.candidates[candidateIndex] = candidate.currentCandidate;
}
```

**Flow:**
1. User changes selection type (e.g., Fixed Win → Tote)
2. Promotions are unlinked if any (BR-010)
3. Selection type is updated in storage
4. Local odds are updated based on new type (win price, place price, or combined)
5. **OddChangedCandidate is unwrapped** → candidate becomes `RacingBetslipCandidate`
6. Next verify API will re-wrap if odds have changed from provider

**Expected Behavior:**

**Scenario: Fixed Win with Promotion → Tote**
```
Before:
- Candidate Type: OddChangedCandidate (wrapping RacingBetslipCandidate)
- preBoostOdds: 12.0 (baseline without boost)
- newOdds: 15.0 (with 25% boost)
- localOdds: 12.0
- Promotion: "25% Boost" linked

User changes: Win → Tote (which triggers BR-010 promotion unlink)

After:
- Candidate Type: RacingBetslipCandidate (unwrapped!)
- No preBoostOdds/newOdds (stale values cleared)
- localOdds: Tote odds from racing runner
- Promotion: UNLINKED
- NO false "Odds have changed" indicator
```

**What Does NOT Happen:**
- ❌ Stale `preBoostOdds` does NOT persist after type change
- ❌ False "Odds have changed" message does NOT appear
- ❌ Old boost values do NOT affect new selection type

**Edge Cases:**
- **Genuine odds change after type switch**: Next verify API will detect real change and re-wrap as `OddChangedCandidate`
- **Each Way Fixed**: Combined odds (win + place) are calculated and set as local odds before unwrap
- **Type change without promotion**: Still unwraps to clear any stale `preBoostOdds`

**Related Business Rules:**
- See **BR-010**: Promotion Unlinking on Selection Type Change (promotions unlinked BEFORE unwrap)
- See **BR-011**: Odds Display Rules (arrow icon logic uses preBoostOdds for market changes)
- See **BR-017**: Odds Change Indicator Visibility Control

---

### BR-019: OddChangedCandidate Property Delegation

**Status:** ✅ Complete

**What this means:**
The `OddChangedCandidate` wrapper class must properly delegate all inherited properties from the wrapped `currentCandidate` to ensure UI components display correctly when a bet is in the "odd changed" state.

**Why Required:**
- `OddChangedCandidate` wraps another candidate type (e.g., `RacingBetslipCandidate`)
- UI components access properties like `silk`, `formatName`, `selectionType` from the candidate
- If not delegated, these properties return default values (null), breaking UI display

**Delegated Properties:**

| Property | Delegated From | Purpose |
|----------|----------------|---------|
| `silk` | `currentCandidate.silk` | Runner icon (jockey silk) image |
| `formatName` | `currentCandidate.formatName` | Runner/selection name display |
| `selectionType` | `currentCandidate.selectionType` | Selection type (Win/Place/etc) |
| `formatEventName` | `currentCandidate.formatEventName` | Event/race name display |
| `legId` | `currentCandidate.legId` | Race/event identifier |
| `selectionId` | `currentCandidate.selectionId` | Selection identifier |
| `category` | `currentCandidate.category` | Bet category (race/sport) |
| `getStake()` | `currentCandidate.getStake()` | Stake amount |
| `rawStake` | `currentCandidate.rawStake` | Raw stake value |
| `errorMetadata` | `currentCandidate.errorMetadata` | Error status and message |
| `promotionUuid` | `currentCandidate.promotionUuid` | Linked promotion UUID |
| `linkedPromotions` | `currentCandidate.linkedPromotions` | List of linked promotions |
| `displayId` | `currentCandidate.displayId` | Display identifier |

**Implementation:**

**File:** `betslip_candidate.dart`

**Example - Silk Delegation:**
```dart
class OddChangedCandidate extends BetslipCandidate {
  // ...
  
  /// Delegate silk getter to currentCandidate
  /// This ensures the runner icon is displayed when wrapped in OddChangedCandidate
  @override
  Future<String?> get silk => currentCandidate.silk;
}
```

**Symptom If Missing:**
- Runner icon (silk image) disappears after applying promotion
- Selection name shows as empty
- Selection type shows as null

**Root Cause:**
- `BetslipCandidate` base class has default implementations returning `null`
- If `OddChangedCandidate` doesn't override with delegation, UI gets `null`

**Affected UI Components:**
- `sport_single_betslip_item_vip_widget.dart` - Uses `silk` for runner icon
- `racing_betslip_item_widget.dart` - Uses `formatName`, `selectionType`

**Related Business Rules:**
- See **BR-011**: Odds Display Rules (requires proper property access)
- See **BR-018**: OddChangedCandidate Unwrapping (cleans up wrapper after type change)

---

### BR-020: Sport Bet Odds Change Message Support

**Status:** ✅ Complete

**What this means:**
Sport bets (event type with `SportBetslipCandidate`) now support the odds change message indicator, similar to racing bets.

**Why Required:**
- Originally, `statusMessage` only checked for racing bet types (`_isRacingCandidate()`)
- Sport bets were excluded from odds change messages
- Users expect consistent behavior across all bet types

**Implementation:**

**File:** `betslip_candidate.dart`

**Changes:**
1. Added `_isSportCandidate()` helper method:
```dart
bool _isSportCandidate() {
  final candidate = currentCandidate;
  return candidate is SportBetslipCandidate;
}
```

2. Updated `statusMessage` getter to include sport bets:
```dart
// Only show odds change message for racing or sport bets
if (!_isRacingCandidate() && !_isSportCandidate()) {
  return null;
}
```

3. Added `SportBetslipCandidate` case to `_getOldOdds()`:
```dart
num? _getOldOdds() {
  final candidate = currentCandidate;
  return switch (candidate) {
    RacingBetslipCandidate() => candidate.selection.odds,
    SportBetslipCandidate() => candidate.selection.odds,  // NEW
    SameRaceMultiBetslipCandidate() => candidate.calculatedResponse.singleOdds,
    _ => null,
  };
}
```

**Supported Bet Types:**
| Bet Type | Candidate Class | Message Support |
|----------|-----------------|-----------------|
| Racing (Win/Place/etc) | `RacingBetslipCandidate` | ✅ Yes |
| Sport (Event) | `SportBetslipCandidate` | ✅ Yes |
| Same Race Multi | `SameRaceMultiBetslipCandidate` | ✅ Yes |
| Exotic | `ExoticBetslipCandidate` | ✅ Yes (fractional) |
| Quaddie | `QuaddieBetslipCandidate` | ✅ Yes (fractional) |
| Multi | `MultiBetslipCandidate` | ❌ No |

**Related Business Rules:**
- See **BR-011**: Odds Display Rules
- See **BR-017**: Odds Change Indicator Visibility Control

---

### BR-021: Verify Before Confirm Mode (Stale Odds Detection)

**Status:** ✅ Complete  
**Implemented:** June 20, 2025

**What this means:**
When a user taps "Place Bet" for the first time (entering confirm mode), the system now proactively calls the Verify API before showing the confirm screen. This ensures users see current odds and any changes that occurred while the betslip was idle.

**Problem Solved:**
Users could leave the betslip open for extended periods (2+ minutes) while odds changed on the backend. Previously, the system only verified when:
- Betslip was opened (via `BlocListener` in screen)
- Stakes/selections were modified

If users did NOT close the betslip, odds changes during idle time went undetected until the final Place Bet API call, which caused unexpected bet rejections or incorrect amounts.

---

#### Detection Sources for Invalid Bets:

| Source | Statuses Set | When Triggered |
|--------|--------------|----------------|
| **Verify API** | `oddChanged`, `selectionNotFound`, `raceNotFound`, `unknownError` | Proactively before confirm mode |
| **WebSocket** | `betClosed` | Real-time via `raceStatusChange` event |

**Key Insight:** The `betClosed` status is **only set via WebSocket**, not from the Verify API. When a race closes, the API returns `error.RaceNotFound` which maps to `raceNotFound` status. Both sources work together to ensure comprehensive coverage.

---

#### Implementation Details:

**Files Modified:**

| File | Changes |
|------|---------|
| `sport_place_bet_vip_cubit_state.dart` | Added `VerifyBeforeConfirmState` class |
| `sport_place_bet_vip_cubit.dart` | Added `verifyAndEnterConfirmMode()` method |
| `sport_betslip_vip_screen.dart` | Updated `_onPlaceBet()` to call verify before confirm mode |

**Cubit Method:**
```dart
Future<void> verifyAndEnterConfirmMode() async {
  emit(const VerifyBeforeConfirmState(isLoading: true));
  
  final betslipVipCubit = GetIt.I<SportBetslipVipCubit>();
  await betslipVipCubit.verifyBetslips();
  
  emit(const VerifyBeforeConfirmState(isLoading: false));
  handelVisibleItem(true); // Enter confirm mode
}
```

**Screen Method:**
```dart
Future<void> _verifyAndEnterConfirmMode() async {
  showLoadingIndicator(); // "Verifying..."
  await cubit.verifyAndEnterConfirmMode();
  hideLoadingIndicator();
}
```

---

#### User Flow (After Fix):

```
┌─────────────────────────────────────────────────────────────────┐
│  User adds bets → Leaves betslip open for 2+ minutes            │
│                           ↓                                      │
│  Odds change on backend (user doesn't know)                     │
│                           ↓                                      │
│  User taps "Place Bet"                                          │
│                           ↓                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ NEW: verifyAndEnterConfirmMode() called                   │  │
│  │ • Shows "Verifying..." loading indicator                  │  │
│  │ • Calls Verify API                                        │  │
│  │ • Wraps changed odds in OddChangedCandidate               │  │
│  │ • Sets CandidateStatus.oddChanged                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           ↓                                      │
│  Confirm screen appears WITH odds change indicators ✅          │
│  • Arrow icons (↑/↓) show direction                             │
│  • Error banner shows "Odds have increased/decreased..."        │
│                           ↓                                      │
│  User can review and accept new odds                            │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Expected Behavior:

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| User leaves betslip open 2min, odds change | ❌ No indicator on confirm screen | ✅ Shows odds change indicator |
| Race closes while betslip open | ❌ Detected only on Place Bet API | ✅ Detected on first tap (via verify) |
| User re-opens betslip | ✅ Auto-verify on open | ✅ Still works (unchanged) |
| User modifies stake | ✅ Auto-verify on change | ✅ Still works (unchanged) |

---

#### Invalid Bet Blocking:

Only bets with these statuses are **blocked** from placement:
- `selectionNotFound`
- `raceNotFound`
- `betClosed`
- `unknownError`

The `oddChanged` status is **informational only** - users CAN still place the bet with updated odds.

---

**Related Business Rules:**
- See **BR-011**: Odds Display Rules with Provider/Promotion Changes
- See **BR-017**: Odds Change Indicator Visibility Control
- See **AC-004a**: Verify Betslip Before Entering Confirm Mode
- See **BR-022**: Verify Before Final Place Bet (below)

---

### BR-022: Verify Before Final Place Bet (Confirm Screen)

**Status:** ✅ Complete  
**Implemented:** June 20, 2025

**What this means:**
When a user taps "Confirm Bet" on the confirm screen, the system verifies odds again before executing the place bet. Based on the profile whitelist and odds direction, the system decides whether to proceed or keep the user in confirm mode.

**Problem Solved:**
Even after entering confirm mode, odds can continue to change. Without this verification:
- Users could place bets at unexpected prices
- The loop scenario (odds keep changing) wasn't handled
- Profile whitelist logic wasn't applied consistently

---

#### Decision Matrix:

| Profile in Whitelist | Odds Increased | Odds Decreased | Action |
|---------------------|----------------|----------------|--------|
| ✅ Yes | ✅ | ❌ | **STAY** (show new odds) |
| ✅ Yes | ❌ | ✅ | **STAY** (show new odds) |
| ✅ Yes | ✅ | ✅ | **STAY** (show new odds) |
| ❌ No | ✅ | ❌ | **CONTINUE** (user doesn't see indicator) |
| ❌ No | ❌ | ✅ | **STAY** (show new odds) |
| ❌ No | ✅ | ✅ | **STAY** (decreased takes priority) |
| Any | ❌ | ❌ | **CONTINUE** (no change) |

**Key Insight:** Users NOT in the whitelist don't see "Odds Increased" messages (per BR-017), so there's no point blocking them for price increases they can't see.

---

#### Implementation Details:

**Files Modified:**

| File | Changes |
|------|---------|
| `sport_place_bet_vip_cubit_state.dart` | Added `VerifyBeforeFinalPlaceBetState` |
| `sport_place_bet_vip_cubit.dart` | Added `verifyBeforeFinalPlaceBet()` and `_checkOddsChangedWithDirection()` |
| `sport_betslip_vip_screen.dart` | Updated `_onPlaceBet()`, added `_verifyAndPlaceBet()` |
| `acknowledge_odds_changes_use_case.dart` | UseCase to acknowledge seen odds changes |

**Cubit Method:**
```dart
Future<bool> verifyBeforeFinalPlaceBet() async {
  // 1. Acknowledge previously seen odds changes (updates baseline)
  await acknowledgeOddsChangesUseCase();
  
  // 2. Call verify API
  await sportBetslipVipCubit.verifyBetslipsUseCase();
  
  // 3. Refresh betslip data
  betslips = await fetchBetslipsUseCase();
  
  // 4. Check odds changed with direction
  final result = _checkOddsChangedWithDirection();
  
  // 5. Apply profile whitelist + direction logic
  if (!result.hasAnyOddsChanged) return true; // CONTINUE
  
  final isInWhitelist = fireStoreService.isProfileShowPriceIncrease(profile);
  
  if (isInWhitelist) {
    return false; // STAY for any change
  } else {
    return !result.hasDecreasedOdds; // STAY only if decreased
  }
}
```

---

#### User Flow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User on Confirm Screen                                                  │
│       │                                                                   │
│       └── Taps "Confirm Bet"                                             │
│               │                                                           │
│               ├── verifyBeforeFinalPlaceBet()                            │
│               │       │                                                   │
│               │       ├── 1. acknowledgeOddsChangesUseCase()             │
│               │       │       └── Updates baseline odds if any changed   │
│               │       │                                                   │
│               │       ├── 2. verifyBetslipsUseCase()                     │
│               │       │       └── Compares UPDATED baseline vs API       │
│               │       │                                                   │
│               │       ├── No NEW odds changed                            │
│               │       │       └── ✅ CONTINUE → Place Bet API            │
│               │       │                                                   │
│               │       └── NEW odds change detected                       │
│               │               │                                           │
│               │               ├── Profile IN whitelist                   │
│               │               │       └── ❌ STAY (any change)           │
│               │               │                                           │
│               │               └── Profile NOT in whitelist               │
│               │                       │                                   │
│               │                       ├── Decreased → ❌ STAY            │
│               │                       └── Only Increased → ✅            │
│               │                                                           │
│               └── User sees updated odds OR bet is placed                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

**Related Business Rules:**
- See **BR-017**: Odds Change Indicator Visibility Control
- See **BR-021**: Verify Before Confirm Mode
- See **BR-023**: Acknowledge Odds Changes Before Re-Verify
- See **AC-004b**: Verify Before Final Place Bet

---

### BR-023: Acknowledge Odds Changes Before Re-Verify

**Status:** ✅ Complete  
**Implemented:** June 20, 2025

**What this means:**
When a user has already seen an odds change and taps "Confirm Bet" again, the system acknowledges (accepts) the previously shown odds as the new baseline before calling the Verify API again. This prevents the user from being blocked repeatedly for the SAME odds change they've already seen.

**Problem Solved:**
Without acknowledgment:
1. User sees odds change 3.5 → 3.0, stays in confirm mode
2. User taps "Confirm Bet" again
3. System compares original odds (3.5) with current (3.0)
4. System thinks odds still changed → User stuck in infinite loop!

With acknowledgment:
1. User sees odds change 3.5 → 3.0, stays in confirm mode
2. User taps "Confirm Bet" again
3. System acknowledges 3.0 as new baseline (updates `selection.odds`)
4. System verifies → compares baseline (3.0) with API response (3.0)
5. No change detected → User proceeds to place bet

---

#### How `OddChangedCandidate` Works:

The `OddChangedCandidate` is a wrapper class that stores:
- `currentCandidate` - the original candidate with original `selection.odds`
- `preBoostOdds` - the new odds from verify API response
- `newOdds` - same as preBoostOdds (for display)

**The Problem:**
```dart
// OddChangedCandidate always compares selection.odds vs preBoostOdds
class OddChangedCandidate {
  final BetslipCandidate currentCandidate; // original odds: 3.5
  final double preBoostOdds;               // new odds: 3.0
  
  // This comparison will ALWAYS be true until selection.odds is updated
  bool get hasChanged => currentCandidate.selection.odds != preBoostOdds;
}
```

**The Fix (Acknowledge):**
```dart
Future<void> acknowledgeOddsChanges() async {
  for (candidate in betslip.candidates) {
    if (candidate is OddChangedCandidate) {
      // 1. Update the underlying selection.odds to match preBoostOdds
      candidate.currentCandidate.selection.odds = candidate.preBoostOdds;
      
      // 2. Unwrap back to original candidate type
      candidates[index] = candidate.currentCandidate;
    }
  }
}
```

---

#### Implementation Details:

**Files Created/Modified:**

| File | Purpose |
|------|---------|
| `acknowledge_odds_changes_use_case.dart` | UseCase to acknowledge odds changes |
| `secure_storage_betslip_store_service.dart` | Added `acknowledgeOddsChanges()` method |
| `bestslip_store_service_base.dart` | Added abstract method signature |
| `sport_vip_repository_base.dart` | Added method to interface |
| `authenticated_sport_vip_repository.dart` | Delegated to storage service |
| `sport_vip_repository.dart` | Delegated to storage service |
| `sport_vip_inject.dart` | Registered new use case |
| `sport_place_bet_vip_cubit.dart` | Added use case call in `verifyBeforeFinalPlaceBet()` |

**Flow Sequence:**
```
verifyBeforeFinalPlaceBet()
    │
    ├── 1. acknowledgeOddsChangesUseCase()
    │       │
    │       └── For each OddChangedCandidate:
    │           ├── Update selection.odds = preBoostOdds
    │           └── Unwrap to original candidate type
    │
    ├── 2. verifyBetslipsUseCase()
    │       │
    │       └── Call API, compare UPDATED baseline vs response
    │
    └── 3. _checkOddsChangedWithDirection()
            │
            └── Return hasIncreasedOdds, hasDecreasedOdds
```

---

#### Test Scenarios:

| # | Scenario | Initial State | Action | Expected Storage State | Expected Result |
|---|----------|---------------|--------|------------------------|-----------------|
| 1 | First verify, odds changed | `selection.odds=3.5` | Verify returns 3.0 | `OddChangedCandidate(preBoostOdds=3.0)` | Stay in confirm |
| 2 | Second verify, no new change | `OddChangedCandidate` | Acknowledge + Verify returns 3.0 | `original candidate(selection.odds=3.0)` | **Proceed** |
| 3 | Second verify, new change | `OddChangedCandidate` | Acknowledge + Verify returns 2.8 | `OddChangedCandidate(preBoostOdds=2.8)` | Stay in confirm |
| 4 | Multiple candidates mixed | 2 changed, 1 unchanged | Acknowledge + Verify | Only changed ones acknowledged | Correct handling |
| 5 | No odds change initially | Normal candidates | Acknowledge (no-op) + Verify | Unchanged | Proceed if no change |

---

**Related Business Rules:**
- See **BR-022**: Verify Before Final Place Bet
- See **AC-004b**: Verify Before Final Place Bet

---

### Verify Betslips API

**Endpoint:** `POST /v1/betslips/verifyBetslips`

**Purpose:** Validate all betslip selections, return current odds, check promotion eligibility, and identify errors before allowing bet placement.

---

**Request Structure:**
```json
{
  "singleItems": [
    {
      "selectionId": "123456",
      "legId": "race-leg-id",
      "type": "win",
      "category": "race",
      "stake": 10.00,
      "isUsedForMulti": false,
      "uniqueId": "candidate-unique-id",
      "boostCodes": ["promo-code-1"],
      "uuid": "promotion-uuid"
    }
  ],
  "multiItem": {
    "stake": 20.00,
    "boostCodes": ["multi-promo-code"],
    "uuid": "multi-promotion-uuid"
  },
  "exoticItems": [...],
  "srmItems": [...],
  "quaddieItems": [...]
}
```

**Request Building:**
- `LocalBetslip.getSingleItemsForVerify()` - Racing/Sport singles
- `LocalBetslip.getMultiItemForVerify()` - Multi bet (if 2+ singles marked `isUsedForMulti`)
- `LocalBetslip.getExoticItemsForVerify()` - Exotic bets
- `LocalBetslip.getSrmItemsForVerify()` - Same Race Multi bets
- `LocalBetslip.getQuaddieItemsForVerify()` - Quaddie bets

**Promotion Fields:**
- `boostCodes`: List of promotion codes applied to bet
- `uuid`: Promotion UUID linking all promotions for this bet
- **Note:** Bonus Cash does NOT send boost codes (see `promotion_docs.md`)

---

**Response Structure:**
```json
{
  "isValid": true,
  "errors": [],
  "singleBetslipModels": [
    {
      "uniqueId": "candidate-unique-id",
      "odds": 3.50,
      "stake": 10.00,
      "potentialReturn": 35.00,
      "boostModels": [
        {
          "id": "boost-id",
          "code": "promo-code-1",
          "type": "boost",
          "discountValue": 1.5
        }
      ],
      "errors": []
    }
  ],
  "multiBetslipModel": {...},
  "exoticBetslipModels": [...],
  "srmBetslipModels": [...],
  "quaddieBetslipModels": [...]
}
```

**Response Fields:**
- `isValid`: Overall betslip validity
- `errors`: Global errors affecting entire betslip
- Per-bet models: Updated odds, errors, promotion status

---

**Integration Flow:**

1. **Trigger Event:** User adds, removes, or modifies betslip
2. **Build Request:** `LocalBetslip.getXxxItemsForVerify()` methods called
3. **API Call:** `AuthenticatedSportVipRepository.verifyBetslips()` executes HTTP request
4. **Logging:** Request payload logged for debugging (see repository code)
5. **Response Received:** Backend returns validation results
6. **Process Response:** `handleResponseAfterVerify()` updates betslip
   - Update odds for each candidate
   - Mark invalid promotions (converted to `InvalidPromotionInfo`)
   - Store error messages per candidate
   - Update potential returns
7. **Update Storage:** `updateLocalBetslip()` persists changes
8. **Update UI:** Cubit emits new state, widgets rebuild

---

**Error Handling:**

| Error Type | Backend Code | Client Behavior |
|------------|--------------|-----------------|
| Invalid Selection | `SELECTION_NOT_AVAILABLE` | Show error on candidate, disable Place Bet |
| Odds Changed | `ODDS_CHANGED` | Show warning, require user acceptance |
| Invalid Promotion | `INVALID_BOOST_CODE` | Remove promotion from candidate, show notification |
| Insufficient Balance | `INSUFFICIENT_BALANCE` | Show error globally, disable Place Bet |
| Network Error | N/A | Show retry option, keep betslip intact |

---

**Cross-References:**
- `promotion_docs.md` - Promotion verification details
- `quaddie_docs.md` - Quaddie verification specifics
- `same_race_multi_rules.md` - SRM verification and quote API

---

### Place Bet API

**Endpoint:** `POST /v1/betslips/placeBet`

**Purpose:** Submit final wager, debit user balance, create transaction records, and return bet confirmation.

---

**Request Structure:**
```json
{
  "singleItems": [...],
  "multiItem": {...},
  "exoticItems": [...],
  "srmItems": [...],
  "quaddieItems": [...],
  "currencyMethod": "cash"
}
```

**Request Building:**
- `LocalBetslip.getSingleItemsForPlaceBet()` - Singles
- `LocalBetslip.getMultiItemForPlaceBet()` - Multi
- `LocalBetslip.getExoticItemsForPlaceBet()` - Exotics
- `LocalBetslip.getSrmItemsForPlaceBet()` - SRMs
- `LocalBetslip.getQuaddieItemsForPlaceBet()` - Quaddies
- `LocalBetslip._getCurrencyMethod()` - Returns "bonus" if Bonus Cash active, else "cash"

**Currency Method Logic:**
```dart
String _getCurrencyMethod() {
  // Check all candidates for BONUS_CASH promotion
  for (final candidate in candidates) {
    for (final linkedPromo in candidate.linkedPromotions) {
      if (linkedPromo.type == PromotionType.bonusCash) {
        return 'bonus';
      }
    }
  }
  return 'cash';
}
```

---

**Response Structure:**
```json
{
  "success": true,
  "transactionId": "txn-12345",
  "betDetails": [
    {
      "betId": "bet-001",
      "status": "placed",
      "stake": 10.00,
      "potentialReturn": 35.00
    }
  ]
}
```

---

**Integration Flow:**

1. **Pre-flight Check:** Ensure betslip is verified and valid
2. **Build Request:** `LocalBetslip.getXxxItemsForPlaceBet()` methods called
3. **Set Currency Method:** `_getCurrencyMethod()` determines payment type
4. **API Call:** `AuthenticatedSportVipRepository.placeBet()` executes HTTP request
5. **Logging:** Request payload logged for debugging
6. **Response Received:** Backend returns transaction results
7. **Success Path:**
   - Convert response to `PlaceBetEntity`
   - Clear betslip via `clearBetslip()`
   - Show confirmation UI with transaction details
   - Clear all promotion data
8. **Error Path:**
   - Parse error message
   - Display error to user
   - Keep betslip intact for retry/corrections

---

**Error Handling:**

| Error Type | Backend Response | Client Behavior |
|------------|------------------|-----------------|
| Odds Changed | `ODDS_CHANGED_ERROR` | Re-verify, show odds change warning |
| Insufficient Balance | `INSUFFICIENT_BALANCE` | Show error, prevent placement |
| Validation Failed | `VALIDATION_ERROR` | Show specific validation message |
| Network Timeout | HTTP timeout | Show retry option, keep betslip |
| Server Error | HTTP 500 | Show generic error, contact support link |

---

**Success Metrics:**
- 99.9% success rate for valid bets
- < 2s response time
- Transaction ID always returned on success

---

## 🏗️ Technical Architecture

### Domain Layer (Business Logic)

#### Models

**LocalBetslip** (`lib/core/services/betslip_store_service/models/local_betslip.dart`)

**Purpose:** Core data model holding all betslip candidates and multi promotion data.

**Key Fields:**
```dart
class LocalBetslip {
  final List<BetslipCandidate> candidates;
  final String? multiPromotionUuid;           // Multi bet promotion UUID
  final List<MultiLinkedPromotion> multiLinkedPromotions;  // Multi bet promotions
  
  // ... other fields
}
```

**Key Methods:**
- **API Payload Builders (Verify):**
  - `getSingleItemsForVerify()` - Racing/Sport singles
  - `getMultiItemForVerify()` - Multi bet
  - `getExoticItemsForVerify()` - Exotics
  - `getSrmItemsForVerify()` - SRMs
  - `getQuaddieItemsForVerify()` - Quaddies

- **API Payload Builders (Place Bet):**
  - `getSingleItemsForPlaceBet()` - Singles
  - `getMultiItemForPlaceBet()` - Multi
  - `getExoticItemsForPlaceBet()` - Exotics
  - `getSrmItemsForPlaceBet()` - SRMs
  - `getQuaddieItemsForPlaceBet()` - Quaddies

- **Utility Methods:**
  - `_getCurrencyMethod()` - Returns "bonus" if Bonus Cash active, else "cash"
  - `toJson()` / `fromJson()` - Serialization for storage

**Promotion Integration:**
- `multiPromotionUuid`: Shared UUID for all multi bet promotions
- `multiLinkedPromotions`: List of promotion details for multi bet
- See `promotion_docs.md` for multi promotion details

---

**BetslipCandidate** (`lib/core/services/betslip_store_service/models/betslip_candidate.dart`)

**Purpose:** Sealed class representing individual bets with polymorphic behavior.

**Hierarchy:**
```dart
sealed class BetslipCandidate {
  final String id;
  final Selection selection;
  final String? promotionUuid;                    // Single bet promotion UUID
  final List<IPromotionInfo> linkedPromotions;    // Single bet promotions
  final ErrorMetadata? errorMetadata;             // Verification errors
  
  // ... other shared fields
}
```

**Concrete Implementations:**
1. `RacingSingleBetslipCandidate` - Racing Win/Place bets
2. `SportSingleBetslipCandidate` - Sport outcome bets
3. `ExoticBetslipCandidate` - Quinella, Exacta, Trifecta, First Four
4. `SameRaceMultiBetslipCandidate` - SRM bets (see `same_race_multi_rules.md`)
5. `QuaddieBetslipCandidate` - Quaddie bets (see `quaddie_docs.md`)
6. `MultiCandidate` - Internal representation for multi bets
7. `OddChangedCandidate` - Wrapper for odds change detection

**Factory Method:**
```dart
factory BetslipCandidate.fromJson(Map<String, dynamic> json) {
  // Type detection logic
  // Returns appropriate concrete type
}
```

**Promotion Fields:**
- `promotionUuid`: Links all promotions for this single bet
- `linkedPromotions`: List of `IPromotionInfo` objects (see `promotion_docs.md`)

---

#### Use Cases

**GetSportBetslipVipUseCase** (`lib/features/sport_betslip_vip/domain/useCases/get_sport_betslip_vip_use_case.dart`)

**Purpose:** Orchestrate betslip business logic operations.

**Key Methods:**

- `fetchBetslips()` → `LocalBetslip`
  - Loads betslip from storage
  - Returns current betslip state

- `verifyBetslips()` → `void`
  - Triggers verify API call
  - Updates betslip with response

- `removeBetslip(String id)` → `void`
  - Removes single candidate
  - Unlinks promotions (see BR-004)
  - Updates storage

- `removeAllBetslips()` → `void`
  - Clears entire betslip
  - Bulk unlinks all promotions
  - Resets storage

- `changeStakeForBetslip(String id, double stake)` → `void`
  - Updates stake for specific candidate type
  - Delegates to type-specific methods

**Type-Specific Stake Updates:**
- `updateStakeForSingle(id, stake)` - Racing/Sport singles
- `updateStakeForMulti(stake)` - Multi bet
- `updateStakeForExotic(id, stake)` - Exotic bets
- `updateStakeForSrm(id, stake)` - SRM bets
- `updateStakeForQuaddie(id, stake)` - Quaddie bets

**Dependencies:**
- `ISportVipRepository` - Data access

---

**CalculateStatsUseCase**

**Purpose:** Calculate betslip statistics (total stake, potential return, etc.)

---

**UpdateOddsUseCase**

**Purpose:** Handle odds updates for singles and multi bets

**Variants:**
- `UpdateOddsForSingleUseCase` - Update individual single odds
- `UpdateOddsForMultiUseCase` - Recalculate multi odds

---

**Cross-References:**
- `promotion_docs.md` - UnlinkPromotionUseCase integration
- `quaddie_docs.md` - Quaddie-specific use cases
- `same_race_multi_rules.md` - SRM-specific validations

---

### Data Layer (Repository & Storage)

#### Repository

**AuthenticatedSportVipRepository** (`lib/features/sport_vip/data/repositories/authenticated_sport_vip_repository.dart`)

**Implements:** `ISportVipRepository`

**Purpose:** Handle API calls for betslip operations with detailed logging.

**Key Methods:**

**`verifyBetslips()` → `Future<void>`**
```dart
Future<void> verifyBetslips() async {
  final betslip = await betslipStoreService.getBetslip();
  
  // Build request from LocalBetslip
  final response = await _apiClient.request<APIResponse<VerifyBetslips>>(
    option: BetslipsRouteApiRoutesGenerated.verifyBetslips(
      singleItems: betslip.getSingleItemsForVerify(),
      multiItem: betslip.getMultiItemForVerify(),
      exoticItems: betslip.getExoticItemsForVerify(),
      srmItems: betslip.getSrmItemsForVerify(),
      quaddieItems: betslip.getQuaddieItemsForVerify(),
    ),
  );
  
  // Process response
  await handleResponseAfterVerify(response);
}
```

**Logging:**
- Request payload logged for debugging
- Promotion data logged separately for visibility
- Errors logged with full context

---

**`placeBet()` → `Future<PlaceBetEntity>`**
```dart
Future<PlaceBetEntity> placeBet() async {
  final betslip = await betslipStoreService.getBetslip();
  
  final response = await _apiClient.request<APIResponse<PlaceBet>>(
    option: BetslipsRouteApiRoutesGenerated.placeBet(
      singleItems: betslip.getSingleItemsForPlaceBet(),
      multiItem: betslip.getMultiItemForPlaceBet(),
      exoticItems: betslip.getExoticItemsForPlaceBet(),
      srmItems: betslip.getSrmItemsForPlaceBet(),
      quaddieItems: betslip.getQuaddieItemsForPlaceBet(),
      currencyMethod: betslip._getCurrencyMethod(),
    ),
  );
  
  return PlaceBetEntity.fromResponse(response);
}
```

---

**`addSelectionToCart()` → `Future<void>`**
- Adds candidate to betslip
- Automatically triggers verify API
- Returns updated betslip

---

**`removeBetslip(String id)` → `Future<void>`**
- Delegates to storage service
- Does NOT handle promotion unlinking (handled by Cubit)

---

**Dependencies:**
- `BetslipStoreService` - Storage operations
- `ApiClient` - HTTP requests

---

#### Storage Service

**SecureStorageBetslipStoreService** (`lib/core/services/betslip_store_service/secure_storage_betslip_store_service.dart`)

**Implements:** `BetslipStoreServiceBase`

**Purpose:** Persist betslip data in encrypted storage with thread-safe operations.

**Storage Mechanism:**
- **Backend:** FlutterSecureStorage (AES encryption)
- **Key:** `'local_betslip'`
- **Format:** JSON serialized `LocalBetslip`

**Thread Safety:**
```dart
class SecureStorageBetslipStoreService {
  final Lock _lock = Lock();  // From synchronized package
  
  Future<void> _saveBetslipToStorage(LocalBetslip betslip) async {
    await _lock.synchronized(() async {
      final json = betslip.toJson();
      await _secureStorage.write(
        key: 'local_betslip',
        value: jsonEncode(json),
      );
    });
  }
}
```

---

**Key Operations:**

**`addToBetslip(BetslipCandidate candidate)` → `Future<void>`**
- Adds candidate to betslip
- Persists to storage
- Thread-safe

---

**`removeFromBetslip(String id)` → `Future<void>`**
- Removes candidate by ID
- **Critical:** Clears `multiPromotionUuid` and `multiLinkedPromotions` if betslip becomes empty
- Updates storage

---

**`clearBetslip()` → `Future<void>`**
- Removes all candidates
- Clears multi promotion data
- Resets storage to empty betslip

---

**`updateLocalBetslip(LocalBetslip betslip)` → `Future<void>`**
- Replaces entire betslip
- Used after verify API to update odds/errors

---

**`getBetslip()` → `Future<LocalBetslip>`**
- Loads betslip from storage
- Deserializes JSON to `LocalBetslip`
- Includes data verification logging

---

**Data Verification:**
```dart
Future<LocalBetslip> _verifyStoredData() async {
  try {
    final jsonString = await _secureStorage.read(key: 'local_betslip');
    if (jsonString == null) return LocalBetslip.empty();
    
    final json = jsonDecode(jsonString);
    final betslip = LocalBetslip.fromJson(json);
    
    // Log verification
    logger.info('Betslip loaded: ${betslip.candidates.length} candidates');
    
    return betslip;
  } catch (e) {
    logger.error('Betslip deserialization failed', e);
    return LocalBetslip.empty();
  }
}
```

---

**Dependencies:**
- `FlutterSecureStorage` - Encrypted storage
- `synchronized` package - Lock for thread safety

---

### Architecture Pattern

```
┌─────────────────────────────────────────────────┐
│              Presentation Layer                 │
│  (Cubit + Screen + Widgets)                     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Domain Layer                       │
│  (Use Cases + Models + Business Logic)          │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Data Layer                         │
│  (Repository + Storage Service)                 │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         ▼               ▼
    ┌─────────┐    ┌──────────────┐
    │   API   │    │   Storage    │
    └─────────┘    └──────────────┘
```

---

### Key Flows

#### 1. Add Bet Flow
```
User taps selection
    ↓
ConvertToBetslipCandidateUseCase
    ↓
addToBetslip() [Storage Service]
    ↓
verifyBetslips() [Repository]
    ↓
Verify API call
    ↓
handleResponseAfterVerify()
    ↓
updateLocalBetslip() [Storage]
    ↓
UI updates with verified odds
```

---

#### 2. Remove Bet Flow
```
User taps remove button
    ↓
Cubit.removeBetslip(id)
    ↓
Check for linked promotions
    ↓
UnlinkPromotionUseCase (if needed)
    ↓
removeFromBetslip(id) [Storage Service]
    ↓
Check multi dissolution (⚠️ partial - see Known Issues)
    ↓
updateLocalBetslip() [Storage]
    ↓
Emit RemoveBetslipVipState
    ↓
UI updates
```

---

#### 3. Verify Flow
```
User changes betslip (add/remove/stake)
    ↓
Debounce trigger (300ms)
    ↓
GetSportBetslipVipUseCase.verifyBetslips()
    ↓
Build API request from LocalBetslip.getXxxItemsForVerify()
    ↓
Repository.verifyBetslips()
    ↓
POST /v1/betslips/verifyBetslips
    ↓
Response received
    ↓
handleResponseAfterVerify()
    - Update odds
    - Mark invalid promotions
    - Store errors
    ↓
updateLocalBetslip() [Storage]
    ↓
UI rebuilds with updated data
```

---

#### 4. Place Bet Flow
```
User taps "Place Bet"
    ↓
Validate betslip (all verified, stakes entered)
    ↓
Build API request from LocalBetslip.getXxxItemsForPlaceBet()
    ↓
Set currencyMethod (bonus or cash)
    ↓
Repository.placeBet()
    ↓
POST /v1/betslips/placeBet
    ↓
Response received
    ↓
Success:
    - Convert to PlaceBetEntity
    - clearBetslip() [Storage]
    - Show confirmation UI
    ↓
Error:
    - Parse error message
    - Display to user
    - Keep betslip intact
```

---

### Presentation Layer (UI & State Management)

#### Cubit

**SportBetslipVipCubit** (`lib/features/sport_betslip_vip/presentation/cubit/sport_betslip_vip_cubit.dart`)

**Extends:** `Cubit<BaseCubitState>`

**Purpose:** Manage betslip UI state and coordinate use case calls.

**Key Methods:**

**`init()` → `void`**
- Initialize betslip cubit
- Load betslip from storage
- Set initial state

---

**`removeBetslip(String id)` → `Future<void>`**
```dart
Future<void> removeBetslip(String betslipId) async {
  emit(RemoveBetslipVipState.loading());
  
  try {
    // Get current betslip
    final betslip = await _getSportBetslipVipUseCase.fetchBetslips();
    
    // Find candidate to remove
    final candidate = betslip?.candidates.firstWhere(
      (c) => c.id.toString() == betslipId,
    );
    
    // Unlink individual bet promotions
    if (candidate != null && candidate.linkedPromotions.isNotEmpty) {
      final usageIds = candidate.linkedPromotions
          .whereType<PromotionInfo>()
          .map((p) => p.usageId)
          .toList();
      
      await _unlinkPromotionUseCase.execute(usageIds: usageIds);
    }
    
    // TODO: Check for multi dissolution (Known Issue #1)
    // Should unlink multi promotions if removing causes < 2 singles
    
    // Remove from storage
    await _getSportBetslipVipUseCase.removeBetslip(betslipId);
    
    emit(RemoveBetslipVipState.success());
  } catch (e) {
    emit(RemoveBetslipVipState.error(e.toString()));
  }
}
```

---

**`removeAllBetslips()` → `Future<void>`**
```dart
Future<void> removeAllBetslips() async {
  emit(RemoveAllBetslipsVipState.loading());
  
  try {
    // Aggregate all promotion usage IDs
    final betslip = await _getSportBetslipVipUseCase.fetchBetslips();
    final allUsageIds = <String>[];
    
    // Single bet promotions
    for (final candidate in betslip?.candidates ?? []) {
      for (final promo in candidate.linkedPromotions) {
        if (promo is PromotionInfo) {
          allUsageIds.add(promo.usageId);
        }
      }
    }
    
    // Multi bet promotions
    final multiPromotions = await _getMultiLinkedPromotionsUseCase.call();
    for (final promo in multiPromotions) {
      if (promo is PromotionInfo) {
        allUsageIds.add(promo.usageId);
      }
    }
    
    // Bulk unlink
    if (allUsageIds.isNotEmpty) {
      await _unlinkPromotionUseCase.execute(usageIds: allUsageIds);
    }
    
    // Clear betslip
    await _getSportBetslipVipUseCase.removeAllBetslips();
    
    emit(RemoveAllBetslipsVipState.success());
  } catch (e) {
    emit(RemoveAllBetslipsVipState.error(e.toString()));
  }
}
```

---

**States:**
- `RemoveBetslipVipState` - Loading / Success / Error for remove bet
- `RemoveAllBetslipsVipState` - Loading / Success / Error for clear betslip

**Dependencies:**
- `GetSportBetslipVipUseCase` - Betslip operations
- `IUnlinkPromotionUseCase` - Promotion unlinking (see `promotion_docs.md`)
- `IGetMultiLinkedPromotionsUseCase` - Multi promotion retrieval

---

#### Screen

**SportBetslipVipScreen** (`lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart`)

**Purpose:** Main betslip UI as bottom sheet modal.

**Layout:**
- Header with title and Clear button
- Scrollable list of bet candidates
- Place Bet button (sticky bottom)

**State Listening:**
- BlocBuilder listens to `SportBetslipVipCubit`
- Rebuilds on state changes

**Key Methods:**

**`_buildMultiList(LocalBetslip betslip, bool isInReuseMode)`**
- Returns list of `MultiBetslipCandidate` for multi section display
- **Important:** Does NOT filter by `displayId` - all candidates in the multi combination should be displayed
- Multi visibility is controlled separately by `_buildMultiSection()` which checks `hasPlacedMulti` (via `multiDisplayId != null`)
- Leg count is derived from `data.length` and displayed as "{count} Leg Multi"

**Reuse Mode Considerations:**
- In reuse mode, the multi section displays ALL legs of the placed multi bet
- Legs are shown regardless of whether they were also placed as individual singles
- Example: User places multi (2 legs A+B) + single A only → multi section shows "2 Leg Multi"
- The `displayId` on individual candidates only indicates if that specific single was placed, NOT whether it's part of the multi

---

#### Widgets

**Bet Type Widgets:** Each candidate type has dedicated widget
- Location: `lib/features/sport_betslip_vip/presentation/widgets/`
- Displays bet details, stake input, odds, potential return
- Shows linked promotions (see `promotion_docs.md`)

---

**Clear Button:**
- Calls `cubit.removeAllBetslips()`
- Shows loading indicator during unlink
- Disabled during operations

---

**Place Bet Button:**
- **Authentication Check:** Shows sign-in prompt if user is unauthenticated
- Validates betslip before placing (stakes entered, verified successfully)
- Calls place bet use case
- Shows loading state
- Navigates to confirmation on success
- Displays errors if placement fails

---

### Dependency Injection

**File:** `lib/features/sport_betslip_vip/di/sport_betslip_vip_inject.dart`

**Registration:**
```dart
void injectSportBetslipVip() {
  // Use Cases
  getIt.registerFactory<GetSportBetslipVipUseCase>(
    () => GetSportBetslipVipUseCase(
      repository: getIt<ISportVipRepository>(),
    ),
  );
  
  getIt.registerFactory<UpdateOddsUseCase>(...);
  getIt.registerFactory<CalculateStatsUseCase>(...);
  
  // Cubit
  getIt.registerFactory<SportBetslipVipCubit>(
    () => SportBetslipVipCubit(
      getSportBetslipVipUseCase: getIt<GetSportBetslipVipUseCase>(),
      unlinkPromotionUseCase: getIt<IUnlinkPromotionUseCase>(),
      getMultiLinkedPromotionsUseCase: getIt<IGetMultiLinkedPromotionsUseCase>(),
    ),
  );
}
```

**Pattern:** Factory (new instance per request)

---

## 🧪 Testing Strategy

### Unit Tests

#### Domain Layer Tests
**Target Files:**
- `local_betslip_test.dart` - LocalBetslip model
- `betslip_candidate_test.dart` - BetslipCandidate polymorphism
- `get_sport_betslip_vip_use_case_test.dart` - Use case logic

**Test Cases:**
- ✅ LocalBetslip serialization (toJson/fromJson)
- ✅ API payload builders return correct structure
- ✅ Currency method logic (bonus vs cash)
- ✅ BetslipCandidate factory creates correct concrete type
- ✅ Use case operations (fetch, verify, remove, clear)
- ✅ Stake update methods for each bet type

---

#### Data Layer Tests
**Target Files:**
- `authenticated_sport_vip_repository_test.dart` - Repository
- `secure_storage_betslip_store_service_test.dart` - Storage service

**Test Cases:**
- ✅ Repository API calls with mocked HTTP client
- ✅ Response handling and entity conversion
- ✅ Error handling for network failures
- ✅ Storage service CRUD operations with mock FlutterSecureStorage
- ✅ Thread-safety with concurrent operations
- ✅ Data persistence and retrieval

---

#### Presentation Layer Tests
**Target Files:**
- `sport_betslip_vip_cubit_test.dart` - Cubit state tests
- Widget tests for each bet type widget

**Test Cases:**
- ✅ Cubit emits correct states for each operation
- ✅ removeBetslip unlinks promotions before removal
- ✅ removeAllBetslips bulk unlinks all promotions
- ✅ Widget displays correct data for each candidate type
- ✅ Stake input validation
- ✅ Error state displays

---

### Integration Tests

**Target Flows:**
1. **Add to Betslip → Verify → Place Bet**
   - Add selection to betslip
   - Verify API updates odds
   - Place bet clears betslip on success

2. **Promotion Integration**
   - Apply promotion to bet
   - Remove bet unlinks promotion
   - Clear betslip bulk unlinks all
   - See `promotion_docs.md` for promotion-specific tests

3. **Multi Bet Scenarios**
   - Add 2+ singles
   - Convert to multi
   - Apply multi promotion
   - Remove singles checks dissolution (⚠️ test exists, implementation missing)

4. **Error Handling**
   - Network timeout retries
   - Odds changed warning
   - Insufficient balance error
   - Invalid promotion removal

---

### Test Coverage Goals

| Layer | Target Coverage |
|-------|----------------|
| Domain | 90%+ |
| Data | 85%+ |
| Presentation | 80%+ |
| Overall | 85%+ |

---

### Testing Tools

- `flutter_test` - Unit and widget tests
- `mocktail` - Mocking dependencies
- `bloc_test` - Testing Cubit states
- `integration_test` - End-to-end flows

---

## 🐛 Known Issues & TODOs

### Issue #1: Multi Bet Dissolution Not Unlinking Multi Promotions

**Severity:** High  
**Status:** ⚠️ Not Implemented  
**Reported:** November 12, 2025

---

**Description:**
When removing individual bets from a multi bet causes the multi to dissolve (fewer than 2 singles remaining), the multi promotion is NOT unlinked via the bulk unlink API. This leaves orphaned promotion usage records on the backend.

**Affected Code:**
- `lib/features/sport_betslip_vip/presentation/cubit/sport_betslip_vip_cubit.dart`
- Method: `removeBetslip(String betslipId)`

---

**Current Behavior:**
```dart
// Current implementation only unlinks individual bet promotions
if (candidate != null && candidate.linkedPromotions.isNotEmpty) {
  final usageIds = candidate.linkedPromotions
      .whereType<PromotionInfo>()
      .map((p) => p.usageId)
      .toList();
  
  await _unlinkPromotionUseCase.execute(usageIds: usageIds);
}

// Missing: Check for multi dissolution and unlink multi promotions
```

---

**Expected Behavior:**
1. User has multi bet with 2 singles (Single A + Single B)
2. Multi bet has a promotion applied
3. User removes Single A
4. Only 1 single remains → Multi dissolves
5. **SHOULD:** Unlink multi promotion before removing Single A
6. **CURRENTLY:** Multi promotion remains linked on backend

---

**Proposed Fix:**
```dart
Future<void> removeBetslip(String betslipId) async {
  emit(RemoveBetslipVipState.loading());
  
  try {
    final betslip = await _getSportBetslipVipUseCase.fetchBetslips();
    final candidate = betslip?.candidates.firstWhere(
      (c) => c.id.toString() == betslipId,
    );
    
    // Unlink individual bet promotions
    if (candidate != null && candidate.linkedPromotions.isNotEmpty) {
      final usageIds = candidate.linkedPromotions
          .whereType<PromotionInfo>()
          .map((p) => p.usageId)
          .toList();
      
      await _unlinkPromotionUseCase.execute(usageIds: usageIds);
    }
    
    // NEW: Check for multi dissolution
    final remainingCandidates = betslip?.candidates
        .where((c) => c.id.toString() != betslipId)
        .toList() ?? [];
    
    if (remainingCandidates.length < 2 && betslip != null) {
      // Get multi linked promotions
      final multiLinkedPromotions = await _getMultiLinkedPromotionsUseCase.call();
      
      if (multiLinkedPromotions.isNotEmpty) {
        final List<String> multiUsageIds = [];
        for (final linkedPromo in multiLinkedPromotions) {
          if (linkedPromo is PromotionInfo) {
            multiUsageIds.add(linkedPromo.usageId);
          }
        }
        
        if (multiUsageIds.isNotEmpty) {
          await _unlinkPromotionUseCase.execute(usageIds: multiUsageIds);
        }
      }
    }
    
    // Continue with removal
    await _getSportBetslipVipUseCase.removeBetslip(betslipId);
    
    emit(RemoveBetslipVipState.success());
  } catch (e) {
    emit(RemoveBetslipVipState.error(e.toString()));
  }
}
```

---

**Testing Requirements:**
1. Unit test for `removeBetslip()` with multi dissolution scenario
2. Integration test: Add 2 singles → Apply multi promotion → Remove 1 single → Verify unlink called
3. Verify backend state after dissolution (no orphaned promotions)

---

**Priority:** High - Affects promotion usage tracking  
**Estimated Effort:** 2-3 hours  
**Assigned To:** TBD

---

**See Also:** `promotion_docs.md` - Scenario 5: Multi Bet Dissolution

---

## 📊 Traceability Matrix

| Requirement | User Story | Acceptance Criteria | Implementation | Test Coverage |
|-------------|-----------|---------------------|----------------|---------------|
| Add to betslip | US-001 | AC-001 | `GetSportBetslipVipUseCase` | ✅ Unit + Integration |
| Auto-verify on add | US-003 | AC-004 | `AuthenticatedSportVipRepository.verifyBetslips()` | ✅ Unit + Integration |
| Auto-open betslip | US-001 | AC-001 | `SportBetslipVipCubit.init()` | ✅ Widget |
| Remove from betslip | US-002 | AC-002 | `SportBetslipVipCubit.removeBetslip()` | ✅ Unit + Integration |
| Unlink promotions on remove | US-005 | AC-002 | `UnlinkPromotionUseCase` integration | ⚠️ Partial (Issue #1) |
| Clear betslip | US-002 | AC-003 | `SportBetslipVipCubit.removeAllBetslips()` | ✅ Unit + Integration |
| Bulk unlink on clear | US-005 | AC-003 | Promotion aggregation + bulk unlink | ✅ Unit + Integration |
| Verify on changes | US-003 | AC-004 | Auto-verify trigger + debounce | ✅ Integration |
| Place bet | US-004 | AC-005 | `AuthenticatedSportVipRepository.placeBet()` | ✅ Unit + Integration |
| Clear on success | US-004 | AC-005 | Post-success overlay cleanup | ✅ Integration |
| Apply promotions | US-005 | See promotion_docs | `PromotionsCubit` integration | ✅ See promotion_docs |
| Multi combinations | Implicit | BR-001, BR-002 | `canCombineToMulti()` validation | ✅ Integration |
| Stake validation | Implicit | BR-008 | Input validation + backend | ✅ Unit + Widget |
| Secure storage | Implicit | N/A | `SecureStorageBetslipStoreService` | ✅ Unit |
| Thread safety | Implicit | N/A | `Lock` in storage service | ✅ Unit |
| **Reuse Mode - Transform to Reuse Screen** | US-006 | AC-006 | `LocalBetslip.progressStatus`, `SportBetslipVipScreen` | ⏸️ Pending |
| **Reuse Mode - Blur Overlay Dialog** | US-006 | AC-007 | `BackdropFilter` wrapper, `show_dialog_place_bet_coodinator.dart` | ⏸️ Pending |
| **Reuse Mode - Success Overlay Cleanup** | US-006 | AC-007 | `BetPlacedSuccessOverlay`, `handlePostSuccessOverlayDismiss()` | ✅ Integration |
| **Reuse Mode - Reuse Selection Action** | US-006 | AC-008 | `SportPlaceBetVipCubit.handleReuseSelection()` | ⏸️ Pending |
| **Reuse Mode - My Bets Action** | US-006 | AC-009 | `SportPlaceBetVipCubit.handleMyBets()` | ⏸️ Pending |
| **Reuse Mode - New Selection in Reuse** | US-006 | AC-010 | `SecureStorageBetslipStoreService.addCandidate()` | ⏸️ Pending |
| **Betslip Progress Status Lifecycle** | US-006 | BR-014 | `BetslipProgressStatus` enum, `LocalBetslip.progressStatus` | ⏸️ Pending |
| **Verify Before Confirm Mode** | US-003 | AC-004a, BR-021 | `SportPlaceBetVipCubit.verifyAndEnterConfirmMode()` | ✅ Complete |
| **Verify Before Final Place Bet** | US-003, US-004 | AC-004b, BR-022 | `SportPlaceBetVipCubit.verifyBeforeFinalPlaceBet()` | ✅ Complete |
| **Acknowledge Odds Changes** | US-003, US-004 | BR-023 | `IAcknowledgeOddsChangesUseCase`, `acknowledgeOddsChanges()` | ✅ Complete |

---

## 📋 Changelog

### Version 1.0 (Current)
**Released:** TBD

**Features:**
- ✅ Core betslip functionality (add, remove, clear)
- ✅ 5 bet types support (Single Racing/Sport, Multi, Exotic, SRM, Quaddie)
- ✅ Verify API integration with auto-verify
- ✅ Place Bet API integration
- ✅ Promotion integration (single + multi promotions)
- ✅ Secure encrypted storage with FlutterSecureStorage
- ✅ Thread-safe operations with Lock
- ✅ Auto-open betslip configuration
- ✅ Stake management per bet type
- ✅ Error handling and display
- ✅ Odds change detection
- ✅ Dynamic "Add to Bet Slip" button behavior (BR-013)

**Bug Fixes:**
- ✅ Fixed "Add to Bet Slip" button incorrectly popping underlying screens (BR-013 - November 19, 2025)
  - Changed from `context.pop()` to `DraggableScrollableSheet.animateTo(0.0)` to properly close only the betslip modal
- ✅ Fixed odds change not detected when entering confirm mode (BR-021 - June 20, 2025)
  - Added `verifyAndEnterConfirmMode()` to call Verify API before showing confirm screen
  - Users now see odds change indicators when tapping Place Bet after leaving betslip idle
- ✅ Fixed odds change not verified when clicking Confirm Bet (BR-022 - June 20, 2025)
  - Added `verifyBeforeFinalPlaceBet()` with profile whitelist + odds direction logic
  - Users must acknowledge odds changes before placing bet (respects A/B test for price increases)
- ✅ Fixed repeated odds change blocking after acknowledgment (BR-023 - June 20, 2025)
  - Added `acknowledgeOddsChangesUseCase` to update baseline odds when user sees change
  - Second "Confirm Bet" tap now proceeds if no NEW odds changes occurred
  - Prevents infinite loop where user was stuck acknowledging same change repeatedly
- ✅ Fixed Multi leg count incorrect in Reuse Mode (BR-015 - June 2025)
  - **Problem:** In reuse mode, multi section showed "1 leg multi" instead of "2 legs multi" when user placed 2 racing bets as a multi but only entered stake for one single bet (not both)
  - **Root Cause:** `_buildMultiList()` in `sport_betslip_vip_screen.dart` incorrectly filtered candidates by `displayId` in reuse mode. Since `displayId` is only set for individually placed singles, legs that were only part of the multi (not placed as singles) were filtered out
  - **Fix:** Removed the filtering block in `_buildMultiList()` - multi section visibility is already controlled by `_buildMultiSection()` which checks `hasPlacedMulti` (via `multiDisplayId`). All multi legs should be displayed regardless of individual single placement status
  - **File:** `lib/features/sport_betslip_vip/presentation/screen/sport_betslip_vip_screen.dart` (lines 707-717)
- ✅ Fixed bets disappearing after "Reuse Selection" (BR-015 - June 2025)
  - **Problem:** After pressing "Reuse Selection" button, only some bets were visible (e.g., 1 of 2 racing bets displayed). The count header showed correct number but items were hidden.
  - **Root Cause:** `singleBetslipVisibleMap` (a presentation-layer visibility state) was not reset after reuse. When user originally pressed "Place Bet", `hideAllItemUnValid()` was called which sets visibility to `false` for candidates without stakes. After "Reuse Selection", this visibility map was never reset, causing candidates without stakes to remain hidden.
  - **Fix:** Added `forceVisibleAllItem()` call in `onReuseSelection()` method to reset visibility for all candidates before transitioning back to pending mode
  - **File:** `lib/features/sport_vip/presentation/cubit/sport_place_bet_vip_cubit/sport_place_bet_vip_cubit.dart` (in `onReuseSelection()` method)
  - **Layer:** Presentation Logic (UI visibility state management)

**Known Issues:**
- ⚠️ Issue #1: Multi bet dissolution not unlinking multi promotions

---

### Version 1.1 (In Progress)
**Target Release:** TBD  
**Status:** ⏳ In Progress

**New Features:**

#### Verify Before Confirm Mode (BR-021) ✅
- [x] **Stale Odds Detection (BR-021):** Proactively calls Verify API when user taps "Place Bet" before showing confirm screen. Detects odds changes, closed races, and invalid selections that occurred while betslip was idle.

#### Verify Before Final Place Bet (BR-022) ✅
- [x] **Confirm Screen Verification (BR-022):** Calls Verify API when user taps "Confirm Bet" on confirm screen. Applies profile whitelist + odds direction logic to decide whether to proceed or stay. Prevents placing bets at unexpected prices. Handles the "loop until stable" scenario.

#### Acknowledge Odds Changes (BR-023) ✅
- [x] **Baseline Odds Update (BR-023):** When user sees an odds change and taps "Confirm Bet" again, the system acknowledges the seen odds as the new baseline before re-verifying. Prevents users from being blocked repeatedly for the SAME odds change they already saw. Fixes the infinite loop bug where users couldn't proceed after acknowledging odds.

#### Reuse Mode (US-006)
- [ ] **Betslip Progress Status Lifecycle (BR-014):** New `BetslipProgressStatus` enum with `pending`, `confirm`, `reuse` states. Persisted in `LocalBetslip` for app restart survival. Maps to existing `isPressPlaceBet` ValueNotifier.

- [ ] **Reuse Mode Behavior (BR-015):** After successful bet placement, betslip transforms to "Reuse Screen" instead of clearing. Selections retained, success indicators per bet, disabled editing, "Reuse Selection" and "My Bets" buttons.

- [x] **Blur Overlay Success Dialog (BR-016):** Success dialog displayed with `BackdropFilter` blur effect. Auto-dismisses after 3 seconds.

- [ ] **Reuse Selection Action (AC-008):** Clears all stakes, returns `progressStatus` to `pending`, enables editing, shows Place Bet button.

- [ ] **My Bets Action (AC-009):** Clears all betslip candidates, closes screen, navigates to My Bets (`/mybet` route).

- [ ] **New Selection in Reuse Mode (AC-010):** Adding new selection while in reuse mode clears existing candidates, adds new selection, returns to `pending` mode.

**Improvements:**
- [ ] Fix Issue #1: Multi bet dissolution unlinking
- [ ] Enhanced error handling for network failures
- [ ] Performance optimization for large betslips (10+ candidates)
- [ ] Offline support for betslip viewing (read-only)
- [ ] Betslip history tracking

**Documentation Updates:**
- ✅ Added AC-004a: Verify Betslip Before Entering Confirm Mode
- ✅ Added AC-004b: Verify Before Final Place Bet (with test scenarios table)
- ✅ Added BR-021: Verify Before Confirm Mode (Stale Odds Detection)
- ✅ Added BR-022: Verify Before Final Place Bet (Confirm Screen)
- ✅ Added BR-023: Acknowledge Odds Changes Before Re-Verify
- ✅ Added US-006: Reuse Selections After Successful Bet
- ✅ Added AC-006 through AC-010: Reuse Mode acceptance criteria
- ✅ Added BR-014: Betslip Progress Status Lifecycle
- ✅ Added BR-015: Reuse Mode Behavior
- ✅ Added BR-016: Blur Overlay Success Dialog
- ✅ Updated UI/UX section with Reuse Screen layout
- ✅ Updated Navigation Flow with Reuse mode path
- ✅ Updated Traceability Matrix with new requirements

---

## 🔗 Cross-References

### Related Documentation

**Core Features:**
- `promotion_docs.md` - Promotion types, selection, compatibility rules, unlinking scenarios, multi promotions, Bonus Cash
- `quaddie_docs.md` - Quaddie bet type specifics, leg requirements, calculate/quote API
- `same_race_multi_rules.md` - SRM selection rules, quote API, flexi percentage, validations

**API Documentation:**
- `lib/core/api/api_routes/betslips_route/api_routes.json` - API route definitions

---

### Code References

**Core Implementation:**
- `lib/features/sport_betslip_vip/` - Presentation layer (Cubit, Screen, Widgets)
- `lib/core/services/betslip_store_service/` - Domain models (LocalBetslip, BetslipCandidate) and storage
- `lib/features/sport_vip/data/repositories/` - Data layer (Repository)

**Dependency Injection:**
- `lib/features/sport_betslip_vip/di/sport_betslip_vip_inject.dart`

**Related Features:**
- `lib/features/promotions/` - Promotion feature (see `promotion_docs.md`)
- `lib/features/quaddie/` - Quaddie feature (see `quaddie_docs.md`)
- `lib/features/same_race_multi/` - SRM feature (see `same_race_multi_rules.md`)

---

## 📝 Document Metadata

**Template Version:** 2.0  
**Document Version:** 1.1  
**Created:** November 12, 2025  
**Last Updated:** June 20, 2025  
**Author:** Development Team  
**Reviewers:** TBD  
**Approved By:** TBD

---

**Navigation:**
- Previous: [Promotion Documentation](promotion_docs.md)
- Next: [Quaddie Documentation](quaddie_docs.md)
- Index: [Documentation Index](README.md)
