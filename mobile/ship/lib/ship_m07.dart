import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:n11_m14/n11_m14.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Ship side of M07 that needs the phone: the M14 map for the delivery screens, the pin picker for the drop-off, and the sharing of the
// Shipper's LATEST position. Nothing here starts GPS by itself: sharing begins only after the Shipper reads the explanation and agrees, shows a
// notification the Shipper can stop, and uploads only the latest fresh position (the server keeps one row per Shipper, no trail).

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
}

/// One shared observer/uploader for the existing M14 recorder; observing never starts GPS.
class ShipLocationReporter extends ChangeNotifier with WidgetsBindingObserver {
  ShipLocationReporter({required this.session, LocationFeed feed = const M14LocationFeed(), this.minGap = const Duration(seconds: 45), DateTime Function()? clock})
      : _feed = feed, _clock = clock ?? DateTime.now {
    session.addListener(_sessionChanged);
  }

  final SessionController session;
  final LocationFeed _feed;
  final Duration minGap;
  final DateTime Function() _clock;
  StreamSubscription<Map<String, dynamic>>? _sub;
  Timer? _expiry;
  bool _sharing = false;
  bool _observeRecording = true;
  bool _observing = false;
  bool _sending = false;
  bool _starting = false;
  int? _latestTime;
  int _epoch = 0;
  int? _lastSentTime;
  DateTime? _lastUpload;
  Map<String, dynamic>? _position;
  String? _error;
  String _gpsStatus = 'Chưa bật chia sẻ vị trí';

  bool get sharing => _sharing;
  DateTime? get lastUpload => _lastUpload;
  String? get error => _error;
  String get gpsStatus => _gpsStatus;
  Map<String, dynamic>? get position => _position;

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
      _clearPosition();
      _gpsStatus = 'Không lấy được vị trí';
      notifyListeners();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) { unawaited(refresh()); }
    else { _clearPosition(); notifyListeners(); }
  }

  void _sessionChanged() {
    if (session.status != SessionStatus.signedIn && (_sharing || _starting)) unawaited(stop());
  }

  void _clearPosition() { _expiry?.cancel(); _expiry = null; _position = null; }

  /// Call only after the Shipper agreed on the explanation screen.
  Future<void> start() async {
    if (_sharing || _starting) return;
    _starting = true;
    final int epoch = ++_epoch;
    _observeRecording = false;
    _clearPosition();
    _gpsStatus = 'Đang lấy vị trí';
    try {
      await _feed.start();
      if (epoch != _epoch) { _starting = false; return; }
      _error = null;
      _sharing = true;
      _observeRecording = true;
      _listen();
      unawaited(refresh());
    } on Object catch (error) {
      _error = error.toString();
      _gpsStatus = error is PlatformException && error.code == 'PERMISSION'
          ? 'Chưa cấp quyền vị trí' : 'Không lấy được vị trí';
    }
    _starting = false;
    notifyListeners();
  }

  Future<void> stop() async {
    ++_epoch;
    _observeRecording = false;
    _sharing = false;
    _clearPosition();
    _gpsStatus = 'Chưa bật chia sẻ vị trí';
    _error = null;
    notifyListeners();
    try { await _feed.stop(); } on Object { /* Core may already be stopped. */ }
  }

  /// Snapshot timestamps are measurement times from M14, never reception times.
  Future<void> onSnapshot(Map<String, dynamic> snapshot) async {
    if (snapshot['recording'] == false) {
      _sharing = false;
      _clearPosition();
      _error = snapshot['status'] as String?;
      _gpsStatus = snapshot['permissionGranted'] == false ? 'Chưa cấp quyền vị trí' : 'Chưa bật chia sẻ vị trí';
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
      _gpsStatus = snapshot['permissionGranted'] == false ? 'Chưa cấp quyền vị trí'
          : snapshot['gpsEnabled'] == false || snapshot['fixState'] == 'DISABLED' ? 'GPS đang tắt'
          : snapshot['fixState'] == 'ACQUIRING' ? 'Đang lấy vị trí'
          : snapshot['fixState'] == 'TIMEOUT' || _error!.contains('Hết thời gian chờ') ? 'Hết thời gian chờ định vị'
          : 'Không lấy được vị trí';
      notifyListeners();
      return;
    }
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
      if (response.status == 200) { _lastSentTime = measured; _lastUpload = now; _error = null; }
      else { _error = 'Chưa gửi được vị trí.'; }
    } on Object {
      if (epoch == _epoch) _error = 'Chưa gửi được vị trí. Kiểm tra kết nối.';
    } finally { _sending = false; }
    if (epoch == _epoch) notifyListeners();
  }

  @override
  void dispose() {
    ++_epoch;
    _sharing = false;
    _observeRecording = false;
    _clearPosition();
    unawaited(_sub?.cancel());
    if (_observing) WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_sessionChanged);
    super.dispose();
  }
}

/// The card on the delivery screens: explains, asks for consent, shows whether the position is being shared and lets the Shipper stop.
class ShipLocationShareCard extends StatelessWidget {
  const ShipLocationShareCard({super.key, required this.reporter});

  final ShipLocationReporter reporter;

  Future<void> _enable(BuildContext context) async {
    final bool yes = await showConfirmDialog(
      context,
      title: 'Chia sẻ vị trí của bạn?',
      confirmLabel: 'Đồng ý chia sẻ',
      content: const Text(
        'Ứng dụng cập nhật vị trí theo chu kỳ khoảng 60 giây, kể cả khi khóa màn hình. Chỉ giữ vị trí mới nhất, không lưu vệt di chuyển. '
        'Quán có đơn bạn đang giữ xem được vị trí này. Bạn có thể dừng bất cứ lúc nào trong thông báo hoặc ở đây.',
        style: N11Text.lead,
      ),
    );
    if (yes) {
      await reporter.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: reporter,
      builder: (BuildContext context, Widget? _) {
        final DateTime? last = reporter.lastUpload;
        return N11Card(
          key: const Key('m07-share-card'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[const Expanded(child: Text('Chia sẻ vị trí', style: N11Text.label)), N11Chip(reporter.sharing ? 'Đang chia sẻ' : 'Đang tắt', kind: reporter.sharing ? ChipKind.ok : ChipKind.neutral)]),
              const SizedBox(height: N11Space.gap2),
              Text(
                reporter.sharing
                    ? (last == null ? 'Đang chờ vị trí đầu tiên.' : 'Gửi lần cuối lúc ${m07Hm(last)}.')
                    : 'Cần bật để nhận đơn trong bán kính 3 km và để quán thấy bạn đang tới.',
                style: N11Text.caption,
              ),
              if (reporter.error != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(reporter.error!, key: const Key('m07-share-error'), style: N11Text.captionInk2)),
              const SizedBox(height: N11Space.gap3),
              reporter.sharing
                  ? N11Button(key: const Key('m07-share-stop'), label: 'Dừng chia sẻ', kind: ButtonKind.secondary, compact: true, onPressed: () => unawaited(reporter.stop()))
                  : N11Button(key: const Key('m07-share-start'), label: 'Bật chia sẻ vị trí', compact: true, icon: Icons.my_location, onPressed: () => unawaited(_enable(context))),
            ],
          ),
        );
      },
    );
  }
}

/// One reporter per session, created on first use.
final Expando<ShipLocationReporter> _reporters = Expando<ShipLocationReporter>('ship-location-reporter');

ShipLocationReporter reporterFor(SessionController session) => _reporters[session] ??= ShipLocationReporter(session: session);
