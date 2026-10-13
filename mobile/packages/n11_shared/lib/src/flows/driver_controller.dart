import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

// Ship: the driver profile (S12-S13) over GET /v1/driver/me and POST /v1/onboarding/driver. Reading grants nothing and submitting
// grants no right to take deliveries: the server keeps the profile PENDING until it is approved elsewhere. The name is typed by the
// person (never copied from the customer profile); nothing about approval, bank or wallet is shown or invented.

@immutable
class DriverProfile {
  const DriverProfile({required this.driverId, required this.fullName, required this.plateNumber, required this.driverType, required this.status, required this.acceptingDeliveries, required this.version});

  final String driverId;
  final String fullName;
  final String? plateNumber;
  final String driverType;

  /// PENDING / ACTIVE / SUSPENDED / CLOSING / CLOSED, exactly as stored.
  final String status;
  final bool acceptingDeliveries;
  final int version;

  static DriverProfile? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? id = data['driver_id'];
    final Object? name = data['full_name'];
    final Object? type = data['driver_type'];
    final Object? status = data['status'];
    final Object? accepting = data['accepting_deliveries'];
    final Object? version = data['version'];
    if (id is! String || name is! String || type is! String || status is! String || accepting is! bool || version is! int) {
      return null;
    }
    return DriverProfile(driverId: id, fullName: name, plateNumber: data['plate_number'] as String?, driverType: type, status: status, acceptingDeliveries: accepting, version: version);
  }
}

String driverStatusLabel(String status) {
  switch (status) {
    case 'PENDING':
      return 'Chờ duyệt';
    case 'ACTIVE':
      return 'Đang hoạt động';
    case 'SUSPENDED':
      return 'Tạm ngưng';
    case 'CLOSING':
      return 'Đang đóng hồ sơ';
    case 'CLOSED':
      return 'Đã đóng';
    default:
      return 'Không rõ';
  }
}

String driverTypeLabel(String type) {
  switch (type) {
    case 'PLATFORM':
      return 'Xế của nền tảng';
    case 'EXTERNAL':
      return 'Xế bên ngoài';
    default:
      return type;
  }
}

enum DriverLoad { idle, loading, ready, failed }

class DriverController extends ChangeNotifier {
  DriverController({required this.session}) {
    _sessionEpoch = session.sessionEpoch;
    session.addListener(_onSession);
  }

  final SessionController session;

  DriverLoad _load = DriverLoad.idle;
  DriverProfile? _profile;
  AuthFailure? _failure;
  bool _busy = false;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;
  String? _pendingKey;
  String? _pendingBody;

  String fullName = '';
  String plateNumber = '';

  DriverLoad get loadState => _load;
  DriverProfile? get profile => _profile;
  AuthFailure? get failure => _failure;
  bool get busy => _busy;
  bool get hasPendingWrite => _pendingKey != null;

  void _onSession() {
    if (session.sessionEpoch != _sessionEpoch || session.status != SessionStatus.signedIn) {
      _sessionEpoch = session.sessionEpoch;
      clear();
    }
  }

  void clear() {
    _epoch++;
    _load = DriverLoad.idle;
    _profile = null;
    _failure = null;
    _busy = false;
    _pendingKey = null;
    _pendingBody = null;
    fullName = '';
    plateNumber = '';
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    session.removeListener(_onSession);
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  /// Reads the profile from the server every time (opening the screen again reads fresh; "Tải lại" calls this too).
  Future<void> load() async {
    if (_busy) {
      return;
    }
    final int epoch = _epoch;
    _load = DriverLoad.loading;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/driver/me');
      if (epoch != _epoch) {
        return;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final Object? data = response.data;
      final DriverProfile? parsed = DriverProfile.tryParse(data);
      if (data != null && parsed == null) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      _profile = parsed;
      _load = DriverLoad.ready;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      _failure = failure;
      _load = DriverLoad.failed;
    }
    _notify();
  }

  /// POST the profile. Only when the server holds none; a second submit is refused here and by the server. The same key and body
  /// are reused when the person retries after a lost answer.
  Future<bool> submit() async {
    if (_busy || _profile != null) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{
      'full_name': fullName.trim(),
      if (plateNumber.trim().isNotEmpty) 'plate_number': plateNumber.trim(),
    });
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    return _send(body, key);
  }

  Future<bool> retryPending() async {
    final String? body = _pendingBody;
    final String? key = _pendingKey;
    if (_busy || body == null || key == null) {
      return false;
    }
    return _send(body, key);
  }

  Future<bool> _send(String body, String key) async {
    final int epoch = _epoch;
    _busy = true;
    _failure = null;
    _pendingBody = body;
    _pendingKey = key;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall('POST', '/v1/onboarding/driver', body: body, idempotencyKey: key);
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200 && response.status != 201) {
        throw failureOf(response);
      }
      _pendingBody = null;
      _pendingKey = null;
      _busy = false;
      // Read both back from the server: the profile and what `me` now says. The context is NOT changed here.
      await load();
      await session.refreshIdentity();
      return epoch == _epoch;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      final bool unknown = failure.kind == AuthFailureKind.unknownOutcome ||
          (failure.kind == AuthFailureKind.serverUnavailable && failure.code == 'TRANSACTION_OUTCOME_UNKNOWN');
      if (!unknown) {
        _pendingBody = null;
        _pendingKey = null;
      }
      _failure = failure;
      _busy = false;
      _notify();
      if (failure.kind == AuthFailureKind.stateConflict) {
        // A profile already exists: show it, create no second one.
        await load();
        _failure = failure;
        _notify();
      }
      return false;
    }
  }
}
