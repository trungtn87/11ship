import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

FakeDiscoveryApi seeded() => FakeDiscoveryApi(shops: <FakeShopEntry>[
      FakeShopEntry('s1', 'Zeta Ốc Hương', reason: 'ONLINE', dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương hấp', 120000, 'c1')]),
      FakeShopEntry('s2', 'Alpha Hải Sản', reason: 'OUTSIDE_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d2', 'Ngao hấp', 60000, 'c2'), FakeDishEntry('d3', 'Ốc len xào dừa', 90000, 'c1')]),
      FakeShopEntry('s3', 'Quán Đóng Cửa', reason: 'OUTSIDE_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d4', 'Mực nướng', 150000, 'c2')]),
      // Issue #190: what an OLDER server (or a stale list) may still send. It is not set up, so the app never draws it, whatever the server said.
      FakeShopEntry('s5', 'Quán Máy Chủ Cũ', reason: 'NO_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d6', 'Gỏi cuốn', 30000, 'c1')]),
      FakeShopEntry('s4', 'Quán Khu Khác', areaId: 'a2', dishes: const <FakeDishEntry>[FakeDishEntry('d5', 'Cua rang', 250000, 'c2')]),
    ]);

ShopMenuView menuOf(String name) => ShopMenuView(
      name: name,
      address: '12 Phố Kim Đồng',
      availabilityReason: 'ONLINE',
      serverNow: DateTime.utc(2026, 10, 14, 11, 30),
      hours: emptyWeek(),
      categories: const <PublicCategory>[
        PublicCategory(name: 'Ốc', items: <PublicItem>[PublicItem(id: 'd1', name: 'Ốc hương hấp', priceVnd: 120000, imageUrl: null)]),
        PublicCategory(name: 'Hải sản', items: <PublicItem>[PublicItem(id: 'd2', name: 'Ngao hấp', priceVnd: 60000, imageUrl: null), PublicItem(id: 'd3', name: 'Ốc len xào dừa', priceVnd: 90000, imageUrl: null)]),
      ],
    );

void phone(WidgetTester tester, {double width = 390, double height = 800}) {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<void> tapKey(WidgetTester tester, String key) async {
  final Finder f = find.byKey(Key(key));
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> home(WidgetTester tester, DiscoveryController c, {PublicShopApi? publicApi}) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: DiscoveryHome(controller: c, publicApi: publicApi ?? FakePublicShopApi(menuOf('Zeta Ốc Hương'))))));
  await tester.pumpAndSettle();
}

void main() {
  group('DiscoveryController', () {
    test('one area is chosen for the person; several are not (no request until they choose)', () async {
      final DiscoveryController one = DiscoveryController(api: seeded());
      await one.start();
      expect(one.areaId, 'a1');
      expect(one.shops.map((ShopCardData s) => s.name), <String>['Zeta Ốc Hương', 'Alpha Hải Sản', 'Quán Đóng Cửa']);
      final FakeDiscoveryApi twoAreas = seeded()..areaList = <AreaChoice>[const AreaChoice(id: 'a1', name: 'Cao Bằng'), const AreaChoice(id: 'a2', name: 'Hòa An')];
      final DiscoveryController many = DiscoveryController(api: twoAreas);
      await many.start();
      expect(many.areaId, isNull);
      expect(twoAreas.queries, isEmpty);
      await many.chooseArea('a2');
      expect(many.shops.map((ShopCardData s) => s.name), <String>['Quán Khu Khác']);
    });

    test('group, open-only and reset: the query follows, reset keeps the area, Áp dụng changes all at once', () async {
      final FakeDiscoveryApi api = seeded();
      final DiscoveryController c = DiscoveryController(api: api);
      await c.start();
      await c.toggleCategory('c2');
      expect(api.queries.last.categoryId, 'c2');
      expect(c.shops.map((ShopCardData s) => s.name), <String>['Alpha Hải Sản', 'Quán Đóng Cửa']);
      await c.toggleCategory('c2');
      expect(c.categoryId, isNull);
      await c.apply(area: 'a1', category: 'c1', open: true);
      expect(c.shops.map((ShopCardData s) => s.name), <String>['Zeta Ốc Hương']);
      expect(c.filtersActive, isTrue);
      await c.reset();
      expect(c.areaId, 'a1');
      expect(c.filtersActive, isFalse);
      expect(c.shops, hasLength(3));
    });

    test('a failed first load is a failure (not an empty list); a failed refresh keeps the list as not up to date', () async {
      final FakeDiscoveryApi api = seeded()..offline = true;
      final DiscoveryController c = DiscoveryController(api: api);
      await c.start();
      expect(c.choicesState, DiscoveryLoad.failed);
      api.offline = false;
      await c.start();
      expect(c.listState, DiscoveryLoad.ready);
      api.offline = true;
      await c.refresh();
      expect(c.stale, isTrue);
      expect(c.shops, hasLength(3));
      api.offline = false;
      await c.refresh();
      expect(c.stale, isFalse);
    });

    test('not connected is its own state, no sample shop', () async {
      final DiscoveryController c = DiscoveryController(api: const UnwiredDiscoveryApi());
      await c.start();
      expect(c.choicesState, DiscoveryLoad.notConnected);
      expect(c.shops, isEmpty);
    });

    test('Xem thêm appends the next page without repeating a shop', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[for (int i = 0; i < 35; i++) FakeShopEntry('s$i', 'Quán ${i.toString().padLeft(2, '0')}', dishes: const <FakeDishEntry>[FakeDishEntry('d', 'Món', 1000, 'c1')])]);
      final DiscoveryController c = DiscoveryController(api: api);
      await c.start();
      expect(c.shops, hasLength(30));
      expect(c.hasMore, isTrue);
      await c.loadMore();
      expect(c.shops, hasLength(35));
      expect(c.shops.map((ShopCardData s) => s.shopId).toSet(), hasLength(35));
      expect(c.hasMore, isFalse);
    });
  });

  testWidgets('shop cards show actual ratings; the distance is a ROAD distance, never the straight line passed off as a route (issue #190)', (WidgetTester tester) async {
    phone(tester);
    const ShopCardData shop = ShopCardData(shopId: 'rated', name: 'Ốc 11', address: 'Cao Bằng', reason: 'ONLINE', ratingAverage: 4.5, ratingCount: 12, latitude: 22.67, longitude: 106.25);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopCard(shop: shop, onTap: () {}))));
    expect(find.text('★ 4.5/5 (12 đánh giá)'), findsOneWidget);
    expect(find.text('Chưa xác định quãng đường'), findsOneWidget);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopCard(shop: shop, locating: true, onTap: () {}))));
    expect(find.text('Đang định vị…'), findsOneWidget);
    final LocationFix fix = LocationFix(latitude: 22.67, longitude: 106.26, accuracyMeters: 10, takenAt: DateTime.now());
    // The straight line is about 1.0 km; the road the server found is 3.4 km. The card shows the road, labelled as such, and never the Haversine number.
    expect(shop.straightLineKm(fix), closeTo(1.026, 0.02));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopCard(shop: shop, customerLocation: fix, distance: const RouteDistance.route(3400), onTap: () {}))));
    expect(find.text('≈ 3,4 km · đường đi'), findsOneWidget);
    expect(find.textContaining('chim bay'), findsNothing);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopCard(shop: shop, customerLocation: fix, distance: RouteDistance.loading, onTap: () {}))));
    expect(find.text('Đang tính quãng đường…'), findsOneWidget);
    // Road unknown: it says so; the straight line may follow only as an explicitly labelled reference.
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopCard(shop: shop, customerLocation: fix, distance: RouteDistance.unavailable, onTap: () {}))));
    expect(find.textContaining('Chưa xác định quãng đường'), findsOneWidget);
    expect(find.textContaining('đường chim bay'), findsOneWidget);
    expect(find.textContaining('đường đi'), findsNothing);
    final FakeLocationProvider gps = FakeLocationProvider()..failure = LocationFailure.denied;
    final DiscoveryPosition position = DiscoveryPosition(provider: gps);
    await position.locate();
    expect(position.fix, isNull);
    expect(gps.calls, 1);
    position.dispose();
  });

  testWidgets('adding from unified search uses the existing one-shop cart replacement confirmation', (WidgetTester tester) async {
    phone(tester);
    final SampleOrderStore store = SampleOrderStore();
    final SampleDish dish = kSampleDishes.first;
    final SampleDish oldDish = kSampleDishes[1];
    final SampleCustomerOrders source = SampleCustomerOrders(store);
    final CartController cart = CartController(source: source);
    OrderRuntime.current = OrderRuntime(customer: source, shop: SampleShopOrders(store), cart: cart);
    addTearDown(() { OrderRuntime.current = null; cart.dispose(); });
    await cart.add(shopId: 'old-shop', shopName: 'Quán cũ', itemId: oldDish.id, name: oldDish.name, priceVnd: oldDish.priceVnd);
    final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[
      FakeShopEntry(kSampleShopId, 'Quán Phở', reason: 'ONLINE', dishes: <FakeDishEntry>[FakeDishEntry(dish.id, dish.name, dish.priceVnd, 'c1')]),
    ]);
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: SearchScreen(api: api, publicApi: FakePublicShopApi(menuOf('Quán Phở')), areaId: 'a1', debounce: Duration.zero)));
    await tester.enterText(find.byKey(const Key('search-field')), 'pho');
    await tester.pumpAndSettle();
    await tapKey(tester, 'dish-add-${dish.id}');
    expect(find.text('Thay giỏ hàng?'), findsOneWidget);
    await tapKey(tester, 'cart-replace-keep');
    expect(cart.shopId, 'old-shop');
    await tapKey(tester, 'dish-add-${dish.id}');
    await tapKey(tester, 'cart-replace-yes');
    expect(cart.shopId, kSampleShopId);
    expect(cart.quantityOf(dish.id), 1);
    expect(cart.failure, isNull);
    expect(cart.unsaved, isFalse);
    expect((await source.cart())!.lines.single.itemId, dish.id);
  });

  group('DishSearchController', () {
    test('typing clears the old results at once and the LATEST term wins even when an older answer arrives last', () async {
      final FakeDiscoveryApi api = seeded();
      final Completer<void> slow = Completer<void>();
      api.gate = (DiscoveryQuery q, String kind) => q.term == 'oc' ? slow.future : Future<void>.value();
      final DishSearchController s = DishSearchController(api: api, areaId: 'a1', debounce: Duration.zero);
      s.setTerm('oc');
      await Future<void>.delayed(Duration.zero);
      expect(s.state, DiscoveryLoad.loading);
      s.setTerm('ngao');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.shops, isEmpty);
      slow.complete();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.term, 'ngao');
      expect(s.shops, isEmpty, reason: 'the answer of the older term "oc" is dropped');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.dishes.map((DishHit d) => d.name), <String>['Ngao hấp']);
      expect(s.dishes.single.shop.name, 'Alpha Hải Sản');
    });

    test('search is in the chosen area, folds case, marks and spaces, and an empty term shows nothing', () async {
      final DishSearchController s = DishSearchController(api: seeded(), areaId: 'a1', debounce: Duration.zero);
      s.setTerm('  OC   HUONG ');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.shops.map((ShopCardData x) => x.name), <String>['Zeta Ốc Hương']);
      s.setTerm('cua rang');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.state, DiscoveryLoad.ready);
      expect(s.shops, isEmpty, reason: 'another area');
      s.setTerm('   ');
      expect(s.hasTerm, isFalse);
    });

    test('search ignores Home category and open-only filters, and deduplicates the shop group', () async {
      final FakeDiscoveryApi api = seeded();
      final DishSearchController s = DishSearchController(api: api, areaId: 'a1', categoryId: 'c2', openOnly: true, debounce: Duration.zero);
      s.setTerm('oc');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(api.queries.every((DiscoveryQuery q) => q.categoryId == null && !q.openOnly && q.areaId == 'a1'), isTrue);
      expect(s.dishes.map((DishHit d) => d.itemId), containsAll(<String>['d1', 'd3']));
      expect(s.groupedShops.map((ShopCardData x) => x.shopId).toSet(), <String>{'s1', 's2'});
      expect(s.groupedShops, hasLength(2));
      s.dispose();
    });

    test('a failure keeps the term and Thử lại runs it again', () async {
      final FakeDiscoveryApi api = seeded()..offline = true;
      final DishSearchController s = DishSearchController(api: api, areaId: 'a1', debounce: Duration.zero);
      s.setTerm('ngao');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(s.state, DiscoveryLoad.failed);
      expect(s.term, 'ngao');
      api.offline = false;
      await s.run();
      expect(s.state, DiscoveryLoad.ready);
    });
  });

  group('Home KP01 / filter KP03', () {
    testWidgets('shows the area, open shops first with their state, no rating / distance / fee, and opens the shop on tap', (WidgetTester tester) async {
      phone(tester);
      final DiscoveryController c = DiscoveryController(api: seeded());
      addTearDown(c.dispose);
      await home(tester, c);
      expect(find.text('Cao Bằng · tham khảo'), findsOneWidget);
      final List<String> order = <String>['Zeta Ốc Hương', 'Alpha Hải Sản', 'Quán Đóng Cửa'];
      for (final String n in order) {
        expect(find.text(n), findsOneWidget);
      }
      expect(tester.getTopLeft(find.text('Zeta Ốc Hương')).dy, lessThan(tester.getTopLeft(find.text('Alpha Hải Sản')).dy));
      expect(find.text('Đang mở cửa'), findsWidgets);
      expect(find.text('Đã đóng cửa'), findsNWidgets(2));
      expect(find.text('Chưa cài giờ hoạt động'), findsNothing);
      expect(find.text('Quán Máy Chủ Cũ'), findsNothing);
      expect(find.text('Quán Khu Khác'), findsNothing);
      for (final String word in <String>['sao', 'km', 'Phí ship', 'Mua', 'Giỏ hàng']) {
        expect(find.textContaining(word), findsNothing);
      }
      await tapKey(tester, 'shop-s1');
      expect(find.byKey(const Key('shop-view-name')), findsOneWidget);
      expect(find.text('Ốc hương hấp'), findsOneWidget);
    });

    testWidgets('group chips filter; the same chip clears it; the filter sheet applies, resets (area kept) and closing applies nothing', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = seeded();
      final DiscoveryController c = DiscoveryController(api: api);
      addTearDown(c.dispose);
      await home(tester, c);
      await tapKey(tester, 'home-cat-c2');
      expect(find.text('Zeta Ốc Hương'), findsNothing);
      expect(find.text('Alpha Hải Sản'), findsOneWidget);
      await tapKey(tester, 'home-cat-c2');
      expect(find.text('Zeta Ốc Hương'), findsOneWidget);

      await tapKey(tester, 'home-filter');
      await tester.tap(find.byKey(const Key('filter-open')));
      await tester.tap(find.byKey(const Key('filter-cat-c1')));
      await tester.pump();
      await tapKey(tester, 'filter-close');
      expect(c.openOnly, isFalse);
      expect(c.categoryId, isNull);
      expect(find.text('Alpha Hải Sản'), findsOneWidget);

      await tapKey(tester, 'home-filter');
      await tester.tap(find.byKey(const Key('filter-open')));
      await tester.tap(find.byKey(const Key('filter-cat-c1')));
      await tester.pump();
      await tapKey(tester, 'filter-apply');
      expect(c.openOnly, isTrue);
      expect(find.text('Alpha Hải Sản'), findsNothing);
      expect(find.text('Zeta Ốc Hương'), findsOneWidget);

      await tapKey(tester, 'home-filter');
      await tapKey(tester, 'filter-reset');
      await tapKey(tester, 'filter-apply');
      expect(c.filtersActive, isFalse);
      expect(c.areaId, 'a1');
      expect(find.text('Alpha Hải Sản'), findsOneWidget);
    });

    testWidgets('the layout follows the approved reference: brand and bell, area, group chips, then Quán gần bạn beside search and filters; the bell says M08 is not there yet', (WidgetTester tester) async {
      phone(tester);
      final DiscoveryController c = DiscoveryController(api: seeded());
      addTearDown(c.dispose);
      await home(tester, c);
      final double bell = tester.getTopLeft(find.byKey(const Key('home-bell'))).dy;
      final double area = tester.getTopLeft(find.byKey(const Key('home-area'))).dy;
      final double search = tester.getTopLeft(find.byKey(const Key('home-search'))).dy;
      final double chips = tester.getTopLeft(find.byKey(const Key('home-cat-all'))).dy;
      final double heading = tester.getTopLeft(find.text('Quán gần bạn')).dy;
      final double firstShop = tester.getTopLeft(find.byKey(const Key('shop-s1'))).dy;
      expect(<double>[bell, area, chips, search, firstShop], orderedEquals(<double>[bell, area, chips, search, firstShop]..sort()));
      expect((search - heading).abs(), lessThan(24));
      expect(tester.getTopLeft(find.byKey(const Key('home-search'))).dx, greaterThan(tester.getTopLeft(find.text('Quán gần bạn')).dx));
      expect(tester.getTopLeft(find.byKey(const Key('home-filter'))).dx, greaterThan(tester.getTopLeft(find.text('Quán gần bạn')).dx), reason: 'the filter button sits at the end of the heading row');
      expect((tester.getTopLeft(find.byKey(const Key('home-filter'))).dy - heading).abs(), lessThan(24));
      await tapKey(tester, 'home-bell');
      expect(find.text('Thông báo sẽ có ở bản sau.'), findsOneWidget);
      expect(find.text('Trang chủ'), findsNothing, reason: 'no page title bar above the brand header');
    });

    testWidgets('the filter sheet shows the groups as pills as wide as their text (not full-width bars) and keeps them in the server order', (WidgetTester tester) async {
      phone(tester);
      final DiscoveryController c = DiscoveryController(api: seeded());
      addTearDown(c.dispose);
      await home(tester, c);
      await tapKey(tester, 'home-filter');
      final Size oc = tester.getSize(find.byKey(const Key('filter-cat-c1')));
      final Size seafood = tester.getSize(find.byKey(const Key('filter-cat-c2')));
      expect(oc.width, lessThan(200));
      expect(seafood.width, lessThan(240));
      expect(tester.getTopLeft(find.byKey(const Key('filter-cat-c1'))).dx, lessThan(tester.getTopLeft(find.byKey(const Key('filter-cat-c2'))).dx), reason: 'the groups sit side by side, in the order the server gave');
    });

    testWidgets('Home picks its region by GPS and does not expose a manual area picker', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = seeded()..areaList = <AreaChoice>[const AreaChoice(id: 'a1', name: 'Cao Bằng'), const AreaChoice(id: 'a2', name: 'Hòa An')];
      api.areaResolver = (double lat, double lng) async => lat == 1
          ? const AreaChoice(id: 'a1', name: 'Cao Bằng')
          : const AreaChoice(id: 'a2', name: 'Hòa An');
      final FakeLocationProvider gps = FakeLocationProvider()
        ..next = LocationFix(latitude: 1, longitude: 106.25, accuracyMeters: 10, takenAt: DateTime.now());
      final DiscoveryController c = DiscoveryController(api: api, position: DiscoveryPosition(provider: gps));
      addTearDown(c.dispose);
      await home(tester, c);
      expect(c.areaId, 'a1');
      expect(find.text('Cao Bằng'), findsOneWidget);
      expect(find.byKey(const Key('area-a1')), findsNothing);
      await tapKey(tester, 'home-filter');
      expect(find.byKey(const Key('filter-area')), findsNothing);
      await tapKey(tester, 'filter-close');
      gps.next = LocationFix(latitude: 2, longitude: 106.25, accuracyMeters: 10, takenAt: DateTime.now());
      await c.locate(force: true);
      await tester.pumpAndSettle();
      expect(c.areaId, 'a2');
      expect(find.text('Hòa An'), findsOneWidget);
      expect(find.text('Quán Khu Khác'), findsOneWidget);
      expect(find.text('Zeta Ốc Hương'), findsNothing);
    });
    testWidgets('no match for the filters says so with Xóa bộ lọc; an area without shops says so', (WidgetTester tester) async {
      phone(tester);
      final DiscoveryController c = DiscoveryController(api: FakeDiscoveryApi(shops: <FakeShopEntry>[FakeShopEntry('s1', 'Quán Đóng', reason: 'OUTSIDE_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d', 'Món', 1000, 'c1')])]));
      addTearDown(c.dispose);
      await home(tester, c);
      await tapKey(tester, 'home-filter');
      await tester.tap(find.byKey(const Key('filter-open')));
      await tester.pump();
      await tapKey(tester, 'filter-apply');
      expect(find.text('Chưa có quán phù hợp'), findsOneWidget);
      await tapKey(tester, 'home-clear');
      expect(find.text('Quán Đóng'), findsOneWidget);
      final DiscoveryController empty = DiscoveryController(api: FakeDiscoveryApi());
      addTearDown(empty.dispose);
      await home(tester, empty);
      expect(find.text('Chưa có quán phù hợp'), findsOneWidget);
      expect(find.text('Khu vực này chưa có quán nào có món để hiển thị.'), findsOneWidget);
    });

    testWidgets('several areas without a GPS match: no manual selection; failed refresh retains the current list', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = seeded()..areaList = <AreaChoice>[const AreaChoice(id: 'a1', name: 'Cao Bằng'), const AreaChoice(id: 'a2', name: 'Hòa An')];
      final FakeLocationProvider gps = FakeLocationProvider()
        ..next = LocationFix(latitude: 0, longitude: 106.25, accuracyMeters: 10, takenAt: DateTime.now());
      api.areaResolver = (double lat, double lng) async => lat == 0 ? null : const AreaChoice(id: 'a1', name: 'Cao Bằng');
      final DiscoveryController c = DiscoveryController(api: api, position: DiscoveryPosition(provider: gps));
      addTearDown(c.dispose);
      await home(tester, c);
      expect(c.outsideCoverage, isTrue);
      expect(find.byKey(const Key('home-pick-area')), findsNothing);
      expect(find.byKey(const Key('area-a1')), findsNothing);
      expect(find.text('Khu vực này chưa được phục vụ'), findsOneWidget);
      expect(find.byKey(const Key('discovery-locate')), findsOneWidget);
      gps.next = LocationFix(latitude: 1, longitude: 106.25, accuracyMeters: 10, takenAt: DateTime.now());
      await tapKey(tester, 'discovery-locate');
      expect(c.areaId, 'a1');
      expect(find.text('Zeta Ốc Hương'), findsOneWidget);
      api.offline = true;
      await c.refresh();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('home-stale')), findsOneWidget);
      expect(find.text('Zeta Ốc Hương'), findsOneWidget);

      final FakeDiscoveryApi down = seeded()..offline = true;
      final DiscoveryController d = DiscoveryController(api: down);
      addTearDown(d.dispose);
      await home(tester, d);
      expect(find.text('Không tải được dữ liệu'), findsOneWidget);
      down.offline = false;
      await tapKey(tester, 'home-retry');
      expect(find.text('Zeta Ốc Hương'), findsOneWidget);
    });
    testWidgets('where discovery is not connected the Home says so (no sample shops)', (WidgetTester tester) async {
      phone(tester);
      final DiscoveryController c = DiscoveryController(api: const UnwiredDiscoveryApi());
      addTearDown(c.dispose);
      await home(tester, c);
      expect(find.text('Chưa nối máy chủ'), findsOneWidget);
    });
  });

  group('Search KP02', () {
    Future<void> openSearch(WidgetTester tester, FakeDiscoveryApi api, {PublicShopApi? publicApi}) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: SearchScreen(api: api, publicApi: publicApi ?? FakePublicShopApi(menuOf('Alpha Hải Sản')), areaId: 'a1', debounce: Duration.zero)));
      await tester.pumpAndSettle();
    }

    testWidgets('type without marks: grouped shop and dish results; no result keeps the term and offers to clear it', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = seeded();
      await openSearch(tester, api);
      expect(find.text('Tìm quán hoặc món'), findsWidgets);
      await tester.enterText(find.byKey(const Key('search-field')), 'oc huong');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('result-shop-s1')), findsOneWidget);
      expect(find.text('Ốc hương hấp'), findsOneWidget);
      expect(find.text('Zeta Ốc Hương'), findsWidgets);
      expect(find.byKey(const Key('search-tab-shops')), findsNothing);
      expect(find.byKey(const Key('search-tab-dishes')), findsNothing);
      expect(find.text('Đang mở cửa'), findsWidgets);
      await tester.enterText(find.byKey(const Key('search-field')), 'khong co gi');
      await tester.pumpAndSettle();
      expect(find.text('Không có kết quả'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('search-field'))).controller!.text, 'khong co gi');
      await tapKey(tester, 'search-clear-term');
      expect(find.text('Không có kết quả'), findsNothing);
      expect(find.text('Gõ tên quán hoặc tên món. Không cần gõ dấu.'), findsOneWidget);
    });

    testWidgets('grouped search shows the shop, and "Xem thêm" brings the next page of a long result without repeating a dish', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = FakeDiscoveryApi(shops: <FakeShopEntry>[
        FakeShopEntry('s1', 'Quán Nhiều Món', reason: 'ONLINE', dishes: <FakeDishEntry>[for (int i = 1; i <= 35; i++) FakeDishEntry('d$i', 'Món số ${i.toString().padLeft(2, '0')}', 1000 * i, 'c1')]),
      ]);
      await openSearch(tester, api);
      await tester.enterText(find.byKey(const Key('search-field')), 'mon so');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('result-shop-s1')), findsOneWidget);
      expect(find.byKey(const Key('result-dish-d1')), findsOneWidget);
      final Finder list = find.byType(Scrollable).last;
      await tester.scrollUntilVisible(find.byKey(const Key('search-more')), 400, scrollable: list);
      await tester.tap(find.byKey(const Key('search-more')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const Key('result-dish-d35')), 400, scrollable: list);
      expect(find.byKey(const Key('result-dish-d35')), findsOneWidget);
      expect(find.byKey(const Key('search-more')), findsNothing);
      final List<DiscoveryQuery> dishQueries = api.queries.where((DiscoveryQuery q) => q.term == 'mon so').toList();
      expect(dishQueries.map((DiscoveryQuery q) => q.offset).toSet(), containsAll(<int>[0, 30]));
    });

    testWidgets('a dish result opens ITS shop and lands on the dish; a dish that is gone says so', (WidgetTester tester) async {
      phone(tester);
      await openSearch(tester, seeded());
      await tester.enterText(find.byKey(const Key('search-field')), 'len xao');
      await tester.pumpAndSettle();
      await tapKey(tester, 'result-dish-d3');
      expect(find.byKey(const Key('shop-view-name')), findsOneWidget);
      final DishRow row = tester.widget<DishRow>(find.widgetWithText(DishRow, 'Ốc len xào dừa'));
      expect(row.highlight, isTrue);
      await tester.tap(find.byTooltip('Quay lại').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('search-field')), 'ngao');
      await tester.pumpAndSettle();
      await tapKey(tester, 'result-dish-d2');
      expect(tester.widget<DishRow>(find.widgetWithText(DishRow, 'Ngao hấp')).highlight, isTrue);
      await tester.tap(find.byTooltip('Quay lại').last);
      await tester.pumpAndSettle();
      // The dish was hidden meanwhile: the shop no longer lists it.
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: ShopPublicScreen(api: FakePublicShopApi(menuOf('Alpha Hải Sản')), shopId: 's2', focusItemId: 'dish-that-is-gone'),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Món này không còn trong thực đơn của quán.'), findsOneWidget);
    });

    testWidgets('a search failure keeps the term; Thử lại works; Hủy leaves', (WidgetTester tester) async {
      phone(tester);
      final FakeDiscoveryApi api = seeded()..offline = true;
      await openSearch(tester, api);
      await tester.enterText(find.byKey(const Key('search-field')), 'ngao');
      await tester.pumpAndSettle();
      expect(find.text('Không tải được dữ liệu'), findsOneWidget);
      api.offline = false;
      await tapKey(tester, 'search-retry');
      expect(find.byKey(const Key('result-shop-s2')), findsOneWidget, reason: 'dish matches are grouped under their shop');
      expect(find.byKey(const Key('result-dish-d2')), findsOneWidget);
    });
  });

  group('K01 in-shop search', () {
    testWidgets('finds dishes without marks, says when none match and keeps the groups of what matches', (WidgetTester tester) async {
      phone(tester);
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: ShopPublicScreen(api: FakePublicShopApi(menuOf('Alpha Hải Sản')), shopId: 's2')));
      await tester.pumpAndSettle();
      expect(find.text('Ngao hấp'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('shop-view-search')), 'OC LEN');
      await tester.pumpAndSettle();
      expect(find.text('Ốc len xào dừa'), findsOneWidget);
      expect(find.text('Ngao hấp'), findsNothing);
      expect(find.text('Ốc hương hấp'), findsNothing);
      await tester.enterText(find.byKey(const Key('shop-view-search')), 'zzz');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('shop-view-nomatch')), findsOneWidget);
    });
  });

  for (final double width in <double>[360, 390]) {
    testWidgets('layout at ${width.toInt()}px: Home with a long shop name, the filter sheet with the keyboard region and search results do not overflow', (WidgetTester tester) async {
      phone(tester, width: width);
      final DiscoveryController c = DiscoveryController(
        api: FakeDiscoveryApi(
          areas: <AreaChoice>[const AreaChoice(id: 'a1', name: 'Thành phố Cao Bằng, tỉnh Cao Bằng')],
          shops: <FakeShopEntry>[FakeShopEntry('s1', 'Quán Ốc Mười Một Chi Nhánh Số Hai Đường Kim Đồng Phường Hợp Giang', address: '12 Phố Kim Đồng, Phường Hợp Giang, Thành phố Cao Bằng, Tỉnh Cao Bằng', dishes: const <FakeDishEntry>[FakeDishEntry('d', 'Món', 1000, 'c1')])],
        ),
      );
      addTearDown(c.dispose);
      await home(tester, c);
      expect(tester.takeException(), isNull);
      for (final String key in <String>['home-search', 'home-filter', 'shop-s1', 'home-cat-c1']) {
        expect(tester.getSize(find.byKey(Key(key))).height, greaterThanOrEqualTo(44), reason: key);
      }
      await tapKey(tester, 'home-filter');
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byKey(const Key('filter-apply'))).height, greaterThanOrEqualTo(44));
    });
  }
}
