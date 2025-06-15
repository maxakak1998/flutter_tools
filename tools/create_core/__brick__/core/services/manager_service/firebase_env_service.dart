import 'manger_service_export.dart';

class FirebaseEnvService extends BaseEnvService {
  late FireStoreService fireStoreService;
  late FirebaseAnalytics firebaseAnalytics;
  late FirebaseStorageEnvService firebaseStorageEnvService;

  Map<String, dynamic>? _remoteConfig;

  StreamSubscription<RemoteConfigUpdate>? remoteStream;

  @override
  Future<void> init(FirebaseEnvOptions options) async {
    await Firebase.initializeApp();
    final firebaseApp = Firebase.app();
    await FirebaseRemoteConfig.instance.ensureInitialized();
    firebaseAnalytics = FirebaseAnalytics.instanceFor(app: firebaseApp);
    if (kReleaseMode) {
      await firebaseAnalytics.setAnalyticsCollectionEnabled(true);
    }
    final remoteInstance = FirebaseRemoteConfig.instance;

    firebaseStorageEnvService = FirebaseStorageEnvService();
    firebaseStorageEnvService.init(options);
    _remoteConfig =
        jsonDecode(
              remoteInstance.getAll()[_getId(options.flavor)]?.asString() ?? "",
            )
            as Map<String, dynamic>?;

    fireStoreService = FireStoreService(
      firestore: FirebaseFirestore.instanceFor(
        app: firebaseApp,
        databaseId: _remoteConfig?[EnvKey.firestoreId],
      ),
      firebaseAuth: FirebaseAuth.instanceFor(app: firebaseApp),
    );
    await fireStoreService.init(options);
  }

  Future<String> getAsset(String name) =>
      firebaseStorageEnvService.getAsset(name);

  String _getId(String flavor) =>
      "${Platform.isAndroid ? "android" : "ios"}_$flavor";

  dynamic getConfigValue(String key) {
    return _remoteConfig?[key];
  }

  List<RemoteConfigValue> getAllFlavors() =>
      FirebaseRemoteConfig.instance
          .getAll()
          .entries
          .where(
            (element) => element.key.startsWith(
              Platform.isAndroid ? "android_" : "ios_",
            ),
          )
          .map((e) => e.value)
          .toList();

  @override
  void dispose() {
    firebaseStorageEnvService.dispose();
    remoteStream?.cancel();
    super.dispose();
  }
}
