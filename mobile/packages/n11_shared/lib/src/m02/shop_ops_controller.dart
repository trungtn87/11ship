import '../flows/shop_logo_data.dart';
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../flows/location.dart';
import '../flows/shop_controller.dart' show ServiceArea;
import 'schedule.dart';

// M02-QUAN / M02-GIO: the owner's day-to-day shop screens (Q01-Q04) over the contract that already exists on the server:
//   GET /v1/shop/me                      profile + weekly schedule + availability, one snapshot, one version
//   PUT /v1/shop/me/profile              full replacement at expected_version, Idempotency-Key
//   PUT /v1/shop/me/business-hours       full replacement ([] = closed all week) at expected_version, Idempotency-Key
//   GET /v1/onboarding/shop/service-areas  the ACTIVE areas the profile may choose
// There is no switch that opens or closes the shop: the schedule is the only input and the server computes ONLINE / OFFLINE.
//
// Pending rule (the prototype v3 bug this class must not have): a write whose outcome is UNKNOWN (no usable answer, a gateway 502/504,
// TRANSACTION_OUTCOME_UNKNOWN) keeps its exact key AND body. While it is kept, nothing else may be written and the drafts are locked;
// the only way forward is [retryPending], which sends that very key and body again. It is released only when the outcome is DECIDED:
// the server answered 2xx, or refused it for good. A failed retry (still offline) keeps it. A session that ended drops everything
// and a pending write is never replayed under another account.

@immutable
class ShopAvailabilityView {
  const ShopAvailabilityView({required this.online, required this.reason, required this.evaluatedAt});

  final bool online;

  /// ONLINE / OUTSIDE_BUSINESS_HOURS / NO_BUSINESS_HOURS / SHOP_INCOMPLETE / SHOP_DISABLED / SERVICE_AREA_INACTIVE.
  final String reason;

  /// The SERVER's instant (UTC). The app never decides open/closed from the phone clock.
  final DateTime? evaluatedAt;
}

@immutable
class ShopOverview {
  const ShopOverview({
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
    required this.version,
    required this.hours,
    required this.availability,
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
  final String status;
  final int version;
  final WeekSchedule hours;
  final ShopAvailabilityView availability;

  bool get isActive => status == 'ACTIVE';
  bool get isDisabled => status == 'DISABLED';
  bool get isIncomplete => status == 'INCOMPLETE';
  bool get hasHours => hours.any((List<HourRange> d) => d.isNotEmpty);

  static ShopOverview? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? id = data['shop_id'];
    final Object? name = data['name'];
    final Object? phone = data['contact_phone'];
    final Object? address = data['address_text'];
    final Object? status = data['status'];
    final Object? version = data['version'];
    final Object? lat = data['pickup_lat'];
    final Object? lng = data['pickup_lng'];
    final WeekSchedule? hours = scheduleFromWire(data['hours']);
    final Object? availability = data['availability'];
    if (id is! String || name is! String || phone is! String || address is! String || status is! String || version is! int || hours == null || availability is! Map<String, Object?>) {
      return null;
    }
    final Object? online = availability['online'];
    final Object? reason = availability['reason'];
    final Object? at = availability['evaluated_at'];
    if (online is! bool || reason is! String) {
      return null;
    }
    if (data['logo'] != null && ShopLogoData.tryParse(data['logo']) == null) return null;
    return ShopOverview(
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
      version: version,
      hours: hours,
      availability: ShopAvailabilityView(online: online, reason: reason, evaluatedAt: at is String ? DateTime.tryParse(at) : null),
    );
  }
}

enum OpsLoad { idle, loading, ready, failed }

enum OpsWriteKind { profile, hours }

/// A write whose outcome is not known: exactly what was sent, kept until the outcome is decided.
class PendingWrite {
  const PendingWrite({required this.kind, required this.method, required this.path, required this.body, required this.key});

  final OpsWriteKind kind;
  final String method;
  final String path;
  final String body;
  final String key;
}

class ProfileDraft {
  ShopLogoData? logo;
  String name = '';
  String phone = '';
  String zalo = '';
  String facebook = '';
  String address = '';
  String? areaId;
}

class ShopOpsController extends ChangeNotifier {
  ShopOpsController({required this.session, required this.location, this.pollEvery = const Duration(seconds: 30)}) {
    session.addListener(_onSession);
    _sessionEpoch = session.sessionEpoch;
  }

  final SessionController session;
  final LocationProvider location;
  final Duration pollEvery;

  OpsLoad _load = OpsLoad.idle;
  ShopOverview? _overview;
  AuthFailure? _loadFailure;
  DateTime? _lastUpdated;
  bool _stale = false;
  bool _refreshing = false;

  final ProfileDraft profile = ProfileDraft();
  LocationFix? _fix;
  LocationFailure? _locationFailure;
  bool _locating = false;
  List<ServiceArea> _areas = const <ServiceArea>[];
  bool _areasFailed = false;
  Map<String, String> _profileErrors = <String, String>{};
  WeekSchedule _hours = emptyWeek();

  bool _busy = false;
  PendingWrite? _pending;
  AuthFailure? _writeFailure;
  bool _conflict = false;
  bool _savedNotReloaded = false;
  String? _notice;
  int _noticeSeq = 0;

  Timer? _timer;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;
  int _formRevision = 0;

  OpsLoad get loadState => _load;
  ShopOverview? get overview => _overview;
  AuthFailure? get loadFailure => _loadFailure;
  DateTime? get lastUpdated => _lastUpdated;

  /// The last refresh failed while older data is shown: the status may be out of date.
  bool get stale => _stale;
  LocationFix? get fix => _fix;
  LocationFailure? get locationFailure => _locationFailure;
  bool get locating => _locating;
  List<ServiceArea> get areas => _areas;
  bool get areasFailed => _areasFailed;
  Map<String, String> get profileErrors => _profileErrors;
  WeekSchedule get hoursDraft => _hours;
  bool get busy => _busy;
  PendingWrite? get pending => _pending;
  AuthFailure? get writeFailure => _writeFailure;

  /// The server says the data moved on (VERSION_CONFLICT): the drafts are kept untouched until the person loads the new version.
  bool get conflict => _conflict;

  /// The write was stored but reading it back failed.
  bool get savedNotReloaded => _savedNotReloaded;

  /// A short message for a toast; changes identity with [noticeSeq].
  String? get notice => _notice;
  int get noticeSeq => _noticeSeq;

  /// Nothing may be edited or written: a write is running or its outcome is still unknown.
  bool get locked => _busy || _pending != null;

  /// No write at all: the shop is not ACTIVE (DISABLED is read-only; INCOMPLETE belongs to the M01 onboarding).
  bool get readOnly => _overview == null || !_overview!.isActive;

  /// Bumps when the drafts are REPLACED by the controller, so screens with text controllers re-read them.
  int get formRevision => _formRevision;

  bool get profileDirty {
    final ShopOverview? o = _overview;
    if (o == null) {
      return false;
    }
    return profile.logo != o.logo || _fix != null ||
        profile.name.trim() != o.name ||
        profile.phone.trim() != o.contactPhone ||
        profile.address.trim() != o.addressText ||
        profile.zalo.trim() != (o.zalo ?? '') ||
        profile.facebook.trim() != (o.facebook ?? '') ||
        profile.areaId != o.serviceAreaId;
  }

  bool get hoursDirty => _overview != null && !sameWeek(_hours, _overview!.hours);

  void _onSession() {
    if (session.sessionEpoch != _sessionEpoch || session.status != SessionStatus.signedIn) {
      _sessionEpoch = session.sessionEpoch;
      clear();
    }
  }

  /// Drops every personal value, the drafts and any pending write (the session ended or changed).
  void clear() {
    _epoch++;
    stopPolling();
    _load = OpsLoad.idle;
    _overview = null;
    _loadFailure = null;
    _lastUpdated = null;
    _stale = false;
    _refreshing = false;
    _fix = null;
    _locationFailure = null;
    _locating = false;
    _areas = const <ServiceArea>[];
    _areasFailed = false;
    _profileErrors = <String, String>{};
    _hours = emptyWeek();
    _busy = false;
    _pending = null;
    _writeFailure = null;
    _conflict = false;
    _savedNotReloaded = false;
    _notice = null;
    _fillProfile(null);
    _formRevision++;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    session.removeListener(_onSession);
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _say(String text) {
    _notice = text;
    _noticeSeq++;
  }

  void _fillProfile(ShopOverview? o) {
    profile.name = o?.name ?? '';
    profile.phone = o?.contactPhone ?? '';
    profile.zalo = o?.zalo ?? '';
    profile.facebook = o?.facebook ?? '';
    profile.logo = o?.logo;
    profile.address = o?.addressText ?? '';
    profile.areaId = o?.serviceAreaId;
  }

  // ---- reading --------------------------------------------------------------------------------------------------

  /// The first load of Q01 (and the "Thử lại" of a failed one). Does not replace drafts that hold edits.
  Future<void> load() async {
    if (_load == OpsLoad.loading) {
      return;
    }
    _load = OpsLoad.loading;
    _loadFailure = null;
    _notify();
    await _read(initial: true);
  }

  /// Foreground / after save / timer refresh. Never overlaps itself; a failure keeps the old data and marks it out of date.
  Future<void> refresh() async {
    if (_refreshing || _busy || _load == OpsLoad.loading) {
      return;
    }
    await _read(initial: false);
  }

  Future<bool> _read({required bool initial, bool replaceDrafts = false}) async {
    if (_refreshing) {
      return false;
    }
    final int epoch = _epoch;
    _refreshing = true;
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/shop/me');
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final ShopOverview? parsed = ShopOverview.tryParse(response.data);
      if (parsed == null) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      final bool keepDrafts = !replaceDrafts && (profileDirty || hoursDirty || _pending != null || _conflict);
      _overview = parsed;
      _lastUpdated = DateTime.now();
      _stale = false;
      _load = OpsLoad.ready;
      _loadFailure = null;
      if (!keepDrafts) {
        _fillProfile(parsed);
        _fix = null;
        _hours = copyWeek(parsed.hours);
        _formRevision++;
      }
      if (parsed.isActive && _areas.isEmpty && !_areasFailed) {
        await loadAreas();
        if (epoch != _epoch) {
          return false;
        }
      }
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      if (_overview != null && !initial) {
        _stale = true;
      } else {
        _loadFailure = failure;
        _load = OpsLoad.failed;
      }
      return false;
    } finally {
      if (epoch == _epoch) {
        _refreshing = false;
        _notify();
      }
    }
  }

  void startPolling() {
    _timer?.cancel();
    if (pollEvery == Duration.zero) {
      return;
    }
    _timer = Timer.periodic(pollEvery, (Timer _) => unawaited(refresh()));
  }

  void stopPolling() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> loadAreas() async {
    final int epoch = _epoch;
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/onboarding/shop/service-areas');
      if (epoch != _epoch) {
        return;
      }
      final Object? data = response.status == 200 ? response.data : null;
      if (data is! List<Object?>) {
        _areasFailed = true;
      } else {
        _areas = <ServiceArea>[
          for (final Object? item in data)
            if (item is Map<String, Object?> && item['service_area_id'] is String && item['name'] is String) ServiceArea(id: item['service_area_id']! as String, name: item['name']! as String),
        ];
        _areasFailed = false;
        if (!_areas.any((ServiceArea a) => a.id == profile.areaId) && _areas.length == 1) profile.areaId = _areas.single.id;
      }
    } on AuthFailure {
      if (epoch == _epoch) {
        _areasFailed = true;
      }
    }
    if (epoch == _epoch) {
      _notify();
    }
  }

  // ---- profile draft --------------------------------------------------------------------------------------------

  void setLogo(ShopLogoData? value) {
    if (locked || readOnly) return;
    profile.logo = value;
    profileEdited();
  }

  void profileEdited() {
    _profileErrors = <String, String>{};
    _notify();
  }

  void chooseArea(String id) {
    if (locked) {
      return;
    }
    profile.areaId = id;
    _profileErrors = Map<String, String>.of(_profileErrors)..remove('area');
    _notify();
  }

  /// "Bỏ thay đổi": back to what was loaded.
  void revertProfile() {
    if (locked) {
      return;
    }
    _fillProfile(_overview);
    _fix = null;
    _profileErrors = <String, String>{};
    _locationFailure = null;
    _formRevision++;
    _notify();
  }

  void selectAddress(String text, {double? latitude, double? longitude}) {
    if (locked || readOnly || session.status != SessionStatus.signedIn) return;
    profile.address = text;
    if (latitude != null && longitude != null) {
      _fix = LocationFix(latitude: latitude, longitude: longitude, accuracyMeters: null, takenAt: DateTime.now());
    }
    profileEdited();
  }

  /// ONE real fix, only on the person's press. Denied / disabled / timeout / unavailable keep the stored position and the draft.
  Future<void> capturePosition() async {
    if (_locating || locked) {
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

  Map<String, String> validateProfile() {
    final Map<String, String> errors = <String, String>{};
    if (profile.name.trim().isEmpty) {
      errors['name'] = 'Nhập tên quán.';
    } else if (profile.name.trim().runes.length > 120) {
      errors['name'] = 'Tên quán tối đa 120 ký tự.';
    }
    if (profile.phone.replaceAll(RegExp(r'\D'), '').length < 9) {
      errors['phone'] = 'Số điện thoại chưa hợp lệ.';
    }
    if (profile.address.trim().isEmpty) {
      errors['address'] = 'Nhập địa chỉ quán.';
    }
    final String? area = profile.areaId;
    if (area == null || !_areas.any((ServiceArea a) => a.id == area)) {
      errors['area'] = 'Hệ thống chưa xác định được khu vực phục vụ. Vui lòng thử lại sau.';
    }
    final ShopOverview? o = _overview;
    if (_fix == null && (o?.pickupLat == null || o?.pickupLng == null)) {
      errors['position'] = 'Mở địa chỉ và chọn ghim vị trí lấy hàng trên bản đồ.';
    }
    return errors;
  }

  /// Validates, then writes. Returns true when the server stored it. Validation errors stay beside their fields; nothing is sent.
  Future<bool> saveProfile() async {
    final ShopOverview? o = _overview;
    if (o == null || locked || readOnly) {
      return false;
    }
    final Map<String, String> errors = validateProfile();
    _profileErrors = errors;
    if (errors.isNotEmpty) {
      _notify();
      return false;
    }
    final double lat = _fix?.latitude ?? o.pickupLat!;
    final double lng = _fix?.longitude ?? o.pickupLng!;
    final String body = jsonEncode(<String, Object?>{
      'expected_version': o.version,
      if (profile.logo != o.logo) 'logo': profile.logo?.toWire(),
      'name': profile.name.trim(),
      'contact_phone': profile.phone.trim(),
      'zalo': profile.zalo.trim().isEmpty ? null : profile.zalo.trim(),
      'facebook': profile.facebook.trim().isEmpty ? null : profile.facebook.trim(),
      'address_text': profile.address.trim(),
      'pickup_lat': lat,
      'pickup_lng': lng,
      'service_area_id': profile.areaId,
    });
    return _begin(PendingWrite(kind: OpsWriteKind.profile, method: 'PUT', path: '/v1/shop/me/profile', body: body, key: newIdempotencyKey()));
  }

  // ---- hours draft ----------------------------------------------------------------------------------------------

  /// Done in the day editor: only the draft changes.
  void setDay(int day, List<HourRange> ranges) {
    if (locked) {
      return;
    }
    _hours = copyWeek(_hours)..[day] = <HourRange>[for (final HourRange r in ranges) r.copy()];
    _notify();
  }

  /// "Áp dụng cho cả tuần": replaces the seven days of the draft. Nothing is stored until Lưu lịch.
  void applyAllWeek(List<HourRange> ranges) {
    if (locked) {
      return;
    }
    _hours = <List<HourRange>>[for (int i = 0; i < 7; i++) <HourRange>[for (final HourRange r in ranges) r.copy()]];
    _notify();
  }

  void revertHours() {
    if (locked) {
      return;
    }
    _hours = copyWeek(_overview?.hours ?? emptyWeek());
    _formRevision++;
    _notify();
  }

  /// True when saving would write an empty week (the screen asks before it does).
  bool get hoursAllClosed => _hours.every((List<HourRange> d) => d.isEmpty);

  Future<bool> saveHours() async {
    final ShopOverview? o = _overview;
    if (o == null || locked || readOnly || !checkSchedule(_hours).ok) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{'expected_version': o.version, 'intervals': scheduleToWire(_hours)});
    return _begin(PendingWrite(kind: OpsWriteKind.hours, method: 'PUT', path: '/v1/shop/me/business-hours', body: body, key: newIdempotencyKey()));
  }

  // ---- the one write path ---------------------------------------------------------------------------------------

  Future<bool> _begin(PendingWrite write) {
    _writeFailure = null;
    _conflict = false;
    _savedNotReloaded = false;
    return _send(write);
  }

  /// "Thử lại" of an unknown outcome: the SAME key and the SAME body, never the current draft.
  Future<bool> retryPending() async {
    final PendingWrite? write = _pending;
    if (write == null || _busy) {
      return false;
    }
    _writeFailure = null;
    return _send(write);
  }

  Future<bool> _send(PendingWrite write) async {
    final int epoch = _epoch;
    _busy = true;
    // Kept from the moment it is sent: if no usable answer comes back, it is already there.
    _pending = write;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall(write.method, write.path, body: write.body, idempotencyKey: write.key);
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200 && response.status != 201) {
        throw failureOf(response);
      }
      _pending = null;
      _busy = false;
      _fix = null;
      _say(write.kind == OpsWriteKind.profile ? 'Đã lưu hồ sơ quán.' : 'Đã lưu lịch hoạt động.');
      _notify();
      final bool reloaded = await _read(initial: false, replaceDrafts: true);
      if (epoch == _epoch && !reloaded) {
        _savedNotReloaded = true;
        _notify();
      }
      return epoch == _epoch;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _busy = false;
      _writeFailure = failure;
      if (!failure.outcomeUnknown) {
        // The outcome is decided (a refusal): the key and body are released.
        _pending = null;
        if (failure.kind == AuthFailureKind.versionConflict) {
          _conflict = true;
        } else if (failure.kind == AuthFailureKind.invalidServiceArea) {
          _profileErrors = <String, String>{'area': 'Khu vực phục vụ chưa hợp lệ. Vui lòng tải lại hồ sơ.'};
          unawaited(loadAreas());
        } else if (failure.kind == AuthFailureKind.stateConflict) {
          unawaited(_read(initial: false));
        }
      }
      _notify();
      return false;
    }
  }

  /// "Đã lưu, chưa tải lại được dữ liệu" -> "Tải lại".
  Future<void> reloadAfterSave() async {
    final int epoch = _epoch;
    final bool ok = await _read(initial: false, replaceDrafts: true);
    if (epoch == _epoch && ok) {
      _savedNotReloaded = false;
      _notify();
    }
  }

  /// Conflict: the person confirmed replacing the drafts with the server's current data.
  Future<bool> loadNewReplacingDrafts() async {
    if (_busy) {
      return false;
    }
    final bool ok = await _read(initial: false, replaceDrafts: true);
    if (ok) {
      _conflict = false;
      _writeFailure = null;
      _notify();
    }
    return ok;
  }

  /// Conflict: the person keeps editing the draft (a later save will meet the conflict again until the new data is loaded).
  void keepDraftAfterConflict() {
    _writeFailure = null;
    _notify();
  }

  void dismissWriteFailure() {
    if (_pending == null) {
      _writeFailure = null;
      _notify();
    }
  }
}
