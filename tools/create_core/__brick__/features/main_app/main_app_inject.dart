// FILE: lib/features/auth/auth_inject.dart

import 'data/repositories/main_app_repository.dart';
import 'domain/repositories/main_app_repository_base.dart';
import 'domain/useCases/change_locale_to_use_case.dart';
import 'domain/useCases/get_main_app_use_case.dart';

import '../../../app_export.dart';

void injectMainAppModule() {
  final sl = GetIt.instance;

  sl.registerLazySingleton<IMainAppRepository>(() => MainAppRepository());

  sl.registerLazySingleton<IGetMainAppUseCase>(() => GetMainAppUseCase());

  sl.registerCachedFactory<IChangeLocaleToUseCase>(
    () => ChangeLocaleToUseCase(),
  );
  sl.registerCachedFactory<IChangeThemeUseCase>(() => ChangeThemeUseCase());
  sl.registerCachedFactory<LocaleService>(() => LocaleService());

  sl.registerSingleton(MainAppCubit());
  sl.registerSingleton(AppRouter());
  sl.registerSingleton(ManagerEnvService());

  sl.registerSingleton<ISecureStorageService>(SecureStorageService());
  sl.registerSingleton<ITheme>(NormalTheme());
  
 
}
