
import 'package:data_entry/app_export.dart';
import 'package:data_entry/features/init/presentation/screen/init_screen.dart';
part 'init_route.g.dart';

@TypedGoRoute<InitRoute>(path: '/')
class InitRoute extends GoRouteData with _$InitRoute {
  @override
  Widget build(BuildContext context, GoRouterState state) => InitScreen();
}
