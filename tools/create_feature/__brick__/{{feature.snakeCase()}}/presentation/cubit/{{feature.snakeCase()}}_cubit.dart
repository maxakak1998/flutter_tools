import '../../../../app_export.dart';
import '{{feature.snakeCase()}}_cubit_state.dart';


class {{feature.pascalCase()}}Cubit extends Cubit<BaseCubitState> {
  {{feature.pascalCase()}}Cubit():super({{feature.pascalCase()}}InitState());
}

