import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_m07.dart';
import 'package:ship/ship_online.dart';

// The one online switch: turning on shares the position first, turning off stops it when nothing needs it, a failed step is cleaned up so the app
// and the server agree, the app reopens into what the server says, and the screens read one state.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

class _Feed extends LocationFeed {
  /// What the core reports when asked (null: nothing yet).
  Map<String, dynamic>? current;
  int starts = 0;
  int stops = 0;
  bool running = false;
  final List<String> settings = <String>[];
  Object? startError;
  Completer<void>? startGate;

  @override
  Stream<Map<String, dynamic>> get positions => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<void> start() async {
    starts++;
    await startGate?.future;
    if (startError != null) throw startError!;
    running = true;
  }

  /// Like the real core: it reports a position only while the service runs.
  @override
  Future<Map<String, dynamic>?> status() async => running ? current : <String, dynamic>{'recording': false, 'permissionGranted': true, 'gpsEnabled': true, 'status': 'Đã dừng'};

  @override
  Future<void> stop() async {
    stops++;
    running = false;
  }

  @override
  Future<void> openSettings(String kind) async => settings.add(kind);
}

Map<String, dynamic> fix(DateTime now) => <String, dynamic>{
      'recording': true, 'lat': 22.66, 'lon': 106.25, 'accuracy': 12.0, 'fresh': true, 'permissionGranted': true, 'gpsEnabled': true, 'fixState': 'FIX',
      'time': now.millisecondsSinceEpoch,
    };

Map<String, Object?> driverProfile({bool accepting = false}) => <String, Object?>{
      'driver_id': '55555555-5555-4555-8555-555555555555',
      'user_id': '11111111-1111-4111-8111-111111111111',
      'shipper_code': 'SH000001',
      'full_name': 'Trần Văn Shipper',
      'phone': '+84901234567',
      'plate_number': null,
      'status': 'ACTIVE',
      'review_state': 'APPROVED',
      'accepting_deliveries': accepting,
      'version': 1,
    };

class _T {
  _T(this.api, this.server, this.session, this.driver, this.feed, this.reporter, this.online, this.clock);
  final FakeApiTransport api;
  final FakeDriverServer server;
  final SessionController session;
  final DriverController driver;
  final _Feed feed;
  final ShipLocationReporter reporter;
  final ShipOnline online;
  final List<DateTime> clock;

  DateTime get now => clock.last;
  void advance(Duration d) => clock.add(clock.last.add(d));
  Future<void> report() => reporter.onSnapshot(fix(now));
  Iterable<String> get accepting => api.to('POST', '/v1/driver/me/accepting').map((RecordedRequest r) => r.body);
}

Future<_T> _build({bool accepting = false, bool walletReady = true, bool attach = true, bool locationReady = false, Duration firstFix = const Duration(milliseconds: 300)}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final FakeDriverServer server = FakeDriverServer(api)
    ..profile = driverProfile(accepting: accepting)
    ..walletReady = walletReady
    ..locationReady = locationReady
    ..enableLocationRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final DriverController driver = DriverController(session: session);
  final _Feed feed = _Feed();
  final List<DateTime> clock = <DateTime>[DateTime.utc(2026, 10, 24, 9)];
  final ShipLocationReporter reporter = ShipLocationReporter(session: session, feed: feed, firstFixTimeout: firstFix, clock: () => clock.last);
  final ShipOnline online = ShipOnline(session: session, reporter: reporter, driver: driver);
  final _T t = _T(api, server, session, driver, feed, reporter, online, clock);
  feed.current = fix(t.now);
  addTearDown(() { online.dispose(); reporter.dispose(); driver.dispose(); });
  if (attach) {
    online.attach();
    await driver.load();
    await Future<void>.delayed(Duration.zero);
  }
  return t;
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  group('turning on', () {
    test('shares the position first, then asks the server; one button does both', () async {
      final t = await _build();
      expect(t.feed.starts, 0, reason: 'opening the app with the switch off starts nothing');
      expect(await t.driver.setAccepting(true), isTrue);
      expect(t.feed.starts, 1);
      final List<String> order = t.api.requests.where((RecordedRequest r) => r.path == '/v1/driver/location' || r.path == '/v1/driver/me/accepting').map((RecordedRequest r) => r.path).toList();
      expect(order, <String>['/v1/driver/location', '/v1/driver/me/accepting'], reason: 'the server holds a position before it is asked to accept');
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
      expect(t.online.receiving, isTrue);
      expect(t.online.paused, isFalse);
      expect(t.online.statusLine, 'Đang chia sẻ vị trí');
      expect(t.online.problem, LocationProblem.none);
    });

    test('permission refused: stays offline, nothing is asked of the server, the instruction is the permission one', () async {
      final t = await _build();
      t.feed.startError = PlatformException(code: 'PERMISSION', message: 'denied');
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.accepting, isEmpty);
      expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
      expect(t.reporter.sharing, isFalse);
      expect(t.online.problem, LocationProblem.permission);
      expect(t.online.statusLine, isNull);
    });

    test('GPS off: stays offline and the service that was started is stopped again', () async {
      final t = await _build();
      t.feed.current = <String, dynamic>{'recording': true, 'gpsEnabled': false, 'permissionGranted': true, 'fixState': 'DISABLED', 'status': 'Định vị đang tắt'};
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.online.problem, LocationProblem.gpsOff);
      expect(t.accepting, isEmpty);
      expect(t.feed.stops, 1);
      expect(t.reporter.sharing, isFalse);
    });

    test('no position in time: stays offline, the service is stopped, "Thử lại" works once a position exists', () async {
      final t = await _build();
      t.feed.current = null;
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.online.problem, LocationProblem.noFix);
      expect(t.feed.stops, 1);
      expect(t.accepting, isEmpty);
      t.feed.current = fix(t.now);
      await t.online.retry();
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
      expect(t.online.problem, LocationProblem.none);
    });

    test('the position cannot be sent: stays offline and cleans up', () async {
      final t = await _build();
      t.api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.online.problem, LocationProblem.upload);
      expect(t.feed.stops, 1);
      expect(t.accepting, isEmpty);
    });

    test('the server refuses (wallet): the sharing it started is stopped and the reason is a plain sentence', () async {
      final t = await _build();
      t.server.walletReady = false; // changed since the profile was read
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.feed.stops, 1);
      expect(t.reporter.sharing, isFalse);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.online.message, contains('Ví chưa đủ điều kiện'));
      expect(t.online.message, isNot(contains('request')));
    });

    test('the answer is lost but the server did switch on: the app reads the server and keeps sharing', () async {
      final t = await _build();
      t.api.routes['POST /v1/driver/me/accepting'] = (String m, String p, Map<String, String> h, String b) async {
        t.server.profile!['accepting_deliveries'] = true;
        t.server.profile!['version'] = 2;
        throw const AuthFailure(AuthFailureKind.unknownOutcome);
      };
      expect(await t.driver.setAccepting(true), isFalse);
      await settle();
      expect(t.driver.profile!.acceptingDeliveries, isTrue, reason: 'read back from the server');
      expect(t.reporter.sharing, isTrue, reason: 'the server wants orders, so the position stays');
      expect(t.feed.stops, 0);
    });

    test('the answer is lost and the server did not switch on: the sharing is stopped', () async {
      final t = await _build();
      t.api.routes['POST /v1/driver/me/accepting'] = (String m, String p, Map<String, String> h, String b) async => throw const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await t.driver.setAccepting(true), isFalse);
      await settle();
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.reporter.sharing, isFalse);
      expect(t.feed.stops, 1);
    });

    test('the answer is lost and the server cannot be read either: nothing is guessed, sharing stays until a later read decides', () async {
      final t = await _build();
      t.api.routes['POST /v1/driver/me/accepting'] = (String m, String p, Map<String, String> h, String b) async => throw const AuthFailure(AuthFailureKind.unknownOutcome);
      t.api.routes['GET /v1/driver/me'] = (String m, String p, Map<String, String> h, String b) async => throw const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.reporter.sharing, isTrue);
      expect(t.feed.stops, 0);
      expect(t.online.message, contains('Kiểm tra mạng'));
    });

    test('a double tap is one attempt: one start, one request', () async {
      final t = await _build();
      final Future<bool> a = t.driver.setAccepting(true);
      final Future<bool> b = t.driver.setAccepting(true);
      expect(await b, isFalse, reason: 'ignored while the first one runs');
      expect(await a, isTrue);
      expect(t.feed.starts, 1);
      expect(t.accepting.length, 1);
      expect(t.api.to('PUT', '/v1/driver/location').length, 1);
    });

    test('a server that does not know the account is not online: no profile, nothing starts', () async {
      final t = await _build();
      t.server.profile = null;
      await t.driver.load();
      expect(await t.online.setOnline(true), isFalse);
      expect(t.feed.starts, 0);
    });
  });

  group('turning off', () {
    test('with no work in progress the service stops and the position is no longer sent', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      expect(await t.driver.setAccepting(false), isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.reporter.sharing, isFalse);
      expect(t.feed.stops, 1);
      expect(t.online.statusLine, isNull);
      final int sent = t.server.locationReports;
      t.advance(const Duration(minutes: 2));
      await t.report();
      expect(t.server.locationReports, sent, reason: 'nothing is sent after stopping');
    });

    test('with a delivery in progress it stops new orders but keeps sharing, then stops by itself when the delivery ends', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.server.hasActiveWork = true;
      expect(await t.driver.setAccepting(false), isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.reporter.sharing, isTrue);
      expect(t.feed.stops, 0);
      expect(t.online.statusLine, 'Đang giao đơn · Vẫn chia sẻ vị trí');
      // The delivery ends on the server; the next report's answer tells the app nothing needs the position any more.
      t.server.hasActiveWork = false;
      t.advance(const Duration(minutes: 1));
      await t.report();
      await settle();
      expect(t.reporter.sharing, isFalse);
      expect(t.feed.stops, 1);
      expect(t.online.statusLine, isNull);
      expect(t.driver.profile!.acceptingDeliveries, isFalse, reason: 'never switched back on');
    });

    test('switching off is refused by the server: still online, still sharing', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.api.routes['POST /v1/driver/me/accepting'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'DRIVER_STATE_CONFLICT');
      expect(await t.driver.setAccepting(false), isFalse);
      expect(t.reporter.sharing, isTrue);
      expect(t.feed.stops, 0);
    });

    test('quick on, off, on: each call runs alone and the service is started once per turn-on', () async {
      final t = await _build();
      expect(await t.driver.setAccepting(true), isTrue);
      expect(await t.driver.setAccepting(false), isTrue);
      t.advance(const Duration(seconds: 20));
      t.feed.current = fix(t.now); // a new start brings a new position
      expect(await t.driver.setAccepting(true), isTrue);
      expect(t.feed.starts, 2);
      expect(t.feed.stops, 1);
      expect(t.reporter.sharing, isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
    });
  });

  group('position lost and back', () {
    test('a position the server no longer holds pauses receiving without touching the switch; the next report resumes it by itself', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      final int postsBefore = t.accepting.length;
      t.advance(const Duration(seconds: 101));
      expect(t.online.receiving, isFalse);
      expect(t.online.paused, isTrue);
      expect(t.online.statusLine, 'Chưa có vị trí · Tạm dừng nhận đơn');
      expect(t.driver.profile!.acceptingDeliveries, isTrue, reason: 'the switch is the Shipper\'s');
      // The server's own verdict is stale too; a report makes it fresh and the profile is read again.
      t.server.locationReady = false;
      await t.driver.load();
      expect(t.driver.profile!.presence!.pausedReason, 'LOCATION_STALE');
      await t.report();
      await settle();
      expect(t.online.receiving, isTrue);
      expect(t.online.paused, isFalse);
      expect(t.accepting.length, postsBefore, reason: 'resuming asks nothing of the accepting command');
    });

    test('a Shipper who switched off is never put back online by a position coming back', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      await t.driver.setAccepting(false);
      final int posts = t.accepting.length;
      t.advance(const Duration(minutes: 3));
      await t.report();
      await settle();
      await t.online.reconcile(force: true);
      expect(t.accepting.length, posts);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.online.receiving, isFalse);
    });
  });

  group('opening the app again', () {
    test('switch on at the server: sharing is restored by itself, nothing is asked of the accepting command', () async {
      final t = await _build(accepting: true, locationReady: false);
      await settle();
      expect(t.feed.starts, 1);
      expect(t.reporter.sharing, isTrue);
      expect(t.accepting, isEmpty);
      await settle();
      expect(t.online.receiving, isTrue, reason: 'after the first report the server confirms');
    });

    test('switch off and no work: nothing starts', () async {
      final t = await _build();
      await settle();
      expect(t.feed.starts, 0);
      expect(t.reporter.sharing, isFalse);
    });

    test('switch off but a delivery is in progress: sharing is restored for it', () async {
      final f = FakeApiTransport();
      f.requests.clear();
      final t = await _build(attach: false);
      t.server.hasActiveWork = true;
      t.online.attach();
      await t.driver.load();
      await settle();
      expect(t.feed.starts, 1);
      expect(t.accepting, isEmpty);
      expect(t.online.statusLine, anyOf('Đang lấy vị trí…', 'Đang giao đơn · Vẫn chia sẻ vị trí'));
    });

    test('permission taken away meanwhile: one clear problem, no prompt loop; "Thử lại" tries again', () async {
      final t = await _build(attach: false, accepting: true);
      t.feed.startError = PlatformException(code: 'PERMISSION', message: 'denied');
      t.online.attach();
      await t.driver.load();
      await settle();
      expect(t.feed.starts, 1);
      expect(t.online.problem, LocationProblem.permission);
      await t.driver.load();
      await settle();
      expect(t.feed.starts, 1, reason: 'no new attempt until the Shipper acts');
      t.feed.startError = null;
      await t.online.retry();
      expect(t.feed.starts, 2);
      expect(t.reporter.sharing, isTrue);
      expect(t.online.problem, LocationProblem.none);
    });

    test('returning to the app tries again and re-reads the server', () async {
      final t = await _build(attach: false, accepting: true);
      t.feed.startError = PlatformException(code: 'PERMISSION', message: 'denied');
      t.online.attach();
      await t.driver.load();
      await settle();
      expect(t.feed.starts, 1);
      t.feed.startError = null;
      t.reporter.onResumed!.call();
      await settle();
      expect(t.feed.starts, 2);
    });

    test('the server switches the account off elsewhere (suspension): the next report ends the sharing', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.server.profile!['accepting_deliveries'] = false;
      t.advance(const Duration(minutes: 1));
      await t.report();
      await settle();
      expect(t.reporter.sharing, isFalse);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
    });
  });

  group('sessions', () {
    test('signing out stops the service and nothing is sent with the old session', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      await t.session.logout();
      await settle();
      expect(t.reporter.sharing, isFalse);
      expect(t.feed.stops, greaterThanOrEqualTo(1));
      final int sent = t.api.to('PUT', '/v1/driver/location').length;
      t.advance(const Duration(minutes: 2));
      await t.report();
      expect(t.api.to('PUT', '/v1/driver/location').length, sent);
      expect(t.online.statusLine, isNull);
      expect(t.online.receiving, isFalse);
    });

    test('a revoked session (401 on a report) ends the sharing', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      t.advance(const Duration(minutes: 1));
      await t.report();
      await settle();
      expect(t.session.status, isNot(SessionStatus.signedIn));
      expect(t.reporter.sharing, isFalse);
    });
  });

  group('screens read the same state', () {
    testWidgets('Home: one button, one small line; no separate "Bật chia sẻ vị trí" button; turning on shows the line and the online title', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipHome(session: t.session, driver: t.driver, onNotifications: () {}, onlineOverride: t.online))));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      expect(find.text('Bật chia sẻ vị trí'), findsNothing);
      expect(find.byKey(const Key('m07-share-start')), findsNothing);
      expect(find.byKey(const Key('home-gps-status')), findsNothing, reason: 'nothing to say while offline');
      expect(find.text('Bạn đang offline'), findsOneWidget);
      expect(find.byKey(const Key('home-online-disclosure')), findsOneWidget);
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      expect(find.text('Bạn đang online'), findsOneWidget);
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
      expect(find.text('Tắt online'), findsOneWidget);
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      expect(find.text('Bạn đang offline'), findsOneWidget);
      expect(find.byKey(const Key('home-gps-status')), findsNothing);
    });

    testWidgets('Home: a refused permission keeps the Shipper offline and shows one short instruction with the settings button; no id or code', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      t.feed.startError = PlatformException(code: 'PERMISSION', message: 'denied');
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipHome(session: t.session, driver: t.driver, onNotifications: () {}, onlineOverride: t.online))));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      expect(find.text('Bạn đang offline'), findsOneWidget);
      expect(find.byKey(const Key('ship-location-problem')), findsOneWidget);
      expect(find.textContaining('quyền vị trí'), findsWidgets);
      expect(find.byKey(const Key('ship-location-settings')), findsOneWidget);
      expect(find.textContaining('request'), findsNothing);
      expect(find.textContaining('PERMISSION'), findsNothing);
      await tester.tap(find.byKey(const Key('ship-location-settings')));
      await tester.runAsync(settle);
      expect(t.feed.settings, <String>['app']);
    });

    testWidgets('Home: paused receiving is shown as paused, with the short line, and the switch is still the Shipper\'s', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await tester.runAsync(() => t.driver.setAccepting(true));
      t.advance(const Duration(seconds: 101));
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipHome(session: t.session, driver: t.driver, onNotifications: () {}, onlineOverride: t.online))));
      await tester.pump();
      expect(find.text('Tạm dừng nhận đơn'), findsOneWidget);
      expect(find.text('Chưa có vị trí · Tạm dừng nhận đơn'), findsOneWidget);
      expect(find.text('Tắt online'), findsOneWidget);
    });

    testWidgets('Delivery screens: the same line, from the same state', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await tester.runAsync(() => t.driver.setAccepting(true));
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipLocationStatusLine(online: t.online))));
      await tester.pump();
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Bật chia sẻ vị trí'), findsNothing);
    });

    testWidgets('Profile switch goes through the same handler as the Home button', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: DriverActivityScreen(controller: t.driver)));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      await tester.tap(find.byKey(const Key('driver-accepting-switch')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      expect(t.feed.starts, 1, reason: 'the profile switch also starts sharing first');
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
      expect(t.api.to('PUT', '/v1/driver/location'), isNotEmpty);
      await tester.runAsync(t.reporter.stop);
    });
  });
}
