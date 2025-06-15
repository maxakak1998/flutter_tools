import 'base_env_options.dart';

class ManagerEnvOptions extends BaseEnvOptions {
  String flavor;
  bool override;

  ManagerEnvOptions({required this.flavor, this.override = false});
}
