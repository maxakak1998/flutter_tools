import 'package:{{project_name}}/features/main_app/main_app_inject.dart';

import 'app_export.dart';

Future<void> main() async {
  injectMainAppModule();
  // injectInitModule();
  // injectSignInModule(); // Register SignIn feature DI
  // injectHomePageModule();
  // injectSearchMeterModule();
  // injectMainSetupModule(); // Register MainSetup feature DI
  // injectDetailMeterModule(); // Register DetailMeter feature DI
  // injectHelpModule(); // Register Help feature DI
  // injectMeterReadingModule(); // Register MeterReading feature DI
  // injectExtraSelectionModule(); // Register ExtraSelection feature DI
  // injectAddressModule(); // Register Address feature DI
  // injectAddCustomerModule(); // Register AddCustomer feature DI
  EasyLocalization.logger.enableBuildModes = [];
  WidgetsFlutterBinding.ensureInitialized();
  await EasyLocalization.ensureInitialized();

  // final firebaseApp = await Firebase.initializeApp();
  GetIt.instance.enableRegisteringMultipleInstancesOfOneType();
  runApp(const MainAppScreen());
}
