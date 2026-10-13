import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  testWidgets('signed in: Hồ sơ xế reads the server, submits once, shows PENDING and keeps order receiving locked', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDriverServer server = FakeDriverServer(api);
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
    final AppFlows flows = createFlows(ClientApp.ship, session, config, transport: api);
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await tester.pumpWidget(N11App(brand: shipBrand, tabs: buildShipTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.byKey(const Key('driver-entry')));
    await tester.pumpAndSettle();
    expect(api.to('GET', '/v1/driver/me'), hasLength(1));
    await tester.enterText(find.byKey(const Key('driver-name')), 'Trần Văn Xế');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('driver-submit')));
    await tester.tap(find.byKey(const Key('driver-submit')));
    await tester.pumpAndSettle();
    expect(server.posts.single['full_name'], 'Trần Văn Xế');
    expect(find.byKey(const Key('driver-status-chip')), findsOneWidget);
    expect(find.text('Chờ duyệt'), findsWidgets);
    expect(find.byKey(const Key('driver-submit')), findsNothing);
    expect(api.to('POST', '/v1/client-auth/context'), isEmpty);
  });
}
