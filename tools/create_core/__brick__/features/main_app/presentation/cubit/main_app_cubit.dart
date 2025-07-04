import '../../../../app_export.dart';
import 'main_app_cubit_state.dart';

class MainAppCubit extends Cubit<BaseCubitState> {
  final IChangeThemeUseCase changeThemeUserCase;
  final IChangeLocaleToUseCase changeLocaleToUseCase;
  final LocaleService localeService;
  late Locale currentLocale;

  ITheme currentTheme = NormalTheme();
  late Locale currentLocale;

  MainAppCubit() : super(MainAppInitState()) {
    currentLocale = localeService.defaultLocale;
  }

  changeThemeTo(ITheme newTheme) async {
    currentTheme = await changeThemeUserCase.changeTheme(newTheme);
    // Update loading widget theme when theme changes
    CommonLoadingWidget.updateTheme();
    emit(ChangeThemeState());
  }

  changeLocaleTo(Locale newLocale) async {
    currentLocale = await changeLocaleToUseCase.changeLocale(newLocale);
    emit(ChangeThemeState());
  }
}
