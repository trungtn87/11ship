import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// PR #400 review (Antigravity FAIL): the Home tile must show a readable road distance, a readable name (2 lines), no cut "chưa có" label,
// and the GPS pill must be exactly 30 high. Each item has a widget test; the layouts are checked at 390 / 360 / 320 px and text scale 1.3.

Future<void> _pumpTiles(WidgetTester tester, {required double width, double textScale = 1, required List<Widget> tiles}) async {
  tester.view.physicalSize = Size(width * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    builder: (BuildContext context, Widget? child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(N11Space.pad),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final Widget t in tiles) ...<Widget>[Expanded(child: t), const SizedBox(width: N11Space.gap3)],
          ],
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

HomeShopTile _tile(ShopCardData shop, {RouteDistance distance = RouteDistance.noPosition, bool locating = false}) =>
    HomeShopTile(key: Key('tile-${shop.shopId}'), shop: shop, distance: distance, locating: locating, onTap: () {});

bool _exceedsLines(WidgetTester tester, Finder f) => tester.renderObject<RenderParagraph>(f).didExceedMaxLines;

void main() {
  // The real app font, so widths are measured with Plus Jakarta Sans and not the test font (Ahem: every glyph one em wide).
  setUpAll(() async {
    final FontLoader fonts = FontLoader('packages/n11_shared/$kFontFamily');
    for (final String weight in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      fonts.addFont(Future<ByteData>.value(ByteData.sublistView(File('assets/fonts/PlusJakartaSans-$weight.ttf').readAsBytesSync())));
    }
    await fonts.load();
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  const ShopCardData rated = ShopCardData(shopId: 'r', name: 'Ốc 11', address: 'x', reason: 'ONLINE', ratingAverage: 4.5, ratingCount: 12);
  const ShopCardData unrated = ShopCardData(shopId: 'u', name: 'Quán mới', address: 'x', reason: 'ONLINE');
  const ShopCardData longName = ShopCardData(shopId: 'l', name: 'B03 Quán Cơm Gà Cao Bằng chi nhánh trung tâm thành phố', address: 'x', reason: 'ONLINE');

  // 1. Distance: a short road distance in one readable line; never cut to "Quãng đườn…".
  for (final (double width, double scale) in <(double, double)>[(390, 1), (360, 1), (360, 1.3), (320, 1), (320, 1.3)]) {
    testWidgets('road distance shows as a short number at ${width.toInt()}px, text ${scale}x, on one line', (WidgetTester tester) async {
      await _pumpTiles(tester, width: width, textScale: scale, tiles: <Widget>[
        _tile(rated, distance: const RouteDistance.route(1300)),
        _tile(unrated, distance: const RouteDistance.route(900)),
      ]);
      expect(find.text('1,3 km'), findsOneWidget);
      expect(find.text('0,9 km'), findsOneWidget);
      expect(_exceedsLines(tester, find.text('1,3 km')), isFalse);
      expect(find.textContaining('Quãng đường'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('no position says a short "Chưa rõ", never a number', (WidgetTester tester) async {
    await _pumpTiles(tester, width: 390, tiles: <Widget>[_tile(rated)]);
    expect(find.text('Chưa rõ'), findsOneWidget);
    expect(find.textContaining(' km'), findsNothing);
    expect(find.byWidgetPredicate((Widget w) => w is Text && RegExp(r'\d\s?m$').hasMatch(w.data ?? '')), findsNothing);
  });

  test('the full road wording stays in the semantics label (accessibility) and the other screens keep distanceLine', () {
    expect(homeDistanceText(const RouteDistance.route(1300)), '1,3 km');
    expect(distanceLine(rated, const RouteDistance.route(1300), null), contains('Quãng đường từ quán đến vị trí hiện tại: ≈ 1,3 km'));
  });

  // 2. "Chưa có đánh giá" is not shown as a cut line: an unrated tile shows no rating line at all.
  for (final double width in <double>[390, 360, 320]) {
    testWidgets('an unrated shop shows no cut "Chưa có đánh giá" line at ${width.toInt()}px, text 1.3x', (WidgetTester tester) async {
      await _pumpTiles(tester, width: width, textScale: 1.3, tiles: <Widget>[_tile(unrated), _tile(rated)]);
      expect(find.textContaining('Chưa có đ'), findsNothing);
      expect(find.byKey(const Key('shop-rating-u')), findsNothing);
      expect(find.text('5.0'), findsNothing);
      // The rated shop keeps its real score on the logo.
      expect(find.text('4.5'), findsOneWidget);
    });
  }

  // 3. Long name: two lines of the name stay readable; the tile does not overflow.
  for (final (double width, double scale) in <(double, double)>[(390, 1), (360, 1.3), (320, 1.3)]) {
    testWidgets('a long shop name uses up to two lines at ${width.toInt()}px, text ${scale}x', (WidgetTester tester) async {
      await _pumpTiles(tester, width: width, textScale: scale, tiles: <Widget>[_tile(longName), _tile(rated)]);
      final Finder name = find.byKey(const Key('shop-name-l'));
      final Text text = tester.widget<Text>(name);
      expect(text.maxLines, 2, reason: 'the name may use two lines, never one');
      final RenderParagraph paragraph = tester.renderObject<RenderParagraph>(name);
      // Two lines at most: the paragraph height stays within two lines of the name's own line height.
      expect(paragraph.size.height, lessThanOrEqualTo(2 * 15 * 1.25 * scale * 1.3 + 2));
      expect(tester.takeException(), isNull);
    });
  }

  // 4. The GPS pill is exactly 30 high (min 78 wide), not the 48 px header height.
  testWidgets('the GPS action pill is 30 px high and at least 78 px wide', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
    final DiscoveryController c = DiscoveryController(
      api: FakeDiscoveryApi(shops: <FakeShopEntry>[FakeShopEntry('s1', 'Zeta', reason: 'ONLINE')]),
      position: DiscoveryPosition(provider: gps),
    );
    addTearDown(c.dispose);
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(null))),
    ));
    await tester.pumpAndSettle();
    final Finder pill = find.byKey(const Key('discovery-locate'));
    expect(pill, findsOneWidget);
    expect(tester.getSize(pill).height, 30);
    expect(tester.getSize(pill).width, greaterThanOrEqualTo(78));
    expect(tester.takeException(), isNull);
  });
}
