import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  testWidgets('signed in: Hồ sơ shipper reads the server, creates the profile once, then bank account and review; order receiving stays blocked by the server', (WidgetTester tester) async {
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
    await tester.enterText(find.byKey(const Key('driver-name')), 'Trần Văn Shipper');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('driver-submit')));
    await tester.tap(find.byKey(const Key('driver-submit')));
    await tester.pumpAndSettle();
    expect(server.posts.single['full_name'], 'Trần Văn Shipper');
    expect(find.byKey(const Key('driver-status-chip')), findsOneWidget);
    expect(find.text('Chưa gửi hồ sơ'), findsWidgets);
    expect(find.byKey(const Key('driver-submit')), findsNothing);
    expect(api.to('POST', '/v1/client-auth/context'), isEmpty);

    // Sending needs a bank account first: the button is unavailable and says why.
    await tester.ensureVisible(find.byKey(const Key('driver-send-review')));
    expect(find.text('Cần khai báo tài khoản ngân hàng trước khi gửi hồ sơ.'), findsOneWidget);

    // Bank account: holder must match the name; the server answers the new profile.
    await tester.ensureVisible(find.byKey(const Key('driver-bank-entry')));
    await tester.tap(find.byKey(const Key('driver-bank-entry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('driver-bank-code')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vietcombank').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('driver-bank-number')), '0123456789');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('driver-bank-save')));
    await tester.tap(find.byKey(const Key('driver-bank-save')));
    await tester.pumpAndSettle();
    expect(server.commands.last.$1, '/v1/driver/me/bank');
    expect(server.commands.last.$2['bank_code'], 'VCB');
    expect(server.commands.last.$2['account_holder'], 'Trần Văn Shipper');
    expect(find.byKey(const Key('driver-bank-state')), findsOneWidget);
    expect(find.text('Chờ xác minh'), findsWidgets);
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();

    // Send for review: the profile shows "Chờ xét duyệt" and cannot be sent again.
    await tester.ensureVisible(find.byKey(const Key('driver-send-review')));
    await tester.tap(find.byKey(const Key('driver-send-review')));
    await tester.pumpAndSettle();
    expect(server.commands.last.$1, '/v1/driver/me/submit');
    expect(find.text('Chờ xét duyệt'), findsWidgets);
    expect(find.byKey(const Key('driver-send-review')), findsNothing);
  });
}
