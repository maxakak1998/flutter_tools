import 'package:data_entry/features/home_page/presentation/routes/home_page_route.dart';
import 'package:data_entry/features/init/presentation/cubit/init_cubit.dart';
import 'package:data_entry/features/init/presentation/mixins/init_mixin.dart';
import 'package:data_entry/features/sign_in/presentation/routes/sign_in_route.dart';

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
              HomePageRoute().pushReplacement(context);
              break;
            case UserAuthState.loggedOut:
            case UserAuthState.unknown:
              SignInRoute().pushReplacement(context);
              break;
          }
        }
      },
      onLoading: (state) => false,
      builder: (context, state, isLoading) => const SizedBox(),
    );
  }
}
