import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// M10 phone screens on the sample store (one in-memory stand-in for the server, shared by both sides). What matters: the cart (one shop, same dish + same
// note joins, another shop asks first, kept by the server), the checkout without a pin ("Chưa xác định phí", never 0đ), a changed price or a dish that is
// gone is refused and the cart refreshed, a LOST answer is not reported as sent or failed and the same reference finds the Order (never two), the customer
// cancels before confirmation (and, with a reason, after pickup), the shop edits then must give a reason, there is no "ready" step, a failed delivery keeps the
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
  test('checkout confirmation sends the complete canonical quote', () {
    final CheckoutPreview preview = CheckoutPreview.fromJson(<String, Object?>{
      'ok': true, 'blockers': <Object?>[], 'lines': <Object?>[], 'items_total_vnd': 45000, 'expected_total_vnd': null,
      'fee': <String, Object?>{'status': 'UNAVAILABLE', 'distance_m': 12000, 'fee_vnd': null, 'reason': 'OUT_OF_PRICE_RANGE', 'policy_version': 7, 'snapshot': 'pickup>dropoff', 'quoted_at': '2026-10-27T00:00:00.000Z'},
    });
    expect(preview.expectedQuoteJson, <String, Object?>{'status': 'UNAVAILABLE', 'distance_m': 12000, 'fee_vnd': null, 'reason': 'OUT_OF_PRICE_RANGE', 'policy_version': 7, 'snapshot': 'pickup>dropoff'});
  });

  group('cart', () {
    testWidgets('cart quantity actions remain usable on a small phone with large text', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: pho.id, name: 'Phở bò tái phần đặc biệt', priceVnd: 45000);
      await mount(
          tester,
          Builder(
              builder: (BuildContext context) => MediaQuery(
                    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(2)),
                    child: CartScreen(runtime: runtime),
                  )));
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 800);
      await settle(tester);
      expect(tester.takeException(), isNull);
      await tap(tester, key('cart-plus-${pho.id}'));
      expect(runtime.cart.lines.single.quantity, 2);
      await tap(tester, key('cart-minus-${pho.id}'));
      expect(runtime.cart.lines.single.quantity, 1);
      await tap(tester, key('cart-remove-${pho.id}'));
      expect(key('cart-empty'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await unmount(tester);
    });

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
      expect(again.feeEstimateVnd, 10000);
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

    testWidgets('voluntary tip updates the proposed delivery fee and total without changing item money', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000, by: 10);
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: tea.id, name: tea.name, priceVnd: 5000);
      const DeliveryAddress pinned = DeliveryAddress(id: 'tip-address', label: AddressLabel.home, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: '12 Phố Huế', deliveryNote: null, latitude: 21, longitude: 105.82, isDeliveryDefault: true, version: 1);
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(const <DeliveryAddress>[pinned]));
      addTearDown(book.dispose);
      await book.load();
      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));
      expect(key('checkout-tip'), findsOneWidget);
      await tap(tester, key('checkout-tip-20000'));
      expect(find.text('Tiền món'), findsOneWidget);
      expect(find.text('455.000đ'), findsOneWidget);
      expect(find.text('Tiền cảm ơn'), findsOneWidget);
      expect(find.text('20.000đ'), findsWidgets);
      expect(find.text('Tổng phí giao đề xuất'), findsOneWidget);
      expect(find.text('30.000đ'), findsOneWidget);
      expect(find.text('485.000đ'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('tip invalidates stale totals, survives an unavailable address safely, and can be removed before a fresh quote', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _DeferredPreviews customer = _DeferredPreviews(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000);
      final List<DeliveryAddress> addresses = <DeliveryAddress>[
        const DeliveryAddress(id: 'pinned', label: AddressLabel.home, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: 'Có ghim', deliveryNote: null, latitude: 21, longitude: 105.82, isDeliveryDefault: true, version: 1),
        const DeliveryAddress(id: 'no-gps', label: AddressLabel.other, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: 'Không có GPS', deliveryNote: null, version: 1),
      ];
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(addresses));
      addTearDown(book.dispose);
      await book.load();
      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));

      customer.pending.single.complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'initial'));
      await settle(tester);
      expect(find.text('55.000đ'), findsWidgets);
      await tap(tester, key('checkout-tip-20000'));
      expect(key('checkout-repricing'), findsOneWidget);
      expect(find.text('55.000đ'), findsNothing, reason: 'the no-tip total becomes stale immediately');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-no-gps'));
      await tap(tester, key('picker-confirm'));
      customer.pending[1].complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'stale-tip', tip: 20000));
      await settle(tester);
      customer.pending[2].complete(const CheckoutPreview(ok: true, blockers: <String>[], lines: <PreviewLine>[], itemsVnd: 45000, feeEstimateVnd: null, feeDistanceM: null, expectedTotalVnd: null, tipVnd: 20000, feeStatus: 'UNAVAILABLE', feeReason: 'DROPOFF_PIN_MISSING', quoteSnapshot: 'no-gps'));
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Chưa xác định được phí giao'), findsOneWidget);
      expect(find.text('Tổng phí giao đề xuất'), findsNothing);
      expect(key('checkout-tip'), findsOneWidget);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      await tap(tester, key('checkout-tip-0'));
      customer.pending[3].complete(const CheckoutPreview(ok: true, blockers: <String>[], lines: <PreviewLine>[], itemsVnd: 45000, feeEstimateVnd: null, feeDistanceM: null, expectedTotalVnd: null, feeStatus: 'UNAVAILABLE', feeReason: 'DROPOFF_PIN_MISSING', quoteSnapshot: 'no-gps-no-tip'));
      await settle(tester);
      expect(find.text('Tiền cảm ơn'), findsNothing);
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-pinned'));
      await tap(tester, key('picker-confirm'));
      customer.pending[4].complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'recovered'));
      await settle(tester);
      expect(find.text('55.000đ'), findsWidgets);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);
      await unmount(tester);
    });

    testWidgets('custom tip input remains enabled and focused while typing 1, 5, 0, 0, 0 during pending preview, coalesces requests, ignores late quotes, and handles null fee on lost GPS safely', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _DeferredPreviews customer = _DeferredPreviews(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000);
      final List<DeliveryAddress> addresses = <DeliveryAddress>[
        const DeliveryAddress(id: 'pinned', label: AddressLabel.home, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: 'Có ghim', deliveryNote: null, latitude: 21, longitude: 105.82, isDeliveryDefault: true, version: 1),
        const DeliveryAddress(id: 'pinned-2', label: AddressLabel.office, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: 'Có ghim 2', deliveryNote: null, latitude: 21.05, longitude: 105.85, version: 1),
        const DeliveryAddress(id: 'no-gps', label: AddressLabel.other, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: 'Không có GPS', deliveryNote: null, version: 1),
      ];
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(addresses));
      addTearDown(book.dispose);
      await book.load();
      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));

      // 1. Initial preview completes (items: 45k, fee: 10k, total: 55k)
      customer.pending.single.complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'initial'));
      await settle(tester);
      expect(find.text('55.000đ'), findsWidgets);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);

      // Verify the custom tip field is enabled
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);

      // Start entering characters '1', '5', '0', '0', '0'
      // Each character is entered while preview hasn't returned
      await tester.enterText(key('checkout-tip-custom'), '1');
      await tester.pump();
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue, reason: 'Field must not be disabled when typing starts');
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, '1');
      expect(key('checkout-repricing'), findsOneWidget);
      expect(find.text('55.000đ'), findsNothing, reason: 'Old total is invalidated immediately');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull, reason: 'Send button is disabled during reprice');

      await tester.enterText(key('checkout-tip-custom'), '15');
      await tester.pump();
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, '15');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      await tester.enterText(key('checkout-tip-custom'), '150');
      await tester.pump();
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, '150');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      await tester.enterText(key('checkout-tip-custom'), '1500');
      await tester.pump();
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, '1500');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      await tester.enterText(key('checkout-tip-custom'), '15000');
      await tester.pump();
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, '15000');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      // Because typing occurred within 300ms debounce interval, no redundant preview was dispatched yet
      expect(customer.pending.length, 1, reason: 'Rapid typing coalesced without extra preview requests');

      // Now debounce interval expires (300ms)
      await tester.pump(const Duration(milliseconds: 300));
      expect(customer.pending.length, 2, reason: 'Preview dispatched after debounce completes');
      expect(customer.drafts.last.tipVnd, 15000);

      // While preview 2 is in-flight (held / pending):
      // Field remains enabled, Send remains disabled, no old or unconfirmed totals
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isTrue);
      expect(key('checkout-repricing'), findsOneWidget);
      expect(find.text('55.000đ'), findsNothing);
      expect(find.text('70.000đ'), findsNothing);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      // Complete preview 2 with valid quote for 15000 tip
      customer.pending[1].complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'tip-15000', tip: 15000));
      await settle(tester);

      // Total updates to 70.000đ (items 45k + fee 10k + tip 15k) and Send is now enabled
      expect(key('checkout-repricing'), findsNothing);
      expect(find.text('70.000đ'), findsWidgets);
      expect(find.text('25.000đ'), findsOneWidget, reason: 'Proposed fee: 10k base + 15k tip = 25k');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);

      // Test late API response: user changes tip to 20000 chip, then types 10000 custom tip while preview 3 is held
      await tap(tester, key('checkout-tip-20000'));
      expect(customer.pending.length, 3, reason: 'Chip tap sends immediate preview');
      expect(customer.drafts.last.tipVnd, 20000);

      // While preview 3 is held, user types 10000 in custom tip
      await tester.enterText(key('checkout-tip-custom'), '10000');
      await tester.pump(const Duration(milliseconds: 300));
      // In-flight preview 3 prevents starting preview 4 until preview 3 releases
      expect(customer.pending.length, 3, reason: 'Pending preview in-flight avoids duplicate wire calls');

      // Now preview 3 (late response for 20000) arrives late
      customer.pending[2].complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'stale-20000', tip: 20000));
      await settle(tester);

      // Preview 4 for 10000 was dispatched automatically upon discarding stale preview 3
      expect(customer.pending.length, 4, reason: 'Preview for 10000 dispatched after in-flight completes');
      expect(customer.drafts.last.tipVnd, 10000);
      expect(find.text('75.000đ'), findsNothing, reason: 'Late quote for 20k was safely discarded');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      // Preview 4 (fresh quote for 10000) arrives
      customer.pending[3].complete(pricedPreview(fee: 10000, distance: 2500, snapshot: 'fresh-10000', tip: 10000));
      await settle(tester);
      expect(find.text('65.000đ'), findsWidgets, reason: 'Total reflects latest fresh quote: 45k + 10k + 10k');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);

      // Test switching between two addresses that both have GPS but different delivery fees:
      // Address 1 had base fee = 10k. Switch to Address 2 which has base fee = 25k.
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-pinned-2'));
      await tap(tester, key('picker-confirm'));
      await settle(tester);
      await settle(tester);

      // Immediately upon picking Address 2: old total and quote are invalidated; old base fee is discarded
      expect(key('checkout-repricing'), findsOneWidget);
      expect(find.text('65.000đ'), findsNothing, reason: 'Old total is invalidated immediately on address change');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull);

      // Preview for Address 2 completes with base fee = 25000 (total = items 45k + fee 25k + tip 10k = 80k)
      customer.pending[4].complete(pricedPreview(fee: 25000, distance: 6000, snapshot: 'addr-2-fee-25k', tip: 10000));
      await settle(tester);
      await settle(tester);

      // Verify the new base fee 25.000đ is displayed, proposed fee is 35.000đ (25k + 10k), and total is 80.000đ
      expect(find.text('25.000đ'), findsOneWidget, reason: 'Phí giao dự tính reflects Address 2 base fee (25k)');
      expect(find.text('35.000đ'), findsOneWidget, reason: 'Proposed fee is 25k base + 10k tip = 35k (not 10k + 10k)');
      expect(find.text('80.000đ'), findsWidgets, reason: 'Total reflects Address 2 fee + tip: 45k + 25k + 10k');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);

      // Test lost GPS / null fee: user switches to address without pin
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-no-gps'));
      await tap(tester, key('picker-confirm'));
      await settle(tester);
      await settle(tester);

      // Preview for no-gps address completes with null fee
      customer.pending[5].complete(const CheckoutPreview(ok: true, blockers: <String>[], lines: <PreviewLine>[], itemsVnd: 45000, feeEstimateVnd: null, feeDistanceM: null, expectedTotalVnd: null, tipVnd: 10000, feeStatus: 'UNAVAILABLE', feeReason: 'DROPOFF_PIN_MISSING', quoteSnapshot: 'no-gps'));
      await settle(tester);
      await settle(tester);

      expect(tester.takeException(), isNull, reason: 'No null assertion crash');
      expect(find.text('Chưa xác định được phí giao'), findsOneWidget);
      expect(find.text('Tổng phí giao đề xuất'), findsNothing);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).enabled, isFalse, reason: 'Custom tip disabled when fee is null');
      expect(find.text('Chờ xác định phí giao; bạn vẫn có thể chọn Không tip.'), findsOneWidget);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNull, reason: 'Cannot submit order with tip when fee is null');

      // User safely removes tip via 'Không tip' chip
      await tap(tester, key('checkout-tip-0'));
      customer.pending[6].complete(const CheckoutPreview(ok: true, blockers: <String>[], lines: <PreviewLine>[], itemsVnd: 45000, feeEstimateVnd: null, feeDistanceM: null, expectedTotalVnd: null, feeStatus: 'UNAVAILABLE', feeReason: 'DROPOFF_PIN_MISSING', quoteSnapshot: 'no-gps-zero-tip'));
      await settle(tester);
      expect(find.text('Tiền cảm ơn'), findsNothing);
      expect(tester.widget<TextField>(key('checkout-tip-custom')).controller!.text, isEmpty);

      await unmount(tester);
    });

    testWidgets('choosing A then B replaces all recipient data; one-order edits do not change the address book', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _CapturedOrders customer = _CapturedOrders(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000);
      final DeliveryAddress a = const DeliveryAddress(id: 'a', label: AddressLabel.home, recipientName: 'Người A', contactPhone: '+84901111111', addressText: 'Địa chỉ A', deliveryNote: 'Cổng A', isDeliveryDefault: true, version: 1);
      final DeliveryAddress b = const DeliveryAddress(id: 'b', label: AddressLabel.office, recipientName: null, contactPhone: '+84902222222', addressText: 'Địa chỉ B', deliveryNote: 'Cổng B', version: 1);
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(<DeliveryAddress>[a, b]));
      addTearDown(book.dispose);
      await book.load();
      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));
      expect(tester.widget<TextField>(key('checkout-name')).controller!.text, 'Người A');
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-b'));
      await tap(tester, key('picker-confirm'));
      expect(tester.widget<TextField>(key('checkout-name')).controller!.text, isEmpty, reason: 'B has no name, so A must be cleared');
      expect(tester.widget<TextField>(key('checkout-phone')).controller!.text, '0902222222');
      expect(tester.widget<TextField>(key('checkout-delivery-note')).controller!.text, 'Cổng B');
      expect(find.text('Địa chỉ B'), findsWidgets);
      await tester.enterText(key('checkout-name'), 'Người nhận hộ');
      await tester.enterText(key('checkout-phone'), '0903333333');
      await tester.enterText(key('checkout-delivery-note'), 'Gọi số 3, cửa sau');
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      await tap(tester, key('checkout-send'));
      expect(customer.placed, isNotNull);
      expect(customer.placed?.recipientName, 'Người nhận hộ');
      expect(customer.placed?.recipientPhone, '0903333333');
      expect(customer.placed?.address.addressId, 'b');
      expect(customer.placed?.deliveryNote, 'Gọi số 3, cửa sau');
      expect(book.byId('b')?.recipientName, isNull);
      expect(book.byId('b')?.contactPhone, '+84902222222');
      expect(book.byId('b')?.deliveryNote, 'Cổng B');
      await unmount(tester);
    });

    testWidgets('a late preview failure for A is ignored and B receives a fresh canonical quote', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _DeferredPreviews customer = _DeferredPreviews(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Shop', itemId: pho.id, name: pho.name, priceVnd: 45000);
      final DeliveryAddress a = const DeliveryAddress(id: 'a', label: AddressLabel.home, recipientName: 'Receiver A', contactPhone: '+84901111111', addressText: 'Address A', deliveryNote: null, isDeliveryDefault: true, version: 1, latitude: 22.65, longitude: 106.25);
      final DeliveryAddress b = const DeliveryAddress(id: 'b', label: AddressLabel.office, recipientName: 'Receiver B', contactPhone: '+84902222222', addressText: 'Address B', deliveryNote: null, version: 1, latitude: 22.67, longitude: 106.27);
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(<DeliveryAddress>[a, b]));
      addTearDown(book.dispose);
      await book.load();

      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));
      expect(customer.drafts.map((CheckoutDraft d) => d.address.addressId), <String?>['a']);
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-b'));
      await tap(tester, key('picker-confirm'));
      expect(customer.drafts, hasLength(1), reason: 'B waits for the one in-flight preview instead of starting a duplicate request');

      customer.pending.single.completeError(const M07Failure(M07FailureKind.offline));
      await settle(tester);
      expect(customer.drafts.map((CheckoutDraft d) => d.address.addressId), <String?>['a', 'b']);
      customer.pending[1].complete(pricedPreview(fee: 12000, distance: 3600, snapshot: 'quote-b'));
      await settle(tester);

      expect(find.text('Address B'), findsWidgets);
      expect(containing('3,6 km'), findsOneWidget);
      expect(find.text(m10Money(12000)), findsOneWidget);
      expect(find.text(m10Money(57000)), findsWidgets);
      expect(key('checkout-failed'), findsNothing, reason: 'the timeout belongs to A, not B');
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);

      await tap(tester, key('checkout-send'));
      expect(customer.placed?.address.addressId, 'b');
      expect(customer.placed?.address.lat, 22.67);
      expect(customer.placed?.address.lng, 106.27);
      expect(customer.acceptedPreview?.quoteSnapshot, 'quote-b');
      await unmount(tester);
    });

    testWidgets('a late successful preview is ignored after several address changes and only the latest address is quoted', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _DeferredPreviews customer = _DeferredPreviews(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Shop', itemId: pho.id, name: pho.name, priceVnd: 45000);
      final List<DeliveryAddress> addresses = <DeliveryAddress>[
        const DeliveryAddress(id: 'a', label: AddressLabel.home, recipientName: 'Receiver A', contactPhone: '+84901111111', addressText: 'Address A', deliveryNote: null, isDeliveryDefault: true, version: 1, latitude: 22.65, longitude: 106.25),
        const DeliveryAddress(id: 'b', label: AddressLabel.office, recipientName: 'Receiver B', contactPhone: '+84902222222', addressText: 'Address B', deliveryNote: null, version: 1, latitude: 22.66, longitude: 106.26),
        const DeliveryAddress(id: 'c', label: AddressLabel.other, recipientName: 'Receiver C', contactPhone: '+84903333333', addressText: 'Address C', deliveryNote: null, version: 1, latitude: 22.68, longitude: 106.28),
      ];
      final AddressBookController book = AddressBookController(api: _StaticAddressApi(addresses));
      addTearDown(book.dispose);
      await book.load();

      await mount(tester, CheckoutScreen(runtime: runtime, addresses: book));
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-b'));
      await tap(tester, key('picker-confirm'));
      await tester.pump(const Duration(milliseconds: 500));
      await tap(tester, key('checkout-pick'));
      await tap(tester, key('picker-c'));
      await tap(tester, key('picker-confirm'));
      expect(customer.drafts, hasLength(1));

      customer.pending.single.complete(pricedPreview(fee: 99000, distance: 9900, snapshot: 'stale-a'));
      await settle(tester);
      expect(customer.drafts.map((CheckoutDraft d) => d.address.addressId), <String?>['a', 'c']);
      customer.pending[1].complete(pricedPreview(fee: 13000, distance: 4200, snapshot: 'quote-c'));
      await settle(tester);

      expect(find.text('Address C'), findsWidgets);
      expect(containing('4,2 km'), findsOneWidget);
      expect(find.text(m10Money(13000)), findsOneWidget);
      expect(find.text(m10Money(99000)), findsNothing);
      expect(key('checkout-failed'), findsNothing);
      expect(tester.widget<N11Button>(key('checkout-send')).onPressed, isNotNull);
      await unmount(tester);
    });

    testWidgets('invalid recipient phone blocks both preview and order placement, then correction sends once', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final _CountedPreviews customer = _CountedPreviews(store);
      final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
      await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở', itemId: pho.id, name: pho.name, priceVnd: 45000);
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      final int before = customer.previews;
      await tester.enterText(key('checkout-phone'), '0912 345678');
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      expect(customer.previews, before);
      await tap(tester, key('checkout-send'));
      expect(containing('không có dấu cách'), findsOneWidget);
      expect(store.orderCount, 0);
      await tester.enterText(key('checkout-phone'), '0912345678');
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      await tap(tester, key('checkout-send'));
      expect(store.orderCount, 1);
      await unmount(tester);
    });

    testWidgets('no pin: fee and total stay unknown and the checkout says they are not included', (WidgetTester tester) async {
      final (OrderRuntime runtime, SampleOrderStore store) = await readyCart();
      await mount(tester, CheckoutScreen(runtime: runtime));
      await fill(tester);
      expect(containing('Phí giao (dự tính)'), findsWidgets);
      expect(find.text(m10Money(10000)), findsNothing);
      expect(find.text(m10Money(0)), findsNothing);
      expect(key('checkout-total'), findsNothing);
      expect(containing('Chưa gồm phí giao'), findsOneWidget);
      expect(containing('chọn điểm giao trên bản đồ'), findsOneWidget);
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
      expect(containing('Đã lấy vị trí hiện tại'), findsOneWidget);
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
      await tap(tester, key('shop-orders-filter'));
      await tap(tester, key('order-filter-scheduled'));
      await tap(tester, key('order-filter-apply'));
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
      await tap(tester, key('order-cancel'));
      await tap(tester, key('m07-confirm-yes'));
      expect(containing('Đã hủy'), findsWidgets);
      expect(key('order-cancel'), findsNothing);
      expect(key('order-reorder'), findsOneWidget);
      await unmount(tester);

      final String running = store.seed(status: 'PREPARING');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: running));
      expect(key('order-cancel'), findsNothing);
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('the shipper and the latest position (with its age) show while a Shipper holds the delivery; an ended order shows neither', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String live = store.seed(status: 'PREPARING', deliveryState: 'accepted');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: live));
      expect(containing('Shipper Minh Họa'), findsWidgets);
      expect(containing('Shipper đang đến quán'), findsWidgets);
      // The map is closed by default (nothing heavy is built); the person opens it to see the position.
      expect(key('m07-location-card'), findsNothing);
      await tap(tester, key('section-map-header'));
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
      expect(key('fake-map'), findsNothing);
      expect(drawn, isEmpty);
      await tap(tester, key('section-map-header'));
      expect(key('fake-map'), findsOneWidget);
      expect(drawn.last, containsAll(<String>['shipper', 'Điểm giao']));
      expect(key('m07-location-time'), findsOneWidget);
      await unmount(tester);
      drawn.clear();
      final String searching = store.seed(status: 'PREPARING', deliveryState: 'waiting_driver');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: searching));
      await tap(tester, key('section-map-header'));
      expect(drawn.last, isNot(contains('shipper')), reason: 'nobody holds the delivery yet: no live position');
      await unmount(tester);
      drawn.clear();
      final String done = store.seed(status: 'COMPLETED', deliveryState: 'completed');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: done));
      await tap(tester, key('section-map-header'));
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
      expect(find.text('Sửa đơn'), findsOneWidget);
      final Rect editButton = tester.getRect(key('order-edit'));
      final Rect rejectButton = tester.getRect(key('order-reject'));
      expect(editButton.center.dy, closeTo(rejectButton.center.dy, 0.1));
      expect(editButton.right, lessThan(rejectButton.left));
      await tap(tester, key('order-edit'));
      await tap(tester, key('edit-minus-line-1-0'));
      await tap(tester, key('edit-save'));
      expect(containing('Ban đầu 2×'), findsOneWidget);
      await tap(tester, key('order-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      await tap(tester, key('m07-reason-back'));
      expect(containing('Xác nhận đơn đã sửa'), findsOneWidget);
      await tap(tester, key('order-confirm'));
      await tester.enterText(key('m07-reason-field'), 'Hết bún, khách đồng ý bớt');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      expect(containing('Hết bún, khách đồng ý bớt'), findsWidgets);
      expect(key('order-edit'), findsNothing);
      await unmount(tester);
    });

    testWidgets('a REQUIRED app update (#193): a waiting order cannot be confirmed but can be refused; an order already accepted is handled as before', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String waiting = store.seed();
      runtime.newWorkBlocked = () => true;
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: waiting));
      expect(key('order-confirm'), findsNothing, reason: 'starting new work is blocked');
      expect(key('order-confirm-blocked'), findsOneWidget);
      expect(containing('Cần cập nhật ứng dụng trước khi nhận đơn mới'), findsOneWidget);
      expect(key('order-reject'), findsOneWidget, reason: 'the shop can still turn the order down');
      await unmount(tester);
      // Once the app is updated (or when no update is required) the same order confirms normally, and then its next steps are never blocked.
      runtime.newWorkBlocked = () => false;
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: waiting));
      expect(key('order-confirm'), findsOneWidget);
      await tap(tester, key('order-confirm'));
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      runtime.newWorkBlocked = () => true;
      await unmount(tester);
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: waiting));
      expect(key('order-confirm-blocked'), findsNothing, reason: 'an accepted order is not "new work"');
      expect(containing('Quán đang chuẩn bị'), findsWidgets);
      expect(find.byType(N11Button), findsWidgets, reason: 'its own actions (call shipper, cancel...) stay');
      await unmount(tester);
    });

    testWidgets('refusing needs a reason and the customer reads it', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed();
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      await tap(tester, key('order-reject'));
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      expect(tester.widgetList<Text>(find.byType(Text)).any((Text text) => (text.data ?? '').startsWith('Nhập ')), isTrue);
      await tester.enterText(key('m07-reason-field'), 'Hết món');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(containing('Quán từ chối'), findsWidgets);
      await unmount(tester);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      expect(containing('Quán đã từ chối đơn — Hết món'), findsWidgets);
      expect(key('order-end-reason'), findsNothing);
      await unmount(tester);
    });

    testWidgets('there is no "Món đã sẵn sàng" step: "Gọi shipper" is the action after confirming and recorded item payment is shown read-only', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING');
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-ready'), findsNothing);
      expect(containing('Món đã sẵn sàng'), findsNothing);
      expect(key('order-payment'), findsNothing);
      expect(containing('Ghi nhận đã thanh toán'), findsNothing);
      expect(containing('Đã thanh toán tiền món'), findsOneWidget);
      expect(containing('Còn phải thanh toán tiền món'), findsOneWidget);
      expect(key('order-call'), findsOneWidget);
      await tap(tester, key('order-call'));
      expect(containing('sẵn sàng để shipper đến lấy'), findsOneWidget);
      await tap(tester, key('call-payer-customer'));
      expect(containing('Đang tìm shipper'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('a customer-raised fee is shown to the shop and can only be called with the customer as payer', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING', tipVnd: 20000);
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      await tap(tester, key('order-call'));
      expect(find.textContaining('tổng phí giao 30.000đ'), findsOneWidget);
      expect(key('call-payer-customer-proposed'), findsOneWidget);
      expect(key('call-payer-shop'), findsNothing);
      await tap(tester, key('call-payer-customer-proposed'));
      final OrderView called = await runtime.shop.get(id);
      expect(called.money.fee.payer, 'CUSTOMER');
      expect(called.money.fee.amountVnd, 30000);
      await unmount(tester);
    });

    testWidgets('when the table cannot price the order the shop is asked for a fee instead of getting a call no Shipper can take', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore()..feeNeedsProposal = true;
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING');
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      await tap(tester, key('order-call'));
      await tap(tester, key('call-payer-shop'));
      expect(key('fee-proposal-dialog'), findsOneWidget);
      expect(containing('chưa tính được phí giao tự động'), findsOneWidget);
      await tap(tester, key('fee-proposal-send'));
      expect(containing('Nhập phí là số nguyên'), findsOneWidget); // nothing is sent without an amount
      await tester.enterText(key('fee-proposal-amount').first, '22000');
      await settle(tester);
      await tap(tester, key('fee-proposal-send'));
      expect(store.lastProposal?.amountVnd, 22000);
      expect(store.lastProposal?.reasonCode, 'OUT_OF_PRICE_RANGE');
      expect(containing('Đang tìm shipper'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('the shop of a customer\'s order cannot cancel once the Shipper has the goods; the customer can, with a reason, and is warned', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING', deliveryState: 'delivering');
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(find.widgetWithText(OutlinedButton, 'Hủy đơn món'), findsNothing);
      expect(key('order-delivering-note'), findsOneWidget);
      expect(containing('chỉ khách mới hủy được'), findsWidgets);
      await unmount(tester);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      expect(key('order-cancel-after-pickup'), findsOneWidget);
      await tap(tester, key('order-cancel-after-pickup'));
      expect(containing('không tự hoàn tiền'), findsOneWidget);
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget); // a reason is required
      await tester.enterText(key('m07-reason-field').first, 'Tôi không cần nữa');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      final OrderView after = await runtime.customer.get(id);
      expect(after.display, DisplayStatus.cancelledByCustomer);
      expect(after.endReason, 'Tôi không cần nữa');
      expect(key('order-cancel-after-pickup'), findsNothing);
      await unmount(tester);
    });

    testWidgets('a fee the Shipper proposed is decided by the customer who pays: agree or refuse, and the order stays either way', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String refused = store.seed(status: 'PREPARING', deliveryState: 'waiting_driver', feeCounter: 16000);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: refused));
      expect(key('order-fee-decision'), findsOneWidget);
      expect(containing('Shipper muốn lấy phí giao 16.000đ'), findsOneWidget);
      expect(containing('Bạn là người trả phí nên bạn quyết định'), findsOneWidget);
      await tap(tester, key('fee-reject'));
      expect(key('order-fee-decision'), findsNothing);
      final OrderView after = await runtime.customer.get(refused);
      expect(after.status, 'PREPARING');
      expect(after.money.fee.amountVnd, 10000); // the earlier fee is kept
      await unmount(tester);
      final String accepted = store.seed(status: 'PREPARING', deliveryState: 'waiting_driver', feeCounter: 16000);
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: accepted));
      await tap(tester, key('fee-accept'));
      expect((await runtime.customer.get(accepted)).money.fee.amountVnd, 16000);
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
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      expect(tester.widgetList<Text>(find.byType(Text)).any((Text text) => (text.data ?? '').startsWith('Nhập ')), isTrue);
      await tap(tester, key('m07-reason-back'));
      await unmount(tester);
    });

    testWidgets('the compact filter menu separates states and the sample banner marks illustrative data', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String pending = store.seed();
      final String attention = store.seed(status: 'PREPARING', deliveryState: 'search_stopped');
      store.seed(status: 'COMPLETED');
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShopOrdersTab(runtime: runtime, deliveries: null))));
      expect(key('m10-sample-banner'), findsOneWidget);
      await tap(tester, key('shop-orders-filter'));
      await tap(tester, key('order-filter-pending'));
      await tap(tester, key('order-filter-apply'));
      expect(key('order-card-$pending'), findsOneWidget);
      expect(key('order-card-$attention'), findsNothing);
      await tap(tester, key('shop-orders-filter'));
      await tap(tester, key('order-filter-attention'));
      await tap(tester, key('order-filter-apply'));
      expect(key('order-card-$attention'), findsOneWidget);
      expect(containing('Cần xử lý'), findsWidgets);
      await tap(tester, key('shop-orders-filter'));
      await tap(tester, key('order-filter-history'));
      await tap(tester, key('order-filter-apply'));
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
      expect(displayStatusOf('READY'), DisplayStatus.preparing); // an older server's flag nobody sets any more
      expect(DisplayStatus.delivering.label, 'Đang giao');
      expect(DisplayStatus.completed.label, 'Hoàn thành');
      expect(DisplayStatus.searchStopped.label, 'Chưa tìm được shipper — quán đang xử lý');
      expect(DisplayStatus.deliveryFailed.label, 'Giao thất bại — đang xử lý');
      expect(DisplayStatus.cancelledByShop.label, 'Đã hủy');
      expect(DisplayStatus.rejected.label, 'Quán từ chối');
    });
  });

  testWidgets('order money distinguishes paid and remaining item money from the delivery fee', (WidgetTester tester) async {
    const OrderMoney money = OrderMoney(
      originalItemsVnd: 455000,
      itemsVnd: 455000,
      paidVnd: 200000,
      remainingVnd: 255000,
      fee: OrderFee(payer: 'CUSTOMER', amountVnd: 30000, estimateVnd: 30000, status: 'FINAL', distanceM: 2500),
      expectedTotalVnd: 485000,
    );
    await mount(tester, const Scaffold(body: OrderMoneyBody(money: money, edited: false)));
    expect(find.text('Đã thanh toán tiền món'), findsOneWidget);
    expect(find.text('200.000đ'), findsOneWidget);
    expect(find.text('Còn phải thanh toán tiền món'), findsOneWidget);
    expect(find.text('255.000đ'), findsOneWidget);
    expect(find.text('Tổng cộng'), findsOneWidget);
    await unmount(tester);
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

class _CountedPreviews extends SampleCustomerOrders {
  _CountedPreviews(super.store);
  int previews = 0;
  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) {
    previews++;
    return super.preview(draft);
  }
}

class _CapturedOrders extends SampleCustomerOrders {
  _CapturedOrders(super.store);
  CheckoutDraft? placed;
  CheckoutPreview? acceptedPreview;

  @override
  Future<OrderView> place(CheckoutDraft draft, {required CheckoutPreview preview, required String clientRef, required String key}) {
    placed = draft;
    acceptedPreview = preview;
    return super.place(draft, preview: preview, clientRef: clientRef, key: key);
  }
}

CheckoutPreview pricedPreview({required int fee, required int distance, required String snapshot, int tip = 0}) => CheckoutPreview(ok: true, blockers: const <String>[], lines: const <PreviewLine>[], itemsVnd: 45000, feeEstimateVnd: fee, feeDistanceM: distance, expectedTotalVnd: 45000 + fee + tip, tipVnd: tip, feeStatus: 'PRICED', quoteSnapshot: snapshot, policyVersion: 1);

class _DeferredPreviews extends _CapturedOrders {
  _DeferredPreviews(super.store);

  final List<CheckoutDraft> drafts = <CheckoutDraft>[];
  final List<Completer<CheckoutPreview>> pending = <Completer<CheckoutPreview>>[];

  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) {
    drafts.add(draft);
    final Completer<CheckoutPreview> request = Completer<CheckoutPreview>();
    pending.add(request);
    return request.future;
  }
}

class _StaticAddressApi implements AddressApi {
  const _StaticAddressApi(this.rows);
  final List<DeliveryAddress> rows;

  @override
  Future<List<DeliveryAddress>> list() async => rows;
  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key}) => throw UnsupportedError('read only');
  @override
  Future<String?> delete(String id, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<void> setDefault(String id, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<void> setDefaultKind(String id, AddressDefaultKind kind, bool enabled, {required String key}) => throw UnsupportedError('read only');
}
