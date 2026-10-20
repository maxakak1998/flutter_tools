import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:get_it/get_it.dart';
import 'package:go_router/go_router.dart';

import '../../domain/use_cases/get_{{feature.snakeCase()}}_use_case.dart';
import '../cubit/{{feature.snakeCase()}}_cubit.dart';
import '../screens/{{feature.snakeCase()}}_screen.dart';

part '{{feature.snakeCase()}}_route.g.dart';

/// Wiring lives here: the route creates the screen's cubit from the use case.
@TypedGoRoute<{{feature.pascalCase()}}Route>(path: '/{{feature.paramCase()}}')
class {{feature.pascalCase()}}Route extends GoRouteData with ${{feature.pascalCase()}}Route {
  @override
  Widget build(BuildContext context, GoRouterState state) => BlocProvider(
    create: (_) => {{feature.pascalCase()}}Cubit(GetIt.I<IGet{{feature.pascalCase()}}UseCase>()),
    child: const {{feature.pascalCase()}}Screen(),
  );
}
