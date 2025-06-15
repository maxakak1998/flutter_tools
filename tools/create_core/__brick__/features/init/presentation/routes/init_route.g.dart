// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'init_route.dart';

// **************************************************************************
// GoRouterGenerator
// **************************************************************************

List<RouteBase> get $appRoutes => [$initRoute];

RouteBase get $initRoute =>
    GoRouteData.$route(path: '/', factory: _$InitRoute._fromState);

mixin _$InitRoute on GoRouteData {
  static InitRoute _fromState(GoRouterState state) => InitRoute();

  @override
  String get location => GoRouteData.$location('/');

  @override
  void go(BuildContext context) => context.go(location);

  @override
  Future<T?> push<T>(BuildContext context) => context.push<T>(location);

  @override
  void pushReplacement(BuildContext context) =>
      context.pushReplacement(location);

  @override
  void replace(BuildContext context) => context.replace(location);
}
