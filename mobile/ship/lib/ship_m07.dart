import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:n11_m14/n11_m14.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Ship side of M07 that needs the phone: the M14 map for the delivery screens, the pin picker for the drop-off, and the sharing of the
// Shipper's LATEST position. There is no separate switch: the one online button starts sharing (ship_online.dart decides when to start and stop),
// a notification shows while it runs, and only the latest fresh position is uploaded (the server keeps one row per Shipper, no trail).

const bool kM14Map = bool.fromEnvironment('M14_OFFLINE_MAP');

Map<String, dynamic> _pin(double lat, double lng, String label, int color) => <String, dynamic>{'lat': lat, 'lon': lng, 'label': label, 'color': color};

/// The M14 offline map (Cao Bằng) when this build enables it; otherwise null and the screens say there is no map.
M07MapBuilder? shipMapBuilder() => kM14Map
    ? (BuildContext context, List<M07MapPin> pins) => M14OfflineMap(pins: <Map<String, dynamic>>[for (final M07MapPin p in pins) _pin(p.lat, p.lng, p.label, p.color)])
    : null;

/// Lets the Shipper pin the drop-off on the M14 map; a tap outside the covered area is ignored.
M07PinPickerBuilder? shipPinPicker() => kM14Map
    ? (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng}) => M14OfflineMap(
          pins: <Map<String, dynamic>>[if (lat != null && lng != null) _pin(lat, lng, 'Điểm giao', 0xFFC0392B)],
          onPoint: (double la, double lo, bool inside) {
            if (inside) {
              onPick(la, lo);
            }
          },
        )
    : null;

/// What the reporter needs from the GPS core (M14 in the app, a fake in tests).
abstract class LocationFeed {
  const LocationFeed();
  Stream<Map<String, dynamic>> get positions;
  Future<void> start();
  Future<Map<String, dynamic>?> status() async => null;
  Future<void> stop();

  /// Opens the phone's own screen for [kind] ('app', 'location' or 'notifications'). The app never turns GPS on or grants a permission itself.
  Future<void> openSettings(String kind) async {}
}

class M14LocationFeed extends LocationFeed {
  const M14LocationFeed();

  static const M14Client _client = M14Client();

  @override
  Stream<Map<String, dynamic>> get positions => _client.positions;

  @override
  Future<void> start() => _client.start(consent: true);

  @override
  Future<Map<String, dynamic>?> status() => _client.status();

  @override
  Future<void> stop() => _client.stop();

  @override
  Future<void> openSettings(String kind) => _client.openSettings(kind);
}

/// Why the position is not being shared, in the words the screen needs to pick its short instruction and button.
enum LocationProblem { none, permission, gpsOff, notification, noFix, upload }

/// What the server answered to a position report: whether the app must keep sharing (the switch is on or work is in progress).
class LocationAck {
  const LocationAck({required this.shouldShare, required this.intentOnline});

  final bool? shouldShare;
  final bool? intentOnline;
}

/// One shared observer/uploader for the existing M14 recorder; observing never starts GPS.
class ShipLocationReporter extends ChangeNotifier with WidgetsBindingObserver {
  ShipLocationReporter({
    required this.session,
    LocationFeed feed = const M14LocationFeed(),
    this.minGap = const Duration(seconds: 45),
    this.firstFixTimeout = const Duration(seconds: 45),
    DateTime Function()? clock,
  })  : _feed = feed, _clock = clock ?? DateTime.now {
    session.addListener(_sessionChanged);
  }

  /// A report this recent counts as "the server has my position"; the server itself accepts 120 s, so one late report is tolerated.
  static const Duration freshAck = Duration(seconds: 100);
  static const Duration startGrace = Duration(seconds: 3);

  final SessionController session;
  final LocationFeed _feed;
  final Duration minGap;
  final Duration firstFixTimeout;
  final DateTime Function() _clock;
  StreamSubscription<Map<String, dynamic>>? _sub;
  Timer? _expiry;
  Timer? _ackTimer;
  bool _sharing = false;
  bool _observeRecording = true;
  bool _observing = false;
  bool _sending = false;
  bool _starting = false;
  Future<void>? _startFuture;
  Future<bool>? _acquiring;
  Completer<bool>? _ackWaiter;
  int? _latestTime;
  int _epoch = 0;
  int? _lastSentTime;
  DateTime? _lastUpload;
  DateTime? _startedAt;
  Map<String, dynamic>? _position;
  String? _error;
  String _gpsStatus = 'Chưa bật chia sẻ vị trí';
  LocationProblem _problem = LocationProblem.none;
  bool _permissionDenied = false;
  bool _gpsOff = false;
  bool _uploadFailed = false;

  /// Told after every accepted report, so the app can stop by itself when the server says nothing needs the position any more.
  void Function(LocationAck ack)? onAck;

  /// Told when the server refuses the report (a closed session, a suspended account): the caller re-reads the profile.
  VoidCallback? onRefused;

  bool get sharing => _sharing;
  bool get starting => _starting;
  DateTime? get lastUpload => _lastUpload;
  String? get error => _error;
  String get gpsStatus => _gpsStatus;
  Map<String, dynamic>? get position => _position;
  LocationProblem get problem => _problem;

  /// True while the server holds a position this app sent a moment ago.
  bool get serverHasPosition => _sharing && _lastUpload != null && _clock().difference(_lastUpload!) < freshAck;

  Future<void> openSettings(String kind) async {
    try { await _feed.openSettings(kind); } on Object { /* The phone has no such screen; the instruction stays. */ }
  }

  void observe() {
    if (_observing) return;
    _observing = true;
    WidgetsBinding.instance.addObserver(this);
    _listen();
    unawaited(refresh());
  }

  void _listen() {
    _sub ??= _feed.positions.listen((Map<String, dynamic> value) => unawaited(onSnapshot(value)),
      onError: (Object _) { _clearPosition(); _gpsStatus = 'Không lấy được vị trí'; notifyListeners(); });
  }

  Future<void> refresh() async {
    final int epoch = _epoch;
    try {
      final Map<String, dynamic>? value = await _feed.status();
      if (epoch == _epoch && value != null) await onSnapshot(value);
    } on Object {
      if (epoch != _epoch) return;
      _clearPosition();
      _gpsStatus = 'Không lấy được vị trí';
      notifyListeners();
    }
  }

  /// Called when the app comes back to the front: re-reads the core (it may have been stopped or restricted meanwhile).
  VoidCallback? onResumed;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) { unawaited(refresh()); onResumed?.call(); }
    else { _clearPosition(); notifyListeners(); }
  }

  void _sessionChanged() {
    if (session.status != SessionStatus.signedIn && (_sharing || _starting)) unawaited(stop());
  }

  void _clearPosition() { _expiry?.cancel(); _expiry = null; _position = null; }

  /// Starts the core. The Android permission and notification checks happen here; a refusal leaves sharing off and [problem] set.
  Future<void> start() {
    if (_sharing) return Future<void>.value();
    return _startFuture ??= _start().whenComplete(() => _startFuture = null);
  }

  Future<void> _start() async {
    _starting = true;
    final int epoch = ++_epoch;
    _observeRecording = false;
    _clearPosition();
    _gpsStatus = 'Đang lấy vị trí';
    _problem = LocationProblem.none;
    _permissionDenied = false;
    _gpsOff = false;
    _uploadFailed = false;
    notifyListeners();
    try {
      await _feed.start();
      if (epoch != _epoch) {
        // Consent/permission may finish after stop or logout. Stop that late native start too.
        try { await _feed.stop(); } on Object { /* Already stopped. */ }
        _starting = false;
        return;
      }
      _error = null;
      _sharing = true;
      _startedAt = _clock();
      _observeRecording = true;
      _listen();
      unawaited(refresh());
    } on Object catch (error) {
      if (epoch != _epoch) { _starting = false; return; }
      _error = error.toString();
      final String? code = error is PlatformException ? error.code : null;
      _problem = code == 'PERMISSION' ? LocationProblem.permission : code == 'NOTIFICATION' ? LocationProblem.notification : LocationProblem.noFix;
      _gpsStatus = code == 'PERMISSION' ? 'Chưa cấp quyền vị trí' : 'Không lấy được vị trí';
    }
    _starting = false;
    notifyListeners();
  }

  /// Starts sharing if needed and waits until a fresh, valid position of this start has been accepted by the server. True means the server now holds
  /// it; false leaves [problem] set (the caller stops the core again if nothing else needs it). Repeated calls share one attempt.
  Future<bool> acquire() => _acquiring ??= _acquire().whenComplete(() => _acquiring = null);

  Future<bool> _acquire() async {
    await start();
    if (!_sharing) return false;
    if (serverHasPosition) return true;
    final int epoch = _epoch;
    final Completer<bool> waiter = Completer<bool>();
    _ackWaiter = waiter;
    final Timer timer = Timer(firstFixTimeout, () { if (!waiter.isCompleted) waiter.complete(false); });
    unawaited(refresh());
    final bool ok = await waiter.future;
    timer.cancel();
    if (identical(_ackWaiter, waiter)) _ackWaiter = null;
    if (epoch != _epoch) return false;
    if (!ok && _problem == LocationProblem.none) {
      _problem = _permissionDenied ? LocationProblem.permission : _gpsOff ? LocationProblem.gpsOff : _uploadFailed ? LocationProblem.upload : LocationProblem.noFix;
    }
    notifyListeners();
    return ok;
  }

  void _settle(bool ok) {
    final Completer<bool>? waiter = _ackWaiter;
    if (waiter != null && !waiter.isCompleted) waiter.complete(ok);
  }

  Future<void> stop() async {
    ++_epoch;
    _observeRecording = false;
    _sharing = false;
    _starting = false;
    _lastUpload = null;
    _ackTimer?.cancel();
    _ackTimer = null;
    _clearPosition();
    _settle(false);
    _gpsStatus = 'Chưa bật chia sẻ vị trí';
    _error = null;
    _problem = LocationProblem.none;
    notifyListeners();
    try { await _feed.stop(); } on Object { /* Core may already be stopped. */ }
  }

  /// Snapshot timestamps are measurement times from M14, never reception times.
  Future<void> onSnapshot(Map<String, dynamic> snapshot) async {
    if (snapshot['recording'] == false) {
      // The service starts a moment after the call returns: a "not recording" read in that moment is not a stop.
      if (_sharing && _startedAt != null && _clock().difference(_startedAt!) < startGrace && snapshot['permissionGranted'] != false) return;
      final bool wasSharing = _sharing;
      _sharing = false;
      _lastUpload = null;
      _clearPosition();
      _error = snapshot['status'] as String?;
      _permissionDenied = snapshot['permissionGranted'] == false;
      _gpsStatus = _permissionDenied ? 'Chưa cấp quyền vị trí' : 'Chưa bật chia sẻ vị trí';
      if (wasSharing && _permissionDenied) _problem = LocationProblem.permission;
      _settle(false);
      notifyListeners();
      return;
    }
    if (_observeRecording && snapshot['recording'] == true) _sharing = true;
    if (!_sharing) return;
    final Object? lat = snapshot['lat'];
    final Object? lon = snapshot['lon'];
    final Object? accuracy = snapshot['accuracy'];
    final Object? measured = snapshot['time'];
    final DateTime now = _clock();
    final int age = measured is int ? now.millisecondsSinceEpoch - measured : -1;
    final bool valid = snapshot['fresh'] == true && snapshot['mock'] != true &&
        snapshot['permissionGranted'] != false && snapshot['gpsEnabled'] != false &&
        lat is num && lat.isFinite && lat >= -90 && lat <= 90 &&
        lon is num && lon.isFinite && lon >= -180 && lon <= 180 &&
        accuracy is num && accuracy.isFinite && accuracy > 0 && accuracy <= 1000 &&
        measured is int && age >= 0 && age < 120000;
    if (valid && _latestTime != null && measured < _latestTime!) return;
    _clearPosition();
    if (!valid) {
      _error = snapshot['status'] as String? ?? 'Không lấy được vị trí';
      _permissionDenied = snapshot['permissionGranted'] == false;
      _gpsOff = snapshot['gpsEnabled'] == false || (snapshot['gpsEnabled'] != true && snapshot['fixState'] == 'DISABLED');
      if (_gpsOff || _permissionDenied) _settle(false);
      _gpsStatus = _permissionDenied ? 'Chưa cấp quyền vị trí'
          : _gpsOff ? 'GPS đang tắt'
          : snapshot['fixState'] == 'ACQUIRING' || (snapshot['gpsEnabled'] == true && snapshot['fixState'] == 'DISABLED') ? 'Đang lấy vị trí'
          : snapshot['fixState'] == 'TIMEOUT' || _error!.contains('Hết thời gian chờ') ? 'Hết thời gian chờ định vị'
          : 'Không lấy được vị trí';
      notifyListeners();
      return;
    }
    _permissionDenied = false;
    _gpsOff = false;
    _latestTime = measured;
    _position = Map<String, dynamic>.from(snapshot);
    _gpsStatus = 'Đã có vị trí mới';
    _expiry = Timer(Duration(milliseconds: 120000 - age), () {
      _position = null;
      _gpsStatus = _sharing ? 'Đang lấy vị trí' : 'Chưa bật chia sẻ vị trí';
      notifyListeners();
    });
    notifyListeners();
    if (session.status != SessionStatus.signedIn || _sending ||
        (_lastSentTime != null && measured <= _lastSentTime!) ||
        (_lastUpload != null && now.difference(_lastUpload!) < minGap)) { return; }
    final int epoch = _epoch;
    _sending = true;
    try {
      final ApiResponse response = await session.protectedCall('PUT', '/v1/driver/location',
        body: jsonEncode(<String, Object?>{'lat': lat.toDouble(), 'lng': lon.toDouble(), 'accuracy_m': accuracy.toDouble()}));
      if (epoch != _epoch) return;
      if (response.status == 200) {
        _lastSentTime = measured;
        _lastUpload = now;
        _error = null;
        _uploadFailed = false;
        _ackTimer?.cancel();
        _ackTimer = Timer(freshAck, notifyListeners);
        _settle(true);
        final Object? data = response.data;
        final Map<String, Object?>? map = data is Map<String, Object?> ? data : null;
        onAck?.call(LocationAck(shouldShare: map?['should_share_location'] as bool?, intentOnline: map?['intent_online'] as bool?));
      } else {
        _error = 'Chưa gửi được vị trí.';
        _uploadFailed = true;
        _settle(false);
        if (response.status == 403 || response.status == 409) onRefused?.call();
      }
    } on Object {
      if (epoch == _epoch) { _error = 'Chưa gửi được vị trí. Kiểm tra kết nối.'; _uploadFailed = true; _settle(false); }
    } finally { _sending = false; }
    if (epoch == _epoch) notifyListeners();
  }

  @override
  void dispose() {
    ++_epoch;
    _sharing = false;
    _observeRecording = false;
    _clearPosition();
    _ackTimer?.cancel();
    _settle(false);
    unawaited(_sub?.cancel());
    if (_observing) WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_sessionChanged);
    super.dispose();
  }
}

/// One reporter per session, created on first use.
final Expando<ShipLocationReporter> _reporters = Expando<ShipLocationReporter>('ship-location-reporter');

ShipLocationReporter reporterFor(SessionController session) => _reporters[session] ??= ShipLocationReporter(session: session);
