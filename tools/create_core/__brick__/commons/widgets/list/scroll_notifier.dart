import 'package:flutter/material.dart';
import 'package:rxdart/rxdart.dart' as rx;

class ScrollNotifierController {
  final ValueNotifier<int> _resetValue = ValueNotifier(0);

  void reset() {
    _resetValue.value = _resetValue.value++;
  }

  void dispose() {
    _resetValue.dispose();
  }
}

class ScrollNotifier extends StatefulWidget {
  final Widget child;
  final Function onReachBottom;
  final Axis axis;
  final ScrollNotifierController? controller;
  final ScrollController? scrollController;

  const ScrollNotifier({
    super.key,
    required this.onReachBottom,
    required this.child,
    this.axis = Axis.vertical,
    this.controller,
    this.scrollController,
  });

  @override
  State<ScrollNotifier> createState() => _ScrollNotifierState();
}

class _ScrollNotifierState extends State<ScrollNotifier> {
  late final rx.BehaviorSubject _stream;
  late final ValueNotifier<bool> isLoading;
  bool isBlocking = false;

  @override
  void initState() {
    super.initState();
    widget.controller?._resetValue.addListener(() {
      isBlocking = false;
      if (mounted) {
        isLoading.value = false;
      }
    });
    _stream = rx.BehaviorSubject();
    isLoading = ValueNotifier(false);
    _stream
        .where((element) {
          if (isBlocking) return false;
          if (mounted) {
            return !isLoading.value;
          }
          return false;
        })
        .debounceTime(const Duration(milliseconds: 250))
        .listen(_listen);

    if (widget.scrollController != null) {
      widget.scrollController?.addListener(() {
        if (mounted && !_stream.isClosed) {
          _stream.add(widget.scrollController?.position);
        }
      });
    }
  }

  @override
  void dispose() {
    _stream.close();
    isLoading.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.scrollController != null) {
      return _buildChild();
    }
    return NotificationListener(
      onNotification: (data) {
        if (data is ScrollMetricsNotification &&
            data.metrics.axis == widget.axis) {
          _stream.add(data);
        }
        return false;
      },
      child: _buildChild(),
    );
  }

  ValueListenableBuilder<bool> _buildLoading() {
    return ValueListenableBuilder<bool>(
      valueListenable: isLoading,
      builder: (context, value, child) {
        return value
            ? Container(
              color: Colors.transparent,
              margin: EdgeInsets.symmetric(
                vertical: widget.axis == Axis.vertical ? 12 : 0,
                horizontal: widget.axis == Axis.horizontal ? 4 : 0,
              ),
              child: SafeArea(
                top: false,
                bottom: true,
                child: CircularProgressIndicator(
                  strokeWidth: 2.0,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    Colors.blue, // Replace with your desired color
                  ),
                ),
              ),
            )
            : const SizedBox();
        // return SwipeTransition(
        //     visible: value,
        //     axisAlignment: widget.axis == Axis.vertical ? 1.0 : 0,
        //     child: Container(
        //       color: Colors.transparent,
        //       margin: EdgeInsets.symmetric(
        //         vertical: widget.axis == Axis.vertical ? 12 : 0,
        //         horizontal: widget.axis == Axis.horizontal ? 4 : 0,
        //       ),
        //       child: const LoadingWidget(
        //         isLoading: true,
        //         child: SizedBox(),
        //       ),
        //     ));
      },
    );
  }

  void _listen(event) async {
    bool activateBottomLoadMore = false;
    final isFree = !isLoading.value && !isBlocking;
    if (event is ScrollMetricsNotification) {
      final extentAfter = event.metrics.maxScrollExtent - event.metrics.pixels;
      if (extentAfter < minTriggerDistance() &&
          isFree &&
          event.metrics.axis == widget.axis) {
        activateBottomLoadMore = true;
      }
    } else if (event is ScrollPosition) {
      double maxScroll = event.maxScrollExtent;
      double currentScroll = event.pixels;
      if (maxScroll - currentScroll <= minTriggerDistance() &&
          isFree &&
          event.axis == widget.axis) {
        activateBottomLoadMore = true;
      }
    }
    if (activateBottomLoadMore) {
      setLoading(true);
      final value = await widget.onReachBottom();
      isBlocking = value == null || value is List && value.isEmpty;
      setLoading(false);
    }
  }

  int minTriggerDistance() => 100;

  void setLoading(bool data) {
    if (mounted) {
      isLoading.value = data;
    }
  }

  Widget _buildChild() {
    switch (widget.axis) {
      case Axis.horizontal:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [Expanded(child: widget.child), _buildLoading()],
        );
      case Axis.vertical:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [Expanded(child: widget.child), _buildLoading()],
        );
    }
  }
}
