---
applyTo: '**'
---


# 🧠 Instructions for Copilot How to Inject

**Use-case**
 1. Should use registerFactory from GetIt, dont use registerLazySingleton or singleton pattern.
 ```dart
   // UseCases
  sl.registerFactory<ISignInUseCase>(
    () => SignInUseCase(
      sl<ISignInRepository>(), 
      sl<ISecureStorageService>(),
      sl<ManagerEnvService>(),
    ),
  );
 ```
 2. Never inject UsecCase or Cubit via GetIt. The only cubit that can be injected is `MainAppCubit`.