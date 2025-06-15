import 'package:data_entry/configs/flavors_values.g.dart';
import 'package:data_entry/core/api/api_interceptors/log_interceptor.dart';
import 'package:dio/dio.dart';

import 'manger_service_export.dart';

class ManagerEnvService extends BaseEnvService {
  late FirebaseEnvService firebaseService;

  late APIClient apiClient;



  @override
  Future<void> init(ManagerEnvOptions options) async {

    apiClient = APIClient(baseUrl: FlavorValues.baseUrl);
    apiClient.initInterceptors([APILogInterceptor()]);
  }



  @override
  void dispose() {
    firebaseService.dispose();
    super.dispose();
  }
}
