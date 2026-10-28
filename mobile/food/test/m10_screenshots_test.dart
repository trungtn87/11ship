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
    Future<void> screen(Widget widget, String name, {double width = 390, double height = 800}) async {
      tester.view.physicalSize = Size(width * 2, height * 2);
      tester.view.devicePixelRatio = 2;
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(RepaintBoundary(key: boundary, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildN11Theme(), home: widget)));
      for (int i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 30));
      }
      await shot(tester, name);
    }

    addTearDown(tester.view.reset);
    final SampleOrderStore store = SampleOrderStore();
    final OrderRuntime runtime = runtimeOf(store);
    final SampleDish pho = kSampleDishes[0];
    final SampleDish tea = kSampleDishes[2];
    await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: pho.id, name: pho.name, priceVnd: 45000, by: 2);
    await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: tea.id, name: tea.name, priceVnd: 5000, note: 'Ít đá');
    await screen(CartScreen(runtime: runtime), 'k01-cart');
    await screen(CheckoutScreen(runtime: runtime), 'k02-checkout');

    final String pending = store.seed();
    final String preparing = store.seed(status: 'PREPARING');
    final String shipping = store.seed(status: 'PREPARING', deliveryState: 'accepted');
    final String scheduled = store.seed(scheduledFor: DateTime.now().add(const Duration(days: 1, hours: 2)));
    final String done = store.seed(status: 'COMPLETED');
    final String failed = store.seed(status: 'PREPARING', deliveryState: 'failed');
    await screen(Scaffold(appBar: AppBar(title: const Text('Đơn hàng')), body: SingleChildScrollView(child: CustomerOrdersView(runtime: runtime))), 'k03-customer-orders');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: pending), 'k04-customer-pending');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: shipping), 'k05-customer-shipper-coming');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: scheduled), 'k06-customer-scheduled');
    await screen(CustomerOrderDetailScreen(runtime: runtime, orderId: done), 'k07-customer-completed');

    await screen(Scaffold(appBar: AppBar(title: const Text('Đơn hàng')), body: SingleChildScrollView(child: ShopOrderList(runtime: runtime))), 'q10-shop-orders');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: pending), 'q11-shop-pending');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: preparing), 'q12-shop-preparing');
    await screen(ShopOrderDetailScreen(runtime: runtime, orderId: failed), 'q13-shop-delivery-failed');
  });
}
