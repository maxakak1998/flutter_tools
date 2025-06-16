---
applyTo: '**'
---

# 🧠 Instructions for Copilot Agency for Navigation

This project uses **GoRouter** with **TypedGoRoute** for type-safe navigation. All navigation is handled through route classes and generated code.

## 🧭 Navigation Architecture

### 1. **Route Structure**
Each feature has its own route file located in `lib/features/<feature>/presentation/routes/`:
```
lib/features/<feature>/presentation/routes/
├── <feature>_route.dart       # Route definition with @TypedGoRoute
└── <feature>_route.g.dart     # Generated route code (auto-generated)
```

### 2. **Route Definition Pattern**
Create route files using the `@TypedGoRoute` annotation:

```dart
import '../screen/home_page_screen.dart';
import '../../../../app_export.dart';

part 'home_page_route.g.dart';

@TypedGoRoute<HomePageRoute>(path: '/home')
class HomePageRoute extends GoRouteData with _$HomePageRoute {
  @override
  Widget build(BuildContext context, GoRouterState state) => HomePageScreen();
}
```

### 3. **Route with Parameters**
For routes that need parameters, define them as class properties:

```dart
import '../screen/detail_meter_screen.dart';
import '../../../../app_export.dart';
part 'detail_meter_route.g.dart';

@TypedGoRoute<DetailMeterRoute>(path: '/detail-meter')
class DetailMeterRoute extends GoRouteData with _$DetailMeterRoute {
  final String meterId;
  final String description;
  final bool isMainSetupFlow;

  const DetailMeterRoute({
    required this.meterId,
    required this.description,
    this.isMainSetupFlow = false,
  });

  @override
  Widget build(BuildContext context, GoRouterState state) {
    return DetailMeterScreen(
      meterId: meterId,
      description: description,
      isMainSetupFlow: isMainSetupFlow,
    );
  }
}
```

## 🚀 Navigation Methods

### 1. **Navigate to New Screen (Push)**
Use `.push(context)` to navigate to a new screen while keeping the current screen in the stack:

```dart
// Navigate to Detail Meter with parameters
DetailMeterRoute(
  meterId: '12345',
  description: 'Meter Description',
  isMainSetupFlow: true,
).push(context);

// Navigate to simple route
HomePageRoute().push(context);
```

### 2. **Replace Current Screen (Go)**
Use `.go(context)` to replace the current screen (clears the navigation stack):

```dart
// Replace current screen with Home Page
HomePageRoute().go(context);
```

### 3. **Replace Current Screen in Stack**
Use `.pushReplacement(context)` to replace the current screen but keep the navigation history:

```dart
HomePageRoute().pushReplacement(context);
```

### 4. **Replace Route in Stack**
Use `.replace(context)` to replace the current route:

```dart
HomePageRoute().replace(context);
```

## 🔧 Navigation Best Practices

### 1. **Use Type-Safe Navigation**
Always use the route classes instead of string-based navigation:

```dart
// ✅ Good - Type-safe
DetailMeterRoute(meterId: '123', description: 'Test').push(context);

// ❌ Bad - String-based
context.push('/detail-meter?meterId=123&description=Test');
```

### 2. **Navigation in Cubit/Bloc Listeners**
Handle navigation in BlocListener callbacks:

```dart
BlocListener<SignInCubit, BaseCubitState>(
  listener: (context, state) {
    if (state is SignInInitState) {
      if (state.state == EventState.succeed) {
        // Navigate to home page
        HomePageRoute().go(context);
      } else if (state.state == EventState.error) {
        // Handle error
        setState(() {
          _errorMessage = state.error ?? 'Sign in failed';
        });
      }
    }
  },
  child: // ... your widget
)
```

### 3. **Navigation with Parameters**
Always define parameters as required or optional in the route class:

```dart
// Required parameters
const DetailMeterRoute({
  required this.meterId,
  required this.description,
  this.isMainSetupFlow = false, // Optional with default
});
```

## ⚙️ Route Generation Commands

### **Generate Routes**
After creating or modifying route files, run this command to regenerate the route files:

```bash
make route
```

This command:
- Generates `.g.dart` files for each route
- Updates `lib/core/routers/all_routes.dart` with new routes
- Uses `go_router_builder` to create type-safe navigation

### **Feature Generation (Includes Routes)**
When creating a new feature, routes are automatically generated:

```bash
make feature name=<featureName>
```

This creates the complete feature structure including the route file template.

## 🗂️ Route Registration

### 1. **Automatic Route Registration**
All routes are automatically registered in `lib/core/routers/all_routes.dart`:

```dart
final List<RouteBase> allRoutes = [
  ...init_route.$appRoutes,
  ...search_meter_route.$appRoutes,
  ...home_page_route.$appRoutes,
  ...sign_in_route.$appRoutes,
  // ... other routes
];
```

### 2. **App Router Configuration**
Routes are consumed by the main app router in `lib/core/routers/routers.dart`:

```dart
class AppRouter {
  final goRouter = GoRouter(initialLocation: '/', routes: allRoutes);
}
```

## 📝 Navigation Examples

### Simple Navigation
```dart
// In a button onPressed callback
ElevatedButton(
  onPressed: () {
    HomePageRoute().push(context);
  },
  child: Text('Go to Home'),
)
```

### Navigation with Parameters
```dart
// Navigate to meter details
onTap: () {
  DetailMeterRoute(
    meterId: meter.id,
    description: meter.description,
    isMainSetupFlow: false,
  ).push(context);
}
```

### Navigation in Cubit Methods
```dart
// In a cubit method after successful operation
void signIn() async {
  final id = DateTime.now().microsecondsSinceEpoch.toString();
  try {
    emit(SignInInitState(id: id, state: EventState.loading));
    
    final result = await _authRepository.signIn();
    
    if (result.isSuccess) {
      emit(SignInInitState(id: id, state: EventState.succeed));
      // Navigation will be handled in the BlocListener
    } else {
      emit(SignInInitState(id: id, state: EventState.error, error: result.error));
    }
  } catch (e) {
    emit(SignInInitState(id: id, state: EventState.error, error: e.toString()));
  }
}
```

## 🚫 Navigation Don'ts

1. **Don't use string-based navigation**
   ```dart
   // ❌ Avoid
   context.go('/home');
   context.push('/detail-meter?id=123');
   ```

2. **Don't navigate directly in Cubit/Bloc methods**
   ```dart
   // ❌ Avoid - Don't navigate in cubit
   void signIn(BuildContext context) {
     // ... logic
     HomePageRoute().go(context); // Don't do this
   }
   ```

3. **Don't create routes without the @TypedGoRoute annotation**
   ```dart
   // ❌ Missing annotation
   class HomePageRoute extends GoRouteData {
     // This won't be generated properly
   }
   ```

## 🔄 Workflow Summary

1. **Create Route File**: Define route with `@TypedGoRoute` annotation
2. **Run Generation**: Execute `make route` to generate route code
3. **Use in Navigation**: Use route class methods (`.push()`, `.go()`, etc.)
4. **Handle in UI**: Use BlocListener for navigation based on state changes

Remember: Always run `make route` after creating or modifying route files to ensure proper code generation and route registration.
