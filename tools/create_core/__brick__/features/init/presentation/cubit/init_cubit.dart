import 'package:data_entry/configs/flavors_values.g.dart';
import 'package:data_entry/core/services/manager_service/options/manager_env_options.dart';

import '../../../../app_export.dart';
import 'init_cubit_state.dart';

class InitCubit extends Cubit<BaseCubitState> {
  UserAuthState userAuthState = UserAuthState.unknown;

  InitCubit() : super(InitInitState());

  Future<void> initPreData() async {
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final ManagerEnvService envService = GetIt.I<ManagerEnvService>();
    envService.init(ManagerEnvOptions(
      flavor: FlavorValues.flavor,
    ));
    userAuthState =
        await GetIt.I<INavigationRedirectUseCase>().getUserAuthState();
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
