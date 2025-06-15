import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:data_entry/core/services/secure_storage/base_secure_storage.dart';
import 'package:data_entry/core/services/secure_storage/models/local_user.dart';

class SecureStorageService implements ISecureStorageService {
  static String get userInfoKey => 'user_info';
  final storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  // Hardcoded values for testing/demo
  static const String hardcodedUsername = 'tam_testing';
  static const String hardcodedPassword = 'tam_testing';

  @override
  Future<LocalUser?> getLocalUser() =>
      storage.read(key: userInfoKey).then((value) {
        if (value == null) return null;
        return LocalUser.fromJson(jsonDecode(value, reviver: (_, __) => null));
      });

  @override
  Future<void> saveLocalUser(LocalUser localUser) async {
    final jsonString = jsonEncode(localUser.toJson());
    await storage.write(key: userInfoKey, value: jsonString);
  }

  @override
  Future<void> removeUserData() async {
    await storage.delete(key: userInfoKey);
  }

  @override
  Future<bool> getIsIndianUI() async {
    if(kDebugMode) return true; // For testing purposes, always return true
    final value = await storage.read(key: 'is_indian_ui');
    return value == 'true';
  }

  @override
  Future<void> setIsIndianUI(bool isIndianUI) async {
    await storage.write(key: 'is_indian_ui', value: isIndianUI.toString());
  }

  @override
  Future<String?> getRememberedUsername() async {
    return await storage.read(key: 'remember_username');
  }

  @override
  Future<String?> getRememberedPassword() async {
    return await storage.read(key: 'remember_password');
  }

  @override
  Future<void> saveRememberedCredentials(String username, String password) async {
    await storage.write(key: 'remember_username', value: username);
    await storage.write(key: 'remember_password', value: password);
  }

  @override
  Future<void> removeRememberedCredentials() async {
    await storage.delete(key: 'remember_username');
    await storage.delete(key: 'remember_password');
  }
}
