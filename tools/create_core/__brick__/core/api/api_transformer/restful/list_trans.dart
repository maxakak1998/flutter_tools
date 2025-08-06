import '../../api_export.dart';

class APIListResponseDataTransformer<T>
    extends DioResponseDataTransformer<T, BaseAPIResponseWrapper<Response, T>> {
  APIListResponseDataTransformer({RootKeyExtractor? rootKeyExtractor})
    : super(rootKeyExtractor: rootKeyExtractor ?? (_) => ["data"]);

  @override
  BaseAPIResponseWrapper<Response, T> transform(
    Response response,
    T? genericObject,
  ) {
    if (isSucceed(response)) {
      List<T> decodedList = [];

      List rawList;
      if (response.data is Map) {
        rawList = getData(response.data) ?? [];
      } else if (response.data is List) {
        rawList = response.data;
      } else {
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
        final pageJson = response.data["pagination"];
        pagination = GeneralPagination.fromJson(pageJson);
      } catch (_) {}

      return APIListResponse(
        decodedList: decodedList,
        decodedData: genericObject,
        pagination: pagination,
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
