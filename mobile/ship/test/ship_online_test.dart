import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_alerts.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_m07.dart';
import 'package:ship/ship_online.dart';

// The one online switch: turning on shares the position first, turning off stops it when nothing needs it, a failed step is cleaned up so the app
// and the server agree, the app reopens into what the server says, and the screens read one state.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

/// Stands in for the running M13 client: only what the static report gate calls.
class _CaptureOps extends Fake implements OpsClient {
  final List<String> reports = <String>[];

  @override
  Future<void> record({required String kind, required String code, String? message, String? deliveryCode}) async {
    reports.add('$kind:$code');
  }
}

/// The phone side: the real service collects AND sends, so this fake plays the service. When it runs and has a fix it "sends" through the fake server
/// (the same route the real service calls) and reports what the server answered, the way the plugin's snapshot does. The Dart app never sends.
class _Feed extends LocationFeed {
  _Feed(this.api, this.clock);

  final FakeApiTransport api;
  final List<DateTime> clock;
  final StreamController<Map<String, dynamic>> controller = StreamController<Map<String, dynamic>>.broadcast();

  /// The fix the phone has (null: none yet).
  Map<String, dynamic>? current;

  /// What the service reports about its own sending.
  Map<String, dynamic> sent = <String, dynamic>{};
  int starts = 0;
  int stops = 0;
  int puts = 0;
  bool running = false;
  final List<String> settings = <String>[];
  Object? startError;
  Completer<void>? startGate;

  @override
  Stream<Map<String, dynamic>> get positions => controller.stream;

  @override
  Future<void> start({String? apiBaseUrl}) async {
    starts++;
    await startGate?.future;
    if (startError != null) throw startError!;
    running = true;
    sent = <String, dynamic>{};
    if (_hasFix) await _send();
  }

  /// The service sends only a fix it accepts (fresh, GPS on).
  bool get _hasFix => current != null && current!['fresh'] == true && current!['gpsEnabled'] != false;

  Future<void> _send() async {
    final ApiResponse r = await api.send('PUT', '/v1/driver/location', body: utf8.encode('{}'));
    puts++;
    if (r.status == 200) {
      final Object? d = r.data;
      final Map<String, Object?> data = d is Map<String, Object?> ? d : <String, Object?>{};
      sent = <String, dynamic>{'uploadedAt': clock.last.millisecondsSinceEpoch, 'uploadState': 'OK', 'shouldShare': data['should_share_location'], 'intentOnline': data['intent_online']};
    } else if (r.status == 401) {
      running = false;
      sent = <String, dynamic>{'uploadState': 'SESSION_ENDED'};
    } else {
      sent = <String, dynamic>{...sent, 'uploadState': r.status == 403 || r.status == 409 ? 'REFUSED' : 'FAILED'};
    }
  }

  Map<String, dynamic> snapshot() => running
      ? <String, dynamic>{...?current, ...sent, 'recording': true}
      : <String, dynamic>{'recording': false, 'permissionGranted': true, 'gpsEnabled': true, 'status': 'Đã dừng', if (sent['uploadState'] == 'SESSION_ENDED') ...sent};

  /// A new fix arrives; the service sends it and tells the app.
  Future<void> nextFix() async {
    current = fix(clock.last);
    if (running && _hasFix) {
      await _send();
      controller.add(snapshot());
    }
  }

  @override
  Future<Map<String, dynamic>?> status() async => snapshot();

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
  Future<void> report() => feed.nextFix();
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
  final List<DateTime> clock = <DateTime>[DateTime.utc(2026, 10, 24, 9)];
  final _Feed feed = _Feed(api, clock);
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
  group('a required app update (#193)', () {
    test('refuses to go online while one is pending, says why, and starts nothing', () async {
      final t = await _build();
      final ValueNotifier<bool> blocked = ValueNotifier<bool>(true);
      t.online.bindUpdateGate(gate: blocked, blocked: () => blocked.value);
      expect(await t.online.setOnline(true), isFalse);
      expect(t.online.message, contains('Cần cập nhật ứng dụng'));
      expect(t.feed.starts, 0);
      expect(t.accepting, isEmpty);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      blocked.value = false;
      expect(await t.online.setOnline(true), isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
    });

    test('a shipper who is online is switched to not accepting the moment a required update is known; the sharing follows the server', () async {
      final t = await _build();
      expect(await t.driver.setAccepting(true), isTrue);
      expect(t.online.receiving, isTrue);
      final ValueNotifier<bool> blocked = ValueNotifier<bool>(false);
      t.online.bindUpdateGate(gate: blocked, blocked: () => blocked.value);
      blocked.value = true;
      blocked.notifyListeners();
      await settle();
      expect(t.accepting.last, contains('false'));
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.online.newWorkBlockedByUpdate, isTrue);
    });
  });

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
      // Past this app's own 100 s the SERVER has not said anything yet: the screen still follows the server, and waits for the next report.
      t.advance(const Duration(seconds: 101));
      expect(t.reporter.serverHasPosition, isFalse);
      expect(t.online.receiving, isTrue);
      expect(t.online.statusLine, 'Đang lấy vị trí…');
      // Once the server's own 120 s have passed it says so, and only then the screen pauses.
      t.server.locationReady = false;
      await t.driver.load();
      expect(t.online.receiving, isFalse);
      expect(t.online.paused, isTrue);
      expect(t.online.statusLine, 'Chưa có vị trí · Tạm dừng nhận đơn');
      expect(t.driver.profile!.acceptingDeliveries, isTrue, reason: 'the switch is the Shipper\'s');
      expect(t.driver.profile!.presence!.pausedReason, 'LOCATION_STALE');
      await t.report();
      await settle();
      expect(t.online.receiving, isTrue);
      expect(t.online.paused, isFalse);
      expect(t.accepting.length, postsBefore, reason: 'resuming asks nothing of the accepting command');
    });

    test('GPS_STALE (#264): a shared position that the server stops holding is reported once, without the position', () async {
      final _CaptureOps ops = _CaptureOps();
      OpsClient.attachForTest(ops);
      addTearDown(() => OpsClient.attachForTest(null));
      final t = await _build();
      await t.driver.setAccepting(true);
      t.advance(const Duration(seconds: 101));
      t.feed.controller.add(t.feed.snapshot());
      await settle();
      expect(ops.reports, <String>['GPS_STALE:GPS_STALE_NO_SERVER_POSITION']);
      t.advance(const Duration(seconds: 5));
      t.feed.controller.add(t.feed.snapshot());
      await settle();
      expect(ops.reports, hasLength(1), reason: 'one report per stale episode');
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

    test('a revoked session (the service gets 401): the service ends itself, the app learns it, ends the session and starts nothing again', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.api.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      t.api.routes['GET /v1/driver/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      t.advance(const Duration(minutes: 1));
      await t.report();
      await settle();
      expect(t.feed.running, isFalse);
      expect(t.session.status, isNot(SessionStatus.signedIn));
      expect(t.reporter.sharing, isFalse);
      final int starts = t.feed.starts;
      await t.online.reconcile(force: true);
      await settle();
      expect(t.feed.starts, starts);
    });

    test('the app was swiped away and opened again: the service that kept running is adopted, nothing is started a second time', () async {
      final t = await _build(attach: false, accepting: true, locationReady: true);
      t.feed.running = true;
      t.feed.current = fix(t.now);
      t.feed.sent = <String, dynamic>{'uploadedAt': t.now.millisecondsSinceEpoch, 'uploadState': 'OK', 'shouldShare': true, 'intentOnline': true};
      t.online.attach();
      await t.driver.load();
      await settle();
      expect(t.reporter.sharing, isTrue);
      expect(t.feed.starts, 0);
      expect(t.online.receiving, isTrue);
      expect(t.feed.puts, 0, reason: 'the app never sends');
    });

    test('the service stopped itself because nothing needs the position any more: the app does not start it again', () async {
      final t = await _build();
      await t.driver.setAccepting(true);
      t.server.hasActiveWork = true;
      await t.driver.setAccepting(false);
      t.server.hasActiveWork = false;
      t.feed.running = false; // the service saw should_share_location=false and stopped
      t.advance(const Duration(seconds: 5));
      t.feed.controller.add(t.feed.snapshot());
      await settle();
      await t.driver.load();
      await settle();
      expect(t.reporter.sharing, isFalse);
      expect(t.feed.starts, 1);
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
      expect(find.byKey(const Key('ship-alert')), findsOneWidget, reason: 'one alert, not a stack of notices');
      expect(find.text('11Ship chưa được cấp quyền vị trí.'), findsOneWidget);
      expect(find.byKey(const Key('ship-alert-app-settings')), findsOneWidget);
      expect(find.byKey(const Key('ship-location-problem')), findsNothing, reason: 'the old problem note is merged into the alert');
      expect(find.textContaining('request'), findsNothing);
      expect(find.textContaining('PERMISSION'), findsNothing);
      await tester.tap(find.byKey(const Key('ship-alert-app-settings')));
      await tester.runAsync(settle);
      expect(t.feed.settings, <String>['app']);
    });

    testWidgets('Home: paused receiving is shown as paused, with the short line, and the switch is still the Shipper\'s', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await tester.runAsync(() => t.driver.setAccepting(true));
      t.advance(const Duration(seconds: 130));
      t.server.locationReady = false; // the server's own limit has passed
      await tester.runAsync(t.driver.load);
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: ShipHome(session: t.session, driver: t.driver, onNotifications: () {}, onlineOverride: t.online))));
      await tester.pump();
      expect(find.byKey(const Key('home-activity-status')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('home-activity-status'))).data, 'Tạm dừng nhận đơn');
      expect(find.byKey(const Key('ship-alert')), findsOneWidget);
      expect(find.text('Tạm dừng nhận đơn — chưa có vị trí mới.'), findsOneWidget);
      expect(find.text('Tắt online'), findsOneWidget);
      expect(find.byKey(const Key('home-gps-status')), findsNothing, reason: 'the GPS line is merged into the label and the alert');
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

  group('home alert and label on the real state (#194)', () {
    Widget home(_T t, {HealthMonitor? monitor}) {
      final Widget screen = Scaffold(body: ShipHome(session: t.session, driver: t.driver, onNotifications: () {}, onlineOverride: t.online, liveTick: const Duration(days: 1)));
      return MaterialApp(theme: buildN11Theme(), home: monitor == null ? screen : HealthScope(monitor: monitor, child: screen));
    }

    Future<void> online(WidgetTester tester, _T t, {HealthMonitor? monitor}) async {
      await tester.pumpWidget(home(t, monitor: monitor));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
    }

    // The reporter's own timers (100 s ack, position expiry) belong to the test's fake clock: end the sharing so none is left pending.
    Future<void> finish(WidgetTester tester, _T t) async {
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(t.reporter.stop);
    }

    Future<void> phone(WidgetTester tester, _T t, Map<String, dynamic> change) async {
      t.feed.current = <String, dynamic>{...?t.feed.current, ...change};
      await tester.runAsync(() async { t.feed.controller.add(t.feed.snapshot()); await settle(); });
      await tester.pump();
    }

    testWidgets('online, GPS turned off: the alert names the GPS, opens the location settings, receiving is paused; GPS back on clears it by itself', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await online(tester, t);
      expect(find.byKey(const Key('ship-alert')), findsNothing, reason: 'nothing to report while everything works');
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
      await phone(tester, t, <String, dynamic>{'gpsEnabled': false, 'fresh': false, 'fixState': 'DISABLED'});
      expect(find.text('Vị trí đang tắt'), findsOneWidget);
      expect(find.text('Vị trí đang tắt. Hãy bật Vị trí để tiếp tục nhận đơn.'), findsOneWidget);
      expect(find.byKey(const Key('ship-alert')), findsOneWidget);
      await tester.tap(find.byKey(const Key('ship-alert-location-settings')));
      await tester.runAsync(settle);
      expect(t.feed.settings, <String>['location']);
      await tester.runAsync(() async { t.feed.current = fix(t.now); await t.report(); await settle(); });
      await tester.pump();
      expect(find.byKey(const Key('ship-alert')), findsNothing, reason: 'it disappears by itself once the phone has a fix again');
      expect(t.driver.profile!.acceptingDeliveries, isTrue, reason: 'the intent to be online was kept the whole time');
      expect(find.text('Đang chia sẻ vị trí'), findsOneWidget);
      await finish(tester, t);
    });

    testWidgets('the phone says there is no Internet but GPS is fine: the alert is about the network only', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await online(tester, t);
      await phone(tester, t, <String, dynamic>{'networkAvailable': false});
      expect(find.text('Điện thoại đang mất kết nối Internet.'), findsOneWidget);
      expect(find.textContaining('Vị trí đang tắt'), findsNothing);
      expect(find.byKey(const Key('ship-alert-retry-network')), findsOneWidget);
      await phone(tester, t, <String, dynamic>{'networkAvailable': true});
      expect(find.byKey(const Key('ship-alert')), findsNothing);
      await finish(tester, t);
    });

    testWidgets('Internet fine but the server answers 503: "Chưa kết nối được máy chủ", never "Wi-Fi/dữ liệu đã tắt"; one alert, no second connection banner', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      final HealthMonitor monitor = HealthMonitor(baseUrl: Uri.parse('https://api.example.test'), transport: (Uri uri, Duration timeout) async => const RawHealthResponse(status: 503, body: '{}'));
      await tester.runAsync(monitor.check);
      await phone(tester, t, <String, dynamic>{'networkAvailable': true});
      await online(tester, t, monitor: monitor);
      await tester.runAsync(monitor.check);
      await tester.pump();
      expect(find.text('Chưa kết nối được máy chủ. Vui lòng thử lại.'), findsOneWidget);
      expect(find.byKey(const Key('connection-banner')), findsNothing, reason: 'the home shows one notice, not the alert plus the shell banner');
      expect(find.textContaining('Wi-Fi'), findsNothing);
      expect(find.textContaining('dữ liệu di động'), findsNothing);
      await tester.tap(find.byKey(const Key('ship-alert-retry')));
      await tester.runAsync(settle);
      await finish(tester, t);
    });

    testWidgets('a shipper who is resting is not alarmed by a dead server or GPS; the normal connection banner stays the only notice', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      t.feed.current = <String, dynamic>{...?t.feed.current, 'gpsEnabled': false, 'networkAvailable': false};
      final HealthMonitor monitor = HealthMonitor(baseUrl: Uri.parse('https://api.example.test'), transport: (Uri uri, Duration timeout) async => throw Exception('down'));
      await tester.runAsync(monitor.check);
      await tester.pumpWidget(home(t, monitor: monitor));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      expect(find.byKey(const Key('ship-alert')), findsNothing);
      expect(find.byKey(const Key('connection-banner')), findsOneWidget);
      expect(find.text('Đã dừng chia sẻ vị trí'), findsOneWidget);
      expect(find.text('Bạn đang offline'), findsOneWidget);
      await finish(tester, t);
    });

    testWidgets('tapping Bật online with GPS off explains it then (not before), and the switch stays off', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      t.feed.current = <String, dynamic>{'recording': true, 'gpsEnabled': false, 'permissionGranted': true, 'fixState': 'DISABLED', 'status': 'Định vị đang tắt'};
      await tester.pumpWidget(home(t));
      await tester.pump();
      await tester.runAsync(settle);
      await tester.pump();
      expect(find.byKey(const Key('ship-alert')), findsNothing);
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      expect(find.text('Vị trí đang tắt'), findsOneWidget);
      expect(find.text('Bạn đang offline'), findsOneWidget);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      await finish(tester, t);
    });

    testWidgets('server paused after 120 s: the label turns into "last location", says it is not updated, and the explanation separates phone GPS from what the server got', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await online(tester, t);
      await tester.tap(find.byKey(const Key('home-location-info')));
      await tester.pump();
      expect(find.textContaining('Máy chủ nhận vị trí lần cuối: ${clockText(t.now)}'), findsOneWidget);
      expect(find.textContaining('Độ chính xác ước tính: ~12 m'), findsOneWidget);
      expect(find.textContaining('khoảng 1 phút/lần'), findsOneWidget);
      t.advance(const Duration(seconds: 130));
      t.server.locationReady = false;
      await tester.runAsync(t.driver.load);
      await tester.pump();
      expect(find.text('Vị trí lần cuối ${clockText(t.now.subtract(const Duration(seconds: 130)))}'), findsOneWidget);
      expect(find.textContaining('chưa được cập nhật'), findsOneWidget);
      expect(find.text('Tạm dừng nhận đơn — chưa có vị trí mới.'), findsOneWidget);
      expect(find.text('Đang chia sẻ vị trí'), findsNothing, reason: 'an old position is never described as live');
      expect(t.driver.profile!.acceptingDeliveries, isTrue, reason: 'opening the explanation and the pause never touch the switch');
      await finish(tester, t);
    });

    testWidgets('switched off with a delivery still in hand: the home says the sharing continues for that order', (WidgetTester tester) async {
      final t = await tester.runAsync(_build) as _T;
      await online(tester, t);
      t.server.hasActiveWork = true;
      await tester.tap(find.byKey(const Key('online-button')));
      await tester.runAsync(() async { await settle(); await settle(); });
      await tester.pump();
      await tester.tap(find.byKey(const Key('home-location-info')));
      await tester.pump();
      expect(find.textContaining('Bạn đã tắt nhận đơn mới nhưng vẫn chia sẻ vị trí cho đơn đang xử lý.'), findsOneWidget);
      expect(find.text('Đã dừng chia sẻ vị trí'), findsNothing);
      await finish(tester, t);
    });
  });

}
