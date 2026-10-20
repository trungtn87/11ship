import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_m07.dart';

// Sharing the Shipper's position (M07.06 / M14): nothing starts without consent, only a fresh latest position is uploaded, uploads are spaced,
// an old snapshot is never sent, and stopping really stops.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

class _Feed extends LocationFeed {
  final StreamController<Map<String, dynamic>> controller = StreamController<Map<String, dynamic>>.broadcast();
  int starts = 0;
  int stops = 0;
  Object? startError;
  Completer<void>? startGate;

  @override
  Stream<Map<String, dynamic>> get positions => controller.stream;

  @override
  Future<void> start() async {
    starts++;
    await startGate?.future;
    if (startError != null) {
      throw startError!;
    }
  }

  @override
  Future<void> stop() async => stops++;
}

Map<String, dynamic> fix({bool fresh = true, double lat = 22.66, double lon = 106.25, int time = 1792314000000}) => <String, dynamic>{'lat': lat, 'lon': lon, 'accuracy': 12.0, 'fresh': fresh, 'time': time};

Future<({ShipLocationReporter reporter, FakeApiTransport api, _Feed feed, List<DateTime> clock})> build({Duration gap = const Duration(seconds: 45)}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'ok': true}});
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final _Feed feed = _Feed();
  final List<DateTime> clock = <DateTime>[DateTime.utc(2026, 10, 18, 9)];
  final ShipLocationReporter reporter = ShipLocationReporter(session: session, feed: feed, minGap: gap, clock: () => clock.last);
  addTearDown(() async { reporter.dispose(); await feed.controller.close(); });
  return (reporter: reporter, api: api, feed: feed, clock: clock);
}

void main() {
  test('nothing is started or uploaded before the Shipper agrees', () async {
    final t = await build();
    expect(t.reporter.sharing, isFalse);
    expect(t.feed.starts, 0);
    t.feed.controller.add(fix());
    await Future<void>.delayed(Duration.zero);
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
  });

  test('only a fresh latest position is uploaded, spaced by the minimum gap', () async {
    final t = await build();
    await t.reporter.start();
    expect(t.feed.starts, 1);
    expect(t.reporter.sharing, isTrue);
    await t.reporter.onSnapshot(fix(fresh: false));
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty, reason: 'an old snapshot is never sent as the current position');
    await t.reporter.onSnapshot(fix());
    await t.reporter.onSnapshot(fix(lat: 22.7)); // too soon
    expect(t.api.to('PUT', '/v1/driver/location').length, 1);
    t.clock.add(DateTime.utc(2026, 10, 18, 9, 1));
    await t.reporter.onSnapshot(fix(lat: 22.7, time: t.clock.last.millisecondsSinceEpoch));
    final List<RecordedRequest> sent = t.api.to('PUT', '/v1/driver/location');
    expect(sent.length, 2);
    final Map<String, Object?> body = jsonDecode(sent.last.body) as Map<String, Object?>;
    expect(body['lat'], 22.7);
    expect(body['lng'], 106.25);
    expect(body['accuracy_m'], 12.0);
    expect(body.keys, isNot(contains('history')));
  });

  test('native timeout is visible and a stopped recorder cannot upload old coordinates', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(<String, dynamic>{'fresh': false, 'recording': true, 'status': 'Hết thời gian chờ vị trí mới'});
    expect(t.reporter.error, contains('Hết thời gian chờ'));
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
    await t.reporter.onSnapshot(<String, dynamic>{...fix(), 'recording': false, 'status': 'Quyền vị trí đã bị thu hồi'});
    expect(t.reporter.sharing, isFalse);
    expect(t.reporter.error, contains('Quyền vị trí'));
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
    await t.reporter.stop();
  });

  test('a failed upload is reported and retried at the next position (no gap is spent on it)', () async {
    final t = await build();
    await t.reporter.start();
    t.api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
    await t.reporter.onSnapshot(fix());
    expect(t.reporter.error, isNotNull);
    expect(t.reporter.lastUpload, isNull);
    t.api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'ok': true}});
    await t.reporter.onSnapshot(fix());
    expect(t.reporter.error, isNull);
    expect(t.reporter.lastUpload, isNotNull);
  });

  test('stopping cancels the subscription and stops the core', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.stop();
    expect(t.reporter.sharing, isFalse);
    expect(t.feed.stops, 1);
    t.feed.controller.add(fix());
    await Future<void>.delayed(Duration.zero);
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
  });

  test('a refused permission keeps sharing off and says so', () async {
    final t = await build();
    t.feed.startError = Exception('Cần quyền vị trí');
    await t.reporter.start();
    expect(t.reporter.sharing, isFalse);
    expect(t.reporter.error, contains('quyền vị trí'));
  });

  test('stop also cancels a native start that finishes after the permission dialog', () async {
    final t = await build();
    final Completer<void> gate = Completer<void>();
    t.feed.startGate = gate;
    final Future<void> starting = t.reporter.start();
    await t.reporter.stop();
    gate.complete();
    await starting;
    expect(t.feed.stops, 2);
    expect(t.reporter.sharing, isFalse);
    await t.reporter.onSnapshot({...fix(), 'recording': true});
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
  });

  test('duplicate measurement is not resent after the rate limit; a newer fix is sent', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(fix());
    t.clock.add(t.clock.last.add(const Duration(seconds: 60)));
    await t.reporter.onSnapshot(fix());
    expect(t.api.to('PUT', '/v1/driver/location').length, 1);
    await t.reporter.onSnapshot(fix(time: t.clock.last.millisecondsSinceEpoch));
    expect(t.api.to('PUT', '/v1/driver/location').length, 2);
  });

  test('invalid, mock, expired and future measurements never become current', () async {
    final t = await build();
    await t.reporter.start();
    for (final Map<String, dynamic> sample in <Map<String, dynamic>>[
      {...fix(), 'mock': true}, {...fix(), 'lat': 91}, {...fix(), 'lon': double.nan},
      {...fix(), 'accuracy': 1001}, {...fix(), 'time': 0}, {...fix(), 'time': t.clock.last.millisecondsSinceEpoch + 1},
    ]) {
      await t.reporter.onSnapshot(sample);
      expect(t.reporter.position, isNull);
    }
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
  });

  test('GPS states follow M14 and clearing sharing rejects even a fresh queued event', () async {
    final t = await build();
    expect(t.reporter.gpsStatus, 'Chưa bật chia sẻ vị trí');
    await t.reporter.start();
    expect(t.reporter.gpsStatus, 'Đang lấy vị trí');
    for (final (String, Map<String, dynamic>) state in <(String, Map<String, dynamic>)>[
      ('Đã có vị trí mới', fix()),
      ('GPS đang tắt', {'gpsEnabled': false}),
      ('Chưa cấp quyền vị trí', {'permissionGranted': false}),
      ('Hết thời gian chờ định vị', {'fixState': 'TIMEOUT'}),
      ('Không lấy được vị trí', {'fixState': 'UNAVAILABLE'}),
    ]) {
      await t.reporter.onSnapshot(state.$2);
      expect(t.reporter.gpsStatus, state.$1);
    }
    await t.reporter.stop();
    final int sent = t.api.to('PUT', '/v1/driver/location').length;
    await t.reporter.onSnapshot({...fix(), 'recording': true});
    expect(t.reporter.position, isNull);
    expect(t.reporter.sharing, isFalse);
    expect(t.api.to('PUT', '/v1/driver/location').length, sent);
  });

  testWidgets('current marker expires without waiting for another native event', (WidgetTester tester) async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(fix());
    expect(t.reporter.position, isNotNull);
    await tester.pump(const Duration(seconds: 120));
    expect(t.reporter.position, isNull);
  });

  testWidgets('the card explains first; only "Đồng ý chia sẻ" starts the core', (WidgetTester tester) async {
    final t = await build();
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: SingleChildScrollView(child: ShipLocationShareCard(reporter: t.reporter)))));
    expect(find.text('Đang tắt'), findsOneWidget);
    await tester.tap(find.byKey(const Key('m07-share-start')));
    await tester.pump();
    expect(find.textContaining('60 giây'), findsOneWidget);
    expect(find.textContaining('không lưu vệt di chuyển'), findsOneWidget);
    expect(t.feed.starts, 0);
    await tester.tap(find.byKey(const Key('m07-confirm-back')));
    await tester.pump();
    expect(t.feed.starts, 0);
    await tester.tap(find.byKey(const Key('m07-share-start')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('m07-confirm-yes')));
    await tester.pump();
    await tester.pump();
    expect(t.feed.starts, 1);
    expect(find.text('Đang chia sẻ'), findsOneWidget);
    expect(find.byKey(const Key('m07-share-stop')), findsOneWidget);
    await tester.runAsync(t.reporter.stop);
  });
}
