import 'manger_service_export.dart';

class FirebaseStorageEnvService extends BaseEnvService {
  late FirebaseStorage firebaseStorage;
  final Map<String, String> _assets = {};

  // late Directory directory;

  late Directory directory;

  @override
  Future<void> init(covariant BaseEnvOptions? options) async {
    final root = await getApplicationDocumentsDirectory();

    directory = await Directory("${root.path}/assets").create(recursive: true);
    firebaseStorage = FirebaseStorage.instance;

    await Future.wait<DownloadTask?>(
      _cacheList.map((e) async {
        try {
          return firebaseStorage
              .ref()
              .child("assets")
              .child(e)
              .writeToFile(File("${directory.path}$e"));
        } catch (e) {
          return null;
        }
      }),
    );
  }

  /// Use StorageAssets to get the asset names.
  List<String> get _cacheList => [];

  Future<String> getAsset(String name) async {
    if (name.trim().isEmpty == true) return "";
    final local = _assets[name];
    if (local != null) return local;

    final localFile = File("${directory.path}$name");
    String? data;
    if (await localFile.exists()) {
      data = localFile.path;
    } else {
      print(name);
      data =
          await firebaseStorage
              .ref()
              .child("assets")
              .child(name)
              .getDownloadURL();
    }
    if (data.isNotEmpty) {
      _assets[name] = data;
    }
    return data;
  }

  @override
  void dispose() {
    _assets.clear();
    super.dispose();
  }
}
