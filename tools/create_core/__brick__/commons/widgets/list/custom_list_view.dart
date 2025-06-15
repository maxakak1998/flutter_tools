
import 'dart:math';

import 'package:flutter/material.dart';

import 'count_down_timer.dart';
import 'scroll_notifier.dart';

typedef CustomItemBuilder<T> = Widget Function(
    T data, int index, BuildContext context);



class CustomListView<T> extends StatefulWidget {
  final List<T>? data;
  final Widget? loadingWidget, notFoundWidget;
  final IndexedWidgetBuilder? separatedWidget;
  final ScrollNotifierController? refreshController;
  final CustomItemBuilder<T> itemBuilder;
  final Widget Function(Widget child, T data)? conditionBuild;
  final RefreshCallback? onRefresh;
  final Function? onReachBottom;
  final Axis axis;
  final bool shrinkWrap, loading, reverse;
  final ScrollController? controller;
  final EdgeInsets padding;
  final Function(ScrollController? controller)? bindController;
  final ChildIndexGetter? findChildKey;
  final double? height;
  final double? itemExtent;
  final double? cacheExtent;
  final ScrollPhysics physics;
  final bool canTouchErrorWidget;
  final ({Duration after, Function(ScrollNotifierController) onDone})? refresh;

  const CustomListView({
    super.key,
    required this.data,
    required this.itemBuilder,
    this.findChildKey,
    this.refresh,
    this.refreshController,
    this.cacheExtent,
    this.itemExtent,
    this.controller,
    this.shrinkWrap = false,
    this.reverse = false,
    this.loading = false,
    this.loadingWidget,
    this.notFoundWidget,
    this.axis = Axis.vertical,
    this.padding = EdgeInsets.zero,
    this.onRefresh,
    this.onReachBottom,
    this.conditionBuild,
    this.bindController,
    this.physics = const AlwaysScrollableScrollPhysics(),
    this.separatedWidget,
    this.height,
    this.canTouchErrorWidget = false,
  });

  @override
  State<CustomListView<T>> createState() => _CustomListViewState<T>();
}

class _CustomListViewState<T> extends State<CustomListView<T>> {
  late ScrollNotifierController _scrollNotifierController;

  CountdownTimer? refreshTimer;

  @override
  void initState() {
    super.initState();
    _scrollNotifierController =
        widget.refreshController ?? ScrollNotifierController();

    WidgetsBinding.instance.addPostFrameCallback((timeStamp) {
      if (widget.bindController != null) {
        widget.bindController!(PrimaryScrollController.of(context));
      }
    });
    if (widget.refresh != null) {
      initRefreshTimer();
    }
  }

  @override
  void didUpdateWidget(covariant CustomListView<T> oldWidget) {
    if (widget.refresh != null) {
      refreshTimer?.dispose();
      initRefreshTimer();
    }
    super.didUpdateWidget(oldWidget);
  }

  void initRefreshTimer() {
    refreshTimer = CountdownTimer(onDone: () {
      widget.refresh!.onDone.call(_scrollNotifierController);
    })
      ..start(repeating: true, from: widget.refresh!.after.inSeconds);
  }

  @override
  void dispose() {
    refreshTimer?.dispose();
    if (widget.refreshController == null) {
      _scrollNotifierController.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.data == null || widget.loading) {
      return Center(
        child: widget.loadingWidget ??
            const CircularProgressIndicator(
                        strokeWidth: 2.0,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          Colors.blue, // Replace with your desired color
                        ),
                      ),
      );
    } else if (widget.data!.isEmpty) {
      Widget noFoundChild = Center(
        child: widget.notFoundWidget ?? const SizedBox(),
      );
      if (widget.onRefresh != null) {
        if (widget.canTouchErrorWidget) {
          return LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
            return RefreshIndicator(
              onRefresh: widget.onRefresh!,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: SizedBox(
                  height: constraints.maxHeight,
                  width: constraints.maxWidth,
                  child: noFoundChild,
                ),
              ),
            );
          });
        }
        noFoundChild = Stack(
          children: [
            noFoundChild,
            RefreshIndicator(
              onRefresh: widget.onRefresh!,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: MediaQuery.of(context).size.height * 2,
                  )
                ],
              ),
            ),
          ],
        );
      }
      return noFoundChild;
    }

    Widget child = ListView.custom(
      scrollDirection: widget.axis,
      itemExtent: widget.itemExtent,
      shrinkWrap: widget.shrinkWrap,
      padding: widget.padding,
      physics: widget.physics,
      reverse: widget.reverse,
      cacheExtent: widget.cacheExtent,
      controller: widget.controller,
      semanticChildCount: widget.data!.length,
      childrenDelegate: SliverChildBuilderDelegate(
        (context, i) {
          int itemIndex = i;
          Widget child;
          if (widget.separatedWidget != null) {
            itemIndex = i ~/ 2;
            if (itemIndex > widget.data!.length - 1) return const SizedBox();
            if (i.isEven) {
              child = widget.itemBuilder(
                  widget.data![itemIndex], itemIndex, context);

              child = Builder(
                  key: child.key,
                  builder: (context) => widget.itemBuilder(
                      widget.data![itemIndex], itemIndex, context));
            } else {
              child = widget.separatedWidget!(context, itemIndex);
            }
            if (widget.conditionBuild != null) {
              child = widget.conditionBuild!(child, widget.data![itemIndex]);
            }
          } else {
            if (itemIndex > widget.data!.length - 1) return const SizedBox();
            child = widget.itemBuilder(
              widget.data![itemIndex],
              itemIndex,
              context,
            );
            child = Builder(
                key: child.key,
                builder: (BuildContext context) => widget.itemBuilder(
                      widget.data![itemIndex],
                      itemIndex,
                      context,
                    ));

            if (widget.conditionBuild != null) {
              child = widget.conditionBuild!(child, widget.data![itemIndex]);
            }
          }
          final data = widget.data![itemIndex];

          return child;
        },
        semanticIndexCallback: (Widget widget, int index) {
          if (this.widget.separatedWidget != null) {
            index.isEven ? _calculateRealIndex(index) : null;
          }
          return _calculateRealIndex(index);
        },
        childCount: _computeDataLength(),
        findChildIndexCallback: (key) {
          if (key is ValueKey && widget.findChildKey != null) {
            final index = _calculateRealIndex(widget.findChildKey!(key));
            // if(index==0) return 1;
            return index;
          }
          return null;
        },
      ),
    );

    if (widget.onRefresh != null) {
      child = RefreshIndicator(
        onRefresh: () {
          return widget.onRefresh!.call().whenComplete(() {
            if (mounted) {
              _scrollNotifierController.reset();
            }
          });
        },
        child: child,
      );
    }
    if (widget.onReachBottom != null) {
      child = ScrollNotifier(
        onReachBottom: widget.onReachBottom!,
        axis: widget.axis,
        controller: _scrollNotifierController,
        scrollController: widget.controller,
        child: child,
      );
    }
    child = SizedBox(
      height: widget.height,
      child: child,
    );
    return child;
  }

  int _computeDataLength() {
    if (widget.separatedWidget != null) {
      return max(0, (widget.data!.length * 2) - 1);
    }
    return widget.data!.length;
  }

  int? _calculateRealIndex(int? index) {
    if (index == null) {
      return index;
    } else if (index == -1) {
      return null;
    }
    if (widget.separatedWidget != null) {
      return min(_computeDataLength(), index * 2);
    }
    return index;
  }
}
