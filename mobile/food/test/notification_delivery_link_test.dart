import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// One page per food order: a notification of a delivery that belongs to an order opens that ORDER (older notices and earlier calls included, found by the
// delivery's own order link); a direct delivery's notice opens the direct delivery; when the link cannot be read the delivery page shows the server's answer
// and never another order. The server decides the target and the right (see the backend tests); the phone never guesses from a code.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> _delivery(String id, {required String source, String? orderId}) => <String, Object?>{
      'delivery_id': id,
      'code': 'G-1',
      'source': source,
      'order_id': orderId,
      'state': 'waiting_driver',
      'version': 1,
      'pickup': <String, Object?>{'shop_name': 'Quán'},
      'recipient': <String, Object?>{'name': 'A', 'phone': '0900000000', 'address_text': 'x', 'lat': null, 'lng': null},
      'goods': <String, Object?>{'description': 'g', 'value_vnd': 1000, 'paid_vnd': 0},
      'fee': <String, Object?>{'mode': 'STANDARD', 'payer': 'SHOP', 'amount_vnd': null, 'status': 'UNKNOWN', 'distance_m': null, 'agreement': null},
      'search': <String, Object?>{'started_at': '2026-10-18T09:00:00Z', 'expires_at': '2026-10-18T09:30:00Z', 'server_now': '2026-10-18T09:05:00Z', 'stopped_at': null},
      'can': <String, Object?>{},
    };

class _Linked extends SampleShopSource {
  _Linked(this.links);

  /// delivery id -> its wire body; an id that is not here is "not found".
  final Map<String, Map<String, Object?>> links;

  @override
  Future<DeliveryView> get(String id) async {
    final Map<String, Object?>? body = links[id];
    if (body == null) {
      throw const M07Failure(M07FailureKind.refused, code: 'DELIVERY_NOT_FOUND');
    }
    return DeliveryView.fromJson(body);
  }
}

Future<void> _open(WidgetTester tester, {required String targetType, required String targetId, required ShopDeliverySource deliveries, required void Function(OrderRuntime, String) check}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{...identityJson(active: 'SHOP_OWNER'), 'available_roles': <String>['CUSTOMER', 'SHOP_OWNER']}});
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await tester.runAsync(() async {
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await session.refreshIdentity();
  });
  final SampleOrderStore store = SampleOrderStore();
  final String orderId = store.seed(status: 'PREPARING');
  final OrderRuntime orders = OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)));
  final AppFlows flows = AppFlows(session: session, reset: ResetController(transport: api, session: session), orders: orders, shopDeliveries: deliveries);
  final DateTime now = DateTime.utc(2026, 10, 21);
  api.routes['GET /v1/notifications?filter=all&limit=30'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
        'data': <String, Object?>{
          'items': <Object?>[<String, Object?>{'notification_id': 'n1', 'seq': 1, 'kind': 'DELIVERY_ACCEPTED', 'category': 'ORDERS', 'title': 'Shipper đã nhận đơn', 'body': 'Đơn DH-1', 'target': <String, Object?>{'type': targetType, 'id': targetId}, 'created_at': now.toIso8601String(), 'updated_at': now.toIso8601String(), 'read': false, 'expired': false}],
          'next_before': null, 'unread_count': 1, 'latest_seq': 1, 'server_now': now.toIso8601String(),
        },
      });
  api.routes['POST /v1/notifications/n1/open'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
        'data': <String, Object?>{'notification_id': 'n1', 'outcome': 'OK', 'target': <String, Object?>{'type': targetType, 'id': targetType == 'ORDER' ? orderId : targetId}, 'delivery_state': 'waiting_driver', 'expired': false, 'server_now': now.toIso8601String()},
      });
  final NotificationController controller = NotificationController(session: session, source: HttpNotificationSource(session: session));
  await tester.runAsync(controller.load);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: Builder(builder: (BuildContext context) => TextButton(
        onPressed: () => unawaited(openNotification(context, controller, foodNotificationRouter(flows), ShellActions(goTab: (_) {}, openDiagnostics: () {}), item: controller.items.single)),
        child: const Text('Mở thông báo'),
      )))));
  await tester.tap(find.text('Mở thông báo'));
  await tester.pumpAndSettle();
  check(orders, orderId);
  await tester.pumpWidget(const SizedBox());
  controller.dispose();
  flows.reset.dispose();
  orders.cart.dispose();
  session.dispose();
}

void main() {
  testWidgets('a notice that points at a delivery of an order (any call of it) opens that one order page, not a delivery page', (WidgetTester tester) async {
    for (final String callId in <String>['d-first-call', 'd-current-call']) {
      late String expected;
      await _open(
        tester,
        targetType: 'DELIVERY',
        targetId: callId,
        deliveries: _Linked(<String, Map<String, Object?>>{callId: _delivery(callId, source: 'ORDER', orderId: 'ignored')}),
        check: (OrderRuntime orders, String orderId) {
          expected = orderId;
          expect(find.byType(ShopDeliveryDetailScreen), findsNothing);
          expect(find.byType(ShopOrderDetailScreen), findsOneWidget);
        },
      );
      expect(expected, isNotEmpty);
    }
  });

  testWidgets('the server\'s own answer (an ORDER target) opens the order page; a direct delivery opens the direct page', (WidgetTester tester) async {
    await _open(tester, targetType: 'ORDER', targetId: 'whatever', deliveries: _Linked(<String, Map<String, Object?>>{}), check: (OrderRuntime orders, String orderId) {
      expect(tester.widget<ShopOrderDetailScreen>(find.byType(ShopOrderDetailScreen)).orderId, orderId);
      expect(find.byType(ShopDeliveryDetailScreen), findsNothing);
    });
    await _open(tester, targetType: 'DELIVERY', targetId: 'd-direct', deliveries: _Linked(<String, Map<String, Object?>>{'d-direct': _delivery('d-direct', source: 'DIRECT')}), check: (OrderRuntime orders, String orderId) {
      expect(tester.widget<ShopDeliveryDetailScreen>(find.byType(ShopDeliveryDetailScreen)).deliveryId, 'd-direct');
      expect(find.byType(ShopOrderDetailScreen), findsNothing);
    });
  });

  testWidgets('a delivery that cannot be read (not found / no right) never opens an order: the delivery page shows the answer', (WidgetTester tester) async {
    await _open(tester, targetType: 'DELIVERY', targetId: 'd-missing', deliveries: _Linked(<String, Map<String, Object?>>{}), check: (OrderRuntime orders, String orderId) {
      expect(find.byType(ShopOrderDetailScreen), findsNothing);
      expect(find.byType(ShopDeliveryDetailScreen), findsOneWidget);
    });
  });
}
