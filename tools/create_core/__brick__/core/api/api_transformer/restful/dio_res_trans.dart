import '../../api_export.dart';

abstract class DioResponseDataTransformer<T, OUTPUT>
    extends BaseAPIResponseDataTransformer<Response, OUTPUT, T> {
  DioResponseDataTransformer({required super.rootKeyExtractor});

  @override
  OUTPUT transform(Response response, T? genericObject);

  @override
  bool isSucceed(Response response) =>
      response.statusCode != null &&
      response.statusCode! >= 200 &&
      response.statusCode! < 300;
}
