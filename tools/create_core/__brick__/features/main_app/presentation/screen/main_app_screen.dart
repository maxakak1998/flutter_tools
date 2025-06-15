import 'package:{{project_name}}/app_export.dart';
import 'package:{{project_name}}/core/services/manager_service/manger_service_export.dart';
import 'package:flutter_easyloading/flutter_easyloading.dart';
import 'package:flutter/cupertino.dart';

class MainAppScreen extends StatefulWidget {
  const MainAppScreen({super.key});

  @override
  State<MainAppScreen> createState() => _MainAppScreenState();
}

class _MainAppScreenState extends State<MainAppScreen> with MainAppMixin {
  @override
  void initState() {
    super.initState();
  }

  @override
  void didChangeDependencies() {
    ScreenUtil.init(context);
    CommonLoadingWidget.initialize();
    super.didChangeDependencies();
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder(
      bloc: mainAppCubit,
      builder: (context, state) {
        return DevicePreview(
          enabled: kDebugMode,
          builder: (context) {
            return EasyLocalization(
              supportedLocales:
                  SupportedLocales.values.map((e) => e.locale).toList(),
              path: localeService.assetLanguage,
              fallbackLocale: SupportedLocales.vi.locale,
              saveLocale: true,
              useFallbackTranslations: true,

              child: ScreenUtilInit(
                designSize: Size(375, 884),

                builder: (context, child) {
                  return GestureDetector(
                    onTap: () {
                      // Unfocus any focused text field when tapping outside globally
                      FocusScope.of(context).unfocus();
                    },
                    child: MaterialApp.router(
                      localizationsDelegates: [
                        ...context.localizationDelegates,
                        DefaultCupertinoLocalizations.delegate,
                      ],
                      supportedLocales: context.supportedLocales,
                      // theme: mainAppCubit.currentTheme.themeData,
                      debugShowCheckedModeBanner: false,
                      locale: context.locale,
                      routerConfig: router.goRouter,
                      builder: EasyLoading.init(),
                    ),
                  );
                },
              ),
            );
          },
        );
      },
    );
  }
}
