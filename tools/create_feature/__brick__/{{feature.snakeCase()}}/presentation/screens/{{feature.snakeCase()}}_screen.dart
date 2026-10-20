import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../cubit/{{feature.snakeCase()}}_cubit.dart';
import '../cubit/{{feature.snakeCase()}}_cubit_state.dart';

class {{feature.pascalCase()}}Screen extends StatelessWidget {
  const {{feature.pascalCase()}}Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<{{feature.pascalCase()}}Cubit, {{feature.pascalCase()}}CubitState>(
      builder: (context, state) => const Scaffold(body: SizedBox.shrink()),
    );
  }
}
