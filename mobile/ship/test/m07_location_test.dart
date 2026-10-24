import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_m07.dart';

// Sharing the Shipper's position (M07.06 / M14). The Android service is the ONLY sender; the app starts and stops it and reads what it reports:
// observing never starts GPS, the app never sends a position itself, a start waits until the server has accepted a position of this start,
// the server's words (keep sharing or not) reach the caller, and stopping really stops.

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
  Future<void> start({String? apiBaseUrl}) async {
    starts++;
    await startGate?.future;
    if (startError != null) {
      throw startError!;
    }
  }

  @override
  Future<void> stop() async => stops++;
}

/// A snapshot as the service reports it: the position, and (when the service has sent one) what the server accepted.
Map<String, dynamic> fix({bool fresh = true, double lat = 22.66, double lon = 106.25, int time = 1792314000000, int? uploadedAt, String? uploadState, bool? shouldShare, bool? intentOnline, bool recording = true}) => <String, dynamic>{
      'recording': recording, 'lat': lat, 'lon': lon, 'accuracy': 12.0, 'fresh': fresh, 'time': time,
      if (uploadedAt != null) 'uploadedAt': uploadedAt,
      if (uploadState != null) 'uploadState': uploadState,
      if (shouldShare != null) 'shouldShare': shouldShare,
      if (intentOnline != null) 'intentOnline': intentOnline,
    };

Future<({ShipLocationReporter reporter, FakeApiTransport api, _Feed feed, List<DateTime> clock})> build({Duration firstFix = const Duration(milliseconds: 200)}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final _Feed feed = _Feed();
  final List<DateTime> clock = <DateTime>[DateTime.utc(2026, 10, 18, 9)];
  final ShipLocationReporter reporter = ShipLocationReporter(session: session, feed: feed, firstFixTimeout: firstFix, clock: () => clock.last);
  addTearDown(() async { reporter.dispose(); await feed.controller.close(); });
  return (reporter: reporter, api: api, feed: feed, clock: clock);
}

int ms(DateTime t) => t.millisecondsSinceEpoch;

void main() {
  test('observing never starts the core and never sends anything', () async {
    final t = await build();
    expect(t.reporter.sharing, isFalse);
    expect(t.feed.starts, 0);
    t.feed.controller.add(fix());
    await Future<void>.delayed(Duration.zero);
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
  });

  test('the app never sends a position itself: a valid fix only becomes the marker (the service is the sender)', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last)));
    t.clock.add(t.clock.last.add(const Duration(minutes: 2)));
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last)));
    expect(t.reporter.position, isNotNull);
    expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
    expect(t.reporter.serverHasPosition, isFalse, reason: 'only a report the service got accepted counts');
  });

  test('a report the server accepted is shown once, with the server\'s words; the same one again is not a new answer', () async {
    final t = await build();
    final List<LocationAck> acks = <LocationAck>[];
    t.reporter.onAck = acks.add;
    await t.reporter.start();
    final int at = ms(t.clock.last);
    await t.reporter.onSnapshot(fix(time: at, uploadedAt: at, uploadState: 'OK', shouldShare: true, intentOnline: true));
    await t.reporter.onSnapshot(fix(time: at, uploadedAt: at, uploadState: 'OK', shouldShare: true, intentOnline: true));
    expect(acks.length, 1);
    expect(acks.single.shouldShare, isTrue);
    expect(acks.single.intentOnline, isTrue);
    expect(t.reporter.serverHasPosition, isTrue);
    expect(t.reporter.lastUpload, isNotNull);
    final int later = at + 60000;
    await t.reporter.onSnapshot(fix(time: later, uploadedAt: later, uploadState: 'OK', shouldShare: false, intentOnline: false));
    expect(acks.length, 2);
    expect(acks.last.shouldShare, isFalse);
  });

  test('what an earlier run left behind (service not running) is never taken for a report of this one', () async {
    final t = await build();
    final List<LocationAck> acks = <LocationAck>[];
    t.reporter.onAck = acks.add;
    await t.reporter.onSnapshot(fix(recording: false, uploadedAt: ms(t.clock.last), uploadState: 'OK', shouldShare: false));
    expect(acks, isEmpty);
    expect(t.reporter.serverHasPosition, isFalse);
  });

  test('failed sends are visible; a refusal reaches the caller once; an ended session reaches it once and is not repeated by every read', () async {
    final t = await build();
    int refused = 0;
    t.reporter.onRefused = () => refused++;
    await t.reporter.start();
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last), uploadState: 'FAILED'));
    expect(t.reporter.error, contains('Chưa gửi được'));
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last), uploadState: 'REFUSED'));
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last), uploadState: 'REFUSED'));
    expect(refused, 1);
    await t.reporter.onSnapshot(fix(recording: false, uploadState: 'SESSION_ENDED'));
    await t.reporter.onSnapshot(fix(recording: false, uploadState: 'SESSION_ENDED'));
    expect(refused, 2);
    expect(t.reporter.sharing, isFalse);
  });

  test('native timeout is visible and a stopped recorder cannot make a position current', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(<String, dynamic>{'fresh': false, 'recording': true, 'status': 'Hết thời gian chờ vị trí mới'});
    expect(t.reporter.error, contains('Hết thời gian chờ'));
    t.clock.add(t.clock.last.add(const Duration(seconds: 5)));
    await t.reporter.onSnapshot(<String, dynamic>{...fix(), 'recording': false, 'status': 'Quyền vị trí đã bị thu hồi'});
    expect(t.reporter.sharing, isFalse);
    expect(t.reporter.error, contains('Quyền vị trí'));
    expect(t.reporter.position, isNull);
    await t.reporter.stop();
  });

  test('stopping cancels the subscription and stops the core', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.stop();
    expect(t.reporter.sharing, isFalse);
    expect(t.feed.stops, 1);
    t.feed.controller.add(fix());
    await Future<void>.delayed(Duration.zero);
    expect(t.reporter.position, isNull);
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
    await t.reporter.onSnapshot(fix());
    expect(t.reporter.position, isNull);
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
  });

  test('GPS states follow M14 and clearing sharing rejects even a fresh queued event', () async {
    final t = await build();
    expect(t.reporter.gpsStatus, 'Chưa bật chia sẻ vị trí');
    await t.reporter.start();
    expect(t.reporter.gpsStatus, 'Đang lấy vị trí');
    for (final (String, Map<String, dynamic>) state in <(String, Map<String, dynamic>)>[
      ('Đã có vị trí mới', fix(time: ms(t.clock.last))),
      ('GPS đang tắt', {'gpsEnabled': false}),
      ('Đang lấy vị trí', {'gpsEnabled': true, 'fixState': 'DISABLED'}), // provider re-enabled before the next recorder cycle
      ('Chưa cấp quyền vị trí', {'permissionGranted': false}),
      ('Hết thời gian chờ định vị', {'fixState': 'TIMEOUT'}),
      ('Không lấy được vị trí', {'fixState': 'UNAVAILABLE'}),
    ]) {
      await t.reporter.onSnapshot(state.$2);
      expect(t.reporter.gpsStatus, state.$1);
    }
    await t.reporter.stop();
    await t.reporter.onSnapshot({...fix(time: ms(t.clock.last)), 'recording': true});
    expect(t.reporter.position, isNull);
    expect(t.reporter.sharing, isFalse);
  });

  testWidgets('current marker expires without waiting for another native event', (WidgetTester tester) async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(fix(time: ms(t.clock.last)));
    expect(t.reporter.position, isNotNull);
    await tester.pump(const Duration(seconds: 120));
    expect(t.reporter.position, isNull);
  });

  test('a "not recording" read right after the start is the service still starting, not a stop; a real stop later is', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.onSnapshot(<String, dynamic>{'recording': false, 'permissionGranted': true, 'status': 'Đã dừng'});
    expect(t.reporter.sharing, isTrue);
    t.clock.add(t.clock.last.add(const Duration(seconds: 4)));
    await t.reporter.onSnapshot(<String, dynamic>{'recording': false, 'permissionGranted': true, 'status': 'Đã dừng'});
    expect(t.reporter.sharing, isFalse);
  });

  group('acquire: start, then wait until the server has accepted a position of this start', () {
    Future<void> accepted(dynamic t) async {
      final int at = ms(t.clock.last as DateTime);
      await t.reporter.onSnapshot(fix(time: at, uploadedAt: at, uploadState: 'OK', shouldShare: false, intentOnline: false));
    }

    test('starts the core once and reports success only when the server has accepted a position', () async {
      final t = await build();
      final Future<bool> pending = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await t.reporter.onSnapshot(fix(time: ms(t.clock.last)));
      expect(t.reporter.serverHasPosition, isFalse, reason: 'a position alone is not enough');
      await accepted(t);
      expect(await pending, isTrue);
      expect(t.feed.starts, 1);
      expect(t.api.to('PUT', '/v1/driver/location'), isEmpty);
      expect(t.reporter.serverHasPosition, isTrue);
      expect(t.reporter.problem, LocationProblem.none);
    });

    test('a double tap shares one attempt: one start, one answer', () async {
      final t = await build();
      final Future<bool> a = t.reporter.acquire();
      final Future<bool> b = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await accepted(t);
      expect(await a, isTrue);
      expect(await b, isTrue);
      expect(t.feed.starts, 1);
    });

    test('already sharing with a recent accepted report: answers at once, nothing new is started', () async {
      final t = await build();
      final Future<bool> first = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await accepted(t);
      await first;
      expect(await t.reporter.acquire(), isTrue);
      expect(t.feed.starts, 1);
    });

    test('a refused permission fails with the permission problem and leaves nothing running', () async {
      final t = await build();
      t.feed.startError = PlatformException(code: 'PERMISSION', message: 'x');
      expect(await t.reporter.acquire(), isFalse);
      expect(t.reporter.sharing, isFalse);
      expect(t.reporter.problem, LocationProblem.permission);
    });

    test('notifications switched off is its own problem', () async {
      final t = await build();
      t.feed.startError = PlatformException(code: 'NOTIFICATION', message: 'x');
      expect(await t.reporter.acquire(), isFalse);
      expect(t.reporter.problem, LocationProblem.notification);
    });

    test('GPS off fails at once with the GPS problem (the app never turns GPS on itself)', () async {
      final t = await build(firstFix: const Duration(seconds: 30));
      final Future<bool> pending = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await t.reporter.onSnapshot(<String, dynamic>{'recording': true, 'gpsEnabled': false, 'permissionGranted': true, 'fixState': 'DISABLED', 'status': 'Định vị đang tắt'});
      expect(await pending, isFalse);
      expect(t.reporter.problem, LocationProblem.gpsOff);
    });

    test('no position in time fails with the no-fix problem', () async {
      final t = await build();
      expect(await t.reporter.acquire(), isFalse);
      expect(t.reporter.sharing, isTrue, reason: 'the caller decides whether to stop again');
      expect(t.reporter.problem, LocationProblem.noFix);
    });

    test('a position the service could not get to the server fails with the upload problem', () async {
      final t = await build();
      final Future<bool> pending = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await t.reporter.onSnapshot(fix(time: ms(t.clock.last), uploadState: 'FAILED'));
      expect(await pending, isFalse);
      expect(t.reporter.problem, LocationProblem.upload);
    });

    test('stopping drops the report: a new start has to get a new position to the server first', () async {
      final t = await build();
      final Future<bool> first = t.reporter.acquire();
      await Future<void>.delayed(Duration.zero);
      await accepted(t);
      await first;
      await t.reporter.stop();
      expect(t.reporter.serverHasPosition, isFalse);
      expect(await t.reporter.acquire(), isFalse, reason: 'no new accepted report arrived');
    });
  });

  test('signing out stops the core', () async {
    final t = await build();
    await t.reporter.start();
    await t.reporter.session.logout();
    await Future<void>.delayed(Duration.zero);
    expect(t.reporter.sharing, isFalse);
    expect(t.feed.stops, greaterThanOrEqualTo(1));
  });

  test('the report goes stale on screen without waiting for another native event', () async {
    final t = await build();
    await t.reporter.start();
    final int at = ms(t.clock.last);
    await t.reporter.onSnapshot(fix(time: at, uploadedAt: at, uploadState: 'OK'));
    expect(t.reporter.serverHasPosition, isTrue);
    t.clock.add(t.clock.last.add(const Duration(seconds: 101)));
    expect(t.reporter.serverHasPosition, isFalse);
  });
}
