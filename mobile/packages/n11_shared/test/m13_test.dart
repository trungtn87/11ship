import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

class _FakeTransport implements ApiTransport {
  _FakeTransport(this.answer);

  ApiResponse Function(String path) answer;
  final List<String> paths = <String>[];

  @override
  Future<ApiResponse> send(String method, String pathAndQuery, {Map<String, String> headers = const <String, String>{}, List<int>? body}) async {
    paths.add(pathAndQuery);
    return answer(pathAndQuery);
  }
}

ApiResponse _json(Object data, {int status = 200}) => ApiResponse(status: status, headers: const <String, String>{}, body: jsonEncode(<String, Object?>{'data': data}));

class _FakePlatform implements UpdatePlatform {
  _FakePlatform(this.dir);

  final Directory dir;

  @override
  Future<String> dataDirectory() async => dir.path;
}

/// What the server answers for a build older than the newest published one. The download fields are still sent by today's server; the app ignores them.
Map<String, Object?> _check({bool required = false, int versionCode = 9, String versionName = '1.9'}) => <String, Object?>{
      'status': required ? 'UPDATE_REQUIRED' : 'UPDATE_OPTIONAL',
      'update_available': true,
      'required': required,
      'release': <String, Object?>{
        'release_id': '11111111-2222-3333-4444-555555555555',
        'version_name': versionName,
        'version_code': versionCode,
        'size_bytes': 5000,
        'sha256': 'a' * 64,
        'download_path': '/v1/app-updates/download/11111111-2222-3333-4444-555555555555',
      },
    };

Map<String, Object?> _latest() => <String, Object?>{'status': 'COMPATIBLE', 'update_available': false, 'required': false, 'release': null};

AppUpdateController _controller(_FakeTransport transport, _FakePlatform platform, {int installed = 5, DateTime Function()? now}) => AppUpdateController(
      component: 'SHIP',
      installedVersionCode: installed,
      installedVersionName: '1.0',
      transport: transport,
      platform: platform,
      now: now,
    );


const AppConfig _config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Future<({SessionController session, FakeApiTransport api})> _signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, _config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

/// A source whose token registration the server refuses (or that is offline); only what PushSync calls is implemented.
class _PushFailSource implements NotificationSource {
  _PushFailSource(this.session);

  final SessionController session;
  NotificationFailureKind kind = NotificationFailureKind.server;
  int tries = 0;

  @override
  Future<void> registerPushToken(String token) async {
    tries += 1;
    throw NotificationFailure(kind);
  }

  @override
  Future<void> reportPushPermissionDenied() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _PushPort implements PushPort {
  final StreamController<String> refreshes = StreamController<String>.broadcast();

  @override
  Future<PushState> state() async => const PushState(supported: true, permission: PushPermission.granted, token: 'tok-aaaaaaaaaaaaaaaaaaaa');

  @override
  Future<PushPermission> requestPermission() async => PushPermission.granted;

  @override
  Future<void> openSystemSettings() async {}

  @override
  Future<void> deleteToken() async {}

  @override
  Stream<String> get tokenRefreshes => refreshes.stream;

  @override
  Stream<String> get taps => const Stream<String>.empty();
}

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('n11-m13-');
  });

  tearDown(() async {
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  });

  group('update notice (#280): compare versions and tell, nothing more', () {
    test('asks for its own component and build, and notices a newer one', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check()));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir));
      await c.check();
      expect(transport.paths.single, '/v1/app-updates/check?component=SHIP&version_code=5');
      expect(c.phase, AppUpdatePhase.available);
      expect(c.notice!.versionName, '1.9');
      expect(c.showNotice, isTrue);
    });

    test('a REQUIRED answer is still only a notice: nothing blocks, nothing is downloaded or installed', () async {
      final _FakePlatform platform = _FakePlatform(dir);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), platform);
      await c.check();
      c.dismiss();
      expect(c.showNotice, isFalse, reason: 'even a REQUIRED answer can be postponed: nothing waits on it');
    });

    test('the same or an older build than the installed one, and a server that says nothing is newer, give no notice and are "up to date"', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_latest()));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir));
      await c.check(force: true);
      expect(c.phase, AppUpdatePhase.upToDate);
      expect(c.showNotice, isFalse);
      transport.answer = (String _) => _json(_check(versionCode: 5));
      await c.check(force: true);
      expect(c.notice, isNull);
      expect(c.phase, AppUpdatePhase.upToDate);
    });

    test('an unanswered or malformed check is never "up to date" and never throws; what is known stays and the next check comes soon', () async {
      DateTime clock = DateTime.utc(2026, 11, 1, 8);
      final _FakeTransport transport = _FakeTransport((String _) => throw const SocketException('down'));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir), now: () => clock);
      await c.check();
      expect(c.lastCheckFailed, isTrue);
      expect(c.phase, isNot(AppUpdatePhase.upToDate));
      expect(c.showNotice, isFalse);
      expect(updateCheckSummary(c), isNot(contains('mới nhất')));
      clock = clock.add(const Duration(minutes: 3));
      transport.answer = (String _) => _json(_check());
      await c.check();
      expect(c.showNotice, isTrue, reason: 'the failure retry interval is two minutes, not half an hour');
      // A later failure keeps the notice.
      transport.answer = (String _) => _json(<String, Object?>{'update_available': true, 'release': <String, Object?>{'version_name': 1}});
      clock = clock.add(const Duration(minutes: 40));
      await c.check();
      expect(c.lastCheckFailed, isTrue);
      expect(c.notice!.versionName, '1.9');
      transport.answer = (String _) => ApiResponse(status: 503, headers: const <String, String>{}, body: '');
      clock = clock.add(const Duration(minutes: 3));
      await c.check();
      expect(c.lastCheckFailed, isTrue);
      expect(c.notice, isNotNull);
    });

    test('the check does not depend on a sign-in or on orders: it only ever uses the public check endpoint', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check()));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir));
      await c.check();
      expect(transport.paths, <String>['/v1/app-updates/check?component=SHIP&version_code=5']);
    });

    test('a build without a build number is never told to update', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check()));
      final AppUpdateController c = AppUpdateController(
        component: 'FOOD', installedVersionCode: 0, installedVersionName: '0.0.0', transport: transport, platform: _FakePlatform(dir), enabled: false,
      );
      await c.check();
      expect(transport.paths, isEmpty);
      expect(c.notice, isNull);
    });

    test('checks are spaced; "Để sau" holds for that build and a still newer build is announced again', () async {
      DateTime clock = DateTime.utc(2026, 11, 1, 8);
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check()));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir), now: () => clock);
      await c.check();
      await c.check();
      expect(transport.paths, hasLength(1), reason: 'inside the interval');
      c.dismiss();
      expect(c.showNotice, isFalse);
      clock = clock.add(const Duration(minutes: 31));
      await c.check();
      expect(transport.paths, hasLength(2));
      expect(c.showNotice, isFalse, reason: 'postponed for this build');
      transport.answer = (String _) => _json(_check(versionCode: 10, versionName: '2.0'));
      clock = clock.add(const Duration(minutes: 31));
      await c.check();
      expect(c.showNotice, isTrue);
    });
  });

  group('update popup (#280)', () {
    Widget app(AppUpdateController c) => MaterialApp(builder: (BuildContext context, Widget? child) => AppUpdateGate(controller: c, child: child!), home: const Scaffold(body: Text('trang chính')));

    testWidgets('an older build gets one light popup with the version and "Để sau"; it blocks nothing for good', (WidgetTester tester) async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check())), _FakePlatform(dir));
      await tester.pumpWidget(app(c));
      await tester.runAsync(c.check);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-popup')), findsOneWidget);
      expect(find.textContaining('1.9'), findsOneWidget);
      expect(find.byKey(const Key('m13-update-open-store')), findsNothing, reason: 'nothing to download or open: no action button');
      expect(find.textContaining('sau khi xong đơn'), findsNothing);
      await tester.tap(find.byKey(const Key('m13-update-later')));
      await tester.pump();
      expect(find.byKey(const Key('m13-update-popup')), findsNothing);
      expect(find.text('trang chính'), findsOneWidget);
    });

    testWidgets('a tap outside closes it as "Để sau"', (WidgetTester tester) async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check())), _FakePlatform(dir));
      await tester.pumpWidget(app(c));
      await tester.runAsync(c.check);
      await tester.pump();
      await tester.tapAt(const Offset(4, 4));
      await tester.pump();
      expect(find.byKey(const Key('m13-update-popup')), findsNothing);
    });

    testWidgets('the newest build, or a check that failed, shows no popup', (WidgetTester tester) async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_latest()));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir));
      await tester.pumpWidget(app(c));
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.byKey(const Key('m13-update-popup')), findsNothing);
      transport.answer = (String _) => throw const SocketException('down');
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.byKey(const Key('m13-update-popup')), findsNothing);
      expect(find.text('trang chính'), findsOneWidget);
    });

    testWidgets('the account row "Kiểm tra cập nhật" re-checks on demand and reports plainly', (WidgetTester tester) async {
      Map<String, Object?> answer = _latest();
      final _FakeTransport transport = _FakeTransport((String _) => _json(answer));
      final AppUpdateController c = _controller(transport, _FakePlatform(dir));
      await tester.pumpWidget(MaterialApp(
        builder: (BuildContext context, Widget? child) => AppUpdateGate(controller: c, child: child!),
        home: Scaffold(body: Builder(builder: (BuildContext context) {
          final AppUpdateController? scoped = AppUpdateScope.maybeOf(context);
          return scoped == null ? const Text('no scope') : ListenableBuilder(listenable: scoped, builder: (BuildContext context, Widget? _) => Text(updateCheckSummary(scoped), key: const Key('summary')));
        })),
      ));
      expect(find.text('Chạm để kiểm tra bản mới.'), findsOneWidget);
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.text('Bạn đang dùng bản mới nhất.'), findsOneWidget);
      answer = _check();
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.text('Có bản mới 1.9'), findsOneWidget);
    });
  });

  group('error queue', () {
    final DateTime start = DateTime.utc(2026, 10, 20, 8);

    ClientLogQueue queue(MemoryLogQueueStore store, DateTime Function() now, {LogQueueLimits limits = const LogQueueLimits()}) => ClientLogQueue(store: store, limits: limits, now: now);

    test('redacts tokens, phone numbers, e-mails, codes and long strings before anything is stored', () async {
      final MemoryLogQueueStore store = MemoryLogQueueStore();
      final ClientLogQueue q = queue(store, () => start);
      await q.add(
        kind: 'ACTION_ERROR',
        code: 'save failed',
        appVersion: '1.0',
        message: 'Bearer abc.def-123 phone 0912345678 mail a@b.vn otp: 123456 token=AbCdEfGhIjKlMnOpQrStUvWxYz012345 url https://x.vn/p?secret=1',
      );
      final String stored = store.content!;
      for (final String secret in <String>['abc.def-123', '0912345678', 'a@b.vn', '123456', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'secret=1']) {
        expect(stored.contains(secret), isFalse, reason: secret);
      }
      expect(q.entries.single.code, 'SAVE_FAILED');
    });

    test('the same error is kept once, within the queue and for a while after it was queued', () async {
      DateTime now = start;
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => now);
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isTrue);
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isFalse);
      await q.flush((List<Map<String, Object?>> _) async => DeliveryOutcome.accepted);
      expect(q.length, 0);
      now = start.add(const Duration(minutes: 1));
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isFalse);
      now = start.add(const Duration(minutes: 30));
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isTrue);
    });

    test('is bounded: the oldest entries go first', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start, limits: const LogQueueLimits(maxEntries: 3));
      for (int i = 0; i < 5; i += 1) {
        await q.add(kind: 'CRASH', code: 'E$i', appVersion: '1.0');
      }
      expect(q.entries.map((ClientLogEntry e) => e.code).toList(), <String>['E2', 'E3', 'E4']);
      expect(q.dropped, 2);
    });

    test('survives a restart through the store and drops damaged or expired entries', () async {
      final MemoryLogQueueStore store = MemoryLogQueueStore();
      DateTime now = start;
      final ClientLogQueue first = queue(store, () => now);
      await first.add(kind: 'CRASH', code: 'A', appVersion: '1.0');
      now = start.add(const Duration(days: 1));
      final ClientLogQueue second = queue(store, () => now);
      await second.load();
      expect(second.length, 1);
      now = start.add(const Duration(days: 8));
      final ClientLogQueue third = queue(store, () => now);
      await third.load();
      expect(third.length, 0);
      store.content = '{not json';
      final ClientLogQueue fourth = queue(store, () => now);
      await fourth.load();
      expect(fourth.length, 0);
    });

    test('delivery is retried with a growing wait and then given up after the limit', () async {
      DateTime now = start;
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => now, limits: const LogQueueLimits(maxAttempts: 3));
      await q.add(kind: 'CRASH', code: 'A', appVersion: '1.0');
      int calls = 0;
      Future<DeliveryOutcome> fail(List<Map<String, Object?>> _) async {
        calls += 1;
        return DeliveryOutcome.retry;
      }

      await q.flush(fail);
      expect(calls, 1);
      await q.flush(fail); // still waiting for its back-off
      expect(calls, 1);
      now = now.add(const Duration(minutes: 2));
      await q.flush(fail);
      now = now.add(const Duration(minutes: 10));
      await q.flush(fail);
      expect(calls, 3);
      expect(q.length, 0);
    });

    test('signed out keeps the entries untouched; a rejected batch is dropped; one batch is at most 50 entries', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start, limits: const LogQueueLimits(maxEntries: 100));
      for (int i = 0; i < 60; i += 1) {
        await q.add(kind: 'CRASH', code: 'E$i', appVersion: '1.0');
      }
      int sent = 0;
      await q.flush((List<Map<String, Object?>> batch) async {
        sent = batch.length;
        return DeliveryOutcome.signedOut;
      });
      expect(sent, 50);
      expect(q.length, 60);
      expect(q.entries.first.attempts, 0);
      await q.flush((List<Map<String, Object?>> batch) async => DeliveryOutcome.rejected);
      expect(q.length, 10);
    });

    test('an unknown kind is refused and the wire form carries only the documented fields', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start);
      expect(await q.add(kind: 'OTHER', code: 'A', appVersion: '1.0'), isFalse);
      await q.add(kind: 'PUSH_ERROR', code: 'A', appVersion: '1.0', message: 'm', deliveryCode: 'D1');
      expect(q.entries.single.toWire().keys.toSet(), <String>{'at', 'kind', 'code', 'app_version', 'message', 'delivery_code'});
    });
  });

  group('error instrumentation (G20-D #264): the five kinds are really reported, redacted and not repeated', () {
    late MemoryLogQueueStore store;
    late ClientLogQueue queue;
    late OpsClient ops;

    setUp(() {
      store = MemoryLogQueueStore();
      queue = ClientLogQueue(store: store);
      // Signed out on purpose: reporting only queues; nothing is delivered in these tests.
      final SessionController signedOut = createSessionController(ClientApp.ship, _config, transport: FakeApiTransport(), bridge: FakeDeviceBridge());
      ops = OpsClient(
        app: ClientApp.ship,
        config: _config,
        session: signedOut,
        updates: _controller(_FakeTransport((String _) => _json(<String, Object?>{})), _FakePlatform(dir)),
        queue: queue,
      );
      OpsClient.attachForTest(ops);
    });

    tearDown(() => OpsClient.attachForTest(null));

    Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

    test('the static gate queues every documented kind, redacts the text and ignores a repeat or an unknown kind; with no client it does nothing', () async {
      OpsClient.report(kind: 'ACTION_ERROR', code: 'post save', message: 'Bearer abc.def-123 for 0912345678 otp: 123456');
      OpsClient.report(kind: 'MAP_ERROR', code: 'PLACE_SEARCH_BAD');
      OpsClient.reportRouteError('ROUTE_DISTANCE_FAILED', message: 'at 22.66667,106.25833');
      OpsClient.report(kind: 'GPS_STALE', code: 'GPS_STALE_NO_SERVER_POSITION');
      OpsClient.report(kind: 'PUSH_ERROR', code: 'PUSH_REGISTER_SERVER');
      OpsClient.report(kind: 'PUSH_ERROR', code: 'PUSH_REGISTER_SERVER');
      OpsClient.report(kind: 'NOT_A_KIND', code: 'X');
      await settle();
      expect(queue.entries.map((ClientLogEntry e) => e.kind).toList(), <String>['ACTION_ERROR', 'MAP_ERROR', 'ROUTE_ERROR', 'GPS_STALE', 'PUSH_ERROR']);
      expect(queue.entries.first.code, 'POST_SAVE');
      final String stored = store.content!;
      for (final String secret in <String>['abc.def-123', '0912345678', '123456']) {
        expect(stored.contains(secret), isFalse, reason: secret);
      }
      OpsClient.attachForTest(null);
      OpsClient.report(kind: 'CRASH', code: 'NOBODY');
      await settle();
      expect(queue.length, 5);
    });

    test('an action code names the endpoint without identifiers or a query', () {
      expect(opsActionCode('post', '/v1/shop/me/deliveries/11111111-1111-4111-8111-111111111111/cancel?x=1'), 'POST_DELIVERIES_CANCEL');
      expect(opsActionCode('PATCH', '/v1/orders/12345/status'), 'PATCH_ORDERS_STATUS');
    });

    test('ACTION_ERROR: a server fault or an unreadable answer on a WRITE is reported; a refusal, a lost answer and a failed read are not', () async {
      final t = await _signedIn();
      const String id = '11111111-1111-4111-8111-111111111111';
      final HttpShopDeliverySource source = HttpShopDeliverySource(session: t.session);
      Future<void> cancel() async {
        try {
          await source.cancel(id, reason: 'x', expectedVersion: 1, key: '33333333-3333-4333-8333-333333333333');
        } on M07Failure {
          // expected
        }
      }

      t.api.routes['POST /v1/shop/me/deliveries/$id/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'DELIVERY_STATE_CONFLICT');
      await cancel();
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await cancel();
      t.api.routes['GET /v1/shop/me/deliveries/$id'] = (String m, String p, Map<String, String> h, String b) async => apiError(500, 'INTERNAL');
      try {
        await source.get(id);
      } on M07Failure {
        // expected
      }
      await settle();
      expect(queue.length, 0, reason: 'none of these is a server fault on a write');

      t.api.routes['POST /v1/shop/me/deliveries/$id/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(500, 'INTERNAL');
      await cancel();
      await settle();
      expect(queue.entries.single.kind, 'ACTION_ERROR');
      expect(queue.entries.single.code, 'POST_DELIVERIES_CANCEL');
      expect(queue.entries.single.message, contains('/shop/me/deliveries/:id/cancel'));
      expect(queue.entries.single.message, isNot(contains(id)));

      t.api.routes['POST /v1/shop/me/deliveries/$id/recall'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'delivery_id': id}});
      try {
        await source.recall(id, key: '44444444-4444-4444-8444-444444444444');
      } on M07Failure {
        // expected
      }
      await settle();
      expect(queue.entries.map((ClientLogEntry e) => e.code), contains('DELIVERY_BAD_RESPONSE'));
    });

    test('MAP_ERROR: a failed place search or a location that cannot be taken is reported; a refused permission and the typed text are not', () async {
      final t = await _signedIn();
      final HttpPlaceSearchApi places = HttpPlaceSearchApi(t.session);
      t.api.routes['GET /v1/customers/me/places?query=Cao+B%E1%BA%B1ng'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_DOWN');
      try {
        await places.search('Cao Bằng');
      } on Object {
        // expected
      }
      await settle();
      final int afterSearch = queue.length;
      expect(afterSearch, 1);
      expect(queue.entries.single.kind, 'MAP_ERROR');
      expect(store.content ?? '', isNot(contains('Cao B')));

      TestWidgetsFlutterBinding.ensureInitialized();
      const MethodChannel channel = MethodChannel('vn.eleven.n11/location-test');
      final MethodChannelLocationProvider provider = MethodChannelLocationProvider(channel: channel);
      String code = 'TIMEOUT';
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (MethodCall call) async => throw PlatformException(code: code));
      addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      await settle();
      expect(queue.entries.any((ClientLogEntry e) => e.kind == 'MAP_ERROR' && e.code == 'LOCATION_TIMEOUT'), isTrue);
      final int before = queue.length;
      code = 'DENIED';
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      code = 'DISABLED';
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      await settle();
      expect(queue.length, before, reason: 'permission and GPS switch are the person\'s choices');
    });

    test('ROUTE_ERROR: a road-distance request that fails is reported once per failure; the card still says "unavailable", never a number', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..routeOffline = true;
      final RouteDistanceController routes = RouteDistanceController(api: api);
      final LocationFix here = LocationFix(latitude: 10.0123, longitude: 106.0456, accuracyMeters: 10, takenAt: DateTime.utc(2026, 10, 25));
      const ShopCardData shop = ShopCardData(shopId: 's1', name: 'Quán', address: 'x', reason: 'ONLINE', latitude: 10.02, longitude: 106.05);
      await routes.want(<ShopCardData>[shop], here);
      await settle();
      expect(routes.of(shop, here).kind, RouteDistanceKind.unavailable);
      expect(queue.entries.single.kind, 'ROUTE_ERROR');
      expect(queue.entries.single.code, 'ROUTE_DISTANCE_FAILED');
      expect(store.content!.contains('10.0123'), isFalse, reason: 'the position is never reported');
    });

    test('PUSH_ERROR: a token that the server did not accept is reported (not an offline phone), without the token', () async {
      final SessionController session = (await _signedIn()).session;
      final _PushFailSource source = _PushFailSource(session);
      final _PushPort port = _PushPort();
      final PushSync sync = PushSync(session: session, source: source, port: port);
      await settle();
      expect(source.tries, 1);
      expect(queue.entries.single.kind, 'PUSH_ERROR');
      expect(queue.entries.single.code, 'PUSH_REGISTER_SERVER');
      expect(store.content!.contains('tok-aaaaaaaaaaaaaaaaaaaa'), isFalse);
      source.kind = NotificationFailureKind.offline;
      port.refreshes.add('tok-bbbbbbbbbbbbbbbbbbbb');
      await settle();
      expect(source.tries, 2);
      expect(queue.length, 1, reason: 'being offline is not a push fault');
      sync.dispose();
    });
  });
}
