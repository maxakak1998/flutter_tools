import '../api_export.dart';

abstract class BaseAPIClient<
  OPTION,
  RESPONSE,
  OUTPUT extends BaseAPIResponseWrapper
> {
  late Dio instance;

  Future<T> request<T>({
    required OPTION option,
    required GenericObject<RESPONSE, T> create,
    Map<String, dynamic> pathVariable = const {},
    FormData? formData,
  });

  String mapVariableQuery(String inputString, Map<String, dynamic> map) {
    RegExp placeholderPattern = RegExp(r':(\w+)');
    return inputString.replaceAllMapped(placeholderPattern, (match) {
      String placeholder = match.group(1)!;
      dynamic placeholderValue = map[placeholder];

      if (placeholderValue is List) {
        if (placeholderValue.isNotEmpty) {
          return placeholderValue.removeAt(0).toString();
        } else {
          return ":$placeholder";
        }
      } else {
        return placeholderValue.toString();
      }
    });
  }

  void initInterceptors(List<Interceptor> interceptors) {
    instance.interceptors.clear(keepImplyContentTypeInterceptor: false);
    instance.interceptors.addAll(interceptors);
  }

  T? getInterceptorByType<T extends Interceptor>() {
    try {
      return instance.interceptors.firstWhere((element) => element is T) as T;
    } catch (e) {
      return null;
    }
  }

  void clearInterceptors() {
    instance.interceptors.clear(keepImplyContentTypeInterceptor: false);
  }

  isEmptyInterceptors() => instance.interceptors.isEmpty;
}
