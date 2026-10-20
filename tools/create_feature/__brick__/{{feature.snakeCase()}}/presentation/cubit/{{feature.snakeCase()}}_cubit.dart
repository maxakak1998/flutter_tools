import '../../../../commons/base_cubit/base_cubit.dart';
import '../../domain/use_cases/get_{{feature.snakeCase()}}_use_case.dart';
import '{{feature.snakeCase()}}_cubit_state.dart';

class {{feature.pascalCase()}}Cubit extends BaseCubit<{{feature.pascalCase()}}CubitState> {
  {{feature.pascalCase()}}Cubit(this.get{{feature.pascalCase()}}UseCase) : super({{feature.pascalCase()}}CubitState());

  final IGet{{feature.pascalCase()}}UseCase get{{feature.pascalCase()}}UseCase;
}
