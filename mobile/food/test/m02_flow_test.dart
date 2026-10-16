import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  testWidgets('the Quán tab -> shop mode -> management reads the real shop; the menu says it is not connected; nothing is invented', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopServer onboarding = FakeShopServer(api)
      ..owner = true
      ..profile = <String, Object?>{
        'shop_id': '44444444-4444-4444-8444-444444444444',
        'name': 'Ốc 11',
        'contact_phone': '+84912345678',
        'zalo': null,
        'facebook': null,
        'address_text': '12 Phố Kim Đồng',
        'pickup_lat': 22.6657,
        'pickup_lng': 106.2522,
        'service_area_id': FakeShopOpsServer.areaId,
        'status': 'ACTIVE',
        'accepting_orders': false,
        'version': 2,
      };
    final FakeShopOpsServer shop = FakeShopOpsServer(api)..reason = 'NO_BUSINESS_HOURS';
    installResetRoutes(api);
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    final AppFlows flows = createFlows(ClientApp.food, session, config, transport: api, location: FakeLocationProvider());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await session.refreshIdentity();
    await tester.pumpWidget(ListenableBuilder(listenable: session, builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: session.identity?.userId, brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero)));
    await tester.pump();
    // The owner's own tab, and no "Quản lý cửa hàng" row left in Tài khoản.
    expect(find.byKey(const Key('tab-shop')), findsOneWidget);
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pumpAndSettle();
    expect(find.text('Quản lý cửa hàng'), findsNothing);
    await tester.tap(find.byKey(const Key('tab-shop')));
    await tester.pumpAndSettle();
    // Not in shop mode yet: nothing is read, the person enters the mode with their own tap.
    expect(find.byKey(const Key('shop-tab-enter')), findsOneWidget);
    expect(shop.reads, 0);
    await tester.tap(find.byKey(const Key('shop-tab-enter')));
    await tester.pumpAndSettle();
    expect(onboarding.contexts, <String>['SHOP_OWNER']);
    expect(shop.reads, greaterThan(0));
    expect(find.byKey(const Key('manage-name')), findsOneWidget);
    expect(find.text('Chưa cài giờ hoạt động'), findsWidgets);
    expect(find.byType(Switch), findsNothing);

    await tester.tap(find.byKey(const Key('manage-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Chưa nối máy chủ'), findsOneWidget);
    expect(find.byKey(const Key('menu-add')), findsNothing);
    await tester.tap(find.byTooltip('Quay lại').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('manage-preview')));
    await tester.pumpAndSettle();
    expect(find.text('Chưa nối máy chủ'), findsOneWidget);
  });
}
