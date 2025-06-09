import 'package:go_router/go_router.dart';

import 'all_routes.dart';

class AppRouter {
  final goRouter = GoRouter(initialLocation: '/', routes: allRoutes);
}
