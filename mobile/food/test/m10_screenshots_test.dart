import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// PNG screenshots of the M10 screens (cart, checkout, customer orders and detail, shop orders and detail) built from the app's own widgets on the sample
// store. Skipped unless N11_SCREENSHOTS names an output directory:  N11_SCREENSHOTS=/tmp/m10-shots flutter test test/m10_screenshots_test.dart
// The dishes and names in the shots are fixtures of the sample store; nothing here talks to a server, and these are widget renders, not device acceptance.

OrderRuntime runtimeOf(SampleOrderStore store) => OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)));

class _AddressApi implements AddressApi {
  const _AddressApi(this.row);
  final DeliveryAddress row;
  @override Future<List<DeliveryAddress>> list() async => <DeliveryAddress>[row];
  @override Future<DeliveryAddress> create(AddressInput input, {required String key}) => throw UnsupportedError('read only');
  @override Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key}) => throw UnsupportedError('read only');
  @override Future<String?> delete(String id, {required String key}) => throw UnsupportedError('read only');
  @override Future<void> setDefault(String id, {required String key}) => throw UnsupportedError('read only');
  @override Future<void> setDefaultKind(String id, AddressDefaultKind kind, bool enabled, {required String key}) => throw UnsupportedError('read only');
}

class _HoldPreviewCustomer extends SampleCustomerOrders {
  _HoldPreviewCustomer(super.store);
  bool hold = false;
  @override Future<CheckoutPreview> preview(CheckoutDraft draft) => hold ? Completer<CheckoutPreview>().future : super.preview(draft);
}

class _ReviewedSource extends M11Source {
  @override
  Future<CustomerOrderReviewState> customerOrder(String orderId) async => CustomerOrderReviewState.fromJson(<String, Object?>{
        'order': <String, Object?>{'code': 'DH-230', 'completed': true},
        'shop': <String, Object?>{'name': 'Quán Phở Minh họa', 'can_review': false, 'review': <String, Object?>{'review_id': 'r-shop', 'stars': 5, 'comment': 'Món ngon', 'created_at': '2026-10-29T09:00:00Z'}},
        'shipper': <String, Object?>{'name': 'Shipper Minh Họa', 'shipper_code': 'SP-230', 'rating': null, 'can_review': false, 'review': <String, Object?>{'review_id': 'r-shipper', 'stars': 5, 'comment': 'Giao cẩn thận', 'created_at': '2026-10-29T09:10:00Z'}},
      });
  @override dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  final String? out = Platform.environment['N11_SCREENSHOTS'];

  setUpAll(() async {
    if (out == null) {
      return;
    }
    final FontLoader loader = FontLoader('packages/n11_shared/PlusJakartaSans');
    for (final String w in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      final Uint8List bytes = File('../packages/n11_shared/assets/fonts/PlusJakartaSans-$w.ttf').readAsBytesSync();
      loader.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  final GlobalKey boundary = GlobalKey();

  Future<void> shot(WidgetTester tester, String name) async {
    final RenderRepaintBoundary object = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => object.toImage(pixelRatio: 2)))!;
    final ByteData? data = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out!).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  testWidgets('M10 screenshots', skip: out == null, (WidgetTester tester) async {
    Future<void> screen(Widget widget, String name, {double width = 390, double height = 800, Key? focus}) async {
      tester.view.physicalSize = Size(width * 2, height * 2);
      tester.view.devicePixelRatio = 2;
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(RepaintBoundary(key: boundary, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildN11Theme(), home: widget)));
      for (int i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 30));
      }
      if (focus != null) {
        await tester.ensureVisible(find.byKey(focus));
        await tester.pump(const Duration(milliseconds: 100));
      }
      await shot(tester, name);
    }

    addTearDown(tester.view.reset);
    final SampleOrderStore store = SampleOrderStore();
    final _HoldPreviewCustomer customer = _HoldPreviewCustomer(store);
    final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer));
    final SampleDish pho = kSampleDishes[0];
    final SampleDish tea = kSampleDishes[2];
    await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: pho.id, name: pho.name, priceVnd: 45000, by: 10);
    await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: tea.id, name: tea.name, priceVnd: 5000, note: 'Ít đá');
    await screen(CartScreen(runtime: runtime), 'k01-cart');
    const DeliveryAddress pinned = DeliveryAddress(id: 'review-address', label: AddressLabel.home, recipientName: 'Nguyễn An', contactPhone: '+84912345678', addressText: '12 Phố Huế, Hà Nội', deliveryNote: null, latitude: 21, longitude: 105.82, isDeliveryDefault: true, version: 1);
    final AddressBookController addresses = AddressBookController(api: const _AddressApi(pinned));
    await addresses.load();
    addTearDown(addresses.dispose);
    await screen(CheckoutScreen(runtime: runtime, addresses: addresses), 'review-01-checkout-no-tip', focus: const Key('checkout-summary'));
    await tester.ensureVisible(find.byKey(const Key('checkout-tip-20000')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const Key('checkout-tip-20000')));
    for (int i = 0; i < 8; i++) { await tester.pump(const Duration(milliseconds: 30)); }
    await tester.ensureVisible(find.byKey(const Key('checkout-summary')));
    await tester.pump(const Duration(milliseconds: 100));
    await shot(tester, 'review-02-checkout-tip-20000-total-485000');
    customer.hold = true;
    await tester.ensureVisible(find.byKey(const Key('checkout-tip-10000')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const Key('checkout-tip-10000')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.ensureVisible(find.byKey(const Key('checkout-summary')));
    await tester.pump(const Duration(milliseconds: 100));
    await shot(tester, 'review-03-checkout-repricing-stale-total-disabled');

    final String pending = store.seed();
    final String preparing = store.seed(status: 'PREPARING');
    final String shipping = store.seed(status: 'PREPARING', deliveryState: 'accepted');
    final String scheduled = store.seed(scheduledFor: DateTime.now().add(const Duration(days: 1, hours: 2)));
    final String done = store.seed(status: 'COMPLETED', tipVnd: 20000, paidVnd: 50000);
    final String failed = store.seed(status: 'PREPARING', deliveryState: 'failed');
    await screen(Scaffold(appBar: AppBar(title: const Text('Đơn hàng')), body: SingleChildScrollView(child: CustomerOrdersView(runtime: runtime))), 'k03-customer-orders');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: pending), 'k04-customer-pending');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: shipping), 'k05-customer-shipper-coming');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: scheduled), 'k06-customer-scheduled');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: done), 'review-04-customer-order-money', focus: const Key('m10-money'));

    await screen(Scaffold(appBar: AppBar(title: const Text('Đơn hàng')), body: SingleChildScrollView(child: ShopOrderList(runtime: runtime))), 'q10-shop-orders');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: pending), 'q11-shop-pending');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: preparing), 'q12-shop-preparing');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: failed), 'q13-shop-delivery-failed');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: done), 'review-05-shop-order-money', focus: const Key('m10-money'));
    await screen(CustomerOrderRatingScreen(source: _ReviewedSource(), orderId: done, picker: const NoImagePicker()), 'review-06-rating-done');
  });
}
