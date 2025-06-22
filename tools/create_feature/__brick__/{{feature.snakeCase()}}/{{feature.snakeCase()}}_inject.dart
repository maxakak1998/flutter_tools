// FILE: lib/features/auth/auth_inject.dart

import 'data/repositories/{{feature.snakeCase()}}_repository.dart';
import 'domain/repositories/{{feature.snakeCase()}}_repository_base.dart';
import 'domain/useCases/get_{{feature.snakeCase()}}_use_case.dart';
import 'presentation/cubit/{{feature.snakeCase()}}_cubit.dart';

import '../../../app_export.dart';


void inject{{feature.pascalCase()}}Module() {
  final sl = GetIt.instance;

  // Repositories
  sl.registerLazySingleton<I{{feature.pascalCase()}}Repository>(() => {{feature.pascalCase()}}Repository());

}
