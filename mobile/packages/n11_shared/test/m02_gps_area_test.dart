import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

LocationFix fix(double lat) => LocationFix(
    latitude: lat,
    longitude: 106.25,
    accuracyMeters: 10,
    takenAt: DateTime.now());
FakeDiscoveryApi apiOf() => FakeDiscoveryApi(
      areas: const <AreaChoice>[
        AreaChoice(id: 'a1', name: 'Vùng 1'),
        AreaChoice(id: 'a2', name: 'Vùng 2')
      ],
      shops: <FakeShopEntry>[
        FakeShopEntry('s1', 'Ốc vùng 1', dishes: const <FakeDishEntry>[
          FakeDishEntry('d1', 'Ốc hấp', 10000, 'c1')
        ]),
        FakeShopEntry('s2', 'Ốc vùng 2',
            areaId: 'a2',
            dishes: const <FakeDishEntry>[
              FakeDishEntry('d2', 'Ốc xào', 20000, 'c1')
            ]),
      ],
    )..areaResolver = (double lat, double lng) async => lat == 0
        ? null
        : AreaChoice(
            id: lat == 1 ? 'a1' : 'a2', name: lat == 1 ? 'Vùng 1' : 'Vùng 2');

void main() {
  testWidgets('outside coverage is explained below the search heading in the list', (tester) async {
    final gps = FakeLocationProvider()..next = fix(0);
    final c = DiscoveryController(api: apiOf(), position: DiscoveryPosition(provider: gps));
    addTearDown(c.dispose);
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: DiscoveryHome(controller: c, publicApi: const UnwiredPublicShopApi()))));
    await tester.pumpAndSettle();
    expect(c.outsideCoverage, isTrue);
    expect(find.byKey(const Key('shop-s1')), findsNothing);
    expect(tester.getTopLeft(find.byKey(const Key('home-outside-coverage'))).dy,
      greaterThan(tester.getBottomLeft(find.byKey(const Key('home-search'))).dy));
    expect(tester.takeException(), isNull);
  });

  test(
      'GPS replaces manual area; same-area fixes do not reload; outside coverage has no fallback',
      () async {
    final FakeDiscoveryApi api = apiOf();
    final FakeLocationProvider gps = FakeLocationProvider()..next = fix(1);
    final DiscoveryController c = DiscoveryController(
        api: api, position: DiscoveryPosition(provider: gps));
    addTearDown(c.dispose);
    await c.start();
    await c.locate();
    expect(c.areaId, 'a1');
    expect(c.shops.single.shopId, 's1');
    final int count = api.queries.length;
    await c.locate(force: true);
    expect(api.queries.length, count);
    gps.next = fix(2);
    await c.locate(force: true);
    expect(c.areaId, 'a2');
    expect(c.shops.single.shopId, 's2');
    gps.next = fix(0);
    await c.locate(force: true);
    expect(c.outsideCoverage, isTrue);
    expect(c.areaId, isNull);
    expect(c.shops, isEmpty);
    await c.start();
    expect(c.areaId, isNull);
    await c.chooseArea('a1');
    expect(c.manualArea, isTrue);
    expect(c.outsideCoverage, isTrue);
    await c.locate(force: true);
    expect(c.areaId, isNull);
  });

  test('denied GPS keeps browsing and does not repeat permission on resume',
      () async {
    final FakeLocationProvider gps = FakeLocationProvider()
      ..failure = LocationFailure.denied;
    final DiscoveryController c = DiscoveryController(
        api: apiOf(), position: DiscoveryPosition(provider: gps));
    addTearDown(c.dispose);
    await c.start();
    await c.chooseArea('a1');
    await c.locate();
    await c.locate();
    expect(gps.calls, 1);
    expect(c.shops.single.shopId, 's1');
    gps.failure = null;
    gps.next = fix(2);
    await c.locate(force: true);
    expect(c.areaId, 'a2');
  });

  test(
      'manual choice wins over an older resolver and disposal ignores outstanding results',
      () async {
    final FakeDiscoveryApi api = apiOf();
    final DiscoveryController c = DiscoveryController(
        api: api,
        position:
            DiscoveryPosition(provider: FakeLocationProvider()..next = fix(2)));
    await c.start();
    final Completer<AreaChoice?> answer = Completer<AreaChoice?>();
    api.areaResolver = (_, __) => answer.future;
    final Future<void> pending = c.locate();
    await Future<void>.delayed(Duration.zero);
    await c.chooseArea('a1');
    answer.complete(const AreaChoice(id: 'a2', name: 'Vùng 2'));
    await pending;
    expect(c.areaId, 'a1');
    expect(c.resolvingArea, isFalse);
    final Completer<AreaChoice?> late = Completer<AreaChoice?>();
    api.areaResolver = (_, __) => late.future;
    final Future<void> disposed = c.locate(force: true);
    await Future<void>.delayed(Duration.zero);
    c.dispose();
    late.complete(const AreaChoice(id: 'a2', name: 'Vùng 2'));
    await disposed;
    expect(c.areaId, 'a1');
  });

  testWidgets('GPS denied: fallback area is optional and visibly marked as reference', (WidgetTester tester) async {
    final FakeDiscoveryApi api = apiOf();
    final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
    final DiscoveryController controller = DiscoveryController(
      api: api, position: DiscoveryPosition(provider: gps));
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: DiscoveryHome(controller: controller, publicApi: const UnwiredPublicShopApi()))));
    await tester.pumpAndSettle();
    expect(gps.calls, 1);
    expect(find.byKey(const Key('fallback-area-a1')), findsOneWidget);
    expect(find.byKey(const Key('fallback-area-a2')), findsOneWidget);
    await tester.tap(find.byKey(const Key('fallback-area-a1')));
    await tester.pumpAndSettle();
    expect(controller.manualArea, isTrue);
    expect(find.text('Vùng 1 · tham khảo'), findsOneWidget);
    gps.failure = null;
    gps.next = fix(2);
    await controller.locate(force: true);
    await tester.pumpAndSettle();
    expect(controller.manualArea, isFalse);
    expect(controller.areaId, 'a2');
    expect(find.text('Vùng 2'), findsOneWidget);
    expect(find.byKey(const Key('fallback-area-a1')), findsNothing);
  });
  testWidgets(
      'Home auto locates once and live search changes area on stale resume',
      (WidgetTester tester) async {
    final FakeDiscoveryApi api = apiOf();
    final FakeLocationProvider gps = FakeLocationProvider()..next = fix(1);
    final DiscoveryPosition position = DiscoveryPosition(provider: gps);
    final DiscoveryController c =
        DiscoveryController(api: api, position: position);
    addTearDown(c.dispose);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: DiscoveryHome(
                controller: c, publicApi: const UnwiredPublicShopApi()))));
    await tester.pumpAndSettle();
    expect(gps.calls, 1);
    expect(find.text('Vùng 1'), findsOneWidget);
    expect(find.byKey(const Key('discovery-locate')), findsNothing);
    await tester.tap(find.byKey(const Key('home-search')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('search-field')), 'Ốc');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Ốc vùng 1'), findsWidgets);
    gps.next = fix(2);
    position.attemptedAt = DateTime.now().subtract(const Duration(minutes: 6));
    for (final AppLifecycleState state in <AppLifecycleState>[
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    await tester.pumpAndSettle();
    expect(gps.calls, 2);
    expect(c.areaId, 'a2');
    expect(api.queries.last.areaId, 'a2');
    expect(find.text('Ốc vùng 2'), findsWidgets);
    expect(find.text('Ốc vùng 1'), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(gps.calls, 2);
    await tester.pumpWidget(const SizedBox());
  });
}
