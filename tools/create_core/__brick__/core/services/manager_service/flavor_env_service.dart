import 'manger_service_export.dart';

class FlavorEnvService extends BaseEnvService {
  late String flavor;

  String get flavorKey => "flavor";

  @override
  Future<void> init(ManagerEnvOptions options) async {
    final storage = await SharedPreferences.getInstance();
    String? localFlavor = storage.getString(flavorKey);
    print("localFlavor: $localFlavor");
    if (localFlavor == null || options.override) {
      await storage.setString(flavorKey, options.flavor);
      localFlavor = storage.getString(flavorKey);
    }

    flavor = localFlavor!;
  }

  Future<bool> switchFlavor(String newFlavor) async {
    if (flavor == newFlavor) return false;
    print("New flavor is $newFlavor");
    final storage = await SharedPreferences.getInstance();
    await storage.setString(flavorKey, newFlavor);
    flavor = newFlavor;
    return true;
  }
}
