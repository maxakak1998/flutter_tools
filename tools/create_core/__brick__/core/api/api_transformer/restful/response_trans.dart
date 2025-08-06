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
      dynamic data = getData(response.data) ?? response.data;

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
      return ErrorResponse<T>(
        message: response.data["error"]["message"] ?? "Unknown error",
        code: response.data["code"].toString(),
      );
    }
  }
}
