import 'package:{{project_name}}/features/init/presentation/mixins/init_mixin.dart';

import '../../../../../app_export.dart';
import '../cubit/init_cubit_state.dart' show UserAuthStateChanged;

class InitScreen extends StatefulWidget {
  const InitScreen({super.key});

  @override
  State<InitScreen> createState() => _InitScreenState();
}

class _InitScreenState extends State<InitScreen> with InitMixin {
  @override
  void initState() {
    super.initState();
    initCubit.initPreData();
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CustomCubit(
      bloc: initCubit,
      onSucceed: (state) {},
      listener: (context, state) {
        if (state is UserAuthStateChanged) {
          switch (initCubit.userAuthState) {
            case UserAuthState.loggedIn:
              break;
            case UserAuthState.loggedOut:
            case UserAuthState.unknown:
              break;
          }
        }
      },
      onLoading: (state) => false,
      builder: (context, state, isLoading) => const SizedBox(),
    );
  }
}
