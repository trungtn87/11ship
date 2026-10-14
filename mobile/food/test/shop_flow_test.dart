import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  testWidgets('signed in: Quản lý cửa hàng opens the server-backed shop flow; a draft saves without GPS; the denied location says so', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopServer server = FakeShopServer(api);
    installResetRoutes(api);
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
    final AppFlows flows = createFlows(ClientApp.food, session, config, transport: api, location: gps);
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.byKey(const Key('shop-entry')));
    await tester.pumpAndSettle();
    expect(api.to('GET', '/v1/onboarding/shop/profile'), hasLength(1));
    expect(api.to('PUT', '/v1/onboarding/shop/profile'), isEmpty);
    await tester.tap(find.byKey(const Key('shop-register')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('shop-name')), 'Quán Cô Ba');
    await tester.enterText(find.byKey(const Key('shop-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('shop-address')), '12 Đường Làng');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('shop-save')));
    await tester.tap(find.byKey(const Key('shop-save')));
    await tester.pumpAndSettle();
    expect(server.puts.single['name'], 'Quán Cô Ba');
    expect(server.puts.single.containsKey('pickup_lat'), isFalse);
    await tester.ensureVisible(find.byKey(const Key('shop-locate')));
    await tester.tap(find.byKey(const Key('shop-locate')));
    await tester.pumpAndSettle();
    expect(gps.calls, 1);
    expect(find.byKey(const Key('location-error')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('shop-complete'))).onPressed, isNull);
  });

  testWidgets('guest: the login screen reaches the reset form, which stays closed unless the server says SMS_OTP', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installResetRoutes(api, mode: 'UNAVAILABLE');
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    final AppFlows flows = createFlows(ClientApp.food, session, config, transport: api, location: FakeLocationProvider());
    await session.start();
    await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('open-login')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('to-reset')));
    await tester.tap(find.byKey(const Key('to-reset')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('reset-closed')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('reset-submit'))).onPressed, isNull);
    expect(api.to('POST', '/v1/account-recovery/reset'), isEmpty);
    expect(api.to('POST', '/v1/account-recovery/otp'), isEmpty);
  });
}
