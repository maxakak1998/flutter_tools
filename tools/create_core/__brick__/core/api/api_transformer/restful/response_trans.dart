import '../../api_export.dart';

class APIResponseDataTransformer<T>
    extends DioResponseDataTransformer<T, BaseAPIResponseWrapper<Response, T>> {
  APIResponseDataTransformer({RootKeyExtractor? rootKeyExtractor})
    : super(rootKeyExtractor: rootKeyExtractor ?? (_) => ["data"]);

  @override
  BaseAPIResponseWrapper<Response, T> transform(
    Response response,
    T? genericObject,
  ) {
    if (isSucceed(response)) {
      dynamic data = response.data;

      if (data is Map) {
        data = getData(response.data) ?? data;
      }

      // dynamic data = getData(response.data) ?? response.data;

      T? object;
      if (genericObject is Decoder) {
        object = genericObject.decode(data);
      } else {
        object = data;
      }

      return APIResponse<T>(
        decodedData: object,
        dataTransformer: this,
        originalResponse: response,
      );
    } else {
      String? errorMessage = "Unknown error";

      final responseData = response.data;
      if (responseData is String) {
        final htmlTagRegex = RegExp(r'<[^>]+>');

        if (htmlTagRegex.hasMatch(responseData) &&
            response.statusMessage != null) {
          errorMessage = response.statusMessage!;
        } else {
          errorMessage = responseData;
        }
      } else {
        final messageData =
            response.data["message"] ?? response.data["error"]?["message"];

        if (messageData is Map) {
          errorMessage = messageData['error'];
          if (errorMessage == null) {
            final listErrors = messageData['errors'];
            if (listErrors is List && listErrors.isNotEmpty) {
              errorMessage = listErrors.join('\n');
            } else {
              errorMessage = messageData["message"]?.toString();
            }
          }
        } else if (messageData is String) {
          errorMessage = messageData;
        }
      }
      final resMap = response.data is Map<String, dynamic> ? response.data : {};
      return ErrorResponse<T>(
        message: errorMessage,
        title: resMap["error"]?["title"]?.toString(),
        code: resMap["error"]?["code"]?.toString(),
        originalResponse: response,
      );
    }
  }
}
