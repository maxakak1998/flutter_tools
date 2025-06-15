import '../../api_export.dart';

class APIResponse<T> extends BaseAPIResponseWrapper<Response, T> {
  APIResponse({
    required super.originalResponse,
    super.decodedData,
    BaseAPIResponseDataTransformer? dataTransformer,
  }) : super(
         dataTransformer: dataTransformer ?? APIResponseDataTransformer<T>(),
       );

  @override
  APIResponse<T> decode() {
    return dataTransformer?.transform(originalResponse, decodedData);
  }
}
