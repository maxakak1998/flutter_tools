import '../useCases/get_init_use_case.dart';

class IInitService {
  final IGetInitUseCase initUseCase;
  IInitService({required this.initUseCase});
}

class InitService extends IInitService {
  InitService({required super.initUseCase});
}
