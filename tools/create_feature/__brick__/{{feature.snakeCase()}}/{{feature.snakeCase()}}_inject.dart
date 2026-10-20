import 'package:get_it/get_it.dart';

import 'data/repositories/{{feature.snakeCase()}}_repository.dart';
import 'domain/repositories/i_{{feature.snakeCase()}}_repository.dart';
import 'domain/use_cases/get_{{feature.snakeCase()}}_use_case.dart';

/// Repositories and use cases are factories (multi-tenant: the user is read at
/// runtime). The cubit is not registered: {{feature.pascalCase()}}Route creates it in a BlocProvider.
void inject{{feature.pascalCase()}}Module() {
  final sl = GetIt.instance;

  sl.registerFactory<I{{feature.pascalCase()}}Repository>(() => {{feature.pascalCase()}}Repository());
  sl.registerFactory<IGet{{feature.pascalCase()}}UseCase>(
    () => Get{{feature.pascalCase()}}UseCase(sl<I{{feature.pascalCase()}}Repository>()),
  );
}
