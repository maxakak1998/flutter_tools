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
      String errorMessage = "Unknown error";

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
        final messageData = response.data["error"]?["message"];

        if (messageData is Map) {
          errorMessage = messageData['error'];
        } else if (messageData is String) {
          errorMessage = messageData;
        }
      }

      return ErrorResponse<T>(
        message: errorMessage,
        title: response.data["error"]?["title"]?.toString(),
        code: response.data["error"]?["code"].toString(),
        originalResponse: response,
      );
    }
  }
}
