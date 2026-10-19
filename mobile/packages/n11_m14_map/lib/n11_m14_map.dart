/// Map-only M14 core: the offline Cao Bằng map and the point picker. It never starts GPS, never asks for a permission, never calculates a route and
/// never uploads anything; the recorder, the foreground service and the routing client live in `n11_m14` (11Ship only).
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// True when this build carries the Cao Bằng package and the app turned the map on (`--dart-define=M14_OFFLINE_MAP=true`). The build only sets the flag
/// when the asset is present, so a screen never opens a map that cannot load.
const bool kM14MapEnabled = bool.fromEnvironment('M14_OFFLINE_MAP');

/// A local MapLibre view. Does not start GPS, calculate routes or upload data.
/// Coordinates are [latitude, longitude]; attribution is always visible.
class M14OfflineMap extends StatelessWidget {
  const M14OfflineMap({super.key, this.pins = const <Map<String, dynamic>>[],
    this.route = const <List<double>>[], this.onPoint, this.onReady, this.onError, this.focusPin = false});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final bool focusPin;
  final VoidCallback? onReady;
  final ValueChanged<String>? onError;
  final void Function(double latitude, double longitude, bool insideCoverage)? onPoint;

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return const Center(child: Text('Bản đồ offline M14 dành cho Android'));
    }
    return _NativeMap(pins: pins, route: route, onPoint: onPoint, onReady: onReady, onError: onError, focusPin: focusPin);
  }
}

class _NativeMap extends StatefulWidget {
  const _NativeMap({required this.pins, required this.route, this.onPoint, this.onReady, this.onError, this.focusPin = false});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final bool focusPin;
  final VoidCallback? onReady;
  final ValueChanged<String>? onError;
  final void Function(double, double, bool)? onPoint;
  @override
  State<_NativeMap> createState() => _NativeMapState();
}
class _NativeMapState extends State<_NativeMap> {
  MethodChannel? _channel;
  Map<String, dynamic> get _data => <String, dynamic>{'pins': widget.pins, 'route': widget.route, 'focus_pin': widget.focusPin};
  @override
  void didUpdateWidget(covariant _NativeMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    _channel?.invokeMethod<void>('update', _data);
  }
  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }
  @override
  Widget build(BuildContext context) => AndroidView(
    viewType: 'vn.eleven/m14/map',
    gestureRecognizers: widget.focusPin ? <Factory<OneSequenceGestureRecognizer>>{Factory<EagerGestureRecognizer>(EagerGestureRecognizer.new)} : const <Factory<OneSequenceGestureRecognizer>>{},
    creationParams: _data,
    creationParamsCodec: const StandardMessageCodec(),
    onPlatformViewCreated: (int id) {
      _channel = MethodChannel('vn.eleven/m14/map/$id');
      _channel!.setMethodCallHandler((MethodCall call) async {
        if (!mounted) return;
        if (call.method == 'ready') widget.onReady?.call();
        if (call.method == 'error') widget.onError?.call(call.arguments as String);
        if (call.method == 'point') {
          final Map<dynamic, dynamic> p = call.arguments as Map;
          widget.onPoint?.call((p['lat'] as num).toDouble(), (p['lon'] as num).toDouble(), p['inside'] as bool);
        }
      });
    },
  );
}
