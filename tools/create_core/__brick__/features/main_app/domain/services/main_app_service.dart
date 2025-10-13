import '../useCases/get_main_app_use_case.dart';

class IMainAppService {
  final IGetMainAppUseCase mainAppUseCase;
  IMainAppService({required this.mainAppUseCase});
}

class MainAppService extends IMainAppService {
  MainAppService({required super.mainAppUseCase});
}
