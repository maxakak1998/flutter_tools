import '/..../../../app_export.dart';
import '../../domain/repositories/{{feature.snakeCase()}}_repository_base.dart';

mixin {{feature.pascalCase()}}Mixin {
    I{{feature.pascalCase()}}Repository get {{feature.camelCase()}}Repository =>GetIt.I<I{{feature.pascalCase()}}Repository>();
}