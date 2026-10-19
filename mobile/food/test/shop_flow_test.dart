import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  testWidgets('one Complete action saves the chosen address and activates the shop; GPS is inside the picker', (WidgetTester tester) async {
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
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('shop-entry')));
    await tester.tap(find.byKey(const Key('shop-entry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('shop-register')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('shop-save')), findsNothing);
    await tester.enterText(find.byKey(const Key('shop-name')), 'Quán Cô Ba');
    await tester.enterText(find.byKey(const Key('shop-phone')), '0901234567');
    await tester.ensureVisible(find.byKey(const Key('shop-address')));
    await tester.tap(find.byKey(const Key('shop-address')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), '12 Đường Làng');
    final TextField field = tester.widget<TextField>(find.byKey(const Key('location-address-text')));
    expect(field.decoration!.filled, isTrue);
    expect(field.decoration!.fillColor, Colors.white);
    expect(gps.calls, 0);
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('location-picker-error')), findsOneWidget);
    gps.failure = null;
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(api.to('PUT', '/v1/onboarding/shop/profile'), isEmpty);
    await tester.ensureVisible(find.byKey(const Key('shop-complete')));
    await tester.tap(find.byKey(const Key('shop-complete')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pumpAndSettle();
    expect(server.puts, hasLength(1));
    expect(server.puts.single['pickup_lat'], 10.0123);
    expect(server.completed, 1);
    expect(find.byKey(const Key('shop-home-name')), findsOneWidget);
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
