import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #384 / Figma 11Food F01 (node 2:75, GPS pending): gradient background, one-row header (area left, bell right), no banner under the
// categories, and no overflow at 320 / 360 / 390 px and text scale 1.3.

FakeDiscoveryApi _api() => FakeDiscoveryApi(
      shops: <FakeShopEntry>[
        FakeShopEntry(
          's1',
          'Zeta Ốc Hương',
          reason: 'ONLINE',
          dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương hấp', 120000, 'c1')],
        ),
      ],
    );

Future<void> _pumpHome(WidgetTester tester, {required double width, double textScale = 1}) async {
  tester.view.physicalSize = Size(width * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final DiscoveryController c = DiscoveryController(api: _api());
  addTearDown(c.dispose);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(
    MaterialApp(
      theme: buildN11Theme(),
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(null)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the Home background is the real 180deg gradient with the Figma stops, not a flat colour', (WidgetTester tester) async {
    await _pumpHome(tester, width: 390);
    final Container box = tester.widget<Container>(find.byKey(const Key('home-gradient')));
    final BoxDecoration decoration = box.decoration! as BoxDecoration;
    final LinearGradient gradient = decoration.gradient! as LinearGradient;
    expect(gradient.begin, Alignment.topCenter);
    expect(gradient.end, Alignment.bottomCenter);
    expect(gradient.stops, <double>[0, 0.20, 0.44, 0.66, 1]);
    expect(
      gradient.colors,
      const <Color>[
        Color(0xFFFFF4C4),
        Color(0xFFFFF9DF),
        Color(0xFFFFFCF0),
        Color(0xFFFFFDF7),
        Color(0xFFFFFDF7),
      ],
    );
  });

  for (final double width in <double>[390, 360, 320]) {
    testWidgets('the header is one row at ${width.toInt()}px: area and bell share the same centre line', (WidgetTester tester) async {
      await _pumpHome(tester, width: width);
      final Offset area = tester.getCenter(find.byKey(const Key('home-area')));
      final Offset bell = tester.getCenter(find.byKey(const Key('home-bell')));
      expect((area.dy - bell.dy).abs(), lessThan(4), reason: 'area and bell are on different lines');
      expect(area.dx, lessThan(bell.dx), reason: 'area must be left of the bell');
      expect(tester.getSize(find.byKey(const Key('home-bell'))).height, greaterThanOrEqualTo(48));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('no banner under the categories: the "Khám phá món ngon gần bạn" block is gone and "Quán gần bạn" follows', (WidgetTester tester) async {
    await _pumpHome(tester, width: 390);
    expect(find.text('Khám phá món ngon gần bạn'), findsNothing);
    expect(find.textContaining('Giao nhanh tại'), findsNothing);
    expect(find.byKey(const Key('home-v5-section-title')), findsOneWidget);
    final double categories = tester.getBottomLeft(find.byKey(const Key('home-v5-category-card'))).dy;
    final double title = tester.getTopLeft(find.byKey(const Key('home-v5-section-title'))).dy;
    expect(title - categories, lessThan(40), reason: 'an empty gap is left where the banner was');
  });

  for (final double width in <double>[320, 360, 390]) {
    testWidgets('text scale 1.3 at ${width.toInt()}px: no overflow in the header, search, categories or title', (WidgetTester tester) async {
      await _pumpHome(tester, width: width, textScale: 1.3);
      expect(tester.takeException(), isNull);
    });
  }
}
