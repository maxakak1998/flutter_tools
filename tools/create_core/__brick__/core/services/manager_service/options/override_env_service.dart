
import '../manger_service_export.dart';

class OverrideEnvService extends BaseEnvService {
  @override
  Future<void> init(FirebaseEnvOptions? options) async {
    await Firebase.initializeApp();
    await FirebaseRemoteConfig.instance.ensureInitialized();
    await FirebaseRemoteConfig.instance.setConfigSettings(RemoteConfigSettings(
        fetchTimeout: const Duration(seconds: 30),
        minimumFetchInterval: const Duration(minutes: 5)));
    // FirebaseRemoteConfig.instance.onConfigUpdated.listen((event) async {
    //   await FirebaseRemoteConfig.instance.fetchAndActivate();
    // });
    await FirebaseRemoteConfig.instance.fetchAndActivate();
  }

  String? getOverrideFlavor(String currentFlavor) {
    try {
      return jsonDecode(FirebaseRemoteConfig.instance
          .getValue("override_env")
          .asString())[currentFlavor];
    } catch (_) {}
    return null;
  }
}
