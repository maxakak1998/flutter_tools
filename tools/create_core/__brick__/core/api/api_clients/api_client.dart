import 'package:{{project_name}}/core/api/api_interceptors/token_interceptor.dart';

import '../api_export.dart';

typedef APIProgressCallback = void Function(double value);

class APIClient
    extends BaseAPIClient<RequestOptions, Response, BaseAPIResponseWrapper> {
  APIClient({required String baseUrl}) {
    instance = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        receiveDataWhenStatusError: true,
        sendTimeout: const Duration(seconds: 15 * 60),
        receiveTimeout: const Duration(seconds: 15 * 60),
        validateStatus: (code) {
          const validStatusCodes = [200, 201, 202, 204, 304];
          return code != null && validStatusCodes.contains(code);
        },
        persistentConnection: true,
      ),
    );
  }

  TokenInterceptor? get tokenInterceptor =>
      instance.interceptors.whereType<TokenInterceptor?>().firstOrNull;

  @override
  Future<T> request<T>({
    required RequestOptions option,
    required GenericObject<Response, T> create,
    Map<String, dynamic> pathVariable = const {},
    FormData? formData,
  }) async {
    option.path = mapVariableQuery(option.path, pathVariable);

    if (formData != null) {
      final bodyData = option.data is Map<String, dynamic>
          ? option.data as Map<String, dynamic>
          : <String, dynamic>{};
      for (final field in formData.fields) {
        bodyData[field.key] = field.value;
      }
      for (final file in formData.files) {
        bodyData[file.key] = file.value;
      }
      option.data = FormData.fromMap(bodyData);
    }

    if (option.baseUrl.isEmpty) {
      option = option.copyWith(baseUrl: instance.options.baseUrl);
    }

    Response response = await instance.fetch(option);

    final apiWrapper = create(response);
    if (apiWrapper is Exception) throw apiWrapper;
    if (apiWrapper is BaseAPIResponseWrapper) {
      final concretedWrapper = (apiWrapper).decode();
      if (concretedWrapper is Exception) throw concretedWrapper;
      return concretedWrapper as T;
    }
    return apiWrapper;
  }
}
