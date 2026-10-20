# 0.2.0

- Output passes upcoz arch gate v2 with no new keys: `domain/use_cases/`, `presentation/screens/`,
  `domain/repositories/i_<name>_repository.dart`, `domain/models/<name>_entity.dart`, `<Name>CubitState`.
- No app-wide barrel imports; direct imports only.
- Repository and use case are `registerFactory`; the cubit is created by a `BlocProvider` in the route
  (no cubit in GetIt, no GetIt in the screen).
- Route mixin is `$<Name>Route` (current go_router_builder); `_$<Name>Route` failed to build.

# 0.1.0+1

- TODO: Describe initial release.
