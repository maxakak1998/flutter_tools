
import 'options/base_env_options.dart';

abstract class BaseEnvService {
  Future<void> init(covariant BaseEnvOptions? options);

  void dispose() {}
}
