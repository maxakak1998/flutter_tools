import '../useCases/get_{{feature.snakeCase()}}_use_case.dart';
class I{{feature.pascalCase()}}Service {
    final IGet{{feature.pascalCase()}}UseCase {{feature.camelCase()}}UseCase;
    I{{feature.pascalCase()}}Service({
        required this.{{feature.camelCase()}}UseCase,
    });
}

class {{feature.pascalCase()}}Service extends I{{feature.pascalCase()}}Service {
    {{feature.pascalCase()}}Service({
        required super.{{feature.camelCase()}}UseCase,
    });
}




