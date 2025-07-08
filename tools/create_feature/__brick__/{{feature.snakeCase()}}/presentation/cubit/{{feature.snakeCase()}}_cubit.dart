import '../../../../app_export.dart';
import '{{feature.snakeCase()}}_cubit_state.dart';
import '../../domain/useCases/get_{{feature.snakeCase()}}_use_case.dart';


class {{feature.pascalCase()}}Cubit extends Cubit<BaseCubitState> {
  final IGet{{feature.pascalCase()}}UseCase iGet{{feature.pascalCase()}}UseCase;

  {{feature.pascalCase()}}Cubit(this.iGet{{feature.pascalCase()}}UseCase) : super({{feature.pascalCase()}}InitState());
}

