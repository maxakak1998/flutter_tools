import 'package:{{project_name}}/features/init/presentation/mixins/init_mixin.dart';

import '../../../../../app_export.dart';
import '../cubit/init_cubit_state.dart' show UserAuthStateChanged;

class InitScreen extends StatefulWidget {
  const InitScreen({super.key});

  @override
  State<InitScreen> createState() => _InitScreenState();
}

class _InitScreenState extends State<InitScreen>  {
    late final InitCubit initCubit;

  @override
  void initState() {
    super.initState();

       // Initialize the cubit as per compliance requirements (not injected via GetIt)
    initCubit = GetIt.I<InitCubit>();
  // Use SchedulerBinding to ensure CustomCubit is fully rendered before calling cubit methods
    // This prevents missing loading states as per cubit.instructions.md
    SchedulerBinding.instance.addPostFrameCallback((_) {
      initCubit.initPreData();
    });  }

  @override
  void dispose() {
    initCubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CustomCubit(
      bloc: initCubit,
      onSucceed: (state) {},
      onSucceed: (state) {
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
