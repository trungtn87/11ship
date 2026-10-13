import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'location.dart';

// Food: the shop profile of the owner (F20-F23), over the contract that already exists on the server:
//   GET /v1/onboarding/shop/profile        PUT /v1/onboarding/shop/profile        POST /v1/onboarding/shop/complete
//   GET /v1/onboarding/shop/service-areas  POST /v1/client-auth/context (only on the person's own action)
// Everything shown comes from those answers. Nothing is invented: no area, no coordinate, no status. The app never creates a draft
// by itself, never derives an area from the position, and never completes a profile the server has not stored.

@immutable
class ShopProfile {
  const ShopProfile({
    required this.shopId,
    required this.name,
    required this.contactPhone,
    required this.zalo,
    required this.facebook,
    required this.addressText,
    required this.pickupLat,
    required this.pickupLng,
    required this.serviceAreaId,
    required this.status,
    required this.acceptingOrders,
    required this.version,
  });

  final String shopId;
  final String name;
  final String contactPhone;
  final String? zalo;
  final String? facebook;
  final String addressText;
  final double? pickupLat;
  final double? pickupLng;
  final String? serviceAreaId;

  /// INCOMPLETE / ACTIVE / DISABLED.
  final String status;
  final bool acceptingOrders;
  final int version;

  bool get hasLocation => pickupLat != null && pickupLng != null;

  /// What the server needs before it will complete: a stored point and a stored area (the server decides; this only orders the UI).
  bool get readyToComplete => status == 'INCOMPLETE' && hasLocation && serviceAreaId != null;

  static ShopProfile? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? id = data['shop_id'];
    final Object? name = data['name'];
    final Object? phone = data['contact_phone'];
    final Object? address = data['address_text'];
    final Object? status = data['status'];
    final Object? accepting = data['accepting_orders'];
    final Object? version = data['version'];
    final Object? lat = data['pickup_lat'];
    final Object? lng = data['pickup_lng'];
    if (id is! String || name is! String || phone is! String || address is! String || status is! String || accepting is! bool || version is! int) {
      return null;
    }
    return ShopProfile(
      shopId: id,
      name: name,
      contactPhone: phone,
      zalo: data['zalo'] as String?,
      facebook: data['facebook'] as String?,
      addressText: address,
      pickupLat: lat is num ? lat.toDouble() : null,
      pickupLng: lng is num ? lng.toDouble() : null,
      serviceAreaId: data['service_area_id'] as String?,
      status: status,
      acceptingOrders: accepting,
      version: version,
    );
  }
}

@immutable
class ServiceArea {
  const ServiceArea({required this.id, required this.name});

  final String id;
  final String name;
}

enum ShopLoad { idle, loading, ready, failed }

class ShopController extends ChangeNotifier {
  ShopController({required this.session, required this.location}) {
    session.addListener(_onSession);
    _sessionEpoch = session.sessionEpoch;
  }

  final SessionController session;
  final LocationProvider location;

  ShopLoad _load = ShopLoad.idle;
  ShopProfile? _profile;
  List<ServiceArea> _areas = const <ServiceArea>[];
  bool _areasFailed = false;
  AuthFailure? _failure;
  bool _busy = false;
  LocationFix? _fix;
  LocationFailure? _locationFailure;
  bool _locating = false;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;

  // Form values live here (not in the widgets) so they survive going back and forth between the form and the location step.
  String name = '';
  String contactPhone = '';
  String addressText = '';
  String zalo = '';
  String facebook = '';
  String? serviceAreaId;

  // A write whose answer was lost: the same key and body, sent again only when the person presses retry.
  String? _pendingKey;
  String? _pendingBody;
  String? _pendingKind;

  ShopLoad get loadState => _load;
  ShopProfile? get profile => _profile;
  List<ServiceArea> get areas => _areas;
  bool get areasFailed => _areasFailed;
  AuthFailure? get failure => _failure;
  bool get busy => _busy;
  LocationFix? get fix => _fix;
  LocationFailure? get locationFailure => _locationFailure;
  bool get locating => _locating;
  bool get hasPendingWrite => _pendingKey != null;

  void _onSession() {
    if (session.sessionEpoch != _sessionEpoch || session.status != SessionStatus.signedIn) {
      // Another session, a logout or an ended session: every personal value and every pending view goes.
      _sessionEpoch = session.sessionEpoch;
      clear();
    }
  }

  /// Drops the profile, the form, the position and any pending write.
  void clear() {
    _epoch++;
    _load = ShopLoad.idle;
    _profile = null;
    _areas = const <ServiceArea>[];
    _areasFailed = false;
    _failure = null;
    _busy = false;
    _fix = null;
    _locationFailure = null;
    _locating = false;
    name = '';
    contactPhone = '';
    addressText = '';
    zalo = '';
    facebook = '';
    serviceAreaId = null;
    _pendingKey = null;
    _pendingBody = null;
    _pendingKind = null;
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

  void _fillFormFromProfile(ShopProfile profile) {
    name = profile.name;
    contactPhone = profile.contactPhone;
    addressText = profile.addressText;
    zalo = profile.zalo ?? '';
    facebook = profile.facebook ?? '';
    serviceAreaId = profile.serviceAreaId;
  }

  /// GET profile (and, for a draft or a new profile, the ACTIVE areas). A new profile is NOT created here.
  Future<void> load() async {
    if (_busy) {
      return;
    }
    final int epoch = _epoch;
    _load = ShopLoad.loading;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/onboarding/shop/profile');
      if (epoch != _epoch) {
        return;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final Object? data = response.data;
      final ShopProfile? parsed = ShopProfile.tryParse(data);
      if (data != null && parsed == null) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      _profile = parsed;
      if (parsed != null) {
        _fillFormFromProfile(parsed);
      }
      if (parsed == null || parsed.status == 'INCOMPLETE') {
        await _loadAreas(epoch);
      }
      if (epoch != _epoch) {
        return;
      }
      _load = ShopLoad.ready;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      _failure = failure;
      _load = ShopLoad.failed;
    }
    _notify();
  }

  Future<void> _loadAreas(int epoch) async {
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/onboarding/shop/service-areas');
      if (epoch != _epoch) {
        return;
      }
      final Object? data = response.status == 200 ? response.data : null;
      if (data is! List<Object?>) {
        _areasFailed = true;
        _areas = const <ServiceArea>[];
        return;
      }
      _areas = <ServiceArea>[
        for (final Object? item in data)
          if (item is Map<String, Object?> && item['service_area_id'] is String && item['name'] is String)
            ServiceArea(id: item['service_area_id']! as String, name: item['name']! as String),
      ];
      _areasFailed = false;
      if (serviceAreaId != null && !_areas.any((ServiceArea a) => a.id == serviceAreaId)) {
        // The stored choice is no longer an ACTIVE area: it is shown as not chosen (the server still holds what it holds).
        serviceAreaId = null;
      }
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthFailureKind.sessionEnded) {
        rethrow;
      }
      _areasFailed = true;
      _areas = const <ServiceArea>[];
    }
  }

  Future<void> reloadAreas() async {
    final int epoch = _epoch;
    try {
      await _loadAreas(epoch);
    } on AuthFailure catch (failure) {
      _failure = failure;
    }
    _notify();
  }

  // ---- position --------------------------------------------------------------------------------------------------

  /// ONE real fix, only on the person's press. Denied / disabled / timeout / unavailable leave no position and keep the draft.
  Future<void> capturePosition() async {
    if (_locating) {
      return;
    }
    final int epoch = _epoch;
    _locating = true;
    _locationFailure = null;
    _notify();
    try {
      final LocationFix fix = await location.currentFix();
      if (epoch != _epoch) {
        return;
      }
      _fix = fix;
    } on LocationException catch (error) {
      if (epoch != _epoch) {
        return;
      }
      _locationFailure = error.failure;
    }
    _locating = false;
    _notify();
  }

  void discardPosition() {
    _fix = null;
    _notify();
  }

  // ---- save / complete -------------------------------------------------------------------------------------------

  Map<String, Object?> _body() {
    final ShopProfile? current = _profile;
    final LocationFix? fresh = _fix;
    final double? lat = fresh?.latitude ?? current?.pickupLat;
    final double? lng = fresh?.longitude ?? current?.pickupLng;
    return <String, Object?>{
      'name': name.trim(),
      'contact_phone': contactPhone.trim(),
      'address_text': addressText.trim(),
      if (zalo.trim().isNotEmpty) 'zalo': zalo.trim(),
      if (facebook.trim().isNotEmpty) 'facebook': facebook.trim(),
      if (lat != null && lng != null) 'pickup_lat': lat,
      if (lat != null && lng != null) 'pickup_lng': lng,
      if (serviceAreaId != null) 'service_area_id': serviceAreaId,
      if (current != null) 'expected_version': current.version,
    };
  }

  /// PUT the draft (works without a position). Returns true when the server stored it.
  Future<bool> saveDraft() async {
    if (_busy) {
      return false;
    }
    final String body = jsonEncode(_body());
    final bool same = _pendingKind == 'save' && _pendingBody == body;
    return _write(kind: 'save', method: 'PUT', path: '/v1/onboarding/shop/profile', body: body, key: same ? _pendingKey! : newIdempotencyKey());
  }

  /// POST complete with the stored version. Only for a profile the server holds with a point and an area.
  Future<bool> complete() async {
    final ShopProfile? current = _profile;
    if (_busy || current == null || !current.readyToComplete) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{'expected_version': current.version});
    final bool same = _pendingKind == 'complete' && _pendingBody == body;
    return _write(kind: 'complete', method: 'POST', path: '/v1/onboarding/shop/complete', body: body, key: same ? _pendingKey! : newIdempotencyKey());
  }

  /// The person pressed "Thử lại" after a lost answer: the very same key and body.
  Future<bool> retryPending() async {
    final String? kind = _pendingKind;
    final String? body = _pendingBody;
    final String? key = _pendingKey;
    if (_busy || kind == null || body == null || key == null) {
      return false;
    }
    return _write(
      kind: kind,
      method: kind == 'save' ? 'PUT' : 'POST',
      path: kind == 'save' ? '/v1/onboarding/shop/profile' : '/v1/onboarding/shop/complete',
      body: body,
      key: key,
    );
  }

  Future<bool> _write({required String kind, required String method, required String path, required String body, required String key}) async {
    final int epoch = _epoch;
    _busy = true;
    _failure = null;
    _pendingKind = kind;
    _pendingBody = body;
    _pendingKey = key;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall(method, path, body: body, idempotencyKey: key);
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200 && response.status != 201) {
        throw failureOf(response);
      }
      _pendingKind = null;
      _pendingBody = null;
      _pendingKey = null;
      if (kind == 'save') {
        _fix = null;
      }
      _busy = false;
      // Read back what the server holds; the answer of the write is not trusted to be the whole truth.
      await load();
      if (kind == 'complete') {
        await session.refreshIdentity();
      }
      return epoch == _epoch;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      final bool unknown = failure.kind == AuthFailureKind.unknownOutcome ||
          (failure.kind == AuthFailureKind.serverUnavailable && failure.code == 'TRANSACTION_OUTCOME_UNKNOWN');
      if (!unknown) {
        _pendingKind = null;
        _pendingBody = null;
        _pendingKey = null;
      }
      _failure = failure;
      _busy = false;
      if (failure.kind == AuthFailureKind.versionConflict || failure.kind == AuthFailureKind.stateConflict) {
        _notify();
        // The profile moved on elsewhere: show what the server holds now, overwrite nothing.
        await load();
        _failure = failure;
      }
      _notify();
      return false;
    }
  }

  // ---- context ---------------------------------------------------------------------------------------------------

  /// The person's own choice between customer and shop-owner mode. The server decides; nothing is granted here.
  Future<bool> switchContext(String context) async {
    if (_busy) {
      return false;
    }
    final int epoch = _epoch;
    _busy = true;
    _failure = null;
    _notify();
    try {
      await session.selectContext(context);
      return epoch == _epoch;
    } on AuthFailure catch (failure) {
      if (epoch == _epoch) {
        _failure = failure;
      }
      return false;
    } finally {
      if (epoch == _epoch) {
        _busy = false;
        _notify();
      }
    }
  }
}
