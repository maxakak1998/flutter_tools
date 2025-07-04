
import 'data/repositories/main_app_repository.dart';
import 'domain/repositories/main_app_repository_base.dart';

import '../../../app_export.dart';
import 'domain/useCases/change_locale_to_use_case.dart';
import 'domain/useCases/get_main_app_use_case.dart';

void injectMainAppModule() {
  final sl = GetIt.instance;

  //Usecases
  sl.registerFactory<IGetMainAppUseCase>(() => GetMainAppUseCase());
  sl.registerFactory<IChangeThemeUseCase>(() => ChangeThemeUseCase());
  sl.registerFactory<IChangeLocaleToUseCase>(() => ChangeLocaleToUseCase());

  /// Repository
  sl.registerLazySingleton<IMainAppRepository>(() => MainAppRepository());

  sl.registerSingleton(AppRouter());
  sl.registerSingleton(ManagerEnvService());
  sl.registerSingleton<ISecureStorageService>(SecureStorageService());
  sl.registerSingleton<LocaleService>(LocaleService());

  sl.registerSingleton(
    MainAppCubit(
      changeThemeUserCase: sl.get<IChangeThemeUseCase>(),
      changeLocaleToUseCase: sl.get<IChangeLocaleToUseCase>(),
      localeService: sl.get<LocaleService>(),
    ),
  );
}
