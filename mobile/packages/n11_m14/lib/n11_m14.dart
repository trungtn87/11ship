library;

import 'package:flutter/services.dart';

// The offline map view and the point picker moved to the map-only package so 11Food can use them without the recorder; 11Ship keeps the same import.
export 'package:n11_m14_map/n11_m14_map.dart';

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
  ///
  /// [apiBaseUrl] (https only) is where 11Ship's service sends the position itself; the GPS test app passes none and never sends.
  Future<void> start({required bool consent, String? apiBaseUrl}) async {
    if (!consent) throw ArgumentError('Cần đồng ý cập nhật vị trí trước khi bắt đầu');
    await _channel.invokeMethod<void>('start', <String, dynamic>{'consent': true, if (apiBaseUrl != null) 'apiBaseUrl': apiBaseUrl});
  }
  Future<void> stop() => _channel.invokeMethod<void>('stop');

  /// Opens the phone's own settings screen: 'app' (permissions), 'location' (GPS on/off) or 'notifications'. Never changes a setting itself.
  Future<void> openSettings(String kind) => _channel.invokeMethod<void>('openSettings', <String, dynamic>{'kind': kind});
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
