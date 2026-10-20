import '../../../../commons/base_cubit/base_cubit_state.dart';

class {{feature.pascalCase()}}CubitState extends BaseCubitState {
  {{feature.pascalCase()}}CubitState({
    super.state,
    super.error,
    super.id,
    super.isLoadMore,
    super.isRefresh,
  });
}
