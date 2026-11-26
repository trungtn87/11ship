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

Finder _homeCards() => find.byType(HomeShopFullCard);

void main() {
  group('Home vertical shop list and tabs (Nổi bật | Gần bạn)', () {
    for (final int n in <int>[0, 1, 4, 5, 6]) {
      testWidgets('$n shop(s): renders real cards vertically with no invented cards', (WidgetTester tester) async {
        _phone(tester, height: 1400);
        await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(n)));
        expect(tester.takeException(), isNull);
        if (n == 0) {
          expect(find.byKey(const Key('home-no-shops')), findsOneWidget);
          expect(find.byKey(const Key('home-sort-tabs')), findsNothing);
          expect(_homeCards(), findsNothing);
          return;
        }
        expect(find.byKey(const Key('home-sort-tabs')), findsOneWidget);
        expect(_homeCards(), findsNWidgets(n));
        for (int i = 1; i <= n; i++) {
          expect(find.byKey(Key('shop-s${i.toString().padLeft(2, '0')}')), findsOneWidget);
        }
      });
    }

    testWidgets('6 shops: vertical list shows shops in order without horizontal carousel wrapper', (WidgetTester tester) async {
      _phone(tester, height: 1400);
      final DiscoveryController c = await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(6)));
      expect(c.shops, hasLength(6));
      expect(_homeCards(), findsNWidgets(6));
      final double y1 = tester.getTopLeft(find.byKey(const Key('shop-s01'))).dy;
      final double y2 = tester.getTopLeft(find.byKey(const Key('shop-s02'))).dy;
      expect(y2, greaterThan(y1));
    });

    testWidgets('a narrow 320px phone: full-width cards fit cleanly without overflow', (WidgetTester tester) async {
      _phone(tester, width: 320, height: 640);
      await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(6)));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('home-sort-tabs')), findsOneWidget);
      expect(find.byKey(const Key('shop-s01')), findsOneWidget);
    });
  });

  group('Xem thêm loads next page on Home', () {
    testWidgets('a long list loads the next page when tapping Xem thêm quán, without repeating a shop', (WidgetTester tester) async {
      _phone(tester);
      // Issue #411: the ranking pool reads pages of 30 until 200 shops are reached, so 230 shops stop at 210 after Home loads.
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(230));
      final DiscoveryController c = await _pumpHome(tester, api);
      expect(c.shops, hasLength(210));
      expect(c.hasMore, isTrue);
      await tester.scrollUntilVisible(
        find.byKey(const Key('home-load-more')),
        2500,
        maxScrolls: 30,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('home-load-more')));
      await tester.pumpAndSettle();
      expect(c.shops, hasLength(230));
      expect(c.shops.map((s) => s.shopId).toSet(), hasLength(230));
      expect(c.hasMore, isFalse);
      expect(tester.takeException(), isNull);
    });
  });

  group('Gần bạn order and honesty (issue #411 / #190)', () {
    testWidgets('known road distances put the nearest first; unknown distances keep the server order after them', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(3))..roads = <String, int?>{'s01': 5000, 's02': 1000};
      await _pumpHome(tester, api);
      await tester.tap(find.byKey(const Key('home-tab-nearby')));
      await tester.pumpAndSettle();
      final double y2 = tester.getTopLeft(find.byKey(const Key('shop-s02'))).dy;
      final double y1 = tester.getTopLeft(find.byKey(const Key('shop-s01'))).dy;
      final double y3 = tester.getTopLeft(find.byKey(const Key('shop-s03'))).dy;
      expect(y2, lessThan(y1), reason: 's02 is 1 km away, s01 is 5 km');
      expect(y1, lessThan(y3), reason: 's03 has no road: after the known ones');
      expect(find.textContaining('chim bay'), findsNothing);
    });

    testWidgets('GPS off on Gần bạn tab: no kilometres are invented and the honest line says to turn location on', (WidgetTester tester) async {
      _phone(tester);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: _shops(2))..roads = <String, int?>{'s01': 1000};
      await _pumpHome(tester, api, gps: gps);
      await tester.tap(find.byKey(const Key('home-tab-nearby')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('home-nearby-note')), findsOneWidget);
      expect(find.textContaining('km'), findsNothing);
      expect(api.routeRequests, isEmpty);
    });

    testWidgets('Sort tabs show "Nổi bật" beside "Gần bạn"', (WidgetTester tester) async {
      _phone(tester);
      await _pumpHome(tester, FakeDiscoveryApi(shops: _shops(3)));
      expect(kHomeFeaturedShopsEnabled, isTrue);
      expect(find.byKey(const Key('home-tab-featured')), findsOneWidget);
      expect(find.byKey(const Key('home-tab-nearby')), findsOneWidget);
      expect(
        tester.getTopLeft(find.byKey(const Key('home-tab-featured'))).dx,
        lessThan(tester.getTopLeft(find.byKey(const Key('home-tab-nearby'))).dx),
      );
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
