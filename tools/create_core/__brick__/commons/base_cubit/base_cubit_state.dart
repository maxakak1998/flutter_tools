enum EventState { loading, error, succeed }

abstract class BaseCubitState {
  String? id;
  EventState state;
  dynamic error;
  final bool isRefresh, isLoadMore;
  BaseCubitState({
    this.state = EventState.loading,
    this.error,
    this.isRefresh = false,
    this.isLoadMore = false,
    this.id,
    Duration duration = Duration.zero,
  });

  bool get isLoading => state == EventState.loading;
}
