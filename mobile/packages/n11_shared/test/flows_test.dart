import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Future<({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge})> signedIn(ClientApp app) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final FakeDeviceBridge bridge = FakeDeviceBridge();
  final SessionController session = createSessionController(app, config, transport: api, bridge: bridge);
  await session.start();
  expect(await session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
  return (session: session, api: api, bridge: bridge);
}

void main() {
  group('Food shop (F20-F23)', () {
    test('draft without GPS, reload, denied location blocks completion, real fix + area completes; CUSTOMER kept, context only on action', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final ShopController shop = ShopController(session: t.session, location: gps);

      await shop.load();
      expect(shop.profile, isNull);
      expect(shop.areas.single.name, 'Khu trung tâm');
      expect(t.api.to('PUT', '/v1/onboarding/shop/profile'), isEmpty, reason: 'a profile is never created by opening the screen');

      shop
        ..name = 'Quán Cô Ba'
        ..contactPhone = '0901234567'
        ..addressText = '12 Đường Làng';
      expect(await shop.saveDraft(), isTrue);
      expect(shop.profile!.status, 'INCOMPLETE');
      expect(shop.profile!.hasLocation, isFalse);
      expect(server.puts.single.containsKey('pickup_lat'), isFalse);
      expect(shop.complete(), completion(isFalse), reason: 'no stored point/area: completion is not even attempted');

      await shop.capturePosition();
      expect(shop.locationFailure, LocationFailure.denied);
      expect(shop.fix, isNull);
      expect(server.completed, 0);

      gps.failure = null;
      await shop.capturePosition();
      expect(shop.fix, isNotNull);
      shop.serviceAreaId = shop.areas.single.id;
      expect(await shop.saveDraft(), isTrue);
      expect(server.puts.last['pickup_lat'], 10.0123);
      expect(server.puts.last['expected_version'], 1);
      expect(shop.profile!.readyToComplete, isTrue);

      expect(await shop.complete(), isTrue);
      expect(shop.profile!.status, 'ACTIVE');
      expect(shop.profile!.acceptingOrders, isFalse);
      expect(t.session.identity!.activeRole, 'CUSTOMER');
      expect(server.contexts, isEmpty);
      expect(t.api.to('POST', '/v1/onboarding/shop/complete').single.body, jsonEncode(<String, Object?>{'expected_version': 2}));

      expect(await shop.switchContext('SHOP_OWNER'), isTrue);
      expect(server.contexts, <String>['SHOP_OWNER']);
      expect(t.session.identity!.activeRole, 'SHOP_OWNER');
      expect(t.session.identity!.availableRoles, containsAll(<String>['CUSTOMER', 'SHOP_OWNER']));
    });

    test('a lost answer is retried with the same key and body; version conflict reloads and overwrites nothing', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop
        ..name = 'Quán A'
        ..contactPhone = '0901234567'
        ..addressText = 'Địa chỉ';
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await shop.saveDraft(), isFalse);
      expect(shop.hasPendingWrite, isTrue);
      expect(await shop.retryPending(), isTrue);
      final List<RecordedRequest> puts = t.api.to('PUT', '/v1/onboarding/shop/profile');
      expect(puts.length, 2);
      expect(puts[0].headers['idempotency-key'], puts[1].headers['idempotency-key']);
      expect(puts[0].body, puts[1].body);

      server.profile = <String, Object?>{...server.profile!, 'name': 'Đổi ở máy khác', 'version': 5};
      shop.name = 'Quán B';
      expect(await shop.saveDraft(), isFalse);
      expect(shop.failure!.kind, AuthFailureKind.versionConflict);
      expect(shop.profile!.name, 'Đổi ở máy khác');
    });

    test('a lost context answer is retried with the same key and body; a refusal (ROLE_NOT_AVAILABLE) changes nothing', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      expect(await shop.switchContext('SHOP_OWNER'), isFalse);
      expect(shop.failure!.kind, AuthFailureKind.roleNotAvailable);
      expect(t.session.identity!.activeRole, 'CUSTOMER');
      server.owner = true;
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await shop.switchContext('SHOP_OWNER'), isFalse);
      expect(await shop.switchContext('SHOP_OWNER'), isTrue);
      final List<RecordedRequest> posts = t.api.to('POST', '/v1/client-auth/context');
      expect(posts.length, 3);
      expect(posts[1].headers['idempotency-key'], posts[2].headers['idempotency-key']);
      expect(posts[0].headers['idempotency-key'], isNot(posts[1].headers['idempotency-key']));
      expect(t.session.identity!.activeRole, 'SHOP_OWNER');
    });

    test('logout clears the shop caches', () async {
      final t = await signedIn(ClientApp.food);
      FakeShopServer(t.api).profile = <String, Object?>{
        'shop_id': '44444444-4444-4444-8444-444444444444', 'name': 'Q', 'contact_phone': '0901234567', 'address_text': 'x', 'status': 'INCOMPLETE', 'accepting_orders': false, 'version': 1,
      };
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      expect(shop.profile, isNotNull);
      await t.session.logout();
      expect(shop.profile, isNull);
      expect(shop.name, '');
    });
  });

  group('Ship driver (S12-S13)', () {
    test('reads first, submits once, reads back; no context change; no duplicate submit', () async {
      final t = await signedIn(ClientApp.ship);
      final FakeDriverServer server = FakeDriverServer(t.api);
      final DriverController driver = DriverController(session: t.session);
      await driver.load();
      expect(driver.profile, isNull);
      driver
        ..fullName = ' Trần Văn Xế '
        ..plateNumber = '';
      expect(await driver.submit(), isTrue);
      expect(server.posts.single, <String, Object?>{'full_name': 'Trần Văn Xế'});
      expect(driver.profile!.status, 'PENDING');
      expect(t.api.to('GET', '/v1/client-auth/me'), hasLength(1), reason: 'me is read again after the write');
      expect(t.session.identity!.activeRole, 'CUSTOMER');
      expect(await driver.submit(), isFalse);
      expect(server.posts.length, 1);
      expect(t.api.to('POST', '/v1/client-auth/context'), isEmpty);
    });

    test('a lost answer retries the same key and body', () async {
      final t = await signedIn(ClientApp.ship);
      FakeDriverServer(t.api);
      final DriverController driver = DriverController(session: t.session)..fullName = 'Trần Văn Xế';
      await driver.load();
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await driver.submit(), isFalse);
      expect(await driver.retryPending(), isTrue);
      final List<RecordedRequest> posts = t.api.to('POST', '/v1/onboarding/driver');
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, posts[1].body);
    });
  });

  group('forgotten password (reset)', () {
    test('only opens on DISABLED_TEST; public request; generic ack; retry same key/body; never logs in', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = ResetController(transport: open, session: t.session);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse, reason: 'config not read yet');
      await reset.loadConfig();
      expect(reset.mode, ResetMode.available);

      open.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await reset.submit(phone: ' 0901234567 ', password: 'New-Pass-123'), isFalse);
      expect(await reset.retryPending(), isTrue);
      final List<RecordedRequest> posts = open.to('POST', '/v1/account-recovery/reset-test');
      expect(posts.length, 2);
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, jsonEncode(<String, Object?>{'phone': '0901234567', 'password': 'New-Pass-123'}));
      expect(posts[1].headers.keys.map((String k) => k.toLowerCase()).toSet(), <String>{'idempotency-key'});
      expect(reset.done, isTrue);
    });

    test('UNAVAILABLE keeps the form closed', () async {
      final t = await signedIn(ClientApp.ship);
      final FakeApiTransport closed = FakeApiTransport();
      installResetRoutes(closed, mode: 'UNAVAILABLE');
      final ResetController reset = ResetController(transport: closed, session: t.session);
      await reset.loadConfig();
      expect(reset.mode, ResetMode.closed);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(closed.to('POST', '/v1/account-recovery/reset-test'), isEmpty);
    });

    test('a session the server revoked is cleared by the ordinary 401 path', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = ResetController(transport: open, session: t.session);
      await reset.loadConfig();
      t.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isTrue);
      expect(t.session.status, SessionStatus.guest);
      expect(t.bridge.token, isNull);
    });
  });
}
