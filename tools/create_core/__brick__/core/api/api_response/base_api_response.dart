import '../api_export.dart';

///T Original response type
class BaseAPIResponseWrapper<R, E> {
  R? originalResponse;
  E? decodedData;

  bool hasError = false;
  BaseAPIResponseDataTransformer? dataTransformer;

  BaseAPIResponseWrapper({
    this.originalResponse,
    this.dataTransformer,
    this.decodedData,
  });

  BaseAPIResponseWrapper<R, E> decode() => this;
}
