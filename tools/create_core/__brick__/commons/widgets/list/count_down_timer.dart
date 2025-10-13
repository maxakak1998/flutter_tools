import 'dart:async';

import 'package:rxdart/subjects.dart';

class CountdownTimer {
  int? _secondsRemaining, from;
  bool repeating = false;
  final BehaviorSubject<int?> _stream = BehaviorSubject();
  Timer? _timer;
  final Function()? onDone;
  bool get isActive => _timer?.isActive == true;
  CountdownTimer({this.onDone});
  void start({int? from = 30, bool repeating = false}) {
    this.from = from;
    _secondsRemaining = from;
    this.repeating = repeating;
    const oneSec = Duration(seconds: 1);
    _timer = Timer.periodic(oneSec, (Timer timer) => _tick());
  }

  void _tick() {
    if (_stream.isClosed) {
      _timer?.cancel();
      return;
    }
    _secondsRemaining ??= 0;
    if (_secondsRemaining! < 1) {
      if (repeating && from != null) {
        _secondsRemaining = from;
      } else {
        reset();
      }
    } else {
      _secondsRemaining = _secondsRemaining! - 1;
    }
    if (!_stream.isClosed) {
      _stream.add(_secondsRemaining);
    }
  }

  int? get secondsRemaining => _secondsRemaining;

  void reset() {
    _secondsRemaining = null;
    _timer?.cancel();
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
    _stream.close();
  }

  Stream<int?> countdownStream() => _stream.stream;
}
