import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// #430: the Home map sat under a tab shell whose body slot moved between tabs (a tab with an app bar and a tab without one put the body at different
// indexes of one Column). Each switch to or from Home tore down the whole IndexedStack, so the Home map view was built again and its camera reset. These
// tests pin the tab bodies: switching tabs many times builds each tab body once and keeps the same State object.

const AppConfig config = AppConfig(
    apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

const RawHealthResponse liveOk =
    RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}');

Future<RawHealthResponse> healthOk(Uri uri, Duration timeout) async => liveOk;

class _TabProbe extends StatefulWidget {
  const _TabProbe({super.key});

  static int created = 0;

  @override
  State<_TabProbe> createState() => _TabProbeState();
}

class _TabProbeState extends State<_TabProbe> {
  @override
  void initState() {
    super.initState();
    _TabProbe.created += 1;
  }

  @override
  Widget build(BuildContext context) => const Text('probe');
}

List<TabSpec> _tabs() => <TabSpec>[
      TabSpec(
        id: 'home',
        label: 'Trang chủ',
        icon: Icons.home_outlined,
        title: 'Trang chủ',
        fullBleed: true,
        showAppBar: false,
        ownsConnectionBanner: true,
        body: (BuildContext context, ShellActions actions) =>
            const _TabProbe(key: ValueKey<String>('home-probe')),
      ),
      TabSpec(
        id: 'orders',
        label: 'Đơn hàng',
        icon: Icons.receipt_long_outlined,
        title: 'Đơn hàng',
        body: (BuildContext context, ShellActions actions) =>
            const _TabProbe(key: ValueKey<String>('orders-probe')),
      ),
      TabSpec(
        id: 'notifications',
        label: 'Thông báo',
        icon: Icons.notifications_outlined,
        title: 'Thông báo',
        fullBleed: true,
        body: (BuildContext context, ShellActions actions) =>
            const _TabProbe(key: ValueKey<String>('notifications-probe')),
      ),
    ];

Future<void> _tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(
      of: find.byType(N11BottomNav), matching: find.text(label)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets(
      '#430: switching between tabs keeps each tab body (Home included) built once, with the same State object',
      (WidgetTester tester) async {
    _TabProbe.created = 0;
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: N11Shell(
        brand: shipBrand,
        config: config,
        tabs: _tabs(),
        transport: healthOk,
        pollInterval: const Duration(hours: 1),
      ),
    ));
    await tester.pump();
    final int createdAtStart = _TabProbe.created;
    final _TabProbeState home = tester.state<_TabProbeState>(
        find.byKey(const ValueKey<String>('home-probe')));

    for (int round = 0; round < 3; round++) {
      await _tapTab(tester, 'Đơn hàng');
      await _tapTab(tester, 'Trang chủ');
      await _tapTab(tester, 'Thông báo');
      await _tapTab(tester, 'Trang chủ');
    }

    expect(_TabProbe.created, createdAtStart,
        reason: 'a tab switch must not build any tab body again');
    expect(
        identical(
            tester.state<_TabProbeState>(
                find.byKey(const ValueKey<String>('home-probe'))),
            home),
        isTrue,
        reason:
            'the Home State (and the map platform view under it) must survive leaving and returning to Home');
  });
}
