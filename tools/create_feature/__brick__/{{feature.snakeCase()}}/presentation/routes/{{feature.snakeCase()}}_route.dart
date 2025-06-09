import '../screen/{{feature.snakeCase()}}_screen.dart';
import '../../../../app_export.dart';
part '{{feature.snakeCase()}}_route.g.dart';

@TypedGoRoute<{{feature.pascalCase()}}Route>(path: '/{{feature.paramCase()}}') 
class {{feature.pascalCase()}}Route extends GoRouteData with _${{feature.pascalCase()}}Route{
  @override
  Widget build(BuildContext context, GoRouterState state) => {{feature.pascalCase()}}Screen();

}

