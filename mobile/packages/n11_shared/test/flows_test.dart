import 'dart:convert';

import 'package:flutter/material.dart';
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

    test('Complete saves and activates in one action and blocks overlapping taps', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop..name = 'Ốc 11'..contactPhone = '0901234567'..addressText = '035 Tổ Gia Cung';
      await shop.capturePosition();
      final Future<bool> first = shop.finishProfile();
      expect(await shop.finishProfile(), isFalse);
      expect(await first, isTrue);
      expect(server.puts, hasLength(1));
      expect(server.completed, 1);
      expect(shop.profile?.status, 'ACTIVE');
      expect(shop.busy, isFalse);
    });

    test('failed read-back retains the point and same save intent; Complete never activates an unconfirmed profile', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop..name = 'Ốc 11'..contactPhone = '0901234567'..addressText = '035 Tổ Gia Cung';
      await shop.capturePosition();
      final FakeHandler original = t.api.routes['GET /v1/onboarding/shop/profile']!;
      t.api.routes['GET /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async => const ApiResponse(status: 200, headers: <String, String>{}, body: 'invalid response');
      expect(await shop.finishProfile(), isFalse);
      expect(shop.hasPendingWrite, isTrue);
      expect(shop.fix, isNotNull);
      expect(shop.failure?.diagnostic, contains('/v1/onboarding/shop/profile'));
      expect(server.completed, 0);
      final RecordedRequest first = t.api.to('PUT', '/v1/onboarding/shop/profile').single;
      // A real server replays the same key. This fake checks the replay intent, then returns its committed result.
      t.api.routes['GET /v1/onboarding/shop/profile'] = original;
      t.api.routes['PUT /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async {
        expect(h['idempotency-key'], first.headers['idempotency-key']);
        expect(b, first.body);
        return json(201, <String, Object?>{'data': <String, Object?>{'shop_id': server.profile!['shop_id'], 'version': 1}});
      };
      expect(await shop.finishProfile(), isTrue);
      expect(server.completed, 1);
    });

    test('malformed optional profile values do not throw or lose the pending save', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop..name = 'Ốc 11'..contactPhone = '0901234567'..addressText = '035 Tổ Gia Cung';
      await shop.capturePosition();
      t.api.routes['GET /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async =>
          json(200, <String, Object?>{'data': <String, Object?>{...server.profile!, 'facebook': 123}});
      expect(await shop.finishProfile(), isFalse);
      expect(shop.failure?.kind, AuthFailureKind.badResponse);
      expect(shop.busy, isFalse);
      expect(shop.hasPendingWrite, isTrue);
      expect(shop.fix, isNotNull);
      expect(server.completed, 0);
    });

    test('HTTP 500 retains the save key for an explicit retry and does not complete', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop..name = 'Ốc 11'..contactPhone = '0901234567'..addressText = '035 Tổ Gia Cung';
      await shop.capturePosition();
      t.api.routes['PUT /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async => apiError(500, 'INTERNAL_ERROR');
      expect(await shop.finishProfile(), isFalse);
      expect(shop.hasPendingWrite, isTrue);
      expect(shop.fix, isNotNull);
      expect(shop.failure?.status, 500);
      expect(server.completed, 0);
      expect(await shop.finishProfile(), isFalse);
      final List<RecordedRequest> puts = t.api.to('PUT', '/v1/onboarding/shop/profile');
      expect(puts[1].headers['idempotency-key'], puts[0].headers['idempotency-key']);
      expect(puts[1].body, puts[0].body);
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
        ..fullName = ' Trần Văn Shipper '
        ..plateNumber = '';
      expect(await driver.submit(), isTrue);
      expect(server.posts.single, <String, Object?>{'full_name': 'Trần Văn Shipper'});
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
      final DriverController driver = DriverController(session: t.session)..fullName = 'Trần Văn Shipper';
      await driver.load();
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await driver.submit(), isFalse);
      expect(await driver.retryPending(), isTrue);
      final List<RecordedRequest> posts = t.api.to('POST', '/v1/onboarding/driver');
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, posts[1].body);
    });
  });

  // The SMS_OTP flow is the only reset the app has: a verified code first, then the password with the one-use proof.
  Future<ResetController> verifiedReset(FakeApiTransport server, SessionController session) async {
    final ResetController reset = ResetController(transport: server, session: session);
    await reset.loadConfig();
    expect(await reset.requestOtp('0901234567'), isTrue);
    expect(await reset.verifyOtp('123456'), isTrue);
    return reset;
  }

  group('forgotten password (reset)', () {
    test('only opens on SMS_OTP with a verified code; public request; retry same key/body; never logs in', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = ResetController(transport: open, session: t.session);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse, reason: 'config not read yet');
      await reset.loadConfig();
      expect(reset.mode, ResetMode.smsOtp);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse, reason: 'no verified code: no reset');
      expect(open.to('POST', '/v1/account-recovery/reset'), isEmpty);
      expect(await reset.requestOtp('0901234567'), isTrue);
      expect(await reset.verifyOtp('123456'), isTrue);

      open.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await reset.submit(phone: ' 0901234567 ', password: 'New-Pass-123'), isFalse);
      expect(await reset.retryPending(), isTrue);
      final List<RecordedRequest> posts = open.to('POST', '/v1/account-recovery/reset');
      expect(posts.length, 2);
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, jsonEncode(<String, Object?>{'verification_token': 'RESET-PROOF-TOKEN-0123456789', 'password': 'New-Pass-123'}));
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
      expect(closed.to('POST', '/v1/account-recovery/reset'), isEmpty);
    });

    test('a session the server revoked is cleared by the ordinary 401 path', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = await verifiedReset(open, t.session);
      t.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isTrue);
      expect(t.session.status, SessionStatus.guest);
      expect(t.bridge.token, isNull);
    });
  });
  group('review fixes F2-F4', () {
    test('F3: a gateway 504 / 502 keeps the key and body of the write; retry replays the same intent; a plain 503 or 4xx drops it', () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop
        ..name = 'Quán Cô Ba'
        ..contactPhone = '0901234567'
        ..addressText = '12 Đường Làng';
      final FakeHandler committed = t.api.routes['PUT /v1/onboarding/shop/profile']!;
      // The server commits the first request, the gateway loses the answer; the retry with the SAME key gets the stored answer back
      // (what the idempotency record does) and never runs a second mutation.
      final Map<String, ApiResponse> stored = <String, ApiResponse>{};
      t.api.routes['PUT /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async {
        final String key = h['idempotency-key']!;
        final ApiResponse? replay = stored[key];
        if (replay != null) {
          return replay;
        }
        stored[key] = await committed(m, p, h, b);
        return apiError(504, 'SERVICE_UNAVAILABLE');
      };
      expect(await shop.saveDraft(), isFalse);
      expect(shop.failure!.outcomeUnknown, isTrue);
      expect(shop.hasPendingWrite, isTrue);
      expect(await shop.retryPending(), isTrue);
      final List<RecordedRequest> puts = t.api.to('PUT', '/v1/onboarding/shop/profile');
      expect(puts.length, 2);
      expect(puts[0].headers['idempotency-key'], puts[1].headers['idempotency-key']);
      expect(puts[0].body, puts[1].body);
      expect(server.puts.length, 1, reason: 'one mutation reached the server logic');

      expect(const AuthFailure(AuthFailureKind.serverUnavailable, code: 'SERVICE_UNAVAILABLE', status: 502).outcomeUnknown, isTrue);
      expect(const AuthFailure(AuthFailureKind.serverUnavailable, code: 'SERVICE_UNAVAILABLE', status: 503).outcomeUnknown, isFalse);
      expect(const AuthFailure(AuthFailureKind.badRequest, status: 400).outcomeUnknown, isFalse);
    });

    test('F3: reset and context also keep the intent after a gateway 504', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = await verifiedReset(open, t.session);
      final FakeHandler ok = open.routes['POST /v1/account-recovery/reset']!;
      int calls = 0;
      open.routes['POST /v1/account-recovery/reset'] = (String m, String p, Map<String, String> h, String b) async => ++calls == 1 ? apiError(504, 'SERVICE_UNAVAILABLE') : ok(m, p, h, b);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(reset.hasPendingWrite, isTrue);
      expect(await reset.retryPending(), isTrue);
      final List<RecordedRequest> posts = open.to('POST', '/v1/account-recovery/reset');
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);

      final FakeShopServer server = FakeShopServer(t.api)..owner = true;
      final FakeHandler context = t.api.routes['POST /v1/client-auth/context']!;
      int contextCalls = 0;
      t.api.routes['POST /v1/client-auth/context'] = (String m, String p, Map<String, String> h, String b) async => ++contextCalls == 1 ? apiError(504, 'SERVICE_UNAVAILABLE') : context(m, p, h, b);
      await expectLater(t.session.selectContext('SHOP_OWNER'), throwsA(isA<AuthFailure>()));
      await t.session.selectContext('SHOP_OWNER');
      final List<RecordedRequest> contexts = t.api.to('POST', '/v1/client-auth/context');
      expect(contexts[0].headers['idempotency-key'], contexts[1].headers['idempotency-key']);
      expect(server.contexts.length, 1, reason: 'the lost first request never reached the server logic; the retry carried the same key');
    });

    test('F2: leaving the reset form drops the unconfirmed write (and its password); opening again starts clean', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = await verifiedReset(open, t.session);
      open.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(reset.hasPendingWrite, isTrue);
      expect(reset.pendingMatches(phone: '0901234567', password: 'New-Pass-123'), isTrue);
      expect(reset.pendingMatches(phone: '0901234567', password: 'Other-Pass-123'), isFalse, reason: 'an edited form is another intent');

      reset.abandon();
      reset.begin();
      expect(reset.hasPendingWrite, isFalse);
      expect(reset.failure, isNull);
      expect(await reset.retryPending(), isFalse);
      expect(open.to('POST', '/v1/account-recovery/reset').length, 1, reason: 'the old intent was not sent again');
    });

    test('F2: after a success, opening the form again shows the form, not the old success', () async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = await verifiedReset(open, t.session);
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isTrue);
      expect(reset.done, isTrue);
      reset.abandon();
      reset.begin();
      expect(reset.done, isFalse);
    });

    testWidgets('F2: ResetScreen opened again after a success shows the empty form', (WidgetTester tester) async {
      final t = await signedIn(ClientApp.food);
      final FakeApiTransport open = FakeApiTransport();
      installResetRoutes(open);
      final ResetController reset = ResetController(transport: open, session: t.session);
      Widget screen() => MaterialApp(home: ResetScreen(controller: reset, brand: foodBrand));
      await tester.pumpWidget(screen());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('reset-phone')), '0901234567');
      await tester.pump();
      await tester.tap(find.byKey(const Key('reset-otp-request')));
      await tester.pump();
      await tester.pump();
      await tester.enterText(find.byKey(const Key('reset-otp-code')), '123456');
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('reset-otp-verify')));
      await tester.tap(find.byKey(const Key('reset-otp-verify')));
      await tester.pump();
      await tester.pump();
      await tester.enterText(find.byKey(const Key('reset-password')), 'New-Pass-123');
      await tester.enterText(find.byKey(const Key('reset-confirm')), 'New-Pass-123');
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('reset-submit')));
      await tester.tap(find.byKey(const Key('reset-submit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('reset-done')), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(screen());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('reset-done')), findsNothing);
      expect(find.byKey(const Key('reset-otp-request')), findsOneWidget, reason: 'an empty form: no code asked, no password yet');
      expect(find.byKey(const Key('reset-submit')), findsNothing);
    });

    testWidgets('F4: after a version conflict and read-back the form shows v2 and a save keeps the untouched v2 fields', (WidgetTester tester) async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(session: t.session, location: FakeLocationProvider());
      await shop.load();
      shop
        ..name = 'Quán v1'
        ..contactPhone = '0901234567'
        ..addressText = '1 Phố Cũ';
      expect(await shop.saveDraft(), isTrue);

      await tester.pumpWidget(MaterialApp(home: ShopFormScreen(controller: shop)));
      await tester.pump();
      // The web edits the shop: v2 on the server, the phone still holds v1.
      server.profile = <String, Object?>{...server.profile!, 'name': 'Quán v2 (web)', 'address_text': '2 Phố Mới', 'version': 2};
      // A save from the stale form meets the conflict; the controller reads v2 back.
      await tester.enterText(find.byKey(const Key('shop-zalo')), 'zalo.moi');
      await tester.pump();
      await tester.runAsync(() => shop.saveDraft());
      await tester.pump();
      expect(shop.profile!.version, 2);
      expect(find.widgetWithText(TextField, 'Quán v2 (web)'), findsOneWidget);
      expect(tester.widget<AddressLocationField>(find.byKey(const Key('shop-address'))).text, '2 Phố Mới');

      // Edit one field only, then save: name and address stay v2.
      await tester.enterText(find.byKey(const Key('shop-zalo')), 'zalo.sau');
      await tester.pump();
      await tester.runAsync(() => shop.saveDraft());
      await tester.pump();
      expect(server.puts.last['name'], 'Quán v2 (web)');
      expect(server.puts.last['address_text'], '2 Phố Mới');
      expect(server.puts.last['expected_version'], 2);
      expect(server.profile!['name'], 'Quán v2 (web)');
    });
  });
}
