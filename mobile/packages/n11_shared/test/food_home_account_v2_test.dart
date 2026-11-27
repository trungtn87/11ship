import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'https://api.example.test',
  deviceEnvironment: 'fixture-env',
);

class _DishAwareDiscoveryApi extends FakeDiscoveryApi {
  _DishAwareDiscoveryApi({
    required super.categories,
    required super.shops,
    required this.customDishes,
  });

  final List<({DishHit hit, String categoryId})> customDishes;

  @override
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query) async {
    final List<DishHit> filtered = <DishHit>[
      for (final item in customDishes)
        if (query.categoryId == null || item.categoryId == query.categoryId)
          item.hit,
    ];
    return DiscoveryPage<DishHit>(items: filtered, hasMore: false);
  }
}

void main() {
  group('11Food Home v2 cards & dish chips', () {
    testWidgets(
      'shows top 3 best-selling dishes under Tất cả, filters dishes by selected category, and hides strip when empty',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(360 * 3, 800 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);

        const ShopCardData s1 = ShopCardData(
          shopId: 's1',
          name: 'Ốc Biển Đêm',
          address: '12 Kim Đồng',
          reason: 'ONLINE',
          ratingAverage: 5.0,
          ratingCount: 15,
        );

        final _DishAwareDiscoveryApi api = _DishAwareDiscoveryApi(
          categories: const <CategoryChoice>[
            CategoryChoice(id: 'c-oc', name: 'Ốc – Hải sản'),
            CategoryChoice(id: 'c-drink', name: 'Đồ uống'),
          ],
          shops: <FakeShopEntry>[
            FakeShopEntry(
              's1',
              'Ốc Biển Đêm',
              reason: 'ONLINE',
              ratingAverage: 5.0,
              ratingCount: 15,
              dishes: const <FakeDishEntry>[
                FakeDishEntry('d1', 'Ốc hương', 90000, 'c-oc'),
                FakeDishEntry('d2', 'Trà tắc', 15000, 'c-drink'),
              ],
            ),
            FakeShopEntry(
              's2',
              'Quán Không Có Món',
              reason: 'ONLINE',
              dishes: const <FakeDishEntry>[],
            ),
          ],
          customDishes: const <({DishHit hit, String categoryId})>[
            (
              hit: DishHit(
                itemId: 'd-low',
                name: 'Sò huyết',
                priceVnd: 70000,
                imageUrl: null,
                shop: s1,
                soldCount: 2,
              ),
              categoryId: 'c-oc',
            ),
            (
              hit: DishHit(
                itemId: 'd-top1',
                name: 'Ốc hương nướng',
                priceVnd: 95000,
                imageUrl: null,
                shop: s1,
                soldCount: 40,
              ),
              categoryId: 'c-oc',
            ),
            (
              hit: DishHit(
                itemId: 'd-top2',
                name: 'Ngao hấp sả',
                priceVnd: 55000,
                imageUrl: null,
                shop: s1,
                soldCount: 25,
              ),
              categoryId: 'c-oc',
            ),
            (
              hit: DishHit(
                itemId: 'd-top3',
                name: 'Trà đào cam sả',
                priceVnd: 25000,
                imageUrl: null,
                shop: s1,
                soldCount: 18,
              ),
              categoryId: 'c-drink',
            ),
          ],
        );

        final DiscoveryController c = DiscoveryController(api: api);
        addTearDown(c.dispose);

        await tester.pumpWidget(
          MaterialApp(
            theme: buildN11Theme(pageGradient: N11V5.homeGradient),
            home: Scaffold(
              body: DiscoveryHome(
                controller: c,
                publicApi: FakePublicShopApi(null),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // Shop 1 shows top 3 dishes by soldCount (40, 25, 18), not the 4th (soldCount 2).
        expect(find.byKey(const Key('shop-dishes-s1')), findsOneWidget);
        expect(find.byKey(const Key('shop-dish-d-top1')), findsOneWidget);
        expect(find.byKey(const Key('shop-dish-d-top2')), findsOneWidget);
        expect(find.byKey(const Key('shop-dish-d-top3')), findsOneWidget);
        expect(find.byKey(const Key('shop-dish-d-low')), findsNothing);

        // Single rating badge on logo only; never repeated in text.
        expect(find.byKey(const Key('shop-rating-s1')), findsOneWidget);
        expect(find.text('5.0'), findsOneWidget);

        // Shop 2 has no dishes: strip is cleanly hidden.
        expect(find.byKey(const Key('shop-dishes-s2')), findsNothing);

        // Selecting Đồ uống filters dish chips to Đồ uống only.
        await tester.tap(find.byKey(const Key('home-cat-c-drink')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('shop-dish-d-top3')), findsOneWidget);
        expect(find.byKey(const Key('shop-dish-d-top1')), findsNothing);
      },
    );

    testWidgets(
      'closed shop without logo hides storefront icon behind Đã đóng cửa and sorts after open shops',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(360 * 3, 800 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);

        final FakeDiscoveryApi api = FakeDiscoveryApi(
          shops: <FakeShopEntry>[
            FakeShopEntry('s-closed', 'Quán Đóng Cửa', reason: 'OUTSIDE_BUSINESS_HOURS'),
            FakeShopEntry('s-open', 'Quán Đang Mở', reason: 'ONLINE'),
          ],
        );
        final DiscoveryController c = DiscoveryController(api: api);
        addTearDown(c.dispose);

        await tester.pumpWidget(
          MaterialApp(
            theme: buildN11Theme(pageGradient: N11V5.homeGradient),
            home: Scaffold(
              body: DiscoveryHome(
                controller: c,
                publicApi: FakePublicShopApi(null),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        expect(
          tester.getTopLeft(find.byKey(const Key('shop-s-open'))).dy,
          lessThan(tester.getTopLeft(find.byKey(const Key('shop-s-closed'))).dy),
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('shop-logo-s-closed')),
            matching: find.byIcon(Icons.storefront_outlined),
          ),
          findsNothing,
        );
        expect(find.byKey(const Key('shop-status-s-closed')), findsOneWidget);
      },
    );
  });

  group('11Food Account v2 (guest centering & Quản lý quán branching)', () {
    testWidgets(
      'signed-in Account branches Quản lý quán card for no-shop, incomplete, and SHOP_OWNER on 360px screen',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(360 * 3, 800 * 3);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);

        final FakeApiTransport api = FakeApiTransport();
        installAccountRoutes(api);
        final FakeShopServer shopServer = FakeShopServer(api);
        final SessionController session = createSessionController(
          ClientApp.food,
          _config,
          transport: api,
          bridge: FakeDeviceBridge(),
        );
        final ShopController shop = ShopController(
          session: session,
          location: FakeLocationProvider(),
        );
        addTearDown(shop.dispose);
        addTearDown(session.dispose);

        await session.start();
        await session.login(phone: '0901234567', password: 'Correct-Horse-9');

        bool manageTapped = false;
        bool registerTapped = false;

        await tester.pumpWidget(
          MaterialApp(
            theme: buildN11Theme(pageGradient: N11V5.homeGradient),
            home: Scaffold(
              body: AccountTab(
                session: session,
                brand: foodBrand,
                actions: ShellActions(goTab: (_) {}, openDiagnostics: () {}),
                shop: shop,
                onOpenShopManage: () => manageTapped = true,
                onOpenShopRegister: () => registerTapped = true,
                entries: const <Widget>[
                  N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        // No shop yet: shows register subtitle, no duplicate shop-entry, and grouped settings.
        expect(find.byKey(const Key('shop-entry')), findsNothing);
        expect(find.byKey(const Key('account-shop-manage-card')), findsOneWidget);
        expect(find.text('Đăng ký tạo quán mới trên 11Food'), findsOneWidget);
        expect(find.text('Cài đặt tài khoản'), findsOneWidget);
        expect(find.text('Hỗ trợ & Ứng dụng'), findsOneWidget);
        expect(find.text('Đổi mật khẩu'), findsOneWidget);
        expect(find.text('Chủ quán'), findsNothing);

        await tester.tap(find.byKey(const Key('account-shop-manage-card')));
        await tester.pump();
        expect(registerTapped, isTrue);
        expect(manageTapped, isFalse);

        // Incomplete shop profile -> updates subtitle.
        shopServer.profile = <String, Object?>{
          'shop_id': 's-1',
          'name': 'Quán Mới',
          'contact_phone': '+84912345678',
          'zalo': null,
          'facebook': null,
          'address_text': '12 Kim Đồng',
          'pickup_lat': null,
          'pickup_lng': null,
          'service_area_id': null,
          'status': 'INCOMPLETE',
          'accepting_orders': false,
          'version': 1,
        };
        await shop.load();
        await tester.pumpAndSettle();
        expect(
          find.text('Hồ sơ quán chưa hoàn tất — tiếp tục đăng ký'),
          findsOneWidget,
        );

        // Approved SHOP_OWNER -> shows Chủ quán badge and management subtitle.
        shopServer.owner = true;
        await session.refreshIdentity();
        await tester.pumpAndSettle();
        expect(find.text('Chủ quán'), findsOneWidget);
        expect(find.text('Thông tin quán, thực đơn và đơn hàng'), findsOneWidget);

        await tester.tap(find.byKey(const Key('account-shop-manage-card')));
        await tester.pump();
        expect(manageTapped, isTrue);
      },
    );
  });
}
