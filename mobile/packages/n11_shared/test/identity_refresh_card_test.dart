import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6c (review fix): a background refresh that changes only the name shows on the Account card, without a new login.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

void main() {
  testWidgets('name changed on another device: the Account card shows the new name after the refresh', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
    DateTime clock = DateTime.utc(2026, 11, 12, 8);
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: bridge, now: () => clock);
    await session.start();
    expect(session.status, SessionStatus.signedIn);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AccountTab(
          session: session,
          brand: shipBrand,
          actions: ShellActions(goTab: (String id) {}, openDiagnostics: () {}),
          entries: const <Widget>[],
          showDiagnostics: false,
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('Nguyễn Văn An'), findsWidgets);

    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async =>
        json(200, <String, Object?>{'data': identityJson(name: 'Tên đổi từ máy khác', version: 2)});
    clock = clock.add(const Duration(minutes: 5));
    await session.refreshIdentityIfStale();
    await tester.pump();
    expect(find.text('Tên đổi từ máy khác'), findsWidgets);
    expect(find.text('Nguyễn Văn An'), findsNothing);
  });
}
