library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Calling status/map/cache never requests a position. Start is explicit only.
class M14Client {
  const M14Client();
  static const MethodChannel _channel = MethodChannel('vn.eleven/m14');
  static const EventChannel _events = EventChannel('vn.eleven/m14/gps');
  Stream<Map<String, dynamic>> get positions => _events.receiveBroadcastStream()
      .map((dynamic value) => Map<String, dynamic>.from(value as Map));

  Future<Map<String, dynamic>> status() async =>
      Map<String, dynamic>.from((await _channel.invokeMapMethod<String, dynamic>('status'))!);
  Future<Map<String, dynamic>> mapPackage() async =>
      Map<String, dynamic>.from((await _channel.invokeMapMethod<String, dynamic>('mapPackage'))!);

  /// Present a Vietnamese explanation before passing consent=true. Android then
  /// asks only foreground precise location and notification permissions.
  Future<void> start({required bool consent}) async {
    if (!consent) throw ArgumentError('Cần đồng ý cập nhật vị trí trước khi bắt đầu');
    await _channel.invokeMethod<void>('start', <String, dynamic>{'consent': true});
  }
  Future<void> stop() => _channel.invokeMethod<void>('stop');
  Future<Map<String, dynamic>?> savedRoute() => _channel.invokeMapMethod<String, dynamic>('savedRoute');

  /// Call only from a user's Calculate action, never from the positions stream.
  /// No default demo endpoint: staging/production supplies its HTTPS origin.
  Future<Map<String, dynamic>> calculate({
    required String origin,
    required double startLat,
    required double startLon,
    required double endLat,
    required double endLon,
  }) async => Map<String, dynamic>.from((await _channel.invokeMapMethod<String, dynamic>('calculate', <String, dynamic>{
    'origin': origin, 'startLat': startLat, 'startLon': startLon,
    'endLat': endLat, 'endLon': endLon,
  }))!);
}

/// A local MapLibre view. Does not start GPS, calculate routes or upload data.
/// Coordinates are [latitude, longitude]; attribution is always visible.
class M14OfflineMap extends StatelessWidget {
  const M14OfflineMap({super.key, this.pins = const <Map<String, dynamic>>[],
    this.route = const <List<double>>[], this.onPoint});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final void Function(double latitude, double longitude, bool insideCoverage)? onPoint;

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return const Center(child: Text('Bản đồ offline M14 dành cho Android'));
    }
    return _NativeMap(pins: pins, route: route, onPoint: onPoint);
  }
}

class _NativeMap extends StatefulWidget {
  const _NativeMap({required this.pins, required this.route, this.onPoint});
  final List<Map<String, dynamic>> pins;
  final List<List<double>> route;
  final void Function(double, double, bool)? onPoint;
  @override
  State<_NativeMap> createState() => _NativeMapState();
}
class _NativeMapState extends State<_NativeMap> {
  MethodChannel? _channel;
  Map<String, dynamic> get _data => <String, dynamic>{'pins': widget.pins, 'route': widget.route};
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
    creationParams: _data,
    creationParamsCodec: const StandardMessageCodec(),
    onPlatformViewCreated: (int id) {
      _channel = MethodChannel('vn.eleven/m14/map/$id');
      _channel!.setMethodCallHandler((MethodCall call) async {
        if (call.method == 'point' && mounted) {
          final Map<dynamic, dynamic> p = call.arguments as Map;
          widget.onPoint?.call((p['lat'] as num).toDouble(), (p['lon'] as num).toDouble(), p['inside'] as bool);
        }
      });
    },
  );
}
