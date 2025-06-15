import 'package:data_entry/core/api/api_response/restful/api_response.dart';
import 'package:data_entry/core/api/api_routes/main_route/api_routes_generated.dart';
import 'package:data_entry/core/api/api_clients/api_client.dart';
import 'package:data_entry/core/services/manager_service/manager_env_service.dart';
import 'package:data_entry/features/detail_meter/domain/models/dropdown_item.dart';
import 'package:get_it/get_it.dart';

class MetaDataService {
  MetaData? _metaData;

  Future<void> fetchAndCacheMetaData() async {
    final APIClient apiClient = GetIt.I<ManagerEnvService>().apiClient;
    final response = await apiClient.request<APIResponse<MetaData>>(
      option: MainRouteApiRoutesGenerated.metaData(),
      create:
          (res) => APIResponse<MetaData>(
            originalResponse: res,
            decodedData: MetaData.fromJson(res.data ?? {}),
          ),
    );
    _metaData = response.decodedData;
  }

  String? getServiceTypeName(String? id) {
    if (_metaData?.serviceType == null || id == null) return null;
    final data = _metaData!.serviceType!
        .firstWhere(
          (e) => e.ID == id,
          orElse: () => MetaDataServiceType(ID: id, Name: null),
        )
        .Name;
    return data?.trim();
  }

  List<DropdownItem> getBPNumbers() {
    if (_metaData?.BPNumbers == null) return [];
    final items = _metaData!.BPNumbers!
        .map((bpNumber) => DropdownItem(
              id: bpNumber.ID ?? '',
              title: bpNumber.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getManufacturers() {
    if (_metaData?.Manufactures == null) return [];
    final items = _metaData!.Manufactures!
        .map((manufacturer) => DropdownItem(
              id: manufacturer.ID ?? '',
              title: manufacturer.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getModelTypes() {
    if (_metaData?.ModelTypes == null) return [];
    final items = _metaData!.ModelTypes!
        .map((modelType) => DropdownItem(
              id: modelType.ID ?? '',
              title: modelType.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getServiceTypes() {
    if (_metaData?.serviceType == null) return [];
    final items = _metaData!.serviceType!
        .map((serviceType) => DropdownItem(
              id: serviceType.ID ?? '',
              title: serviceType.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getMeasureUnits() {
    if (_metaData?.Units == null) return [];
    final items = _metaData!.Units!
        .map((unit) => DropdownItem(
              id: unit.ID ?? '',
              title: unit.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getMeterCapacities() {
    if (_metaData?.Capacities == null) return [];
    final items = _metaData!.Capacities!
        .map((capacity) => DropdownItem(
              id: capacity.ID ?? '',
              title: capacity.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getAddresses() {
    if (_metaData?.Addresses == null) return [];
    final items = _metaData!.Addresses!
        .map((address) => DropdownItem(
              id: address.ID ?? '',
              title: address.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  List<DropdownItem> getAMRs() {
    if (_metaData?.ARMs == null) return [];
    final items = _metaData!.ARMs!
        .map((arm) => DropdownItem(
              id: arm.ID ?? '',
              title: arm.Name ?? '',
            ))
        .toList();
    items.sort((a, b) => a.title.compareTo(b.title));
    return items;
  }

  // Note: There is no getMeterSerials() method because meter serial numbers
  // are individual fields stored on each meter (GetMeter.SerialNo), not
  // predefined lists in MetaData. Each meter has its own unique serial number.

  bool get isLoaded => _metaData != null;

  String? getMeasureUnitName(String? id) {
    if (_metaData?.Units == null || id == null) return null;
    final data = _metaData!.Units!
        .firstWhere(
          (e) => e.ID == id,
          orElse: () => MetaDataUnits(ID: id, Name: null),
        )
        .Name;
    return data?.trim();
  }
}
