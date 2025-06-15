import '../../../../app_export.dart';
import '../../presentation/mixins/main_app_mixin.dart';

abstract class IChangeThemeUseCase {
  Future<ITheme> changeTheme(ITheme newTheme);
}

class ChangeThemeUseCase extends IChangeThemeUseCase with MainAppMixin {
  @override
  Future<ITheme> changeTheme(ITheme newTheme) async {
    await Future.delayed(const Duration(milliseconds: 500));
    return newTheme;
  }
}
