import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// F04 guest: the small "Quản lý cửa hàng" link at the end of the Account screen opens the existing sign-in. No guest route, no API.

const String sha = '0123456789abcdef0123456789abcdef01234567';

const AppConfig config = AppConfig(
  apiBaseUrl: 'https://103.9.78.67.sslip.io',
  appId: 'vn.eleven.food.test',
  versionName: '0.1.0',
  buildNumber: '3',
  sourceSha: sha,
  signing: SigningMode.stable,
  deviceEnvironment: 'fixture-env',
);

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(
      status: 200,
      body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}',
    );

Future<void> pumpGuest(WidgetTester tester) async {
  tester.view.physicalSize = const Size(360 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport server = FakeApiTransport();
  installAccountRoutes(server);
  final SessionController session = createSessionController(ClientApp.food, config, transport: server, bridge: FakeDeviceBridge());
  await session.start();
  await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(session), config: config, transport: healthy(), pollInterval: Duration.zero));
  await tester.pump();
  await tester.pump();
  await tester.tap(find.byKey(const Key('tab-account')));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('F04 guest: Account screen centers logo and auth buttons with no bottom tool rows', (WidgetTester tester) async {
    await pumpGuest(tester);
    expect(find.byKey(const Key('guest-shop-link')), findsNothing);
    expect(find.text('Quản lý cửa hàng'), findsNothing);
    expect(find.text('Trợ giúp'), findsNothing);
    expect(find.byKey(const Key('m13-update-check')), findsNothing);
    expect(find.text('Thèm là có'), findsOneWidget);
    expect(find.text('Đặt món từ quán gần bạn.'), findsOneWidget);
    expect(find.byKey(const Key('open-register')), findsOneWidget);
    expect(find.byKey(const Key('open-login')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
