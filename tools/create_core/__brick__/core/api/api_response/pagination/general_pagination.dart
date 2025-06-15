

import '../../api_export.dart';

class GeneralPagination extends BasePagination {
  GeneralPagination(
      {required super.page, required super.limit, required super.total});

  GeneralPagination.fromJson(Map<String, dynamic>? json)
      : super(
            page: int.tryParse(json?["page"]?.toString()??"") ?? 0,
            limit: int.tryParse(json?["limit"]?.toString()??"") ?? 0,
            total: int.tryParse(json?["total"]?.toString()??"") ?? 0);

}
