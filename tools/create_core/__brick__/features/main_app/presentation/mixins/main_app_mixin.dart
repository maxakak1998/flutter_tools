import 'package:data_entry/features/main_app/domain/useCases/change_locale_to_use_case.dart';

import '/..../../../app_export.dart';
import '../../domain/repositories/main_app_repository_base.dart';

mixin MainAppMixin {
  IMainAppRepository get mainAppRepository => GetIt.I<IMainAppRepository>();

  MainAppCubit get mainAppCubit => GetIt.I();

  LocaleService get localeService => GetIt.I();

  IChangeThemeUseCase get changeThemeUserCase => GetIt.I<ChangeThemeUseCase>();

  IChangeLocaleToUseCase get changeLocaleToUseCase =>
      GetIt.I<ChangeLocaleToUseCase>();

  AppRouter get router => GetIt.I();
}
