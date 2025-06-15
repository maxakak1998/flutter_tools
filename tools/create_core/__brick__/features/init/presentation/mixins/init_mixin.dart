import 'package:{{project_name}}/core/services/manager_service/base_env_service.dart';
import 'package:{{project_name}}/features/init/presentation/cubit/init_cubit.dart';

import '/..../../../app_export.dart';
import '../../domain/repositories/init_repository_base.dart';

mixin InitMixin {
  IInitRepository get initRepository => GetIt.I<IInitRepository>();

  INavigationRedirectUseCase get navigationRedirectUseCase =>
      GetIt.I<NavigationRedirectUseCase>();

  ManagerEnvService get env => GetIt.I<ManagerEnvService>();

  InitCubit get initCubit => GetIt.I<InitCubit>();

}
