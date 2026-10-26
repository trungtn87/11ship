import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'm02_shop_views_test.dart' show harness, show;
import 'm02_menu_views_test.dart' show textOf;

class ClockShopApi implements PublicShopApi {
  String reason = 'ONLINE';
  int calls = 0;
  bool offline = false;
  @override
  Future<ShopMenuView> load(String id) async {
    calls++;
    if (offline) throw const AuthFailure(AuthFailureKind.serverUnavailable);
    return ShopMenuView(name: 'Ốc 11', address: 'Cao Bằng', availabilityReason: reason,
      serverNow: DateTime.utc(2026, 10, 25, 14, 59, 59), hours: emptyWeek(),
      nextRefreshMs: 1000, categories: const <PublicCategory>[]);
  }
}

class LateCartSource extends SampleCustomerOrders {
  LateCartSource() : super(SampleOrderStore());
  final Completer<CartView?> pending = Completer<CartView?>();
  @override
  Future<CartView?> cart() => pending.future;
}

void main() {
  testWidgets('#204: open screen crosses close/open boundary and offline data stops advertising ONLINE', (tester) async {
    final api = ClockShopApi();
    await tester.pumpWidget(MaterialApp(home: ShopPublicScreen(api: api, shopId: 's1')));
    await tester.pump();
    expect(find.text('Đang mở cửa'), findsOneWidget);
    api.reason = 'OUTSIDE_BUSINESS_HOURS';
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('Đã đóng cửa'), findsOneWidget);
    api.reason = 'ONLINE';
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('Đang mở cửa'), findsOneWidget);
    api.offline = true;
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('Đang mở cửa'), findsNothing);
    expect(find.text('Chưa cập nhật'), findsWidgets);
    api.offline = false;
    await tester.pump(const Duration(seconds: 30));
    await tester.pump();
    expect(find.text('Đang mở cửa'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('#204: foreground resume reloads once; dispose cancels the server alarm', (tester) async {
    final api = ClockShopApi();
    final controller = PublicShopController(api: api, shopId: 's1');
    await controller.load();
    controller.freshness.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(controller.stale, isTrue);
    await tester.pump(const Duration(seconds: 10));
    expect(api.calls, 1);
    api.reason = 'OUTSIDE_BUSINESS_HOURS';
    controller.freshness.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await tester.pump();
    expect(api.calls, 2);
    expect(controller.view!.availabilityReason, 'OUTSIDE_BUSINESS_HOURS');
    controller.dispose();
    await tester.pump(const Duration(seconds: 10));
    expect(api.calls, 2);
  });

  testWidgets('#204: an old refresh cannot overwrite a newer adopted cart', (tester) async {
    final source = LateCartSource();
    final cart = CartController(source: source);
    final read = cart.load();
    cart.adopt(const CartView(shopId: 'new', shopName: 'Giỏ mới', online: true, lines: <CartLine>[], note: null, itemsVnd: 0));
    source.pending.complete(null);
    await read;
    expect(cart.shopId, 'new');
    expect(cart.shopName, 'Giỏ mới');
    cart.dispose();
  });

  testWidgets('#207: small-screen text expands, preserves lines and hides the empty description', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final text = List<String>.filled(12, '1 đĩa 500g; hấp sả, không cay.').join('\n');
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: ExpandableDishDescription(text: text)))));
    expect(tester.widget<Text>(find.byKey(const Key('dish-description-text'))).maxLines, 3);
    await tester.tap(find.text('Xem thêm'));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const Key('dish-description-text'))).maxLines, isNull);
    expect(find.text('Thu gọn'), findsOneWidget);
    await tester.tap(find.text('Thu gọn'));
    await tester.pump();
    expect(find.text('Xem thêm'), findsOneWidget);
    await tester.pumpWidget(const MaterialApp(home: ExpandableDishDescription(text: '')));
    expect(find.byKey(const Key('dish-description-text')), findsNothing);
  });

  testWidgets('#207: Unicode 300/301 input, rebuild, save/edit/clear description', (tester) async {
    final h = await harness(tester);
    await h.flows.ops.load();
    await h.flows.menu.load();
    h.flows.menu.startNew();
    h.flows.menu.setName('Ốc hấp');
    h.flows.menu.setPrice('10000');
    h.flows.menu.setCategory('c1');
    final text = '👨‍👩‍👦' * 300;
    h.flows.menu.setDescription(text);
    expect(h.flows.menu.validate(h.flows.menu.form!), isEmpty);
    h.flows.menu.setDescription('${text}x');
    expect(h.flows.menu.validate(h.flows.menu.form!)['description'], isNotNull);
    h.flows.menu.setDescription('1 đĩa 500g\nÍt cay');
    expect(await h.flows.menu.save(), isTrue);
    final item = h.flows.menu.snapshot!.items.last;
    h.flows.menu.startEdit(item.id);
    await show(tester, DishFormScreen(flows: h.flows));
    expect(textOf(tester, 'dish-description'), '1 đĩa 500g\nÍt cay');
    h.flows.menu.setCategory('c2');
    await tester.pump();
    expect(textOf(tester, 'dish-description'), '1 đĩa 500g\nÍt cay');
    await tester.enterText(find.byKey(const Key('dish-description')), '');
    expect(await h.flows.menu.save(), isTrue);
    h.flows.menu.startEdit(item.id);
    expect(h.flows.menu.form!.description, '');
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
