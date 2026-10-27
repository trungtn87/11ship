import 'dart:async';
import 'package:flutter/widgets.dart';

/// A server-relative one-shot alarm, never a device-clock decision about opening.
/// A failed read keeps data stale and retries with bounded backoff. No background polling.
class AvailabilityRefresh with WidgetsBindingObserver {
  AvailabilityRefresh({required this.refresh, required this.invalidate});
  WidgetsBinding? _binding;

  /// Called by mounted screens; controller-only tests need no Flutter binding.
  void observe() {
    if (_disposed || _binding != null) return;
    _binding = WidgetsBinding.instance;
    _binding!.addObserver(this);
  }
  final Future<void> Function() refresh;
  final VoidCallback invalidate;
  Timer? _timer;
  bool _disposed = false;
  bool _paused = false;
  bool _running = false;
  bool _hasDeadline = false;
  int _retrySeconds = 30;

  void arm(int? milliseconds) {
    _timer?.cancel();
    _retrySeconds = 30;
    _hasDeadline = milliseconds != null;
    if (!_disposed && !_paused && milliseconds != null) {
      _timer = Timer(Duration(milliseconds: milliseconds.clamp(1, 604800000)), reload);
    }
  }

  void failed() {
    _timer?.cancel();
    if (_disposed || _paused || !_hasDeadline) return;
    _timer = Timer(Duration(seconds: _retrySeconds), reload);
    _retrySeconds = (_retrySeconds * 2).clamp(30, 300);
  }

  Future<void> reload() async {
    if (_disposed || _paused || _running) return;
    _timer?.cancel();
    _running = true;
    invalidate();
    try {
      await refresh();
    } finally {
      _running = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _paused = state != AppLifecycleState.resumed;
    if (_paused) {
      _timer?.cancel();
      invalidate();
    } else {
      unawaited(reload());
    }
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _binding?.removeObserver(this);
  }
}
