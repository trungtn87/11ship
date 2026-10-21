import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

void main() {
  for (final String role in <String>['CUSTOMER', 'SHOP_OWNER']) {
    testWidgets('notification GET -> POST open -> $role detail uses server order id', (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{...identityJson(active: role), 'available_roles': <String>['CUSTOMER', if (role == 'SHOP_OWNER') 'SHOP_OWNER']}});
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await tester.runAsync(() async {
        await session.start();
        await session.login(phone: '0901234567', password: 'Correct-Horse-9');
        await session.refreshIdentity();
      });
      expect(session.identity?.activeRole, role);
      final SampleOrderStore store = SampleOrderStore();
      final String orderId = store.seed(status: 'COMPLETED');
      final OrderRuntime orders = OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)));
      final AppFlows flows = AppFlows(session: session, reset: ResetController(transport: api, session: session), orders: orders);
      final DateTime now = DateTime.utc(2026, 10, 21);
      api.routes['GET /v1/notifications?filter=all&limit=30'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
        'data': <String, Object?>{
          'items': <Object?>[<String, Object?>{'notification_id': 'n1', 'seq': 1, 'kind': 'ORDER_CREATED', 'category': 'ORDERS', 'title': 'Có đơn món mới', 'body': 'Đơn DH-DISPLAY', 'target': <String, Object?>{'type': 'ORDER', 'id': 'stale-target'}, 'created_at': now.toIso8601String(), 'updated_at': now.toIso8601String(), 'read': false, 'expired': false}],
          'next_before': null, 'unread_count': 1, 'latest_seq': 1, 'server_now': now.toIso8601String(),
        },
      });
      api.routes['POST /v1/notifications/n1/open'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
        'data': <String, Object?>{'notification_id': 'n1', 'outcome': 'ENDED', 'target': <String, Object?>{'type': 'ORDER', 'id': orderId}, 'delivery_state': null, 'expired': false, 'server_now': now.toIso8601String()},
      });
      final NotificationController controller = NotificationController(session: session, source: HttpNotificationSource(session: session));
      await tester.runAsync(controller.load);
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: Builder(builder: (BuildContext context) => TextButton(
        onPressed: () => unawaited(openNotification(context, controller, foodNotificationRouter(flows), ShellActions(goTab: (_) {}, openDiagnostics: () {}), item: controller.items.single)),
        child: const Text('Mở thông báo'),
      )))));
      await tester.tap(find.text('Mở thông báo'));
      await tester.pumpAndSettle();
      if (role == 'SHOP_OWNER') {
        expect(tester.widget<ShopOrderDetailScreen>(find.byType(ShopOrderDetailScreen)).orderId, orderId);
        expect(find.byType(CustomerOrderDetailScreen), findsNothing);
      } else {
        expect(tester.widget<CustomerOrderDetailScreen>(find.byType(CustomerOrderDetailScreen)).orderId, orderId);
        expect(find.byType(ShopOrderDetailScreen), findsNothing);
      }
      expect(api.to('POST', '/v1/notifications/n1/open').single.body, '{}');
      expect(controller.items.single.read, isTrue);
      expect(controller.unreadCount, 0);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
      flows.reset.dispose();
      orders.cart.dispose();
      session.dispose();
    });
  }
}
