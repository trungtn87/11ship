import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// PNG renders of "one page per order": the two lists (Đơn món / Giao hàng), the unified order page and its Diễn biến. Skipped unless N11_SCREENSHOTS names an
// output directory:  N11_SCREENSHOTS=/tmp/shots flutter test test/one_page_order_screenshots_test.dart
// Widget renders on fixtures (the story lines are the ones the server writes); nothing here talks to a server and none of it is device acceptance.

Map<String, Object?> _delivery({required String state, bool incident = false, Map<String, Object?>? result}) => <String, Object?>{
      'delivery_id': 'd2',
      'code': 'G-2',
      'display_code': 'K101-0007',
      'source': 'ORDER',
      'order_id': 'o1',
      'previous_delivery_id': null,
      'state': state,
      'version': 4,
      'pickup': <String, Object?>{'shop_name': 'Quán Phở Minh họa', 'phone': '+84900000001', 'address_text': '5 Phố Cổ', 'lat': 21.0, 'lng': 105.8},
      'recipient': <String, Object?>{'name': 'Nguyễn Văn An', 'phone': '+84912345678', 'address_text': '12 Phố Huế, Hai Bà Trưng', 'lat': 21.0, 'lng': 105.82},
      'goods': <String, Object?>{'description': '2× Phở bò, 1× Trà đá', 'value_vnd': 95000, 'paid_vnd': 0},
      'fee': <String, Object?>{'mode': 'STANDARD', 'payer': 'CUSTOMER', 'amount_vnd': 10000, 'status': 'FINAL', 'distance_m': 2500, 'agreement': null},
      'search': <String, Object?>{'started_at': '2026-10-20T11:00:00Z', 'expires_at': '2026-10-20T11:30:00Z', 'server_now': '2026-10-20T11:05:00Z', 'stopped_at': null},
      'note': null,
      'assignment': state == 'failed' || state == 'accepted' || state == 'cancelled_by_system'
          ? <String, Object?>{'assignment_id': 'a1', 'shipper': <String, Object?>{'name': 'Trần Minh Shipper', 'phone': '+84911111111', 'plate_number': '59X1-123.45'}, 'accepted_at': '2026-10-20T11:01:00Z', 'picked_up_at': null, 'destination_confirmed': true}
          : null,
      'location': null,
      'result': result,
      'incident': incident ? <String, Object?>{'incident_id': 'i1', 'status': 'OPEN', 'custody': 'SHIPPER', 'reason': 'Gọi ba lần không được', 'opened_at': '2026-10-20T11:20:00Z'} : null,
      'can': <String, Object?>{if (incident) 'resolve_custody': true},
    };

Map<String, Object?> _order({required Map<String, Object?> delivery, required String display, required List<(String, String)> story, Map<String, bool> can = const <String, bool>{}, int calls = 1}) => <String, Object?>{
      'order_id': 'o1',
      'code': 'K101-0007',
      'display_code': 'K101-0007',
      'status': 'PREPARING',
      'display_status': display,
      'version': 6,
      'shop': <String, Object?>{'shop_id': 's1', 'name': 'Quán Phở Minh họa', 'phone': '+84900000001', 'address_text': '5 Phố Cổ'},
      'recipient': <String, Object?>{'name': 'Nguyễn Văn An', 'phone': '+84912345678', 'address_text': '12 Phố Huế, Hai Bà Trưng', 'lat': 21.0, 'lng': 105.82},
      'note': null,
      'scheduled_for': null,
      'items': <Object?>[
        <String, Object?>{'line_id': 'l1', 'menu_item_id': 'm1', 'name': 'Phở bò', 'note': null, 'quantity': 2, 'unit_price_vnd': 45000, 'line_total_vnd': 90000, 'removed': false, 'original': null},
        <String, Object?>{'line_id': 'l2', 'menu_item_id': 'm2', 'name': 'Trà đá', 'note': null, 'quantity': 1, 'unit_price_vnd': 5000, 'line_total_vnd': 5000, 'removed': false, 'original': null},
      ],
      'money': <String, Object?>{
        'items_original_total_vnd': 95000,
        'items_total_vnd': 95000,
        'paid_vnd': 0,
        'items_remaining_vnd': 95000,
        'fee': <String, Object?>{'payer': 'CUSTOMER', 'amount_vnd': 10000, 'estimate_vnd': null, 'status': 'FINAL', 'distance_m': 2500},
        'expected_total_vnd': 105000,
      },
      'edited': false,
      'change_reason': null,
      'confirmed_at': '2026-10-20T10:58:00Z',
      'ready_at': null,
      'ended_at': null,
      'end_actor': null,
      'end_reason': null,
      'created_at': '2026-10-20T10:55:00Z',
      'updated_at': '2026-10-20T11:20:00Z',
      'server_now': '2026-10-20T11:25:00Z',
      'delivery': delivery,
      'deliveries': <Object?>[
        for (int i = 0; i < calls; i++) <String, Object?>{'delivery_id': 'd$i', 'code': 'G-$i', 'display_code': 'K101-0007', 'state': delivery['state'], 'previous_delivery_id': null, 'created_at': '2026-10-20T11:00:00Z', 'ended_at': null, 'end_reason': null},
      ],
      'schedule_conflict': false,
      'can': can,
      'timeline': <Object?>[],
      'story': <Object?>[for (final (String, String) s in story) <String, Object?>{'at': s.$1, 'text': s.$2}],
    };

class _Orders extends SampleShopOrders {
  _Orders(super.store, this.json);

  final Map<String, Object?> json;

  @override
  Future<OrderView> get(String id) async => id == 'o1' ? OrderView.fromJson(json) : super.get(id);
}

class _Deliveries extends SampleShopSource {
  _Deliveries(this.json);

  final Map<String, Object?> json;

  @override
  Future<DeliveryView> get(String id) async => id == 'd2' ? DeliveryView.fromJson(json) : super.get(id);
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
  });

  final GlobalKey boundary = GlobalKey();

  Future<void> shot(WidgetTester tester, String name) async {
    final RenderRepaintBoundary object = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => object.toImage(pixelRatio: 2)))!;
    final ByteData? data = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out!).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  Future<void> pumpScreen(WidgetTester tester, Widget widget, {double width = 390, double height = 800}) async {
    tester.view.physicalSize = Size(width * 2, height * 2);
    tester.view.devicePixelRatio = 2;
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(RepaintBoundary(key: boundary, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildN11Theme(), home: widget)));
    for (int i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
  }

  testWidgets('one page per order screenshots', skip: out == null, (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    final SampleOrderStore store = SampleOrderStore();
    store.seed(status: 'PENDING_CONFIRMATION');
    store.seed(status: 'PREPARING', deliveryState: 'waiting_driver', name: 'Trần Thị Bình');
    store.seed(status: 'PREPARING', deliveryState: 'accepted', name: 'Lê Văn Cường');
    final SampleShopSource direct = SampleShopSource();
    OrderRuntime runtimeOf(ShopOrderSource shop) => OrderRuntime(customer: SampleCustomerOrders(store), shop: shop, cart: CartController(source: SampleCustomerOrders(store)));

    // 1-2. The two lists of "Đơn hàng": orders on one side, direct calls on the other.
    final Widget tab = Scaffold(appBar: AppBar(title: const Text('Đơn hàng')), body: SingleChildScrollView(padding: const EdgeInsets.all(16), child: ShopOrdersTab(runtime: runtimeOf(SampleShopOrders(store)), deliveries: direct)));
    await pumpScreen(tester, tab, height: 900);
    await shot(tester, '01-don-mon');
    await tester.tap(find.byKey(const Key('orders-part-deliveries')));
    for (int i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
    await shot(tester, '02-giao-hang');

    // 3. A call that failed: the order page holds the goods handling and tells the story once.
    final Map<String, Object?> failed = _delivery(state: 'failed', incident: true, result: <String, Object?>{'outcome': 'failed', 'at': '2026-10-20T11:20:00Z', 'reason': 'Không liên lạc được người nhận: Gọi ba lần không được', 'goods_condition': 'WITH_SHIPPER'});
    final Map<String, Object?> failedOrder = _order(
      delivery: failed,
      display: 'DELIVERY_FAILED',
      calls: 2,
      story: <(String, String)>[
        ('2026-10-20T10:55:00Z', 'Đã đặt đơn'),
        ('2026-10-20T10:58:00Z', 'Quán đã xác nhận'),
        ('2026-10-20T11:00:00Z', 'Đang tìm shipper'),
        ('2026-10-20T11:01:00Z', 'Shipper đã nhận đơn'),
        ('2026-10-20T11:06:00Z', 'Shipper đã lấy hàng'),
        ('2026-10-20T11:20:00Z', 'Giao không thành công — Không liên lạc được người nhận: Gọi ba lần không được'),
      ],
    );
    await pumpScreen(tester, ShopOrderDetailScreen(runtime: runtimeOf(_Orders(store, failedOrder)), orderId: 'o1', deliveries: _Deliveries(failed)), height: 2400);
    await shot(tester, '03-chi-tiet-don-giao-that-bai');

    // 4. The late-pickup order of the Owner's example: the call is cancelled, the order is not.
    final Map<String, Object?> late = _delivery(state: 'cancelled_by_system', result: <String, Object?>{'outcome': 'search_stopped', 'at': '2026-10-20T12:25:00Z', 'reason': 'Shipper chưa lấy hàng quá thời gian quy định', 'goods_condition': null});
    final Map<String, Object?> lateOrder = _order(
      delivery: late,
      display: 'PREPARING',
      can: <String, bool>{'call_shipper': true, 'cancel': true},
      story: <(String, String)>[
        ('2026-10-20T10:55:00Z', 'Đã đặt đơn'),
        ('2026-10-20T10:58:00Z', 'Quán đã xác nhận'),
        ('2026-10-20T11:24:00Z', 'Đang tìm shipper'),
        ('2026-10-20T11:25:00Z', 'Shipper đã nhận đơn'),
        ('2026-10-20T12:25:00Z', 'Đã hủy yêu cầu giao vì shipper chưa lấy hàng quá thời gian quy định'),
      ],
    );
    await pumpScreen(tester, ShopOrderDetailScreen(runtime: runtimeOf(_Orders(store, lateOrder)), orderId: 'o1', deliveries: _Deliveries(late)), height: 2100);
    await shot(tester, '04-chi-tiet-don-huy-yeu-cau-giao');
  });
}
