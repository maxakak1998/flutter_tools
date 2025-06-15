import '../../api_export.dart';

class APIListResponse<T> extends APIResponse<T> {
  final List<T>? decodedList;
  final BasePagination? pagination;

  APIListResponse({
    this.pagination,
    required super.originalResponse,
    super.decodedData,
    this.decodedList,
    BaseAPIResponseDataTransformer? dataTransformer,
  }) : super(
         dataTransformer:
             dataTransformer ?? APIListResponseDataTransformer<T>(),
       );
}
