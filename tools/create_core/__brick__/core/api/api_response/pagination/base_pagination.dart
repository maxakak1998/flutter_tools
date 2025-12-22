import 'dart:math';

abstract class BasePagination {
  int page, limit;
  int? total;

  int get _total => total ?? 9999;

  bool isEnd() => (max(1, (page - 1)) * limit) >= _total;

  int getLastPage() {
    num number = (_total / limit);
    final frags = number - number.toInt();
    if (frags != 0) {
      number = number + .5;
    }
    return max(1, number.round());
  }

  BasePagination({
    required this.page,
    required this.limit,
    required this.total,
  });
}
