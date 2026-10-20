import '../m02/menu_models.dart';
import 'shop_logo_data.dart';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'location.dart';
import '../widgets/form_feedback.dart';

// Food: the shop profile of the owner (F20-F23), over the contract that already exists on the server:
//   GET /v1/onboarding/shop/profile        PUT /v1/onboarding/shop/profile        POST /v1/onboarding/shop/complete
//   GET /v1/onboarding/shop/service-areas  POST /v1/client-auth/context (only on the person's own action)
// Everything shown comes from those answers. Nothing is invented: no area, no coordinate, no status. The app never creates a draft
// by itself and never completes a profile the server has not stored.

@immutable
class ShopProfile {
  const ShopProfile({
    required this.shopId,
    required this.name,
    required this.contactPhone,
    required this.zalo,
    required this.facebook,
    this.logo,
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
  final ShopLogoData? logo;
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
    if (id is! String || name is! String || phone is! String || address is! String || status is! String || accepting is! bool || version is! int || version < 1) {
      return null;
    }
    // A malformed optional value is a bad response, never an unchecked cast that leaves the form busy.
    for (final String field in <String>['zalo', 'facebook', 'service_area_id']) {
      if (data[field] != null && data[field] is! String) { return null; }
    }
    if ((lat == null) != (lng == null) ||
        (lat != null && (lat is! num || !lat.isFinite || lat.abs() > 90)) ||
        (lng != null && (lng is! num || !lng.isFinite || lng.abs() > 180))) {
      return null;
    }
    if (data['logo'] != null && ShopLogoData.tryParse(data['logo']) == null) return null;
    return ShopProfile(
      shopId: id,
      logo: ShopLogoData.tryParse(data['logo']),
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
  ShopController({required this.session, required this.location, this.picker = const NoImagePicker()}) {
    session.addListener(_onSession);
    _sessionEpoch = session.sessionEpoch;
  }

  final SessionController session;
  final LocationProvider location;
  final ImagePickerPort picker;
  ShopLogoData? logo;

  void setLogo(ShopLogoData? value) {
    if (busy || hasPendingWrite || (_profile != null && _profile!.status != 'INCOMPLETE')) return;
    logo = value;
    _notify();
  }

  ShopLoad _load = ShopLoad.idle;
  ShopProfile? _profile;
  List<ServiceArea> _areas = const <ServiceArea>[];
  bool _areasFailed = false;
  AuthFailure? _failure;
  int _failureView = 0;
  bool _busy = false;
  bool _finishing = false;
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
  bool get busy => _busy || _finishing;
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

  void dismissFailure({bool notify = true}) {
    _failureView++;
    // An unresolved write must keep its visible retry and exact intent.
    if (!hasPendingWrite) _failure = null;
    if (notify) _notify();
  }

  /// Drops the profile, the form, the position and any pending write.
  void clear() {
    _epoch++;
    _formRevision++;
    _load = ShopLoad.idle;
    _profile = null;
    _areas = const <ServiceArea>[];
    _areasFailed = false;
    _failure = null;
    _busy = false;
    _finishing = false;
    _fix = null;
    _locationFailure = null;
    _locating = false;
    name = '';
    contactPhone = '';
    addressText = '';
    zalo = '';
    facebook = '';
    logo = null;
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

  /// Bumps whenever the form fields above are REPLACED by the controller (a server snapshot was accepted, or everything was
  /// cleared). A screen that keeps its own text controllers re-reads the fields when it changes, so what is displayed is never an
  /// older snapshot than what the next save will send.
  int _formRevision = 0;
  int get formRevision => _formRevision;

  void _fillFormFromProfile(ShopProfile profile) {
    _formRevision++;
    name = profile.name;
    contactPhone = profile.contactPhone;
    addressText = profile.addressText;
    zalo = profile.zalo ?? '';
    facebook = profile.facebook ?? '';
    logo = profile.logo;
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
        throw failureOf(response, endpoint: '/v1/onboarding/shop/profile');
      }
      if (response.json?.containsKey('data') != true) {
        throw AuthFailure(AuthFailureKind.badResponse, status: response.status, endpoint: '/v1/onboarding/shop/profile');
      }
      final Object? data = response.data;
      final ShopProfile? parsed = ShopProfile.tryParse(data);
      if (data != null && parsed == null) {
        throw AuthFailure(AuthFailureKind.badResponse, status: response.status, endpoint: '/v1/onboarding/shop/profile');
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
      if (serviceAreaId == null && _areas.length == 1) serviceAreaId = _areas.single.id;
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

  void selectAddress(String text, {double? latitude, double? longitude}) {
    if (_busy || hasPendingWrite || session.status != SessionStatus.signedIn) return;
    addressText = text;
    if (latitude != null && longitude != null) {
      _fix = LocationFix(latitude: latitude, longitude: longitude, accuracyMeters: null, takenAt: DateTime.now());
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
      if (logo != current?.logo) 'logo': logo?.toWire(),
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

  Map<String, String?> get fieldErrors => <String, String?>{
    'name': textError(name, 'tên cửa hàng', 120),
    'phone': phoneError(contactPhone),
    'address': textError(addressText, 'địa chỉ lấy hàng', 500) ??
        (_fix == null && !(_profile?.hasLocation ?? false) ? 'Mở địa chỉ và chọn vị trí trên bản đồ.' : null),
    'zalo': textError(zalo, 'Zalo', 160, optional: true),
    'facebook': textError(facebook, 'Facebook', 300, optional: true),
  };

  bool get canFinish => fieldErrors.values.every((String? error) => error == null);

  bool get _profileChanged {
    final ShopProfile? p = _profile;
    return p == null || logo != p.logo || _fix != null || name.trim() != p.name ||
        contactPhone.trim() != p.contactPhone || addressText.trim() != p.addressText ||
        zalo.trim() != (p.zalo ?? '') || facebook.trim() != (p.facebook ?? '') || serviceAreaId != p.serviceAreaId;
  }

  /// One user action; each server mutation retains its own version and idempotency key.
  Future<bool> finishProfile() async {
    if (busy || session.status != SessionStatus.signedIn) { return false; }
    final int epoch = _epoch;
    _finishing = true;
    _notify();
    try {
      if (hasPendingWrite && !await retryPending()) { return false; }
      if (epoch != _epoch) { return false; }
      if (_profile?.status == 'ACTIVE') {
        await session.refreshIdentity();
        return epoch == _epoch && session.identity?.availableRoles.contains('SHOP_OWNER') == true;
      }
      if (!canFinish) { return false; }
      if (serviceAreaId == null) { await _loadAreas(epoch); }
      if (epoch != _epoch) { return false; }
      if (serviceAreaId == null) {
        _failure = const AuthFailure(AuthFailureKind.invalidServiceArea);
        return false;
      }
      if (_profileChanged && !await saveDraft()) { return false; }
      if (epoch != _epoch || _load != ShopLoad.ready || _profile?.readyToComplete != true) { return false; }
      return await complete() && _profile?.status == 'ACTIVE';
    } on AuthFailure catch (failure) {
      if (epoch == _epoch) { _failure = failure; }
      return false;
    } finally {
      if (epoch == _epoch) { _finishing = false; _notify(); }
    }
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
    final int failureView = _failureView;
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
        final AuthFailure failure = failureOf(response, endpoint: path);
        // An upstream 5xx can follow a committed write. Retry this exact intent, never a new key.
        if (response.status >= 500) {
          throw AuthFailure(AuthFailureKind.unknownOutcome, status: response.status, code: failure.code, endpoint: path, requestId: failure.requestId);
        }
        throw failure;
      }
      _busy = false;
      // Keep the intent and selected point until a valid server snapshot confirms the write.
      await load();
      if (epoch != _epoch || _load != ShopLoad.ready || _profile == null) {
        if (epoch == _epoch && _failure == null) {
          _failure = const AuthFailure(AuthFailureKind.badResponse, status: 200, endpoint: '/v1/onboarding/shop/profile');
        }
        _notify();
        return false;
      }
      _pendingKind = null;
      _pendingBody = null;
      _pendingKey = null;
      if (kind == 'save') { _fix = null; }
      if (kind == 'complete') {
        await session.refreshIdentity();
      }
      return epoch == _epoch;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      final bool unknown = failure.outcomeUnknown;
      if (!unknown) {
        _pendingKind = null;
        _pendingBody = null;
        _pendingKey = null;
      }
      if (failure.outcomeUnknown || failureView == _failureView) _failure = failure;
      _busy = false;
      if (failure.kind == AuthFailureKind.versionConflict || failure.kind == AuthFailureKind.stateConflict) {
        _notify();
        // The profile moved on elsewhere: show what the server holds now, overwrite nothing.
        await load();
        if (failure.outcomeUnknown || failureView == _failureView) _failure = failure;
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
