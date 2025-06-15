import 'package:{{project_name}}/features/init/presentation/mixins/init_mixin.dart';

import '../../../../app_export.dart';

enum UserAuthState { loggedIn, loggedOut, unknown }

abstract class INavigationRedirectUseCase {
  final ISecureStorageService service;

  INavigationRedirectUseCase(this.service);

  Future<UserAuthState> getUserAuthState();
}

class NavigationRedirectUseCase extends INavigationRedirectUseCase
    with InitMixin {
  NavigationRedirectUseCase(super.service);

  @override
  Future<UserAuthState> getUserAuthState() async {
    try {
      final localUser = await service.getLocalUser();
      final isLoggedIn = localUser != null && localUser.apiUrl != null && localUser.apiUrl!.isNotEmpty;
      if (isLoggedIn) {
        return UserAuthState.loggedIn;
      } else {
        return UserAuthState.loggedOut;
      }
    }  catch (e) {
      service.removeUserData();
      return UserAuthState.loggedOut;
    }
  }
}
