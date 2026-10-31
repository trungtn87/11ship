import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #238: the customer edits an Order that still waits for the shop. Nothing is written until the money was seen and "Lưu thay đổi" is pressed; closing the
// editor changes nothing; if the shop confirmed meanwhile the save writes nothing and says to contact the shop; once confirmed there is no "Sửa đơn".

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 9000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));

OrderRuntime runtimeOf(SampleOrderStore store) => OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)));

void main() {
  testWidgets('"Sửa đơn" sits beside "Hủy đơn" only while the shop has not confirmed', (WidgetTester tester) async {
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: store.seed()));
    expect(key('order-edit'), findsOneWidget);
    expect(key('order-cancel'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: store.seed(status: 'PREPARING')));
    expect(key('order-edit'), findsNothing);
  });

  testWidgets('the editor changes a quantity, the money is checked first, saving replaces the content once; closing it unsaved changes nothing', (WidgetTester tester) async {
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    final String id = store.seed();
    final OrderView before = await runtime.customer.get(id);
    final String itemId = before.items.first.itemId;
    await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));

    // Opened and closed without saving: nothing was written.
    await tap(tester, key('order-edit'));
    expect(key('order-edit-save'), findsOneWidget);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull, reason: 'the money must be checked first');
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await settle(tester);
    await settle(tester);
    await tester.pump(const Duration(seconds: 1));
    expect((await runtime.customer.get(id)).customerEditCount, 0);

    await tap(tester, key('order-edit'));
    await tap(tester, key('order-edit-plus-$itemId'));
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull);
    await tap(tester, key('order-edit-review'));
    expect(key('order-edit-compare'), findsOneWidget);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNotNull);
    // Any further change voids the check again.
    await tap(tester, key('order-edit-plus-$itemId'));
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull);
    await tap(tester, key('order-edit-review'));
    await tap(tester, key('order-edit-save'));
    await tester.pump(const Duration(seconds: 1));

    final OrderView after = await runtime.customer.get(id);
    expect(after.customerEditCount, 1);
    expect(after.version, before.version + 1);
    expect(after.items.first.quantity, before.items.first.quantity + 2);
    expect(find.byKey(const Key('order-edit-save')), findsNothing, reason: 'back on the order');
  });

  testWidgets('the shop confirmed while the customer was editing: nothing is written and the customer is told to contact the shop', (WidgetTester tester) async {
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    final String id = store.seed();
    final OrderView before = await runtime.customer.get(id);
    await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
    await tap(tester, key('order-edit'));
    await tap(tester, key('order-edit-plus-${before.items.first.itemId}'));
    await tap(tester, key('order-edit-review'));
    await runtime.shop.confirm(id, expectedVersion: before.version, key: 'k-confirm');
    await tap(tester, key('order-edit-save'));
    expect(key('order-edit-locked'), findsOneWidget);
    expect(find.textContaining('liên hệ quán'), findsWidgets);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull);
    expect((await runtime.customer.get(id)).customerEditCount, 0);
  });

  testWidgets('"Thêm món" lists the shop\'s dishes and an added dish joins the draft; an empty order cannot be priced', (WidgetTester tester) async {
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    final String id = store.seed();
    final OrderView before = await runtime.customer.get(id);
    await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
    await tap(tester, key('order-edit'));
    await tap(tester, key('order-edit-add'));
    final SampleDish extra = kSampleDishes.firstWhere((SampleDish d) => before.items.every((OrderLine l) => l.itemId != d.id));
    await tap(tester, key('order-edit-add-${extra.id}'));
    expect(key('order-edit-line-${extra.id}'), findsOneWidget);
    for (final OrderLine l in before.items) {
      await tap(tester, key('order-edit-remove-${l.itemId}'));
    }
    await tap(tester, key('order-edit-remove-${extra.id}'));
    await tap(tester, key('order-edit-review'));
    expect(key('order-edit-message'), findsOneWidget);
    expect(find.textContaining('Hủy đơn'), findsWidgets);
  });

  testWidgets('the shop sees "Khách vừa cập nhật đơn hàng" on the newest version only after the customer edited', (WidgetTester tester) async {
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    final String id = store.seed();
    await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
    expect(key('order-customer-edited'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    final OrderView before = await runtime.customer.get(id);
    final OrderLine first = before.items.first;
    final CheckoutPreview preview = CheckoutPreview.fromJson(<String, Object?>{'ok': true, 'blockers': <Object?>[], 'lines': <Object?>[], 'items_total_vnd': 1, 'expected_total_vnd': null, 'fee': <String, Object?>{'status': 'UNAVAILABLE', 'distance_m': null, 'fee_vnd': null, 'reason': null, 'policy_version': null, 'snapshot': 's'}});
    await runtime.customer.editOrder(id, CheckoutDraft(shopId: before.shop.shopId, shopName: before.shop.name, lines: <DraftLine>[DraftLine(itemId: first.itemId, name: first.name, quantity: first.quantity + 1, priceVnd: first.unitPriceVnd)], note: null, recipientName: 'An', recipientPhone: '0912345678', address: DraftAddress.typed('Hà Nội'), scheduledFor: null), preview: preview, expectedVersion: before.version, key: 'k');
    await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
    expect(key('order-customer-edited'), findsOneWidget);
    expect(find.textContaining('Khách vừa cập nhật đơn hàng'), findsWidgets);
  });
}
