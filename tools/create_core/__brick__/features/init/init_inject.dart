// FILE: lib/features/auth/auth_inject.dart

import 'package:{{project_name}}/features/init/domain/useCases/navigation_redirect_use_case.dart';

import 'data/repositories/init_repository.dart';
import 'domain/repositories/init_repository_base.dart';
import 'domain/useCases/get_init_use_case.dart';
import 'presentation/cubit/init_cubit.dart';

import '../../../app_export.dart';

void injectInitModule() {
  final sl = GetIt.instance;

  // Repositories
  sl.registerLazySingleton<IInitRepository>(() => InitRepository());

  // UseCases
  sl.registerFactory<IGetInitUseCase>(() => GetInitUseCase());
  sl.registerFactory<INavigationRedirectUseCase>(
    () => NavigationRedirectUseCase(GetIt.I<ISecureStorageService>()),
  );

  // Cubit
  sl.registerSingletonIfAbsent(() => InitCubit());
}
