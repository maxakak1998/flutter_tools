import '../repositories/i_{{feature.snakeCase()}}_repository.dart';

abstract class IGet{{feature.pascalCase()}}UseCase {}

class Get{{feature.pascalCase()}}UseCase implements IGet{{feature.pascalCase()}}UseCase {
  Get{{feature.pascalCase()}}UseCase(this.repository);

  final I{{feature.pascalCase()}}Repository repository;
}
