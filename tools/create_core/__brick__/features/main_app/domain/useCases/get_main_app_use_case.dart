import '../../../../app_export.dart';
import '../../presentation/mixins/main_app_mixin.dart';

abstract class IGetMainAppUseCase {}

class GetMainAppUseCase extends IGetMainAppUseCase with MainAppMixin {}
