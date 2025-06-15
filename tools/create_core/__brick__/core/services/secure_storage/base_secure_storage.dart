import 'package:{{project_name}}/core/services/secure_storage/models/local_user.dart';

abstract class ISecureStorageService {
  Future<LocalUser?> getLocalUser();

  Future<void> saveLocalUser(LocalUser localUser);

  Future<void> removeUserData();

  Future<bool> getIsIndianUI();

  Future<void> setIsIndianUI(bool isIndianUI);

  Future<String?> getRememberedUsername();

  Future<String?> getRememberedPassword();

  Future<void> saveRememberedCredentials(String username, String password);

  Future<void> removeRememberedCredentials();
}
