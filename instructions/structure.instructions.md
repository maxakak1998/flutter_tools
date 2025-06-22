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
├── data/
│   └── repositories/        # Data access layer
│       ├── meter_reading_repository.dart         # Factory
│       ├── meter_reading_online_repository.dart  # API calls
│       └── meter_reading_offline_repository.dart # Local DB
├── domain/
│   ├── useCases/            # Business logic
│   └── repositories/        # Interfaces
├── presentation/
│   ├── cubit/               # State management
│   └── pages/               # UI screens
└── meter_reading_inject.dart # Dependency injection
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
  
  // Repository (Factory pattern)
  sl.registerLazySingleton<IMeterReadingRepository>(
    () => MeterReadingRepository(
      onlineRepository: MeterReadingOnlineRepository(),
      offlineRepository: MeterReadingOfflineRepository(),
    ),
  );
  
  // Use cases
  sl.registerFactory(() => GetMeterReadingUseCase(sl()));
  
  // Cubit
  sl.registerFactory(() => MeterReadingCubit(sl()));
}
```
