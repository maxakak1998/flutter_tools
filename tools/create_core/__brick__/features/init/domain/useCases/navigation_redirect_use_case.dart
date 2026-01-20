import '../../../../app_export.dart';

enum UserAuthState { loggedIn, loggedOut, unknown }

abstract class INavigationRedirectUseCase {
  final ISecureStorageService service;

  INavigationRedirectUseCase(this.service);

  Future<UserAuthState> getUserAuthState();
}

class NavigationRedirectUseCase extends INavigationRedirectUseCase {
  NavigationRedirectUseCase(super.service);

  @override
  Future<UserAuthState> getUserAuthState() async {
    try {
      final localUser = await service.getLocalUser();
      final isLoggedIn =
          localUser != null &&
          localUser.apiUrl != null &&
          localUser.apiUrl!.isNotEmpty;
      if (isLoggedIn) {
        return UserAuthState.loggedIn;
      } else {
        return UserAuthState.loggedOut;
      }
    } catch (e) {
      service.removeUserData();
      return UserAuthState.loggedOut;
    }
  }
}
