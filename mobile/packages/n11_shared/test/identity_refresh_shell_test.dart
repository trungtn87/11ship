import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6c: the shell asks the session to read `me` again when the app returns to the foreground and when the Account tab opens.
// The throttle lives in the session (identity_refresh_test.dart); here only the triggers are checked.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Future<RawHealthResponse> healthy(Uri uri, Duration timeout) async => const RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}');

List<TabSpec> tabs() => <TabSpec>[
  TabSpec(id: 'home', label: 'Home', icon: Icons.home, title: 'Home', body: (BuildContext c, ShellActions a) => const Text('home body')),
  TabSpec(id: 'account', label: 'Account', icon: Icons.person, title: 'Account', body: (BuildContext c, ShellActions a) => const Text('account body')),
];

void main() {
  late FakeApiTransport api;
  late SessionController session;
  DateTime clock = DateTime.utc(2026, 11, 9, 8);

  Future<void> boot(WidgetTester tester, {bool wired = true}) async {
    clock = DateTime.utc(2026, 11, 9, 8);
    api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
    session = createSessionController(ClientApp.ship, config, transport: api, bridge: bridge, now: () => clock);
    await session.start();
    await tester.pumpWidget(N11App(brand: shipBrand, tabs: tabs(), config: config, transport: healthy, session: wired ? session : null));
    await tester.pump();
  }

  int meCalls() => api.to('GET', '/v1/client-auth/me').length;

  testWidgets('returning to the foreground reads the identity again, once per throttle window', (WidgetTester tester) async {
    await boot(tester);
    final int base = meCalls();
    clock = clock.add(const Duration(minutes: 5));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(meCalls(), base + 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(meCalls(), base + 1, reason: 'a second resume inside the window costs nothing');
  });

  testWidgets('opening the Account tab reads it; the Home tab does not', (WidgetTester tester) async {
    await boot(tester);
    final int base = meCalls();
    clock = clock.add(const Duration(minutes: 5));
    await tester.tap(find.byIcon(Icons.home));
    await tester.pump();
    expect(meCalls(), base);
    await tester.tap(find.byIcon(Icons.person));
    await tester.pump();
    expect(meCalls(), base + 1);
  });

  testWidgets('a shell without a session never calls', (WidgetTester tester) async {
    await boot(tester, wired: false);
    final int base = meCalls();
    clock = clock.add(const Duration(minutes: 5));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.tap(find.byIcon(Icons.person));
    await tester.pump();
    expect(meCalls(), base);
  });
}
