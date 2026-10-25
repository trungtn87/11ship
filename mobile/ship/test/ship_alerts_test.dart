import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_alerts.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_m07.dart';

// #194: which ONE alert the home shows, and the label/explanation on the map. Pure functions of state, so every combination is a table row.

ShipAlert? alert({
  bool intent = true,
  bool hasWork = false,
  LocationProblem problem = LocationProblem.none,
  bool? internet,
  HealthPhase health = HealthPhase.ready,
  bool paused = false,
  bool acquiring = false,
}) =>
    computeShipAlert(intent: intent, hasWork: hasWork, problem: problem, internetAvailable: internet, health: health, paused: paused, acquiring: acquiring);

final DateTime t0 = DateTime.utc(2026, 10, 25, 9);

ShipLocationView view({
  bool intent = true,
  bool hasWork = false,
  bool starting = false,
  bool sharing = true,
  LocationProblem problem = LocationProblem.none,
  bool uploadFailed = false,
  Duration now = Duration.zero,
  DateTime? ackAt,
  DateTime? fixAt,
  double? accuracy,
  bool hasFix = false,
}) =>
    buildLocationView(intent: intent, hasWork: hasWork, starting: starting, sharing: sharing, problem: problem, uploadFailed: uploadFailed, now: t0.add(now), ackAt: ackAt, fixAt: fixAt, accuracyMetres: accuracy, hasFix: hasFix);

void main() {
  group('which alert', () {
    test('a shipper who chose to rest (offline, nothing in hand) is never alarmed, whatever the phone says', () {
      expect(alert(intent: false, internet: false, health: HealthPhase.timeout), isNull);
      expect(alert(intent: false, paused: true), isNull);
    });

    test('a failed attempt to go online is explained even though the switch stayed off', () {
      final ShipAlert? a = alert(intent: false, problem: LocationProblem.gpsOff);
      expect(a!.id, 'gps-off');
    });

    test('GPS off: says so and opens the location settings, with Thử lại', () {
      final ShipAlert a = alert(problem: LocationProblem.gpsOff)!;
      expect(a.title, 'Vị trí đang tắt');
      expect(a.text, 'Vị trí đang tắt. Hãy bật Vị trí để tiếp tục nhận đơn.');
      expect(a.buttons.map((ShipAlertButton b) => b.action), <ShipAlertAction>[ShipAlertAction.openLocationSettings, ShipAlertAction.retry]);
    });

    test('permission refused: the app settings, not the location settings', () {
      final ShipAlert a = alert(problem: LocationProblem.permission, internet: false)!;
      expect(a.text, '11Ship chưa được cấp quyền vị trí.');
      expect(a.buttons.first.action, ShipAlertAction.openAppSettings);
    });

    test('missing notification permission is its own alert with its own settings', () {
      final ShipAlert a = alert(problem: LocationProblem.notification)!;
      expect(a.id, 'notification');
      expect(a.buttons.first.action, ShipAlertAction.openNotificationSettings);
    });

    test('Internet really down (the phone says so) and GPS fine: talks only about the Internet', () {
      final ShipAlert a = alert(internet: false)!;
      expect(a.text, 'Điện thoại đang mất kết nối Internet.');
      expect('${a.title} ${a.text}', isNot(contains('Vị trí')));
      expect(a.buttons.single.action, ShipAlertAction.retry);
    });

    test('both really down: names the two conditions and gives both ways out, without "và/hoặc"', () {
      final ShipAlert a = alert(problem: LocationProblem.gpsOff, internet: false)!;
      expect(a.title, 'Mạng và Vị trí chưa sẵn sàng');
      expect(a.text, allOf(contains('Internet:'), contains('Vị trí:')));
      expect(a.title + a.text, isNot(contains('và/hoặc')));
      expect(a.buttons.map((ShipAlertButton b) => b.action), contains(ShipAlertAction.openLocationSettings));
      expect(a.buttons.map((ShipAlertButton b) => b.action), contains(ShipAlertAction.retry));
    });

    test('the server not answering never claims the phone is offline, whatever the phone says or does not say', () {
      for (final HealthPhase phase in <HealthPhase>[HealthPhase.timeout, HealthPhase.offline, HealthPhase.badResponse, HealthPhase.tlsFailed, HealthPhase.backendNotReady]) {
        for (final bool? internet in <bool?>[true, null]) {
          final ShipAlert a = alert(health: phase, internet: internet)!;
          expect(a.id, 'server');
          expect(a.text, 'Chưa kết nối được máy chủ. Vui lòng thử lại.');
          final String all = '${a.title} ${a.text} ${a.details.join(' ')}';
          expect(all, isNot(contains('Wi-Fi')));
          expect(all, isNot(contains('dữ liệu di động')));
          expect(all, isNot(contains('mất kết nối Internet')));
        }
      }
    });

    test('only one alert at a time, in the order permission > GPS > notification > Internet > server > send > no fix > paused', () {
      expect(alert(problem: LocationProblem.permission, internet: false, health: HealthPhase.timeout, paused: true)!.id, 'permission');
      expect(alert(problem: LocationProblem.gpsOff, health: HealthPhase.timeout, paused: true)!.id, 'gps-off');
      expect(alert(problem: LocationProblem.notification, internet: false)!.id, 'notification');
      expect(alert(internet: false, health: HealthPhase.timeout)!.id, 'internet');
      expect(alert(health: HealthPhase.timeout, problem: LocationProblem.upload)!.id, 'server');
      expect(alert(problem: LocationProblem.upload, paused: true)!.id, 'upload');
      expect(alert(problem: LocationProblem.noFix, paused: true)!.id, 'no-fix');
      expect(alert(paused: true)!.id, 'paused');
      expect(alert(), isNull);
    });

    test('looking for the first fix is neutral (no alert), and a pause is reported only once the server says so', () {
      expect(alert(paused: true, acquiring: true), isNull);
      expect(alert(paused: false), isNull);
      expect(alert(health: HealthPhase.checking), isNull);
      expect(alert(health: HealthPhase.ready, internet: true), isNull);
    });

    test('with a delivery in hand the alert says the order is not cancelled', () {
      final ShipAlert a = alert(intent: false, hasWork: true, internet: false)!;
      expect(a.details.join(' '), contains('Đơn đang giao không bị hủy'));
    });
  });

  group('location label and explanation', () {
    test('server ACK fresh: sharing, with the server time and the real accuracy', () {
      final ShipLocationView v = view(ackAt: t0, fixAt: t0, accuracy: 12.4, hasFix: true, now: const Duration(seconds: 30));
      expect(v.label, 'Đang chia sẻ vị trí');
      expect(v.tone, ShipLocationTone.sharing);
      expect(v.facts, contains('Máy chủ nhận vị trí lần cuối: ${clockText(t0)}'));
      expect(v.facts, contains('Độ chính xác ước tính: ~12 m'));
      expect(v.facts, isNot(contains('Vị trí trên điện thoại — chưa gửi lên máy chủ')));
      expect(v.paragraphs.first, contains('khoảng 1 phút/lần'));
      expect(v.paragraphs.first, contains('kể cả khi khóa màn hình'));
      expect(v.showPin, isTrue);
    });

    test('a GPS fix on the phone that the server never acknowledged is not "shared"', () {
      final ShipLocationView v = view(ackAt: null, fixAt: t0, hasFix: true, accuracy: 20, now: const Duration(seconds: 5), uploadFailed: true);
      expect(v.label, 'Chưa gửi được vị trí mới');
      expect(v.tone, ShipLocationTone.problem);
      expect(v.facts, contains('Vị trí trên điện thoại — chưa gửi lên máy chủ'));
      expect(v.facts.where((String f) => f.startsWith('Máy chủ nhận')), isEmpty);
    });

    test('fields without data are hidden, never invented', () {
      final ShipLocationView v = view(sharing: true, starting: true, ackAt: null, fixAt: null, hasFix: false);
      expect(v.label, 'Đang lấy vị trí');
      expect(v.facts, isEmpty);
      expect(v.showPin, isFalse);
    });

    test('past the 100 s window the position is old: no live wording, the last ACK time with "chưa được cập nhật", and no marker', () {
      final ShipLocationView v = view(ackAt: t0, fixAt: t0, hasFix: true, accuracy: 9, now: const Duration(seconds: 101));
      expect(v.label, 'Vị trí lần cuối ${clockText(t0)}');
      expect(v.tone, ShipLocationTone.stale);
      expect(v.label, isNot(contains('Đang chia sẻ')));
      expect(v.facts, contains('Vị trí lần cuối lúc ${clockText(t0)} — chưa được cập nhật'));
      expect(v.facts.where((String f) => f.startsWith('Độ chính xác')), isEmpty, reason: 'an old sample\'s accuracy is not shown as current');
      expect(v.showPin, isFalse);
      // Just inside the window it is still live.
      expect(view(ackAt: t0, fixAt: t0, hasFix: true, now: const Duration(seconds: 99)).label, 'Đang chia sẻ vị trí');
    });

    test('offline on purpose with nothing in hand: stopped, neutral', () {
      final ShipLocationView v = view(intent: false, hasWork: false, sharing: false);
      expect(v.label, 'Đã dừng chia sẻ vị trí');
      expect(v.tone, ShipLocationTone.stopped);
      expect(v.showPin, isFalse);
    });

    test('switched off but a delivery remains: says it is still shared for that order', () {
      final ShipLocationView v = view(intent: false, hasWork: true, ackAt: t0, fixAt: t0, hasFix: true);
      expect(v.label, 'Đang chia sẻ vị trí');
      expect(v.paragraphs.first, contains('Bạn đã tắt nhận đơn mới nhưng vẫn chia sẻ vị trí cho đơn đang xử lý.'));
    });

    test('the explanation separates the phone\'s GPS from what the server received, and says the recenter button sends nothing', () {
      final String text = view().paragraphs.join(' ');
      expect(text, contains('hai việc khác nhau'));
      expect(text, contains('Chỉ máy chủ quyết định'));
      expect(text, contains('không gửi vị trí'));
    });
  });

  group('widgets', () {
    testWidgets('the alert has one action per button, a fold for the details, and cannot be dismissed', (WidgetTester tester) async {
      final List<ShipAlertAction> taps = <ShipAlertAction>[];
      final ShipAlert a = alert(problem: LocationProblem.gpsOff)!;
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipAlertBanner(alert: a, onAction: taps.add))));
      expect(find.text('Vị trí đang tắt'), findsOneWidget);
      expect(find.byKey(const Key('ship-alert-details')), findsNothing);
      await tester.tap(find.byKey(const Key('ship-alert-more')));
      await tester.pump();
      expect(find.byKey(const Key('ship-alert-details')), findsOneWidget);
      await tester.tap(find.byKey(const Key('ship-alert-more')));
      await tester.pump();
      expect(find.byKey(const Key('ship-alert-details')), findsNothing);
      expect(find.text('Vị trí đang tắt'), findsOneWidget, reason: 'folding the explanation never hides the alert');
      await tester.tap(find.byKey(const Key('ship-alert-location-settings')));
      await tester.tap(find.byKey(const Key('ship-alert-retry')));
      expect(taps, <ShipAlertAction>[ShipAlertAction.openLocationSettings, ShipAlertAction.retry]);
    });

    testWidgets('the label is always there; the (i) opens and folds the explanation in place', (WidgetTester tester) async {
      final ShipLocationView v = view(ackAt: t0, fixAt: t0, hasFix: true, accuracy: 15, now: const Duration(seconds: 10));
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: SingleChildScrollView(child: ShipHomeLayoutProbe(view: v)))));
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
      expect(find.byKey(const Key('home-location-explainer')), findsNothing);
      await tester.tap(find.byKey(const Key('home-location-info')));
      await tester.pump();
      expect(find.byKey(const Key('home-location-explainer')), findsOneWidget);
      expect(find.textContaining('Độ chính xác ước tính: ~15 m'), findsOneWidget);
      await tester.tap(find.byKey(const Key('home-location-info')));
      await tester.pump();
      expect(find.byKey(const Key('home-location-explainer')), findsNothing);
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
    });
  });
}

/// The home layout around a location view, as the app draws it (label over the map area, explanation under it).
class ShipHomeLayoutProbe extends StatelessWidget {
  const ShipHomeLayoutProbe({super.key, required this.view});

  final ShipLocationView view;

  @override
  Widget build(BuildContext context) => SizedBox(height: 700, child: ShipHomeLayout(reason: 'r', onNotifications: () {}, locationView: view));
}
