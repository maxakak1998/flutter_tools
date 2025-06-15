import '../../../../app_export.dart';

class InitInitState extends BaseCubitState {
  InitInitState({
    super.state,
    super.error,
    super.id,
    super.isLoadMore,
    super.isRefresh,
  });
}

class UserAuthStateChanged extends InitInitState {
  UserAuthStateChanged({
    super.state = EventState.succeed,
    super.error,
    super.id,
    super.isLoadMore = false,
    super.isRefresh = false,
  });
}
