import '../../../../app_export.dart';
import '../repositories/{{feature.snakeCase()}}_repository_base.dart';

abstract class IGet{{feature.pascalCase()}}UseCase {


}

class Get{{feature.pascalCase()}}UseCase extends IGet{{feature.pascalCase()}}UseCase {
  final I{{feature.pascalCase()}}Repository i{{feature.pascalCase()}}Repository;
  Get{{feature.pascalCase()}}UseCase(this.i{{feature.pascalCase()}}Repository);

}

