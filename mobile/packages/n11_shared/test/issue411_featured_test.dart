import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #411 (Owner 21/11): "Quán nổi bật" = average >= 4.0 AND >= 5 visible reviews, best first, filled with the newest shops up to 5.
// Without GPS, "Quán gần bạn" uses the same order and shows no distance. With GPS it is nearest by road. "Xem tất cả" uses the same order.

FakeShopEntry _s(
  int i, {
  double? avg,
  int count = 0,
  DateTime? created,
  String reason = 'ONLINE',
}) =>
    FakeShopEntry(
      's${i.toString().padLeft(2, '0')}',
      'Quán ${i.toString().padLeft(2, '0')}',
      reason: reason,
      dishes: <FakeDishEntry>[FakeDishEntry('d$i', 'Món $i', 50000, 'c1')],
      latitude: 10.0 + i * 0.001,
      longitude: 106.0,
      ratingAverage: avg,
      ratingCount: count,
      createdAt: created,
    );

ShopCardData _card(String id, {double? avg, int count = 0, DateTime? created, String name = 'Q'}) => ShopCardData(
      shopId: id,
      name: name,
      address: 'a',
      reason: 'ONLINE',
      ratingAverage: avg,
      ratingCount: count,
      createdAt: created,
    );

void _phone(WidgetTester tester, {double width = 390, double height = 800}) {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<DiscoveryController> _pumpHome(WidgetTester tester, FakeDiscoveryApi api, {FakeLocationProvider? gps}) async {
  final DiscoveryController c = DiscoveryController(
    api: api,
    position: DiscoveryPosition(provider: gps ?? FakeLocationProvider()),
  );
  addTearDown(c.dispose);
  api.areaResolver = (double lat, double lng) async => const AreaChoice(id: 'a1', name: 'Cao Bằng');
  await tester.pumpWidget(
    MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(null))),
    ),
  );
  await tester.pumpAndSettle();
  return c;
}

/// Shop ids in the vertical order they are drawn on Home.
List<String> _cardIds(WidgetTester tester) {
  final List<HomeShopFullCard> cards =
      tester.widgetList<HomeShopFullCard>(find.byType(HomeShopFullCard)).toList();
  return <String>[for (final HomeShopFullCard c in cards) c.shop.shopId];
}

void main() {
  group('isFeaturedRated (pure)', () {
    test('4.0 and 5 reviews qualify; below either limit does not; no rating does not', () {
      expect(isFeaturedRated(_card('a', avg: 4.0, count: 5)), isTrue);
      expect(isFeaturedRated(_card('a', avg: 3.99, count: 50)), isFalse);
      expect(isFeaturedRated(_card('a', avg: 4.8, count: 4)), isFalse);
      expect(isFeaturedRated(_card('a', avg: null, count: 9)), isFalse);
    });
  });

  group('featuredOrder (pure)', () {
    test('0 qualified: the newest shops, undated last, and no rating is invented', () {
      final List<ShopCardData> out = featuredOrder(<ShopCardData>[
        _card('old', created: DateTime.utc(2025, 1, 1)),
        _card('none'),
        _card('new', created: DateTime.utc(2026, 3, 1)),
        _card('mid', created: DateTime.utc(2025, 9, 1), avg: 4.9, count: 2),
      ]);
      expect(out.map((s) => s.shopId).toList(), <String>['new', 'mid', 'old', 'none']);
    });

    test('2 qualified then the newest fill: qualified by average, then reviews, then name', () {
      final List<ShopCardData> out = featuredOrder(<ShopCardData>[
        _card('n1', created: DateTime.utc(2026, 1, 1)),
        _card('q1', avg: 4.2, count: 5, name: 'B'),
        _card('q2', avg: 4.8, count: 9, name: 'A'),
        _card('n2', created: DateTime.utc(2026, 2, 1)),
        _card('n3', created: DateTime.utc(2025, 1, 1)),
      ]);
      expect(out.map((s) => s.shopId).toList(), <String>['q2', 'q1', 'n2', 'n1', 'n3']);
    });

    test('ties: equal average, more reviews first; equal both, by name', () {
      final List<ShopCardData> out = featuredOrder(<ShopCardData>[
        _card('b', avg: 4.5, count: 6, name: 'Bình'),
        _card('a', avg: 4.5, count: 10, name: 'An'),
        _card('c', avg: 4.5, count: 6, name: 'Cường'),
      ]);
      expect(out.map((s) => s.shopId).toList(), <String>['a', 'b', 'c']);
    });

    test('each shop appears once even when the input repeats it', () {
      final List<ShopCardData> out = featuredOrder(<ShopCardData>[
        _card('x', created: DateTime.utc(2026, 1, 1)),
        _card('x', created: DateTime.utc(2026, 1, 1)),
        _card('y', avg: 4.1, count: 5),
        _card('y', avg: 4.1, count: 5),
      ]);
      expect(out.map((s) => s.shopId).toList(), <String>['y', 'x']);
    });
  });

  group('Quán nổi bật on Home (issue #411, Owner 21/11)', () {
    testWidgets('0 qualified shops: the Nổi bật tab shows the newest shops first', (WidgetTester tester) async {
      _phone(tester, height: 1400);
      final List<FakeShopEntry> shops = <FakeShopEntry>[for (int i = 1; i <= 7; i++) _s(i, created: DateTime.utc(2026, 1, i))];
      await _pumpHome(tester, FakeDiscoveryApi(shops: shops));
      expect(_cardIds(tester).take(5).toList(), <String>['s07', 's06', 's05', 's04', 's03']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('2 qualified + 3 newest: qualified by score first, then the newest filled in', (WidgetTester tester) async {
      _phone(tester, height: 1400);
      final List<FakeShopEntry> shops = <FakeShopEntry>[
        _s(1, created: DateTime.utc(2026, 1, 1)),
        _s(2, avg: 4.2, count: 5, created: DateTime.utc(2025, 1, 1)),
        _s(3, avg: 4.9, count: 12, created: DateTime.utc(2025, 2, 1)),
        _s(4, created: DateTime.utc(2026, 5, 1)),
        _s(5, created: DateTime.utc(2026, 4, 1)),
        _s(6, created: DateTime.utc(2026, 3, 1)),
      ];
      await _pumpHome(tester, FakeDiscoveryApi(shops: shops));
      expect(_cardIds(tester).take(5).toList(), <String>['s03', 's02', 's04', 's05', 's06']);
    });

    testWidgets('6+ qualified: all qualified shops list in score order', (WidgetTester tester) async {
      _phone(tester, height: 1400);
      final List<FakeShopEntry> shops = <FakeShopEntry>[
        for (int i = 1; i <= 7; i++) _s(i, avg: 4.0 + i / 10, count: 5 + i),
      ];
      await _pumpHome(tester, FakeDiscoveryApi(shops: shops));
      expect(_cardIds(tester), <String>['s07', 's06', 's05', 's04', 's03', 's02', 's01']);
    });

    testWidgets('a shop that is not public never appears in any featured list', (WidgetTester tester) async {
      _phone(tester);
      final List<FakeShopEntry> shops = <FakeShopEntry>[
        _s(1, avg: 4.9, count: 30, reason: 'LOCKED'),
        _s(2, avg: 4.1, count: 5),
        _s(3, created: DateTime.utc(2026, 1, 1)),
      ];
      final DiscoveryController c = await _pumpHome(tester, FakeDiscoveryApi(shops: shops));
      expect(c.shops.map((s) => s.shopId), isNot(contains('s01')));
      expect(_cardIds(tester), <String>['s02', 's03']);
    });

    testWidgets('a narrow 320px phone: full-width cards render cleanly and nothing overflows', (WidgetTester tester) async {
      _phone(tester, width: 320, height: 640);
      await _pumpHome(tester, FakeDiscoveryApi(shops: <FakeShopEntry>[for (int i = 1; i <= 6; i++) _s(i, avg: 4.5, count: 6)]));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('home-sort-tabs')), findsOneWidget);
    });
  });

  group('Quán gần bạn without GPS and its order (issue #411, Owner 21/11)', () {
    testWidgets('GPS off: Gần bạn tab keeps featured order, no km, and shows the honest hint to turn location on', (WidgetTester tester) async {
      _phone(tester);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[
        _s(1, created: DateTime.utc(2026, 1, 1)),
        _s(2, avg: 4.4, count: 8),
        _s(3, created: DateTime.utc(2026, 2, 1)),
      ]);
      await _pumpHome(tester, api, gps: gps);
      await tester.tap(find.byKey(const Key('home-tab-nearby')));
      await tester.pumpAndSettle();
      expect(_cardIds(tester), <String>['s02', 's03', 's01']);
      expect(find.byKey(const Key('home-nearby-note')), findsOneWidget);
      expect(find.textContaining(' km'), findsNothing);
      expect(api.routeRequests, isEmpty);
    });

    testWidgets('GPS on: Gần bạn tab orders nearest by road first (not the featured order)', (WidgetTester tester) async {
      _phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[
        _s(1, avg: 4.9, count: 30),
        _s(2, created: DateTime.utc(2026, 1, 1)),
      ]);
      api.roads = <String, int?>{'s01': 2500, 's02': 400};
      await _pumpHome(tester, api);
      await tester.tap(find.byKey(const Key('home-tab-nearby')));
      await tester.pumpAndSettle();
      expect(_cardIds(tester), <String>['s02', 's01']);
    });

    testWidgets('switching GPS from off to on reorders the Gần bạn list from featured order to road distance', (WidgetTester tester) async {
      _phone(tester);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[
        _s(1, avg: 4.9, count: 30),
        _s(2, created: DateTime.utc(2026, 1, 1)),
      ]);
      api.roads = <String, int?>{'s01': 2500, 's02': 400};
      final DiscoveryController c = await _pumpHome(tester, api, gps: gps);
      await tester.tap(find.byKey(const Key('home-tab-nearby')));
      await tester.pumpAndSettle();
      expect(_cardIds(tester), <String>['s01', 's02']);
      gps.failure = null;
      await tester.runAsync(() => c.position.locate());
      await tester.pumpAndSettle();
      expect(_cardIds(tester), <String>['s02', 's01']);
      expect(find.byKey(const Key('home-nearby-note')), findsNothing);
    });
  });
}
