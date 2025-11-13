---
applyTo: '**'
---

# 🧠 Instructions for Copilot Agency for using UseCase

1. Always inject UseCase in injected file via GetIt using `sl.registerFactory` in the feature folder.
   ```dart
   sl.registerFactory<IYourUseCase>(
     () => YourUseCase(
       sl<Repository1>(),
       sl<Repository2>(),
     ),
   );
   ```
2. Each usecase will have at least one repository injected.
   ```dart
   class YourUseCase {
     final Repository1 _repository1;
     final Repository2 _repository2;

     YourUseCase(this._repository1, this._repository2);
   }
   ```
3. One usecase should only have one method due to Single Responsibility Principle (SRP).
   ```dart
   Future<ReturnType> call(ParamType param) async {
     // Business logic here
   }
   ```
4. Usecase should only contain business logic and not UI logic.
5. Usecase should return data to Cubit/Bloc for state management.