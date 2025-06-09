---
applyTo: '**'
---
## Here is the bash command line instructions for Copilot

### ⚙️ Feature Generator (Makefile)

To generate a new feature, use the provided Makefile command.
It will generate the necessary files and directories for a new feature located in `lib/features/<feature>/`.
```bash
make feature name=<featureName>
```


### ⚙️ Use-case Generator (Makefile)
It will generate the necessary files and directories for a new use-case located in `lib/features/<feature>/domain/useCases/`.
```bash
make usecase name=<useCaseName> path=<useCasePath>
```
The usecase path is required to specify the directory where the use-case should be created, relative to `lib/features/<feature>/domain/useCases/`.


### ⚙️ Routes Generator (Makefile)
Each screen should have its own route file located in `lib/features/<feature>/presentation/routes/` marked with the `@TypedGoRoute` annotation.
All routes should be generated in `lib/core/routers/all_routes.dart` to be used by the app.
Run this command to generate a generated route .g file using go_router_builder:
```bash
make route
```

### ⚙️ API Generator (Makefile)
Using this command to fetch the latest API changes and generate the necessary files, ideally after updating API json files in `lib/core/api/api_routes`
All generated files will be exported in `lib/core/api/api_roputes/api_route_export.dart`:
```bash
make gen_api
```



### ⚙️ Flutter Pub Get 
Using fvm to run flutter pub get:
```bash
fvm flutter pub get


Rules:
 1. Alaways ask about the feature name before generating a new feature if it is not provided.
 2. If the feature name is not provided, ask the user to provide it.
 3. If the use-case name is not provided, ask the user to provide it.
 4. If the use-case path is not provided, ask the user to provide it.
