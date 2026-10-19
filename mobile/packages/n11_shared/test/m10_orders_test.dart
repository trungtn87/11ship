import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// M10 phone screens on the sample store (one in-memory stand-in for the server, shared by both sides). What matters: the cart (one shop, same dish + same
// note joins, another shop asks first, kept by the server), the checkout without a pin ("Chưa xác định phí", never 0đ), a changed price or a dish that is
// gone is refused and the cart refreshed, a LOST answer is not reported as sent or failed and the same reference finds the Order (never two), the customer
// cancels only before confirmation, the shop edits then must give a reason, "ready" and "call a Shipper" are independent, a failed delivery keeps the
// Order, and an ended Order draws no live position.

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 9000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));
Finder containing(String value) => find.textContaining(value);

OrderRuntime runtimeOf(SampleOrderStore store) => OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)));

final SampleDish pho = kSampleDishes[0];
final SampleDish tea = kSampleDishes[2];

void main() {
  group('cart', () {
    test('one shop; the same dish with the same note joins one line, another note is another line; the server keeps it', () async {
      final SampleOrderStore store = SampleOrderStore();
      final CartController cart = CartController(source: SampleCustomerOrders(store));
      await cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000, note: 'ít cay');
      await cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000, note: ' Ít  cay ', by: 2);
      await cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000);
      expect(cart.lines.map((DraftLine l) => (l.quantity, l.note)).toList(), <(int, String?)>[(3, 'ít cay'), (1, null)]);
      expect(cart.count, 4);
      expect(cart.itemsVnd, 180000);
      // Leaving the app and coming back (a new controller on the same server) finds the same cart.
      final CartController again = CartController(source: SampleCustomerOrders(store));
      await again.load();
      expect(again.lines, hasLength(2));
      expect(again.shopName, 'Quán Phở Minh họa');
    });

    test('another shop needs a decision; replacing starts a new cart', () async {
      final SampleOrderStore store = SampleOrderStore();
      final CartController cart = CartController(source: SampleCustomerOrders(store));
      await cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000);
      expect(cart.needsReplace('other-shop'), isTrue);
      expect(() => cart.add(shopId: 'other-shop', shopName: 'Quán khác', itemId: tea.id, name: tea.name, priceVnd: 5000), throwsStateError);
      await cart.add(shopId: 'other-shop', shopName: 'Quán khác', itemId: tea.id, name: tea.name, priceVnd: 5000, replace: true);
      expect(cart.shopId, 'other-shop');
      expect(cart.lines.single.itemId, tea.id);
    });

    test('a save that fails keeps what is on screen and says it is unsaved; the next change saves it', () async {
      final SampleOrderStore store = SampleOrderStore();
      final _Offline source = _Offline(store);
      final CartController cart = CartController(source: source);
      source.offline = true;
      await cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000);
      expect(cart.unsaved, isTrue);
      expect(cart.failure?.kind, M07FailureKind.offline);
      expect(cart.count, 1);
      source.offline = false;
      await cart.setQuantity(cart.lines.single, 2);
      expect(cart.unsaved, isFalse);
      expect((await SampleCustomerOrders(store).cart())!.lines.single.quantity, 2);
    });

    testWidgets('the + on a dish of another shop asks first; "Giữ giỏ cũ" changes nothing', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      await runtime.cart.add(shopId: 'other-shop', shopName: 'Quán khác', itemId: tea.id, name: tea.name, priceVnd: 5000);
      await mount(tester, Scaffold(body: DishStepper(cart: runtime.cart, shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000)));
      await tap(tester, key('dish-add-${pho.id}'));
      expect(containing('Thay giỏ hàng?'), findsOneWidget);
      await tap(tester, key('cart-replace-keep'));
      expect(runtime.cart.shopId, 'other-shop');
      await tap(tester, key('dish-add-${pho.id}'));
      await tap(tester, key('cart-replace-yes'));
      expect(runtime.cart.shopId, kSampleShopId);
      expect(runtime.cart.quantityOf(pho.id), 1);
      await unmount(tester);
    });
  });

  group('checkout', () {
    Future<(OrderRuntime, SampleOrderStore)> readyCart() async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: pho.id, name: pho.name, priceVnd: 45000, by: 2);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: tea.id, name: tea.name, priceVnd: 5000);
      return (runtime, store);
    }

    Future<void> fill(WidgetTester tester) async {
      await tester.enterText(key('checkout-name'), 'Nguyễn An');
      await tester.enterText(key('checkout-phone'), '0912345678');
      await tap(tester, key('checkout-typed-toggle'));
      await tester.enterText(key('location-address-text'), '12 Phố Huế, Hà Nội');
      await tap(tester, key('location-save'));
      await settle(tester);
    }

    testWidgets('no pin (no GPS): the Order still goes, the fee reads "Chưa xác định phí" — never 0đ, and no total is claimed', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      expect(containing('Chưa xác định phí'), findsWidgets);
      expect(find.text(m10Money(0)), findsNothing);
      expect(key('checkout-total'), findsNothing);
      expect(containing('Thanh toán trực tiếp'), findsWidgets);
      await tap(tester, key('checkout-send'));
      expect(store.orderCount, 1);
      expect(key('order-sent'), findsOneWidget);
      expect(containing('Chờ quán xác nhận'), findsWidgets);
      expect(runtime.cart.isEmpty, isTrue);
      await unmount(tester);
    });

    testWidgets('"Dùng vị trí hiện tại": one explicit fix becomes the pin of the Order; a refusal leaves the Order without a pin and says so (never a made-up point)', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final FakeLocationProvider gps = FakeLocationProvider();
      final OrderRuntime runtime = OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)), location: gps);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000);
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      expect(gps.calls, 0, reason: 'nothing is read until the person presses the button');
      gps.failure = LocationFailure.denied;
      await tap(tester, key('checkout-address'));
      await tap(tester, key('location-current'));
      expect(gps.calls, 1);
      expect(containing('Chưa được cấp quyền'), findsOneWidget);
      gps.failure = null;
      await tap(tester, key('location-current'));
      expect(gps.calls, 2);
      expect(containing('Đã chọn vị trí'), findsOneWidget);
      await tap(tester, key('location-save'));
      await tap(tester, key('checkout-send'));
      expect(store.lastPin, (10.0123, 106.0456));
      await unmount(tester);
    });

    testWidgets('the map pin picker: pick a point, move it, and the Order is sent with the LAST point; no point is made up', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = OrderRuntime(
        customer: SampleCustomerOrders(store),
        shop: SampleShopOrders(store),
        cart: CartController(source: SampleCustomerOrders(store)),
        pinPicker: (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng}) => Column(children: <Widget>[
          Text(lat == null ? 'pin:none' : 'pin:$lat,$lng', key: const Key('picker-state')),
          TextButton(key: const Key('picker-a'), onPressed: () => onPick(22.66, 106.25), child: const Text('A')),
          TextButton(key: const Key('picker-b'), onPressed: () => onPick(22.67, 106.26), child: const Text('B')),
        ]),
      );
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán', itemId: pho.id, name: pho.name, priceVnd: 45000);
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      await tap(tester, key('checkout-address'));
      expect(find.text('pin:none'), findsOneWidget);
      await tap(tester, key('picker-a'));
      expect(find.text('pin:22.66,106.25'), findsOneWidget);
      await tap(tester, key('picker-b'));
      expect(find.text('pin:22.67,106.26'), findsOneWidget);
      await tap(tester, key('location-save'));
      expect(key('checkout-use-gps'), findsNothing);
      await tap(tester, key('checkout-send'));
      expect(store.lastPin, (22.67, 106.26));
      await unmount(tester);
    });

    testWidgets('a changed price is refused: nothing is created, the cart is refreshed and the person is told to check and send again', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      store.changePrice(pho.id, 50000);
      await tap(tester, key('checkout-send'));
      expect(store.orderCount, 0);
      expect(key('checkout-changed'), findsOneWidget);
      expect(runtime.cart.lines.first.priceVnd, 50000);
      await tap(tester, key('checkout-send'));
      expect(store.orderCount, 1);
      await unmount(tester);
    });

    testWidgets('a lost answer is neither "sent" nor "failed": the same reference finds the Order, and one tap of "Gửi lại" never makes a second', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      store.dropNextPlaceAnswer = true;
      await tap(tester, key('checkout-send'));
      expect(key('checkout-unknown'), findsOneWidget);
      expect(key('order-sent'), findsNothing);
      expect(store.orderCount, 1);
      await tap(tester, key('checkout-resend'));
      expect(store.orderCount, 1, reason: 'the retry carries the same client reference');
      expect(key('order-sent'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('after a lost answer "Kiểm tra kết quả" opens the Order that did arrive', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      store.dropNextPlaceAnswer = true;
      await tap(tester, key('checkout-send'));
      await tap(tester, key('checkout-lookup'));
      expect(store.orderCount, 1);
      expect(key('order-sent'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('a dish that is no longer sold is flagged in the cart and blocks continuing', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      store.removeDish(tea.id);
      await mount(tester, CartScreen(runtime: runtime));
      expect(key('cart-unavailable'), findsOneWidget);
      expect(tester.widget<N11Button>(key('cart-continue')).onPressed, isNull);
      await tap(tester, key('cart-remove-${tea.id}'));
      expect(key('cart-unavailable'), findsNothing);
      expect(tester.widget<N11Button>(key('cart-continue')).onPressed, isNotNull);
      await unmount(tester);
    });

    testWidgets('a wanted time is a scheduled order: the label "Đơn hẹn" and the time show on both sides', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final DateTime at = DateTime.now().add(const Duration(days: 1, hours: 2));
      final String id = store.seed(scheduledFor: at);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      expect(containing('Đơn hẹn'), findsWidgets);
      expect(key('order-wanted'), findsOneWidget);
      await unmount(tester);
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShopOrderList(runtime: runtime))));
      await tap(tester, key('shop-filter-scheduled'));
      expect(containing('Đơn hẹn'), findsWidgets);
      await unmount(tester);
    });
  });

  group('customer order', () {
    testWidgets('the customer cancels only while the shop has not confirmed; afterwards there is no cancel button', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String pending = store.seed();
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: pending));
      expect(containing('Hủy đơn'), findsWidgets);
      await tap(tester, find.widgetWithText(OutlinedButton, 'Hủy đơn'));
      await tap(tester, key('m07-confirm-yes'));
      expect(containing('Đã hủy'), findsWidgets);
      expect(find.widgetWithText(OutlinedButton, 'Hủy đơn'), findsNothing);
      expect(key('order-reorder'), findsOneWidget);
      await unmount(tester);

      final String running = store.seed(status: 'PREPARING');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: running));
      expect(find.widgetWithText(OutlinedButton, 'Hủy đơn'), findsNothing);
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('the shipper and the latest position (with its age) show while a Shipper holds the delivery; an ended order shows neither', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String live = store.seed(status: 'PREPARING', deliveryState: 'accepted');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: live));
      expect(containing('Shipper Minh Họa'), findsOneWidget);
      expect(containing('Shipper đang đến quán'), findsWidgets);
      expect(key('m07-location-card'), findsOneWidget);
      expect(key('m07-location-time'), findsOneWidget);
      await unmount(tester);

      final String done = store.seed(status: 'COMPLETED');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: done));
      expect(key('m07-location-card'), findsNothing);
      expect(containing('Hoàn thành'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('the map shows pickup, drop-off and the Shipper\'s latest position with its time while a Shipper holds the delivery; an ended order draws no live position', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final List<List<String>> drawn = <List<String>>[];
      final OrderRuntime runtime = OrderRuntime(
        customer: SampleCustomerOrders(store),
        shop: SampleShopOrders(store),
        cart: CartController(source: SampleCustomerOrders(store)),
        mapBuilder: (BuildContext context, List<M07MapPin> pins) {
          drawn.add(<String>[for (final M07MapPin p in pins) p.label]);
          return const SizedBox(key: Key('fake-map'));
        },
      );
      final String live = store.seed(status: 'PREPARING', deliveryState: 'accepted');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: live));
      expect(key('fake-map'), findsOneWidget);
      expect(drawn.last, containsAll(<String>['shipper', 'Điểm giao']));
      expect(key('m07-location-time'), findsOneWidget);
      await unmount(tester);
      drawn.clear();
      final String searching = store.seed(status: 'PREPARING', deliveryState: 'waiting_driver');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: searching));
      expect(drawn.last, isNot(contains('shipper')), reason: 'nobody holds the delivery yet: no live position');
      await unmount(tester);
      drawn.clear();
      final String done = store.seed(status: 'COMPLETED', deliveryState: 'completed');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: done));
      expect(drawn.every((List<String> labels) => !labels.contains('shipper')), isTrue, reason: 'an ended order stops tracking');
      expect(key('m07-location-card'), findsNothing);
      expect(containing('không còn theo dõi vị trí'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('a call again makes a NEW delivery: the screen follows the current one (the earlier one keeps its history, the Shipper pin is gone until the new Shipper holds it)', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String stopped = store.seed(status: 'PREPARING', deliveryState: 'search_stopped');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: stopped));
      expect(containing('Chưa tìm được shipper — quán đang xử lý'), findsWidgets);
      await unmount(tester);
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: stopped));
      await tap(tester, key('order-call'));
      await tap(tester, key('call-payer-customer'));
      await unmount(tester);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: stopped));
      expect(containing('Đang tìm shipper'), findsWidgets);
      expect(key('m07-location-card'), findsNothing);
      await unmount(tester);
    });

    testWidgets('a search that stopped and a failed delivery are said plainly; the order is not cancelled', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String stopped = store.seed(status: 'PREPARING', deliveryState: 'search_stopped');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: stopped));
      expect(containing('Chưa tìm được shipper — quán đang xử lý'), findsWidgets);
      await unmount(tester);
      final String failed = store.seed(status: 'PREPARING', deliveryState: 'failed');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: failed));
      expect(containing('Giao thất bại — đang xử lý'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('the list has "Đang xử lý", "Đơn hẹn" and "Lịch sử", and an order moves between them', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String a = store.seed();
      store.seed(scheduledFor: DateTime.now().add(const Duration(days: 1)));
      store.seed(status: 'COMPLETED');
      await mount(tester, Scaffold(body: SingleChildScrollView(child: CustomerOrdersView(runtime: runtime))));
      expect(key('order-card-$a'), findsOneWidget);
      expect(find.byType(OrderSummaryCard), findsOneWidget);
      await tap(tester, key('orders-tab-scheduled'));
      expect(find.byType(OrderSummaryCard), findsOneWidget);
      await tap(tester, key('orders-tab-history'));
      expect(find.byType(OrderSummaryCard), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('ordering again puts the dishes still on sale into the cart at today\'s price and names the ones skipped', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'COMPLETED');
      store.changePrice(pho.id, 50000);
      store.removeDish(tea.id);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      await tap(tester, key('order-reorder'));
      expect(runtime.cart.lines.single.priceVnd, 50000);
      expect(runtime.cart.lines.single.quantity, 2);
      expect(containing('Món không còn bán'), findsWidgets);
      await unmount(tester);
    });
  });

  group('shop', () {
    testWidgets('an edited order cannot be confirmed without a reason; the customer\'s original stays visible', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed();
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-edit-note'), findsOneWidget);
      await tap(tester, key('order-edit'));
      await tap(tester, key('edit-minus-line-1-0'));
      await tap(tester, key('edit-save'));
      expect(containing('Ban đầu 2×'), findsOneWidget);
      await tap(tester, key('order-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      await tap(tester, key('m07-reason-back'));
      expect(containing('Xác nhận đơn đã chỉnh'), findsOneWidget);
      await tap(tester, key('order-confirm'));
      await tester.enterText(key('m07-reason-field'), 'Hết bún, khách đồng ý bớt');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      expect(containing('Hết bún, khách đồng ý bớt'), findsWidgets);
      expect(key('order-edit'), findsNothing);
      await unmount(tester);
    });

    testWidgets('refusing needs a reason and the customer reads it', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed();
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      await tap(tester, find.widgetWithText(OutlinedButton, 'Từ chối đơn'));
      expect(tester.widget<TextButton>(key('m07-reason-confirm')).onPressed, isNull);
      await tester.enterText(key('m07-reason-field'), 'Hết món');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(containing('Quán từ chối'), findsWidgets);
      await unmount(tester);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-end-reason'), findsOneWidget);
      expect(containing('Hết món'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('"Món đã sẵn sàng" and "Gọi shipper" are two buttons that need neither the other; both exist while preparing', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING');
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-ready'), findsOneWidget);
      expect(key('order-call'), findsOneWidget);
      // Call first, not ready: allowed.
      await tap(tester, key('order-call'));
      await tap(tester, key('call-payer-customer'));
      expect(containing('Đang tìm shipper'), findsWidgets);
      // Ready afterwards: still offered, and it does not touch the delivery.
      await tap(tester, key('order-ready'));
      expect(key('order-ready'), findsNothing);
      expect(containing('Đang tìm shipper'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('a stopped search keeps the order, says so, and offers to call again or to cancel the dish order', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING', deliveryState: 'search_stopped');
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-search-stopped'), findsOneWidget);
      expect(find.widgetWithText(N11Button, 'Gọi lại shipper'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Hủy đơn món'), findsOneWidget);
      await tap(tester, find.widgetWithText(OutlinedButton, 'Hủy đơn món'));
      expect(tester.widget<TextButton>(key('m07-reason-confirm')).onPressed, isNull);
      await tap(tester, key('m07-reason-back'));
      await unmount(tester);
    });

    testWidgets('the list separates the filters and the sample banner marks illustrative data', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String pending = store.seed();
      final String attention = store.seed(status: 'PREPARING', deliveryState: 'search_stopped');
      store.seed(status: 'COMPLETED');
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShopOrdersTab(runtime: runtime, deliveries: null))));
      expect(key('m10-sample-banner'), findsOneWidget);
      await tap(tester, key('shop-filter-pending'));
      expect(key('order-card-$pending'), findsOneWidget);
      expect(key('order-card-$attention'), findsNothing);
      await tap(tester, key('shop-filter-attention'));
      expect(key('order-card-$attention'), findsOneWidget);
      expect(containing('Cần xử lý'), findsWidgets);
      await tap(tester, key('shop-filter-history'));
      expect(find.byType(OrderSummaryCard), findsOneWidget);
      await unmount(tester);
    });
  });

  group('wire', () {
    test('the models read the server\'s JSON and keep an unknown fee unknown', () {
      final OrderView o = OrderView.fromJson(<String, Object?>{
        'order_id': '00000000-0000-4000-8000-000000000001',
        'code': 'DH-ABC234',
        'status': 'PREPARING',
        'display_status': 'SEARCH_STOPPED',
        'version': 4,
        'shop': <String, Object?>{'shop_id': 's', 'name': 'Quán', 'phone': '+84900000001', 'address_text': 'x'},
        'recipient': <String, Object?>{'name': 'An', 'phone': '+84912345678', 'address_text': 'y', 'lat': null, 'lng': null},
        'note': null,
        'scheduled_for': null,
        'items': <Object?>[],
        'money': <String, Object?>{
          'items_original_total_vnd': 100,
          'items_total_vnd': 100,
          'paid_vnd': 0,
          'items_remaining_vnd': 100,
          'fee': <String, Object?>{'payer': 'CUSTOMER', 'amount_vnd': null, 'estimate_vnd': null, 'status': 'UNKNOWN', 'distance_m': null},
          'expected_total_vnd': null,
        },
        'edited': false,
        'change_reason': null,
        'confirmed_at': '2026-10-18T09:00:00.000Z',
        'ready_at': null,
        'ended_at': null,
        'end_actor': null,
        'end_reason': null,
        'created_at': '2026-10-18T08:00:00.000Z',
        'server_now': '2026-10-18T09:30:00.000Z',
        'delivery': null,
        'can': <String, Object?>{'cancel': false, 'reorder': true},
      });
      expect(o.display, DisplayStatus.searchStopped);
      expect(o.money.fee.shownVnd, isNull);
      expect(o.money.expectedTotalVnd, isNull);
      expect(o.recipient.hasPin, isFalse);
      expect(o.allowed('reorder'), isTrue);
      expect(() => displayStatusOf('NOPE'), throwsFormatException);
    });

    test('every status has the words of the approved table', () {
      expect(DisplayStatus.awaitingShop.label, 'Chờ quán xác nhận');
      expect(DisplayStatus.preparing.label, 'Quán đang chuẩn bị');
      expect(DisplayStatus.searchingShipper.label, 'Đang tìm shipper');
      expect(DisplayStatus.shipperComing.label, 'Shipper đang đến quán');
      expect(DisplayStatus.ready.label, 'Món đã sẵn sàng — chờ lấy');
      expect(DisplayStatus.delivering.label, 'Đang giao');
      expect(DisplayStatus.completed.label, 'Hoàn thành');
      expect(DisplayStatus.searchStopped.label, 'Chưa tìm được shipper — quán đang xử lý');
      expect(DisplayStatus.deliveryFailed.label, 'Giao thất bại — đang xử lý');
      expect(DisplayStatus.cancelledByShop.label, 'Đã hủy');
      expect(DisplayStatus.rejected.label, 'Quán từ chối');
    });
  });
}

/// A customer source whose cart writes can be made to fail like a lost connection.
class _Offline extends SampleCustomerOrders {
  _Offline(super.store);

  bool offline = false;

  @override
  Future<CartView?> saveCart({required String shopId, required List<DraftLine> lines, String? note}) {
    if (offline) {
      throw const M07Failure(M07FailureKind.offline);
    }
    return super.saveCart(shopId: shopId, lines: lines, note: note);
  }
}
