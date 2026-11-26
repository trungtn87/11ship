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

  testWidgets('no banner under the categories: the "Khám phá món ngon gần bạn" block is gone and "Quán nổi bật" follows directly', (WidgetTester tester) async {
    await _pumpHome(tester, width: 390);
    expect(find.text('Khám phá món ngon gần bạn'), findsNothing);
    expect(find.textContaining('Giao nhanh tại'), findsNothing);
    expect(find.byKey(const Key('home-brand')), findsNothing);
    expect(find.byKey(const Key('home-featured-section')), findsOneWidget);
    expect(find.byKey(const Key('home-v5-section-title')), findsOneWidget);
    final double categories = tester.getBottomLeft(find.byKey(const Key('home-v5-category-card'))).dy;
    final double featured = tester.getTopLeft(find.byKey(const Key('home-featured-section'))).dy;
    final double nearbyTitle = tester.getTopLeft(find.byKey(const Key('home-v5-section-title'))).dy;
    expect(featured - categories, lessThan(40), reason: 'an empty gap is left where the banner was');
    expect(nearbyTitle, greaterThan(featured));
  });

  testWidgets('Home layout at 360px and 390px shows both "Quán nổi bật" and "Quán gần bạn" above bottom nav, with clean "Ốc – Hải sản" category and address book link', (WidgetTester tester) async {
    for (final double width in <double>[360, 390]) {
      tester.view.physicalSize = Size(width * 3, 844 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final FakeDiscoveryApi api = FakeDiscoveryApi(
        categories: const <CategoryChoice>[
          CategoryChoice(id: 'c1', name: 'Đồ uống'),
          CategoryChoice(id: 'c2', name: 'Đồ ăn nhanh'),
          CategoryChoice(id: '52a8e959-0129-492e-8e43-1c16ebd6dfec', name: 'Ốc – Hải sản'),
          CategoryChoice(id: 'c4', name: 'Bún - Phở'),
        ],
        shops: <FakeShopEntry>[
          FakeShopEntry('s1', 'Ốc 11 - Hải Sản Đêm', reason: 'ONLINE', ratingAverage: 5.0, ratingCount: 12, dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương', 90000, 'c1')]),
          FakeShopEntry('s2', 'B03 Cơm Gà Cao Bằng', reason: 'ONLINE', ratingAverage: 4.8, ratingCount: 8, dishes: const <FakeDishEntry>[FakeDishEntry('d2', 'Cơm gà', 45000, 'c2')]),
          FakeShopEntry('s3', 'Quán Đóng Cửa', reason: 'OUTSIDE_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d3', 'Mực nướng', 120000, 'c1')]),
        ],
      );
      final DiscoveryController c = DiscoveryController(api: api);
      addTearDown(c.dispose);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: Scaffold(
            body: DiscoveryHome(controller: c, publicApi: FakePublicShopApi(null)),
            bottomNavigationBar: N11BottomNav(
              items: const <NavItem>[
                NavItem(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined),
                NavItem(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined),
                NavItem(id: 'call', label: 'Gọi ship', icon: Icons.two_wheeler_outlined),
                NavItem(id: 'shop', label: 'Quán', icon: Icons.storefront_outlined),
                NavItem(id: 'account', label: 'Tài khoản', icon: Icons.person_outline),
              ],
              activeIndex: 0,
              onSelect: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('11food'), findsNothing);
      expect(find.textContaining('Giao đến:'), findsNothing);
      expect(find.text('Ốc – Hải sản'), findsOneWidget);
      expect(find.text('Quán nổi bật'), findsOneWidget);
      expect(find.text('Quán gần bạn'), findsOneWidget);
      expect(find.text('Yêu thích'), findsWidgets);
      expect(find.text('Mở cửa'), findsWidgets);
      expect(find.text('Đã đóng cửa'), findsWidgets);
      expect(find.byKey(const Key('home-featured-see-all')), findsOneWidget);
      expect(find.byKey(const Key('home-nearby-see-all')), findsOneWidget);
      // Nearby section header sits comfortably above the bottom navigation bar.
      final double navTop = tester.getTopLeft(find.byType(N11BottomNav)).dy;
      final double nearbyTop = tester.getTopLeft(find.byKey(const Key('home-nearby-section'))).dy;
      expect(nearbyTop, lessThan(navTop));
    }
  });

  for (final double width in <double>[320, 360, 390]) {
    testWidgets('text scale 1.3 at ${width.toInt()}px: no overflow in the header, search, categories or title', (WidgetTester tester) async {
      await _pumpHome(tester, width: width, textScale: 1.3);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('header displays saved default delivery address and opens AddressBookScreen on tap', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(360 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final AddressBookController addresses = AddressBookController(
      api: _StaticAddressApi(const <DeliveryAddress>[
        DeliveryAddress(
          id: 'addr-1',
          label: AddressLabel.home,
          recipientName: 'Nguyễn An',
          contactPhone: '+84912345678',
          addressText: 'Tổ 07, Phường Sông Bằng, Thành phố Cao Bằng, Tỉnh Cao Bằng',
          deliveryNote: null,
          latitude: 22.67,
          longitude: 106.26,
          isDeliveryDefault: true,
          version: 1,
        ),
      ]),
    );
    addTearDown(addresses.dispose);
    await addresses.load();
    final DiscoveryController c = DiscoveryController(api: _api());
    addTearDown(c.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildN11Theme(),
        home: Scaffold(
          body: DiscoveryHome(
            controller: c,
            publicApi: FakePublicShopApi(null),
            addresses: addresses,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.text('Tổ 07, Phường Sông Bằng, Thành phố Cao Bằng, Tỉnh Cao Bằng'),
      findsOneWidget,
    );
    expect(find.textContaining('Giao đến:'), findsNothing);
    await tester.tap(find.byKey(const Key('home-area')));
    await tester.pumpAndSettle();
    expect(find.byType(AddressBookScreen), findsOneWidget);
  });
}

class _StaticAddressApi implements AddressApi {
  const _StaticAddressApi(this.rows);
  final List<DeliveryAddress> rows;

  @override
  Future<List<DeliveryAddress>> list() async => rows;
  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) =>
      throw UnsupportedError('read only');
  @override
  Future<DeliveryAddress> update(
    String id,
    AddressInput input, {
    required int expectedVersion,
    required String key,
  }) =>
      throw UnsupportedError('read only');
  @override
  Future<String?> delete(String id, {required String key}) =>
      throw UnsupportedError('read only');
  @override
  Future<void> setDefault(String id, {required String key}) =>
      throw UnsupportedError('read only');
  @override
  Future<void> setDefaultKind(
    String id,
    AddressDefaultKind kind,
    bool enabled, {
    required String key,
  }) =>
      throw UnsupportedError('read only');
}
