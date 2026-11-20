/// Map-only M14 core: the offline Cao Bằng map and the point picker. It never starts GPS, never asks for a permission, never calculates a route and
/// never uploads anything; the recorder, the foreground service and the routing client live in `n11_m14` (11Ship only).
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

export 'src/polyline6.dart';

/// True when this build carries the Cao Bằng package and the app turned the map on (`--dart-define=M14_OFFLINE_MAP=true`). The build only sets the flag
/// when the asset is present, so a screen never opens a map that cannot load.
const bool kM14MapEnabled = bool.fromEnvironment('M14_OFFLINE_MAP');

/// A local MapLibre view. Does not start GPS, calculate routes or upload data.
/// Coordinates are [latitude, longitude]; attribution is always visible.
class M14OfflineMap extends StatelessWidget {
  const M14OfflineMap({super.key, this.pins = const <Map<String, dynamic>>[],
    this.route = const <List<double>>[], this.onPoint, this.onReady, this.onError, this.focusPin = false, this.centerRequest = 0, this.radiusCircle});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final bool focusPin;
  final int centerRequest;
  /// Visual-only radius overlay (`lat`, `lon`, `radius_m`, `color`, `fill_color`).
  final Map<String, dynamic>? radiusCircle;
  final VoidCallback? onReady;
  final ValueChanged<String>? onError;
  final void Function(double latitude, double longitude, bool insideCoverage)? onPoint;

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || (defaultTargetPlatform != TargetPlatform.android && defaultTargetPlatform != TargetPlatform.iOS)) {
      return const Center(child: Text('Bản đồ offline Cao Bằng chỉ có trên điện thoại'));
    }
    return _NativeMap(pins: pins, route: route, onPoint: onPoint, onReady: onReady, onError: onError, focusPin: focusPin, centerRequest: centerRequest, radiusCircle: radiusCircle);
  }
}

class _NativeMap extends StatefulWidget {
  const _NativeMap({required this.pins, required this.route, this.onPoint, this.onReady, this.onError, this.focusPin = false, this.centerRequest = 0, this.radiusCircle});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final bool focusPin;
  final int centerRequest;
  final Map<String, dynamic>? radiusCircle;
  final VoidCallback? onReady;
  final ValueChanged<String>? onError;
  final void Function(double, double, bool)? onPoint;
  @override
  State<_NativeMap> createState() => _NativeMapState();
}
class _NativeMapState extends State<_NativeMap> {
  MethodChannel? _channel;
  // Signature of the data the native view was last sent. Null until the channel exists (#387): a change made before that is kept, not dropped,
  // and is sent as soon as the view is created.
  String? _sent;
  Map<String, dynamic> get _data => <String, dynamic>{'pins': widget.pins, 'route': widget.route, 'focus_pin': widget.focusPin,
    'select_points': widget.onPoint != null, 'center_request': widget.centerRequest, if (widget.radiusCircle != null) 'radius_circle': widget.radiusCircle};
  @override
  void didUpdateWidget(covariant _NativeMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    _pushChanged();
  }
  /// Redraws natively only when the data changed: the screen around the map rebuilds with identical data while typing (#299).
  void _pushChanged() {
    final MethodChannel? channel = _channel;
    if (channel == null) return;
    final String signature = jsonEncode(_data);
    if (signature == _sent) return;
    _sent = signature;
    channel.invokeMethod<void>('update', _data).catchError((Object _) {
      if (mounted) widget.onError?.call('Không cập nhật được ghim trên bản đồ. Hãy thử chạm lại.');
    });
  }
  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    // A bounded map card must receive pan/pinch gestures even when embedded in a ScrollView.
    final Set<Factory<OneSequenceGestureRecognizer>> gestures = <Factory<OneSequenceGestureRecognizer>>{Factory<EagerGestureRecognizer>(EagerGestureRecognizer.new)};
    return defaultTargetPlatform == TargetPlatform.iOS
        ? UiKitView(viewType: 'vn.eleven/m14/map', gestureRecognizers: gestures, creationParams: _data, creationParamsCodec: const StandardMessageCodec(), onPlatformViewCreated: _created)
        : AndroidView(viewType: 'vn.eleven/m14/map', gestureRecognizers: gestures, creationParams: _data, creationParamsCodec: const StandardMessageCodec(), onPlatformViewCreated: _created);
  }

  void _created(int id) {
      if (!mounted) return;
      final MethodChannel channel = MethodChannel('vn.eleven/m14/map/$id');
      _channel = channel;
      channel.setMethodCallHandler((MethodCall call) async {
        if (!mounted) return;
        if (call.method == 'ready') widget.onReady?.call();
        if (call.method == 'error') widget.onError?.call(call.arguments as String);
        if (call.method == 'point') {
          final Map<dynamic, dynamic> p = call.arguments as Map;
          widget.onPoint?.call((p['lat'] as num).toDouble(), (p['lon'] as num).toDouble(), p['inside'] as bool);
        }
      });
      // The native view was created with the params of the build before this moment: send the CURRENT pins/route/mode once, so nothing set
      // before the channel existed is lost (#387).
      _sent = null;
      _pushChanged();
      // Recover readiness/errors emitted before Dart installed its handler.
      channel.invokeMapMethod<String, dynamic>('state').then((Map<String, dynamic>? state) {
        if (!mounted) return;
        if (state?['error'] is String) { widget.onError?.call(state!['error'] as String); }
        else if (state?['ready'] == true) { widget.onReady?.call(); }
      }).catchError((Object error) { if (mounted) widget.onError?.call('Không mở được bản đồ Cao Bằng'); });
  }
}
