import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
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
  Stream<Map<String, dynamic>> get positions;
  Future<void> start();
  Future<void> stop();
}

class M14LocationFeed implements LocationFeed {
  const M14LocationFeed();

  static const M14Client _client = M14Client();

  @override
  Stream<Map<String, dynamic>> get positions => _client.positions;

  @override
  Future<void> start() => _client.start(consent: true);

  @override
  Future<void> stop() => _client.stop();
}

/// Uploads the latest fresh position of the Shipper (PUT /v1/driver/location) at most every [minGap]. Old snapshots are never uploaded.
class ShipLocationReporter extends ChangeNotifier {
  ShipLocationReporter({required this.session, LocationFeed feed = const M14LocationFeed(), this.minGap = const Duration(seconds: 45), DateTime Function()? clock})
      : _feed = feed,
        _clock = clock ?? DateTime.now;

  final SessionController session;
  final LocationFeed _feed;
  final Duration minGap;
  final DateTime Function() _clock;

  StreamSubscription<Map<String, dynamic>>? _sub;
  bool _sharing = false;
  DateTime? _lastUpload;
  String? _error;

  bool get sharing => _sharing;
  DateTime? get lastUpload => _lastUpload;
  String? get error => _error;

  /// Call only after the Shipper agreed on the explanation screen.
  Future<void> start() async {
    if (_sharing) {
      return;
    }
    try {
      await _feed.start();
    } on Object catch (error) {
      _error = error is Exception ? error.toString().replaceFirst('PlatformException', '').trim() : 'Không bật được định vị.';
      notifyListeners();
      return;
    }
    _error = null;
    _sharing = true;
    _sub = _feed.positions.listen((Map<String, dynamic> snapshot) => unawaited(onSnapshot(snapshot)));
    notifyListeners();
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    _sharing = false;
    try {
      await _feed.stop();
    } on Object {
      // The core stops on its own when the notification is dismissed; nothing else to undo.
    }
    notifyListeners();
  }

  /// Visible for tests: handle one snapshot from the GPS core.
  Future<void> onSnapshot(Map<String, dynamic> snapshot) async {
    final Object? lat = snapshot['lat'];
    final Object? lon = snapshot['lon'];
    if (snapshot['fresh'] != true || lat is! num || lon is! num) {
      return;
    }
    final DateTime now = _clock();
    final DateTime? last = _lastUpload;
    if (last != null && now.difference(last) < minGap) {
      return;
    }
    _lastUpload = now;
    final Object? accuracy = snapshot['accuracy'];
    try {
      final ApiResponse response = await session.protectedCall('PUT', '/v1/driver/location', body: jsonEncode(<String, Object?>{'lat': lat.toDouble(), 'lng': lon.toDouble(), if (accuracy is num) 'accuracy_m': accuracy.toDouble()}));
      if (response.status != 200) {
        _lastUpload = last;
        _error = 'Chưa gửi được vị trí.';
      } else {
        _error = null;
      }
    } on Object {
      _lastUpload = last;
      _error = 'Chưa gửi được vị trí. Kiểm tra kết nối.';
    }
    notifyListeners();
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
