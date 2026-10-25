import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #190, section 6: the distance on a shop card is the ROAD distance from the customer's current position to the shop's pickup point.

final LocationFix here = LocationFix(latitude: 10.0123, longitude: 106.0456, accuracyMeters: 10, takenAt: DateTime.utc(2026, 10, 25));

ShopCardData card(String id, {double? lat = 10.02, double? lng = 106.05}) => ShopCardData(shopId: id, name: 'Quán $id', address: 'x', reason: 'ONLINE', latitude: lat, longitude: lng);

FakeShopEntry entry(String id, {double? lat = 10.02, double? lng = 106.05}) =>
    FakeShopEntry(id, 'Quán $id', latitude: lat, longitude: lng, dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Bún riêu', 40000, 'c1')]);

void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

void main() {
  group('RouteDistanceController', () {
    test('a card is a pure lookup: loading before the answer, the road length after it; nothing is requested by looking', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..roads = <String, int?>{'s1': 3400};
      final RouteDistanceController routes = RouteDistanceController(api: api);
      expect(routes.of(card('s1'), here).kind, RouteDistanceKind.loading);
      expect(routes.of(card('s1'), null).kind, RouteDistanceKind.noPosition);
      expect(api.routeRequests, isEmpty);
      await routes.want(<ShopCardData>[card('s1')], here);
      final RouteDistance known = routes.of(card('s1'), here);
      expect(known.kind, RouteDistanceKind.route);
      expect(known.meters, 3400);
      // The fixture's straight line is about 1 km: the number shown is the road, never Haversine.
      expect(card('s1').straightLineKm(here), lessThan(1.5));
      expect(distanceLine(card('s1'), known, here), '≈ 3,4 km · đường đi');
      expect(api.routeRequests.single.shopIds, <String>['s1']);
      expect((latitude: api.routeRequests.single.latitude, longitude: api.routeRequests.single.longitude), (latitude: here.latitude, longitude: here.longitude));
    });

    test('no road, a missing answer, a shop without a point, and a failure are all "unavailable" - never a number, never a retry storm', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..roads = <String, int?>{'a': null};
      DateTime now = DateTime.utc(2026, 10, 25, 1);
      final RouteDistanceController routes = RouteDistanceController(api: api, clock: () => now);
      await routes.want(<ShopCardData>[card('a'), card('b'), card('c', lat: null, lng: null)], here);
      for (final String id in <String>['a', 'b']) {
        expect(routes.of(card(id), here).kind, RouteDistanceKind.unavailable);
      }
      expect(routes.of(card('c', lat: null, lng: null), here).kind, RouteDistanceKind.unavailable);
      expect(api.routeRequests.single.shopIds, <String>['a', 'b']); // the shop without a point was never asked
      expect(distanceLine(card('a'), RouteDistance.unavailable, here), startsWith('Chưa xác định quãng đường'));
      expect(distanceLine(card('a'), RouteDistance.unavailable, here), contains('đường chim bay'));
      // Asking again inside the back-off window makes no request; after it, one.
      await routes.want(<ShopCardData>[card('a'), card('b')], here);
      expect(api.routeRequests, hasLength(1));
      now = now.add(const Duration(minutes: 2));
      api.roads = <String, int?>{'a': 1200, 'b': 2200};
      await routes.want(<ShopCardData>[card('a'), card('b')], here);
      expect(api.routeRequests, hasLength(2));
      expect(routes.of(card('a'), here).meters, 1200);
      // A routing outage is the same: unavailable, and the list around it is untouched.
      final FakeDiscoveryApi down = FakeDiscoveryApi()..routeOffline = true;
      final RouteDistanceController offline = RouteDistanceController(api: down);
      await offline.want(<ShopCardData>[card('z')], here);
      expect(offline.of(card('z'), here).kind, RouteDistanceKind.unavailable);
    });

    test('one request at a time, at most 20 shops each and 60 in all; what is known or already asked is not asked again', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi();
      int running = 0;
      int peak = 0;
      api.routeGate = () async {
        running++;
        peak = running > peak ? running : peak;
        await Future<void>.delayed(const Duration(milliseconds: 1));
        running--;
      };
      final RouteDistanceController routes = RouteDistanceController(api: api);
      final List<ShopCardData> shops = <ShopCardData>[for (int i = 0; i < 100; i++) card('s$i')];
      final Future<void> first = routes.want(shops, here);
      final Future<void> again = routes.want(shops, here); // while the first is on its way: nothing new to ask
      await Future.wait<void>(<Future<void>>[first, again]);
      expect(api.routeRequests.map((r) => r.shopIds.length).toList(), <int>[20, 20, 20]);
      expect(api.routeRequests.expand((r) => r.shopIds).toSet(), hasLength(60));
      expect(peak, 1);
      await routes.want(shops, here);
      expect(api.routeRequests, hasLength(3));
    });

    test('a new position (about 110 m or more) or another pickup point makes the old answer unusable; a late answer for the old one is dropped', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..roads = <String, int?>{'s1': 3400};
      final RouteDistanceController routes = RouteDistanceController(api: api);
      await routes.want(<ShopCardData>[card('s1')], here);
      expect(routes.of(card('s1'), here).meters, 3400);
      // GPS jitter inside ~110 m: same answer, no request.
      final LocationFix jitter = LocationFix(latitude: 10.0124, longitude: 106.0457, accuracyMeters: 10, takenAt: DateTime.utc(2026, 10, 25));
      expect(routes.of(card('s1'), jitter).meters, 3400);
      await routes.want(<ShopCardData>[card('s1')], jitter);
      expect(api.routeRequests, hasLength(1));
      // A real move: the old number is not shown for the new place.
      final LocationFix moved = LocationFix(latitude: 10.0323, longitude: 106.0456, accuracyMeters: 10, takenAt: DateTime.utc(2026, 10, 25));
      expect(routes.of(card('s1'), moved).kind, RouteDistanceKind.loading);
      // The shop moved its pickup point: same story.
      expect(routes.of(card('s1', lat: 10.03), here).kind, RouteDistanceKind.loading);
      // An answer that is still on its way when the area changes (reset) is dropped.
      final Completer<void> hold = Completer<void>();
      api.routeGate = () => hold.future;
      api.roads = <String, int?>{'s2': 999};
      final Future<void> pending = routes.want(<ShopCardData>[card('s2')], here);
      await Future<void>.delayed(Duration.zero);
      routes.reset();
      hold.complete();
      await pending;
      expect(routes.of(card('s2'), here).kind, RouteDistanceKind.loading);
      expect(routes.of(card('s1'), here).kind, RouteDistanceKind.loading); // reset forgets everything
    });

    test('entries expire after the TTL', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..roads = <String, int?>{'s1': 3400};
      DateTime now = DateTime.utc(2026, 10, 25, 1);
      final RouteDistanceController routes = RouteDistanceController(api: api, clock: () => now);
      await routes.want(<ShopCardData>[card('s1')], here);
      now = now.add(const Duration(minutes: 11));
      expect(routes.of(card('s1'), here).kind, RouteDistanceKind.loading);
      await routes.want(<ShopCardData>[card('s1')], here);
      expect(api.routeRequests, hasLength(2));
    });
  });

  group('Home and Search', () {
    Future<DiscoveryController> pumpHome(WidgetTester tester, FakeDiscoveryApi api, {FakeLocationProvider? gps}) async {
      final DiscoveryController c = DiscoveryController(api: api, position: DiscoveryPosition(provider: gps ?? FakeLocationProvider()));
      addTearDown(c.dispose);
      api.areaResolver = (double lat, double lng) async => const AreaChoice(id: 'a1', name: 'Cao Bằng');
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(null)))));
      await tester.pumpAndSettle();
      return c;
    }

    testWidgets('Home draws the road distance, the same shop shows the same number in Search from the SAME request, and no straight line is passed off as a route', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[entry('s1')])..roads = <String, int?>{'s1': 3400};
      final DiscoveryController c = await pumpHome(tester, api);
      expect(find.text('Quán s1'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('shop-distance-s1'))).data, '≈ 3,4 km · đường đi');
      expect(find.textContaining('chim bay'), findsNothing);
      expect(api.routeRequests, hasLength(1));
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: SearchScreen(api: api, publicApi: FakePublicShopApi(null), areaId: 'a1', position: c.position, discovery: c, debounce: Duration.zero)));
      await tester.enterText(find.byKey(const Key('search-field')), 'Quán');
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('shop-distance-s1'))).data, '≈ 3,4 km · đường đi');
      expect(api.routeRequests, hasLength(1)); // Search reuses Home's answer
    });

    testWidgets('the list is not held back by the routes: cards appear at once with "Đang tính quãng đường…", then the numbers', (WidgetTester tester) async {
      phone(tester);
      final Completer<void> hold = Completer<void>();
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[entry('s1'), entry('s2')])
        ..roads = <String, int?>{'s1': 3400, 's2': 800}
        ..routeGate = () => hold.future;
      await pumpHome(tester, api);
      expect(find.text('Quán s1'), findsOneWidget);
      expect(find.text('Quán s2'), findsOneWidget);
      expect(find.text('Đang tính quãng đường…'), findsNWidgets(2));
      hold.complete();
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('shop-distance-s2'))).data, '≈ 0,8 km · đường đi');
      expect(tester.widget<Text>(find.byKey(const Key('shop-distance-s1'))).data, '≈ 3,4 km · đường đi');
    });

    testWidgets('GPS off or refused: "Chưa xác định quãng đường", no request, the list works', (WidgetTester tester) async {
      phone(tester);
      final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[entry('s1')])..roads = <String, int?>{'s1': 3400};
      await pumpHome(tester, api, gps: gps);
      expect(find.text('Quán s1'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('shop-distance-s1'))).data, 'Chưa xác định quãng đường');
      expect(api.routeRequests, isEmpty);
    });

    testWidgets('routing down: the card says it does not know the road and shows the straight line only labelled "đường chim bay"; nothing crashes', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[entry('s1')])..routeOffline = true;
      await pumpHome(tester, api);
      final String text = tester.widget<Text>(find.byKey(const Key('shop-distance-s1'))).data!;
      expect(text, startsWith('Chưa xác định quãng đường'));
      expect(text, contains('đường chim bay'));
      expect(text, isNot(contains('đường đi')));
      expect(tester.takeException(), isNull);
    });
  });

  group('HttpDiscoveryApi.routeDistances', () {
    final Uri base = Uri.parse('https://api.example.test');

    test('posts the position and the shop ids, keeps only a clean ROUTE length, and refuses a malformed answer', () async {
      final FakeApiTransport transport = FakeApiTransport();
      final HttpDiscoveryApi api = HttpDiscoveryApi(transport: transport, base: base);
      transport.routes['POST /v1/discovery/route-distances'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
            'data': <String, Object?>{
              'routing_available': true,
              'distances': <Object?>[
                <String, Object?>{'shop_id': 'a', 'status': 'ROUTE', 'distance_m': 3400},
                <String, Object?>{'shop_id': 'b', 'status': 'UNAVAILABLE', 'distance_m': null},
                <String, Object?>{'shop_id': 'c', 'status': 'ROUTE', 'distance_m': -5},
                <String, Object?>{'shop_id': 'd', 'status': 'ROUTE', 'distance_m': 12.5},
              ],
            },
          });
      expect(await api.routeDistances(22.6, 106.2, <String>['a', 'b', 'c', 'd']), <String, int?>{'a': 3400, 'b': null, 'c': null, 'd': null});
      final RecordedRequest sent = transport.requests.single;
      expect(sent.body, contains('"origin":{"lat":22.6,"lng":106.2}'));
      expect(sent.body, contains('"shop_ids":["a","b","c","d"]'));
      transport.routes['POST /v1/discovery/route-distances'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'distances': 'x'}});
      await expectLater(api.routeDistances(22.6, 106.2, <String>['a']), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.kind, 'kind', AuthFailureKind.badResponse)));
      transport.routes['POST /v1/discovery/route-distances'] = (String m, String p, Map<String, String> h, String b) async => apiError(400, 'BAD_REQUEST');
      await expectLater(api.routeDistances(22.6, 106.2, <String>['a']), throwsA(isA<AuthFailure>()));
    });
  });
}
