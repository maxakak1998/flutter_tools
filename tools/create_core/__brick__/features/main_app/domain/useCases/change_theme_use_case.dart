import '../../../../app_export.dart';

abstract class IChangeThemeUseCase {
  Future<ITheme> changeTheme(ITheme newTheme);
}

class ChangeThemeUseCase extends IChangeThemeUseCase {
  @override
  Future<ITheme> changeTheme(ITheme newTheme) async {
    await Future.delayed(const Duration(milliseconds: 500));
    return newTheme;
  }
}
