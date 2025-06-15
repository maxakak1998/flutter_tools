import '../../api_export.dart';

class APIListResponseDataTransformer<T>
    extends DioResponseDataTransformer<T, BaseAPIResponseWrapper<Response, T>> {
  APIListResponseDataTransformer({RootKeyExtractor? rootKeyExtractor})
    : super(rootKeyExtractor: rootKeyExtractor ?? (_) => ["items"]);

  @override
  BaseAPIResponseWrapper<Response, T> transform(
    Response response,
    T? genericObject,
  ) {
    List<T> decodedList = [];

    List rawList;
    if (response.data is Map) {
      rawList = getData(response.data) ?? [];
    } else if (response.data is List) {
      rawList = response.data;
    }else{
      rawList = [];
    }
      if (genericObject is Decoder) {
        for (final e in rawList) {
          decodedList.add(genericObject.decode(e));
        }
      } else {
        decodedList = rawList.cast<T>();
      }
 
    GeneralPagination? pagination;
    try {
      final pageJson = response.data;
      pagination = GeneralPagination.fromJson(pageJson);
    } catch (_) {}

    return APIListResponse(
      decodedList: decodedList,
      decodedData: genericObject,
      pagination: pagination,
      originalResponse: response,
    );
  }

  @override
  BaseAPIResponseWrapper<Response, T> extractData(Response response) {
    throw UnimplementedError();
  }

  @override
  bool isSucceed(Response response) => true;
}
