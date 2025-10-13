import '../../../../app_export.dart';

abstract class IChangeLocaleToUseCase {
  Future<Locale> changeLocale(Locale newLocale);
}

class ChangeLocaleToUseCase extends IChangeLocaleToUseCase {
  @override
  Future<Locale> changeLocale(Locale newLocale) async {
    await Future.delayed(const Duration(milliseconds: 500));
    return newLocale;
  }
}
