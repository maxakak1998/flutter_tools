# Architecture Documentation


## Project Structure

```
lib/
├── main.dart                 # App entry point
├── core/                     # Shared infrastructure
│   ├── api/                 # Network layer
│   ├── services/            # Database, storage, connectivity
│   ├── routers/             # Navigation
│   └── theme/               # UI theming
├── features/                 # Business features
│   ├── meter_reading/       # Meter data collection
│   ├── add_customer/        # Customer management
│   ├── search_meter/        # Meter search
│   └── main_setup/          # Meter configuration
└── commons/                  # Shared utilities
```

### Feature Structure
Each feature follows this pattern:

```
features/meter_reading/
├── docs/                    # Feature documentation
│   ├── README.md           # Overview, purpose, dependencies
│   ├── api.md              # API endpoints (optional)
│   ├── flows.md            # User flows, business logic (optional)
│   └── decisions.md        # Feature-specific decisions (optional)
├── data/
│   └── repositories/        # Data access layer
│       ├── meter_reading_repository.dart         # Concrete implementation
├── domain/
│   ├── models/            # Entities domain models
│   ├── useCases/            # Business logic
│   └── repositories/        # Interfaces
├── application/             # Cross-feature coordination (optional)
│   └── orchestrators/       # Business logic orchestrators
├── presentation/
│   ├── cubit/               # State management
│   ├── coordinators/        # UI flow coordinators (optional)
│   └── screens/               # UI screens
│   └── widgets/               # Widgets (optional)
│   └── routes/               # Routes (optional)
└── meter_reading_inject.dart # Dependency injection
```

**Note:** 
- `docs/` - Feature documentation (README.md required, others as needed)
- `application/orchestrators/` - Add when feature needs to coordinate with other features
- `presentation/coordinators/` - Add when feature has complex UI navigation flows

### Feature Documentation Guidelines

The `docs/` folder contains feature-specific documentation:

| File | Purpose | Required |
|------|---------|----------|
| `README.md` | Feature overview, purpose, dependencies, quick start | ✅ Yes |
| `api.md` | API endpoints, request/response, error handling | If uses APIs |
| `flows.md` | User flows, state diagrams, business logic | For complex features |
| `decisions.md` | Architectural decisions specific to this feature | When non-obvious |

**README.md Template:**
```markdown
# [Feature Name]

## Overview
Brief description of what this feature does.

## Dependencies
- List other features this depends on
- External packages used

## Quick Start
How to use/test this feature.

## Related Docs
- [API Documentation](./api.md)
- [User Flows](./flows.md)
- [Cart Feature](../../cart/docs/README.md) (cross-reference example)
```

**Cross-Reference Pattern:**
```markdown
<!-- Link to other feature docs -->
See [Product Selection](../../product/docs/flows.md#selection) for details.
```

## Key Architecture Patterns

### 1. Repository Factory Pattern
Automatically switches between online and offline data sources:

```dart
class MeterReadingRepository implements IMeterReadingRepository {
  final IMeterReadingRepository onlineRepository;
  final IMeterReadingRepository offlineRepository;
  
  @override
  Future<MeterData?> getMeterData(String id) async {
    if (connectivityService.isOnline) {
      return await onlineRepository.getMeterData(id);  // API + Cache
    }
    return await offlineRepository.getMeterData(id);   // Local DB only
  }
}
```

### 2. Use Case Pattern  
Business logic separated from UI:

```dart
class GetMeterReadingUseCase {
  final IMeterReadingRepository repository;
  
  Future<MeterReading?> call(String meterId) async {
    final data = await repository.getMeterData(meterId);
    return _validateAndProcess(data);  // Business rules here
  }
}
```

### 3. State Management with Cubit
Reactive UI updates:

```dart
class MeterReadingCubit extends Cubit<MeterReadingState> {
  final GetMeterReadingUseCase getMeterReadingUseCase;
  
  Future<void> loadMeterReading(String meterId) async {
    emit(MeterReadingLoading());
    final result = await getMeterReadingUseCase.call(meterId);
    emit(MeterReadingLoaded(result));
  }
}
```

### 4. Orchestrator Pattern
**Location:** `application/` layer (Business logic layer)

**Purpose:** Coordinates multiple business operations across different features/services

**Characteristics:**
- Cross-feature coordination - manages workflows spanning multiple features
- Business logic orchestration - coordinates complex multi-step processes
- Service coordination - brings together multiple services/cubits
- Async workflows - handles sequential or parallel async operations

**Structure:**
```dart
// Abstract interface
abstract class IBetslipOrchestrator {
  Future<void> updateSelectionTypeWithPromotionSync({
    required SportPlaceBetVipCubit betslipCubit,
    required PromotionsCubit promotionsCubit,
    required String betslipId,
    required String selectionId,
    required String? selectionType,
  });
}

// Implementation coordinates multiple features
class BetslipOrchestrator implements IBetslipOrchestrator {
  @override
  Future<void> updateSelectionTypeWithPromotionSync({
    required SportPlaceBetVipCubit betslipCubit,
    required PromotionsCubit promotionsCubit,
    required String betslipId,
    required String selectionId,
    required String? selectionType,
  }) async {
    // Step 1: Update selection type in betslip feature
    await betslipCubit.updateSelectionTypeForSingleRacing(
      betslipId: betslipId,
      selectionId: selectionId,
      selectionType: selectionType,
    );

    // Step 2: Fetch updated betslip data
    await betslipCubit.fetchBetslips();

    // Step 3: Sync promotions feature with new state
    await promotionsCubit.refreshPromotionsSilently();
  }
}
```

**When to use Orchestrator:**
- ✅ Coordinating multiple features/services
- ✅ Complex business workflows (with/without UI)
- ✅ Cross-cutting concerns between domains
- ✅ Need to synchronize multiple state managers

**Examples in project:**
- `BetslipOrchestrator` - Coordinates betslip + promotions
- `NotificationOrchestrator` - Coordinates notifications + Firebase + deep linking
- `DepositFundsFlowOrchestrator` - Coordinates deposit flow with user data

### 5. Coordinator Pattern
**Location:** `presentation/coordinators/` or `presentation/application/` layer

**Purpose:** Coordinates UI-related concerns like navigation, dialogs, and user flows

**Characteristics:**
- UI coordination - manages navigation, dialogs, and screen transitions
- Presentation logic - handles user interaction flows
- Context-aware - often works with BuildContext for UI operations
- Simpler workflows - focused on single-feature UI flows

**Structure:**
```dart
// Abstract interface
abstract class ILoginCoordinator {
  void handleLoginSuccess(BuildContext context);
  void openAppSettings(BuildContext context);
}

// Implementation handles UI navigation and flows
class LoginCoordinator implements ILoginCoordinator {
  final MainAppCubit mainAppCubit;

  LoginCoordinator({required this.mainAppCubit});

  @override
  void handleLoginSuccess(BuildContext context) async {
    await mainAppCubit.getThemeInit();
    await mainAppCubit.fetchUserInfo();
    await mainAppCubit.updateAuthenticationState();
    
    // Navigate based on verification status
    if (mainAppCubit.currentUserNotifier.value?.isVerified ?? false) {
      HomeVipRoute().go(context);
      return;
    }
    VerificationRoute().go(context);
  }

  @override
  void openAppSettings(BuildContext context) async {
    context.pop();
    await AppSettings.openAppSettings(type: AppSettingsType.security);
    await mainAppCubit.getPreferredBiometricType();
  }
}
```

**When to use Coordinator:**
- ✅ Managing navigation flows
- ✅ Showing dialogs/bottom sheets/overlays
- ✅ User interaction flows within a feature
- ✅ Post-action UI transitions

**Examples in project:**
- `ShowDialogPlaceBetCoordinator` - Shows success/error dialogs after bet placement
- `LoginCoordinator` - Handles post-login navigation flows

### Orchestrator vs Coordinator Comparison

| Aspect | Orchestrator | Coordinator |
|--------|-------------|-------------|
| **Layer** | Application/Business | Presentation |
| **Scope** | Cross-feature | Single feature (UI) |
| **Concerns** | Business logic workflows | UI flows & navigation |
| **Dependencies** | Multiple Cubits/Services | BuildContext, UI widgets |
| **Complexity** | Complex multi-step processes | Simpler UI transitions |
| **File Location** | `application/` | `presentation/coordinators/` |

**Key Rule:**
- **Orchestrator** = "Backend-facing" business logic coordinator
- **Coordinator** = "Frontend-facing" UI flow manager

## Dependency Injection Setup

Uses **GetIt** service locator for dependency management:

```dart
// main.dart
void main() async {
  // 1. Register core services
  injectMainAppModule();
  
  // 2. Register all features
  injectMeterReadingModule();
  injectAddCustomerModule();
  // ... other features
  
  runApp(MyApp());
}

// Feature injection example
void injectMeterReadingModule() {
  final sl = GetIt.instance;
  
  // Repository (Factory function pattern - runtime params)
  sl.registerFactory<IMeterReadingRepository Function(String, String)>(
    () => (String userId, String storeId) => MeterReadingRepository(
      userId: userId,
      storeId: storeId,
      onlineRepository: MeterReadingOnlineRepository(),
      offlineRepository: MeterReadingOfflineRepository(),
    ),
  );
  
  // Use cases
  sl.registerFactory(() => GetMeterReadingUseCase(sl()));
  
  // Orchestrators (Business logic coordination)
  sl.registerFactory<IBetslipOrchestrator>(
    () => BetslipOrchestrator(),
  );
  
  // Coordinators (UI flow coordination)
  sl.registerFactory<ILoginCoordinator>(
    () => LoginCoordinator(mainAppCubit: sl<MainAppCubit>()),
  );
  
  // Cubit
  sl.registerFactory(() => MeterReadingCubit(sl()));
}
```

**Registration Guidelines:**
- Use `registerFactory` for Orchestrators (new instance per use)
- Use `registerFactory` for Coordinators (new instance per use)
- Use `registerFactory` for Repositories (no singleton - use Function pattern)
- Use `registerFactory` for UseCases (new instance per use)
- Use `registerFactory` for Cubits (new instance per screen)
