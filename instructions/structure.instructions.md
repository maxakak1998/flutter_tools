---
applyTo: '**'
---
# 🧠 Project Instructions for Copilot Agency

## 🧱 Architecture Overview

This project uses **Clean Architecture** with a **Feature-First** structure.

Each feature is self-contained with its own layers:

```
lib/
├── commons/               # Shared base utilities (e.g., base_cubit)
├── constants/             # Static constants and keys
├── core/                  # App-wide logic
│   ├── api/               # Network configuration, clients
│   ├── font/              # Font assets
│   ├── localization/      # Localization setup
│   ├── routers/           # Global route setup
│   ├── services/          # Shared services like SecureStorageService
│   └── theme/             # App-wide theme management
├── features/              # All business logic is grouped per feature
│   └── <feature_name>/    # e.g., home_page/
│       ├── data/          # Data sources, models, repository impls
│       ├── domain/        # Business logic (use cases, interfaces)
│       ├── presentation/  # UI layer (Cubit/Bloc, Pages, Widgets)
│       └── <feature>_inject.dart  # DI setup for the feature
```

---

## 🧭 Feature Structure Example

Example: `lib/features/home_page/`

```
home_page/
├── data/
│   └── repositories/
│       └── home_page_repository.dart
├── domain/
│   ├── models/
│   ├── repositories/
│   ├── services/
│   └── useCases/
│       └── get_home_page_use_case.dart
├── presentation/
│   ├── cubit/
│   ├── mixins/
│   ├── routes/
│   └── screen/
├── home_page_inject.dart
```



## 🧪 Cubit/Bloc Usage
- Use Cubit or Bloc for state management in the presentation layer.
- Each feature should have its own Cubit/Bloc for managing state.
- All cubits should extend from a base class in `lib/commons/base_cubit.dart` for consistency.
- Use `getIt` for dependency injection in your Cubit/Bloc.
- Ensure that your Cubit/Bloc is easily testable by injecting dependencies.

## 🤖 Copilot Agency Rules

- Always use **feature-based clean architecture**.
- Respect naming conventions and layer responsibilities.
- Do **not** put logic from `domain` inside `presentation` or `data` folders.
- When unsure, default to separation of concerns:  
  `data ↔ domain ↔ presentation`.
- Use `getIt` for dependency injection, ensuring features can be lazy-loaded if needed.
- When add new files, carefully follow the structure and naming conventions.
