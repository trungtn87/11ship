import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #411: Home "Quán gần bạn" is one horizontal row of at most 5 shop cards plus "Xem tất cả"; "Xem tất cả" opens the full list
// (two columns, scrolling down, no 5-card limit). "Quán nổi bật" stays hidden until its criterion exists.

// Coordinates are needed: a shop without them has no road distance at all (RouteDistanceController.of).
FakeShopEntry _shop(int i) => FakeShopEntry(
      's${i.toString().padLeft(2, '0')}',
      'Quán ${i.toString().padLeft(2, '0')}',
      dishes: <FakeDishEntry>[FakeDishEntry('d$i', 'Món $i', 50000, 'c1')],
      latitude: 10.0 + i * 0.001,
      longitude: 106.0,
    );

List<FakeShopEntry> _shops(int n) => <FakeShopEntry>[for (int i = 1; i <= n; i++) _shop(i)];

void _phone(WidgetTester tester, {double width = 390, double height = 800}) {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<DiscoveryController> _pumpHome(
  WidgetTester tester,
  FakeDiscoveryApi api, {
  FakeLocationProvider? gps,
}) async {
  final DiscoveryController c = DiscoveryController(
    api: api,
    position: DiscoveryPosition(provider: gps ?? FakeLocationProvider()),
  );
  addTearDown(c.dispose);
  api.areaResolver = (double lat, double lng) async => const AreaChoice(id: 'a1', name: 'Cao Bằng');
  await tester.pumpWidget(
    MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(
        body: DiscoveryHome(
          controller: c,
          publicApi: FakePublicShopApi(null),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return c;
}

Finder _homeTiles() => find.descendant(of: find.byKey(const Key('home-nearby-carousel')), matching: find.byType(HomeShopTile));

/// The Scrollable of the full list (its ListView key is not a Scrollable itself).
Finder _allScrollable() => find.descendant(of: find.byKey(const Key('nearby-all-list')), matching: find.byType(Scrollable)).first;

/// A tile inside the full list (Home's tiles stay in the tree under it, so tile keys repeat across the two screens).
Finder _allTile(String id) => find.descendant(of: find.byKey(const Key('nearby-all-list')), matching: find.byKey(Key('shop-$id')));

double _homeScrollPixels(WidgetTester tester) {
  // The first Scrollable under the Home list is the list itself (the carousel's own scroll view comes after it).
  final Finder scrollable = find.descendant(of: find.byKey(const Key('home-list')), matching: find.byType(Scrollable)).first;
  return tester.state<ScrollableState>(scrollable).position.pixels;
}

ShopMenuView _menu(String name) => ShopMenuView(
      name: name,
      address: '12 Phố Kim Đồng',
      availabilityReason: 'ONLINE',
      serverNow: DateTime.utc(2026, 10, 14, 11, 30),
      hours: emptyWeek(),
      categories: const <PublicCategory>[
        PublicCategory(name: 'Ốc', items: <PublicItem>[PublicItem(id: 'd6', name: 'Món 6', priceVnd: 50000, imageUrl: null)]),
      ],
    );

void main() {
  group('Home carousel limit (issue #411)', () {
    for (final int n in <int>[0, 1, 4, 5, 6]) {
      testWidgets('$n shop(s): at most 5 cards on Home, the real count, and "Xem tất cả" only when there is a list', (WidgetTester tester) async {
        _phone(tester);
        await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(n)));
        expect(tester.takeException(), isNull);
        if (n == 0) {
          expect(find.byKey(const Key('home-no-shops')), findsOneWidget);
          expect(find.byKey(const Key('home-nearby-carousel')), findsNothing);
          expect(find.byKey(const Key('home-nearby-see-all')), findsNothing);
          expect(_homeTiles(), findsNothing);
          return;
        }
        expect(find.byKey(const Key('home-nearby-carousel')), findsOneWidget);
        expect(_homeTiles(), findsNWidgets(n < 5 ? n : 5));
        // Never a fake card: only real shops of the list are tiles.
        for (int i = 1; i <= (n < 5 ? n : 5); i++) {
          expect(find.byKey(Key('shop-s${i.toString().padLeft(2, '0')}')), findsOneWidget);
        }
        expect(find.byKey(const Key('home-nearby-see-all')), findsOneWidget);
      });
    }

    testWidgets('6 shops: the 6th shop is not on Home, but "Xem tất cả" still lists it; no grid below the row', (WidgetTester tester) async {
      _phone(tester);
      final DiscoveryController c = await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(6)));
      expect(c.shops, hasLength(6));
      expect(find.byKey(const Key('shop-s06')), findsNothing);
      expect(_homeTiles(), findsNWidgets(5));
      // The row is one horizontal strip: every visible tile has the same top edge.
      final double top = tester.getTopLeft(find.byKey(const Key('shop-s01'))).dy;
      for (int i = 2; i <= 5; i++) {
        expect(tester.getTopLeft(find.byKey(Key('shop-s0$i'))).dy, top);
      }
      expect(find.byKey(const Key('nearby-all-screen')), findsNothing);
    });

    testWidgets('a narrow 320px phone: the row scrolls sideways, the next card peeks, and nothing overflows', (WidgetTester tester) async {
      _phone(tester, width: 320, height: 640);
      await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(6)));
      expect(tester.takeException(), isNull);
      final Finder carousel = find.byKey(const Key('home-nearby-carousel'));
      expect(carousel, findsOneWidget);
      // The first card is inside the screen and the second runs past the right edge (a visible peek of more content).
      final double screenRight = tester.getTopRight(find.byType(Scaffold).first).dx;
      expect(tester.getTopRight(find.byKey(const Key('shop-s01'))).dx, lessThan(screenRight));
      expect(tester.getTopRight(find.byKey(const Key('shop-s02'))).dx, greaterThan(screenRight));
      // "Xem tất cả" sits after the 5 cards, off to the right until the row is scrolled.
      expect(find.byKey(const Key('home-nearby-see-all')), findsOneWidget);
      await tester.dragUntilVisible(find.byKey(const Key('home-nearby-see-all')), carousel, const Offset(-120, 0));
      expect(tester.takeException(), isNull);
    });
  });

  group('Xem tất cả opens the full list of that section (issue #411)', () {
    testWidgets('tapping "Xem tất cả" opens the two-column, vertical list with every loaded shop and no 5-card limit', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(7));
      final DiscoveryController c = await _pumpHome(tester, api);
      await tester.ensureVisible(find.byKey(const Key('home-nearby-see-all')));
      await tester.tap(find.byKey(const Key('home-nearby-see-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nearby-all-screen')), findsOneWidget);
      expect(find.text('Quán gần bạn'), findsWidgets);
      // Row 1: shops 01 and 02 side by side; the sixth shop is listed too (it is not on Home).
      expect(tester.getTopLeft(_allTile('s01')).dy, tester.getTopLeft(_allTile('s02')).dy);
      expect(tester.getTopLeft(_allTile('s01')).dx, lessThan(tester.getTopLeft(_allTile('s02')).dx));
      expect(tester.getTopLeft(_allTile('s03')).dy, greaterThan(tester.getTopLeft(_allTile('s01')).dy));
      await tester.scrollUntilVisible(_allTile('s06'), 200, scrollable: _allScrollable());
      expect(_allTile('s06'), findsOneWidget);
      expect(c.shops, hasLength(7));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long list loads the next page when the end is reached, without repeating a shop', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(35));
      final DiscoveryController c = await _pumpHome(tester, api);
      expect(c.shops, hasLength(30));
      expect(c.hasMore, isTrue);
      await tester.ensureVisible(find.byKey(const Key('home-nearby-see-all')));
      await tester.tap(find.byKey(const Key('home-nearby-see-all')));
      await tester.pumpAndSettle();
      // Scroll to the end of the lazy list: the next page loads by itself.
      await tester.drag(find.byKey(const Key('nearby-all-list')), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(c.shops, hasLength(35));
      expect(c.shops.map((s) => s.shopId).toSet(), hasLength(35));
      expect(c.hasMore, isFalse);
      expect(tester.takeException(), isNull);
    });

    testWidgets('"Quay lại" returns to Home with the same carousel and the same scroll position', (WidgetTester tester) async {
      _phone(tester, height: 480);
      await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(6)));
      // Scroll Home down a little so the carousel is near the bottom of a short screen.
      await tester.drag(find.byKey(const Key('home-list')), const Offset(0, -120));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('home-nearby-see-all')));
      await tester.pumpAndSettle();
      final double before = _homeScrollPixels(tester);
      expect(before, greaterThan(0));
      await tester.tap(find.byKey(const Key('home-nearby-see-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nearby-all-screen')), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nearby-all-screen')), findsNothing);
      expect(_homeScrollPixels(tester), before);
      expect(_homeTiles(), findsNWidgets(5));
    });

    testWidgets('a tile on the full list opens that shop', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(6));
      final DiscoveryController c = DiscoveryController(api: api, position: DiscoveryPosition(provider: FakeLocationProvider()));
      addTearDown(c.dispose);
      api.areaResolver = (double lat, double lng) async => const AreaChoice(id: 'a1', name: 'Cao Bằng');
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(_menu('Quán 06'))))));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('home-nearby-see-all')));
      await tester.tap(find.byKey(const Key('home-nearby-see-all')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(_allTile('s06'), 200, scrollable: _allScrollable());
      await tester.tap(_allTile('s06'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('shop-view-name')), findsOneWidget);
    });
  });

  group('Quán gần bạn order and honesty (issue #411 / #190)', () {
    testWidgets('known road distances put the nearest first; unknown distances keep the server order after them', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(3))..roads = <String, int?>{'s01': 5000, 's02': 1000};
      await _pumpHome(tester, api);
      final double x2 = tester.getTopLeft(find.byKey(const Key('shop-s02'))).dx;
      final double x1 = tester.getTopLeft(find.byKey(const Key('shop-s01'))).dx;
      final double x3 = tester.getTopLeft(find.byKey(const Key('shop-s03'))).dx;
      expect(x2, lessThan(x1), reason: 's02 is 1 km away, s01 is 5 km');
      expect(x1, lessThan(x3), reason: 's03 has no road: after the known ones');
      expect(find.textContaining('chim bay'), findsNothing);
    });

    testWidgets('GPS off: no kilometres are invented and the honest line says to turn location on', (WidgetTester tester) async {
      _phone(tester);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(2))..roads = <String, int?>{'s01': 1000};
      await _pumpHome(tester, api, gps: gps);
      expect(find.byKey(const Key('home-nearby-note')), findsOneWidget);
      expect(find.textContaining('km'), findsNothing);
      expect(api.routeRequests, isEmpty);
    });

    testWidgets('"Quán nổi bật" is not shown while its criterion is off', (WidgetTester tester) async {
      _phone(tester);
      await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(3)));
      expect(kHomeFeaturedShopsEnabled, isFalse);
      expect(find.text('Quán nổi bật'), findsNothing);
      expect(find.byKey(const Key('home-featured-section')), findsNothing);
    });
  });

  group('nearbyByRoadDistance (pure)', () {
    ShopCardData card(String id) => ShopCardData(shopId: id, name: id, address: 'a', reason: 'ONLINE');

    test('nearest known road first, unknown and unavailable keep the server order at the end, ties keep the server order', () {
      final Map<String, RouteDistance> d = <String, RouteDistance>{
        'a': const RouteDistance.route(3000),
        'b': RouteDistance.unavailable,
        'c': const RouteDistance.route(1000),
        'd': RouteDistance.loading,
        'e': const RouteDistance.route(3000),
        'f': RouteDistance.noPosition,
      };
      final List<String> out = nearbyByRoadDistance(
        <ShopCardData>[for (final String id in <String>['a', 'b', 'c', 'd', 'e', 'f']) card(id)],
        (ShopCardData s) => d[s.shopId]!,
      ).map((ShopCardData s) => s.shopId).toList();
      expect(out, <String>['c', 'a', 'e', 'b', 'd', 'f']);
    });

    test('no distances at all: the server order is unchanged', () {
      final List<ShopCardData> input = <ShopCardData>[card('x'), card('y'), card('z')];
      final List<ShopCardData> out = nearbyByRoadDistance(input, (ShopCardData _) => RouteDistance.noPosition);
      expect(out.map((ShopCardData s) => s.shopId).toList(), <String>['x', 'y', 'z']);
    });
  });
}
