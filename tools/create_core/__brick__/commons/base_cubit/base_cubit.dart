import '../../app_export.dart';

class CustomCubit<T extends BaseCubitState> extends StatefulWidget {
  final Cubit<T> bloc;
  final ValueChanged<T>? onError, onSucceed;
  final bool Function(T)? onLoading;
  final BlocBuilderCondition<T>? buildWhen;
  final BlocWidgetListener<T>? listener;
  final bool Function(T)? listenWhen;
  final Function(BuildContext context, T state, bool isLoading) builder;

  const CustomCubit({
    required this.bloc,
    key,
    this.onError,
    this.onSucceed,
    this.onLoading,
    this.buildWhen,
    this.listener,
    required this.builder,
    this.listenWhen,
  }) : super(key: key);

  @override
  State<CustomCubit> createState() => _CustomCubitState<T>();
}

class _CustomCubitState<T extends BaseCubitState>
    extends State<CustomCubit<T>> {
  late bool isLoading = false;
  late Map<String, bool> loadingData;

  late StreamSubscription<T> _streamSubscription;

  @override
  void initState() {
    super.initState();
    isLoading = false;
    loadingData = {};

    _streamSubscription = widget.bloc.stream
        .where((element) {
          return widget.listenWhen?.call(element) ?? true;
        })
        .listen((state) {
          _onListen(state);
        });
  }

  void _onListen(T state) {
    bool requestLoading = widget.onLoading?.call(state) ?? false;

    switch (state.state) {
      case EventState.error:
        widget.onError?.call((state));
        break;
      case EventState.succeed:
        widget.onSucceed?.call(state);
        break;
      case EventState.loading:
        final id = state.id;
        if (id != null && requestLoading) {
          loadingData.update(id, (value) => true, ifAbsent: () => true);
          isLoading = true;
        }
        break;
    }
    if (requestLoading &&
        state.state != EventState.loading &&
        loadingData[state.id] != null) {
      loadingData.remove(state.id);
      isLoading = false;
    }
  }

  @override
  void dispose() {
    _streamSubscription.cancel();
    loadingData.clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => BlocConsumer<Cubit<T>, T>(
    bloc: widget.bloc,
    builder: (context, state) => widget.builder(context, state, isLoading),
    buildWhen: widget.buildWhen,
    listener: (context, state) {
      widget.listener?.call(context, state);
    },
  );
}
