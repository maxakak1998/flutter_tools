// FILE: lib/features/auth/auth_inject.dart

import 'data/repositories/main_app_repository.dart';
import 'domain/repositories/main_app_repository_base.dart';


import '../../../app_export.dart';

void injectMainAppModule() {
  final sl = GetIt.instance;

  sl.registerLazySingleton<IMainAppRepository>(() => MainAppRepository());

  sl.registerSingleton(MainAppCubit());
  sl.registerSingleton(AppRouter());
  sl.registerSingleton(ManagerEnvService());
  sl.registerSingleton<ISecureStorageService>(SecureStorageService());
  sl.registerSingleton<LocaleService>(LocaleService());
 
}
