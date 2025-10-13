import 'package:{{project_name}}/configs/flavors_values.g.dart';
import 'package:{{project_name}}/core/services/manager_service/options/manager_env_options.dart';

import '../../../../app_export.dart';
import 'init_cubit_state.dart';

class InitCubit extends Cubit<BaseCubitState> {
  final INavigationRedirectUseCase navigationRedirectUseCase;

  UserAuthState userAuthState = UserAuthState.unknown;

  InitCubit(this.navigationRedirectUseCase) : super(InitInitState());

  Future<void> initPreData() async {
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final ManagerEnvService envService = GetIt.I<ManagerEnvService>();
    envService.init(ManagerEnvOptions(flavor: FlavorValues.flavor));
    userAuthState = await navigationRedirectUseCase.getUserAuthState();
    switch (userAuthState) {
      case UserAuthState.loggedIn:
        break;
      case UserAuthState.loggedOut:
        break;
      case UserAuthState.unknown:
        break;
    }
    emit(UserAuthStateChanged(id: id, state: EventState.succeed));
  }
}
