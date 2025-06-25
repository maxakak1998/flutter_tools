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
