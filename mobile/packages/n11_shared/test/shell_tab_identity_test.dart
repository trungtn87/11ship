import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// #430: the Home tab shows a map whose native view is laid out at the height of the tab area. The app bar and the connection banner of OTHER tabs were
// siblings of the shared body, so opening those tabs shrank the body that Home was laid out in (measured 532 -> 288 -> 532), and the Home map was resized
// twice per round trip. These tests pin that the body height and the Home State stay the same over tab switches.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

const RawHealthResponse liveOk = RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}');

Future<RawHealthResponse> healthOk(Uri uri, Duration timeout) async => liveOk;

class _TabProbe extends StatefulWidget {
  const _TabProbe({super.key, this.onHeight});

  static int created = 0;

  final void Function(double height)? onHeight;

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
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          widget.onHeight?.call(constraints.maxHeight);
          return const SizedBox.expand();
        },
      );
}

List<TabSpec> _tabs({void Function(double height)? onHomeHeight}) => <TabSpec>[
      TabSpec(
        id: 'home',
        label: 'Trang chủ',
        icon: Icons.home_outlined,
        title: 'Trang chủ',
        fullBleed: true,
        showAppBar: false,
        ownsConnectionBanner: true,
        body: (BuildContext context, ShellActions actions) => _TabProbe(key: const ValueKey<String>('home-probe'), onHeight: onHomeHeight),
      ),
      TabSpec(
        id: 'orders',
        label: 'Đơn hàng',
        icon: Icons.receipt_long_outlined,
        title: 'Đơn hàng',
        // Full-bleed so the probe (a SizedBox.expand) gets a bounded height; the app bar is shown either way.
        fullBleed: true,
        body: (BuildContext context, ShellActions actions) => const _TabProbe(key: ValueKey<String>('orders-probe')),
      ),
      TabSpec(
        id: 'notifications',
        label: 'Thông báo',
        icon: Icons.notifications_outlined,
        title: 'Thông báo',
        fullBleed: true,
        body: (BuildContext context, ShellActions actions) => const _TabProbe(key: ValueKey<String>('notifications-probe')),
      ),
    ];

Future<void> _pumpShell(WidgetTester tester, {void Function(double height)? onHomeHeight}) => tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: N11Shell(
        brand: shipBrand,
        config: config,
        tabs: _tabs(onHomeHeight: onHomeHeight),
        transport: healthOk,
        pollInterval: const Duration(hours: 1),
      ),
    ));

Future<void> _tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets('#430: the Home body height is the same after leaving Home for a tab with an app bar and a banner, and coming back', (WidgetTester tester) async {
    final List<double> heights = <double>[];
    await _pumpShell(tester, onHomeHeight: heights.add);
    await tester.pump();
    final double start = heights.last;

    await _tapTab(tester, 'Thông báo');
    await _tapTab(tester, 'Trang chủ');

    expect(heights.last, start, reason: 'the Home body must keep its height over a tab round trip (it was 532 -> 288 -> 532 before the fix)');
    expect(heights.every((double h) => h == start), isTrue, reason: 'every Home layout pass uses the same height');
  });

  testWidgets('#430: 20 tab switches keep every tab body built once, the Home State and the Home body height', (WidgetTester tester) async {
    _TabProbe.created = 0;
    final List<double> heights = <double>[];
    await _pumpShell(tester, onHomeHeight: heights.add);
    await tester.pump();
    final int createdAtStart = _TabProbe.created;
    final double start = heights.last;
    final _TabProbeState home = tester.state<_TabProbeState>(find.byKey(const ValueKey<String>('home-probe')));

    const List<String> route = <String>['Đơn hàng', 'Trang chủ', 'Thông báo', 'Trang chủ'];
    for (int i = 0; i < 20; i++) {
      await _tapTab(tester, route[i % route.length]);
    }

    expect(_TabProbe.created, createdAtStart, reason: 'a tab switch must not build any tab body again');
    expect(identical(tester.state<_TabProbeState>(find.byKey(const ValueKey<String>('home-probe'))), home), isTrue,
        reason: 'the Home State (and the map under it) must survive 20 switches');
    expect(heights.every((double h) => h == start), isTrue, reason: 'the Home body height must not change over 20 switches');
  });

  // From #436 (kept as merged on main): the same tab switches, checked for the builds and the Home State only.
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
