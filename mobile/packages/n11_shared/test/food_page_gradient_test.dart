import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'https://api.example.test',
  deviceEnvironment: 'fixture-env',
);

Future<RawHealthResponse> _healthy(Uri uri, Duration timeout) async =>
    const RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}');

List<TabSpec> _tabs() => <TabSpec>[
  TabSpec(
    id: 'home',
    label: 'Trang chủ',
    icon: Icons.home_outlined,
    title: 'Trang chủ',
    showAppBar: false,
    fullBleed: true,
    body: (BuildContext context, ShellActions actions) =>
        const Center(child: Text('home body')),
  ),
  TabSpec(
    id: 'orders',
    label: 'Đơn hàng',
    icon: Icons.receipt_long_outlined,
    title: 'Đơn hàng',
    body: (BuildContext context, ShellActions actions) =>
        const Text('orders body'),
  ),
  TabSpec(
    id: 'account',
    label: 'Tài khoản',
    icon: Icons.person_outline,
    title: 'Tài khoản',
    body: (BuildContext context, ShellActions actions) =>
        const Text('account body'),
  ),
];

BoxDecoration _appBarDecoration(WidgetTester tester, String title) {
  final Finder bar = find.ancestor(
    of: find.text(title),
    matching: find.byType(N11AppBar),
  );
  final Container container = tester.widget<Container>(
    find.descendant(of: bar, matching: find.byType(Container)).first,
  );
  return container.decoration! as BoxDecoration;
}

void main() {
  testWidgets(
    'N11App with foodBrand registers N11V5.homeGradient, paints shell backdrop, and uses transparent N11AppBar on other tabs',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        N11App(
          brand: foodBrand,
          tabs: _tabs(),
          config: _config,
          transport: _healthy,
          pollInterval: Duration.zero,
          keepBottomNavOnChildRoutes: true,
        ),
      );
      await tester.pump();

      final DecoratedBox backdrop = tester.widget<DecoratedBox>(
        find.byKey(const Key('n11-page-gradient')),
      );
      expect((backdrop.decoration as BoxDecoration).gradient, N11V5.homeGradient);

      final BuildContext shellContext = tester.element(find.byType(N11Shell));
      expect(N11PageBackground.maybeOf(shellContext), N11V5.homeGradient);

      await tester.tap(find.byIcon(Icons.receipt_long_outlined));
      await tester.pumpAndSettle();
      expect(_appBarDecoration(tester, 'Đơn hàng').color, Colors.transparent);

      await tester.tap(find.byIcon(Icons.person_outline));
      await tester.pumpAndSettle();
      expect(_appBarDecoration(tester, 'Tài khoản').color, Colors.transparent);
    },
  );

  testWidgets(
    'M02Scaffold, N11FormScaffold, and m07Page render N11V5.homeGradient backdrop with transparent Scaffold when theme provides pageGradient',
    (WidgetTester tester) async {
      final ThemeData theme = buildN11Theme(pageGradient: N11V5.homeGradient);

      for (final ({String name, Widget page}) entry
          in <({String name, Widget page})>[
        (
          name: 'M02Scaffold',
          page: const M02Scaffold(
            title: 'M02',
            content: <Widget>[Text('m02 content')],
          ),
        ),
        (
          name: 'N11FormScaffold(usePageGradient: true)',
          page: const N11FormScaffold(
            title: 'Form',
            session: null,
            usePageGradient: true,
            children: <Widget>[Text('form content')],
          ),
        ),
        (
          name: 'm07Page',
          page: m07Page('M07', false, const <Widget>[Text('m07 content')]),
        ),
      ]) {
        await tester.pumpWidget(MaterialApp(theme: theme, home: entry.page));
        await tester.pump();

        final DecoratedBox backdrop = tester.widget<DecoratedBox>(
          find.byKey(const Key('n11-page-gradient')),
        );
        expect(
          (backdrop.decoration as BoxDecoration).gradient,
          N11V5.homeGradient,
          reason: '${entry.name} must paint homeGradient',
        );
        final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
        expect(
          scaffold.backgroundColor,
          Colors.transparent,
          reason: '${entry.name} Scaffold must be transparent over gradient',
        );
      }
    },
  );

  testWidgets(
    'N11App with shipBrand leaves N11PageBackground unset and keeps opaque white N11AppBar',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        N11App(
          brand: shipBrand,
          tabs: _tabs(),
          config: _config,
          transport: _healthy,
          pollInterval: Duration.zero,
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      final BuildContext shellContext = tester.element(find.byType(N11Shell));
      expect(N11PageBackground.maybeOf(shellContext), isNull);

      await tester.tap(find.byIcon(Icons.receipt_long_outlined));
      await tester.pumpAndSettle();
      expect(_appBarDecoration(tester, 'Đơn hàng').color, N11Colors.white);
    },
  );

  testWidgets(
    'default N11FormScaffold uses warm formBg surface and opaque formBg N11AppBar with formDivider border',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: const N11FormScaffold(
            title: 'Đăng nhập',
            session: null,
            children: <Widget>[Text('form content')],
          ),
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, N11Colors.formBg);
      final BoxDecoration barDec = _appBarDecoration(tester, 'Đăng nhập');
      expect(barDec.color, N11Colors.formBg);
      expect((barDec.border! as Border).bottom.color, N11Colors.formDivider);
    },
  );
}
