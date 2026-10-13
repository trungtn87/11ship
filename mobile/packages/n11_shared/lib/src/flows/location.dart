import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// One real position fix, taken only when the person presses the button at the shop (foreground, one shot, no tracking). The native
// side (mobile/tool/android-templates/kotlin/N11LocationChannel.kt) asks for the minimal foreground location permission, refuses a
// mock provider, and never keeps listening. There is no default position and no way to type coordinates to pass the gate.

enum LocationFailure { denied, disabled, timeout, unavailable }

class LocationException implements Exception {
  const LocationException(this.failure);

  final LocationFailure failure;

  @override
  String toString() => 'LocationException($failure)';
}

@immutable
class LocationFix {
  const LocationFix({required this.latitude, required this.longitude, required this.accuracyMeters, required this.takenAt});

  final double latitude;
  final double longitude;
  final double? accuracyMeters;
  final DateTime takenAt;
}

abstract class LocationProvider {
  /// Asks for permission when needed and takes ONE fix. Throws [LocationException].
  Future<LocationFix> currentFix();
}

class MethodChannelLocationProvider implements LocationProvider {
  MethodChannelLocationProvider({MethodChannel? channel}) : _channel = channel ?? const MethodChannel('vn.eleven.n11/location');

  final MethodChannel _channel;

  @override
  Future<LocationFix> currentFix() async {
    try {
      final Map<Object?, Object?>? raw = await _channel.invokeMethod<Map<Object?, Object?>>('currentFix');
      final Object? lat = raw?['latitude'];
      final Object? lng = raw?['longitude'];
      final Object? accuracy = raw?['accuracyMeters'];
      final Object? millis = raw?['takenAtMillis'];
      if (lat is! double || lng is! double || lat.abs() > 90 || lng.abs() > 180 || !lat.isFinite || !lng.isFinite) {
        throw const LocationException(LocationFailure.unavailable);
      }
      return LocationFix(
        latitude: lat,
        longitude: lng,
        accuracyMeters: accuracy is double ? accuracy : null,
        takenAt: millis is int ? DateTime.fromMillisecondsSinceEpoch(millis) : DateTime.now(),
      );
    } on PlatformException catch (error) {
      switch (error.code) {
        case 'DENIED':
          throw const LocationException(LocationFailure.denied);
        case 'DISABLED':
          throw const LocationException(LocationFailure.disabled);
        case 'TIMEOUT':
          throw const LocationException(LocationFailure.timeout);
        default:
          throw const LocationException(LocationFailure.unavailable);
      }
    } on MissingPluginException {
      throw const LocationException(LocationFailure.unavailable);
    }
  }
}

String locationFailureMessage(LocationFailure failure) {
  switch (failure) {
    case LocationFailure.denied:
      return 'Bạn chưa cho phép ứng dụng dùng vị trí. Bạn vẫn lưu nháp được, nhưng chưa hoàn tất hồ sơ khi chưa có vị trí.';
    case LocationFailure.disabled:
      return 'Dịch vụ vị trí của điện thoại đang tắt. Hãy bật rồi thử lại; bạn vẫn lưu nháp được.';
    case LocationFailure.timeout:
      return 'Chưa lấy được vị trí trong thời gian chờ. Hãy ra nơi thoáng hơn và thử lại; bạn vẫn lưu nháp được.';
    case LocationFailure.unavailable:
      return 'Không lấy được vị trí thật từ điện thoại. Bạn vẫn lưu nháp được, nhưng chưa hoàn tất hồ sơ.';
  }
}
