import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// One page per food order in 11Food: the shop reads and acts on the delivery INSIDE the order (no second page), the story is in plain words (no event key,
// no internal code, no result repeated), and a direct delivery keeps its own page. The sources are fakes that record what the screens ask the server for.

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 9600);
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

final List<RegExp> _technical = <RegExp>[
  RegExp(r'delivery\.'),
  RegExp(r'order\.'),
  RegExp(r'pickup_reminder|search_reminder|pickup_timeout'),
  RegExp(r'[A-Z]{3,}_[A-Z_]{3,}'),
  RegExp(r'[0-9a-f]{8}-[0-9a-f]{4}-'),
];

List<String> texts(WidgetTester tester) => <String>[for (final Text t in tester.widgetList<Text>(find.byType(Text))) if (t.data != null) t.data!];

Map<String, Object?> deliveryJson({
  String id = 'd2',
  String state = 'failed',
  Set<String> can = const <String>{},
  Map<String, Object?>? agreement,
  bool incident = true,
  List<Map<String, Object?>> story = const <Map<String, Object?>>[],
}) =>
    <String, Object?>{
      'delivery_id': id,
      'code': 'G-$id',
      'display_code': 'K101-0007',
      'source': 'ORDER',
      'order_id': 'o1',
      'previous_delivery_id': 'd1',
      'state': state,
      'version': 4,
      'pickup': <String, Object?>{'shop_name': 'Quán', 'phone': '+84900000001', 'address_text': '5 Phố Cổ', 'lat': 21.0, 'lng': 105.8},
      'recipient': <String, Object?>{'name': 'Người nhận', 'phone': '+84912345678', 'address_text': '12 Phố Huế', 'lat': 21.0, 'lng': 105.82},
      'goods': <String, Object?>{'description': '1× Phở', 'value_vnd': 45000, 'paid_vnd': 0},
      'fee': <String, Object?>{'mode': 'STANDARD', 'payer': 'CUSTOMER', 'amount_vnd': 10000, 'status': 'FINAL', 'distance_m': 2500, 'agreement': agreement},
      'search': <String, Object?>{'started_at': '2026-10-20T11:00:00Z', 'expires_at': '2026-10-20T11:30:00Z', 'server_now': '2026-10-20T11:05:00Z', 'stopped_at': null},
      'note': null,
      'assignment': state == 'failed' || state == 'accepted'
          ? <String, Object?>{'assignment_id': 'a1', 'shipper': <String, Object?>{'name': 'Shipper Minh', 'phone': '+84911111111', 'plate_number': '59X1-123.45'}, 'accepted_at': '2026-10-20T11:01:00Z', 'picked_up_at': null, 'destination_confirmed': true}
          : null,
      'location': null,
      'result': state == 'failed' ? <String, Object?>{'outcome': 'failed', 'at': '2026-10-20T11:20:00Z', 'reason': 'Không liên lạc được người nhận', 'goods_condition': 'WITH_SHIPPER'} : null,
      'incident': incident && state == 'failed' ? <String, Object?>{'incident_id': 'i1', 'status': 'OPEN', 'custody': 'SHIPPER', 'reason': 'Gọi ba lần không được', 'opened_at': '2026-10-20T11:20:00Z'} : null,
      'can': <String, Object?>{for (final String c in can) c: true},
      'timeline': <Object?>[
        <String, Object?>{'at': '2026-10-20T11:00:00Z', 'type': 'delivery.created', 'actor': 'SHOP', 'note': null},
        <String, Object?>{'at': '2026-10-20T11:10:00Z', 'type': 'delivery.pickup_reminder', 'actor': 'SYSTEM', 'note': 'Nhắc shipper lấy hàng'},
      ],
      'story': story,
    };

Map<String, Object?> orderJson({required Map<String, Object?> delivery, List<Map<String, Object?>>? story, String display = 'DELIVERY_FAILED', String status = 'PREPARING', Map<String, bool> can = const <String, bool>{}, int calls = 2, String? endReason}) =>
    <String, Object?>{
      'order_id': 'o1',
      'code': 'K101-0007',
      'display_code': 'K101-0007',
      'status': status,
      'display_status': display,
      'version': 6,
      'shop': <String, Object?>{'shop_id': 's1', 'name': 'Quán Phở', 'phone': '+84900000001', 'address_text': '5 Phố Cổ'},
      'recipient': <String, Object?>{'name': 'Người nhận', 'phone': '+84912345678', 'address_text': '12 Phố Huế', 'lat': 21.0, 'lng': 105.82},
      'note': null,
      'scheduled_for': null,
      'items': <Object?>[
        <String, Object?>{'line_id': 'l1', 'menu_item_id': 'm1', 'name': 'Phở bò', 'note': null, 'quantity': 1, 'unit_price_vnd': 45000, 'line_total_vnd': 45000, 'removed': false, 'original': null},
      ],
      'money': <String, Object?>{
        'items_original_total_vnd': 45000,
        'items_total_vnd': 45000,
        'paid_vnd': 0,
        'items_remaining_vnd': 45000,
        'fee': <String, Object?>{'payer': 'CUSTOMER', 'amount_vnd': 10000, 'estimate_vnd': null, 'status': 'FINAL', 'distance_m': 2500},
        'expected_total_vnd': 55000,
      },
      'edited': false,
      'change_reason': null,
      'confirmed_at': '2026-10-20T10:58:00Z',
      'ready_at': null,
      'ended_at': status == 'PREPARING' ? null : '2026-10-20T12:00:00Z',
      'end_actor': null,
      'end_reason': endReason,
      'created_at': '2026-10-20T10:55:00Z',
      'updated_at': '2026-10-20T11:20:00Z',
      'server_now': '2026-10-20T11:25:00Z',
      'delivery': delivery,
      'deliveries': <Object?>[
        for (int i = 0; i < calls; i++) <String, Object?>{'delivery_id': 'd$i', 'code': 'G-$i', 'display_code': 'K101-0007', 'state': i == calls - 1 ? delivery['state'] : 'cancelled_by_merchant', 'previous_delivery_id': null, 'created_at': '2026-10-20T11:00:00Z', 'ended_at': null, 'end_reason': null},
      ],
      'schedule_conflict': false,
      'can': <String, Object?>{for (final MapEntry<String, bool> e in can.entries) e.key: e.value},
      'timeline': <Object?>[
        <String, Object?>{'at': '2026-10-20T10:55:00Z', 'type': 'order.placed', 'actor': 'CUSTOMER', 'note': null},
      ],
      'story': story ?? const <Map<String, Object?>>[],
    };

class _Orders extends ShopOrderSource {
  _Orders(this.json);

  Map<String, Object?> json;
  final List<String> calls = <String>[];

  @override
  bool get isSample => false;

  @override
  Future<OrderView> get(String id) async => OrderView.fromJson(json);

  @override
  Future<OrderView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async {
    calls.add('order-cancel:$reason');
    return OrderView.fromJson(json);
  }

  @override
  Future<OrderView> callShipper(String id, {required String feePayer, AgreedFeeProposal? agreedFee, required int expectedVersion, required String key}) async {
    calls.add('call:$feePayer');
    return OrderView.fromJson(json);
  }

  @override
  Future<OrderList> list({required String filter, String query = '', DateTime? from, DateTime? to}) => throw UnimplementedError();
  @override
  Future<OrderView> edit(String id, {required List<LineEdit> changes, required int expectedVersion, required String key}) => throw UnimplementedError();
  @override
  Future<OrderView> confirm(String id, {String? changeReason, required int expectedVersion, required String key}) => throw UnimplementedError();
  @override
  Future<OrderView> reject(String id, {required String reason, required int expectedVersion, required String key}) => throw UnimplementedError();
  @override
  Future<OrderView> closeNotCompleted(String id, {required String reason, required int expectedVersion, required String key}) => throw UnimplementedError();
  @override
  Future<void> resolveCustody(String deliveryId, {required String resolution, String? note, required String key}) => throw UnimplementedError();
}

class _Deliveries extends ShopDeliverySource {
  _Deliveries(this.json);

  Map<String, Object?> json;
  final List<String> calls = <String>[];

  @override
  bool get isSample => false;

  @override
  Future<DeliveryView> get(String id) async => DeliveryView.fromJson(json);

  @override
  Future<DeliveryView> resolveCustody(String id, {required String resolution, String? note, required String key}) async {
    calls.add('custody:$id:$resolution');
    return DeliveryView.fromJson(json);
  }

  @override
  Future<DeliveryView> answerCounter(String id, {required bool accept, required int expectedVersion, required String key}) async {
    calls.add('counter:$id:$accept');
    return DeliveryView.fromJson(json);
  }

  @override
  Future<DeliveryView> confirmCustomerFee(String id, {required int expectedVersion, required String key}) async {
    calls.add('customer-fee:$id');
    return DeliveryView.fromJson(json);
  }

  @override
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async {
    calls.add('cancel:$id:$reason');
    return DeliveryView.fromJson(json);
  }

  @override
  Future<List<DeliveryView>> list({required bool history, String query = ''}) async => <DeliveryView>[];
  @override
  Future<DeliveryView> create(NewDeliveryInput input, {required String key}) => throw UnimplementedError();
  @override
  Future<List<FeeBand>> feeBands() async => <FeeBand>[];
  @override
  Future<DeliveryView> recall(String id, {required String key}) => throw UnimplementedError();
}

OrderRuntime runtimeOf(ShopOrderSource shop) {
  final SampleOrderStore store = SampleOrderStore();
  return OrderRuntime(customer: SampleCustomerOrders(store), shop: shop, cart: CartController(source: SampleCustomerOrders(store)));
}

const List<Map<String, Object?>> _story = <Map<String, Object?>>[
  <String, Object?>{'at': '2026-10-20T10:55:00Z', 'text': 'Đã đặt đơn'},
  <String, Object?>{'at': '2026-10-20T10:58:00Z', 'text': 'Quán đã xác nhận'},
  <String, Object?>{'at': '2026-10-20T11:00:00Z', 'text': 'Đang tìm shipper'},
  <String, Object?>{'at': '2026-10-20T11:01:00Z', 'text': 'Shipper đã nhận đơn'},
  <String, Object?>{'at': '2026-10-20T11:20:00Z', 'text': 'Giao không thành công — Không liên lạc được người nhận: Gọi ba lần không được'},
];

void main() {
  group('shop order page holds the delivery', () {
    testWidgets('a failed call: goods handling is done on the order page, the story is plain, there is no second page and no repeated result', (WidgetTester tester) async {
      final _Deliveries deliveries = _Deliveries(deliveryJson(can: <String>{'resolve_custody'}));
      final _Orders orders = _Orders(orderJson(delivery: deliveryJson(can: <String>{'resolve_custody'}), story: _story));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(orders), orderId: 'o1', deliveries: deliveries));
      expect(key('order-delivery'), findsOneWidget);
      expect(key('order-open-delivery'), findsNothing);
      expect(key('m07-shipper-card'), findsOneWidget);
      expect(containing('Shipper Minh'), findsWidgets);
      expect(key('m07-incident'), findsOneWidget);
      expect(key('order-call-count'), findsOneWidget);
      expect(containing('Lần gọi shipper thứ 2'), findsOneWidget);
      for (final String line in <String>['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Shipper đã nhận đơn']) {
        expect(find.text(line), findsOneWidget);
      }
      // The result is told once, in the story; not again at the head of the card.
      expect(containing('Giao không thành công'), findsOneWidget);
      for (final String line in texts(tester)) {
        for (final RegExp bad in _technical) {
          expect(bad.hasMatch(line), isFalse, reason: line);
        }
      }
      expect(find.byType(ShopDeliveryDetailScreen), findsNothing);
      await tap(tester, key('m07-custody-returned'));
      await tap(tester, find.text('Xác nhận hàng đã về'));
      expect(deliveries.calls, <String>['custody:d2:GOODS_RETURNED']);
      await unmount(tester);
    });

    testWidgets('the fee talks are answered on the order page: another price from the Shipper, and the customer\'s agreement', (WidgetTester tester) async {
      final Map<String, Object?> countered = <String, Object?>{'state': 'COUNTERED', 'proposed_vnd': 15000, 'counter_vnd': 20000, 'reason_code': 'BAD_WEATHER', 'reason_note': null, 'expires_at': '2026-10-20T11:30:00Z'};
      final _Deliveries deliveries = _Deliveries(deliveryJson(state: 'waiting_driver', agreement: countered, incident: false, can: <String>{'cancel', 'decide_fee'}));
      final _Orders orders = _Orders(orderJson(delivery: deliveryJson(state: 'waiting_driver', agreement: countered, incident: false, can: <String>{'cancel', 'decide_fee'}), display: 'SEARCHING_SHIPPER', story: _story.sublist(0, 3)));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(orders), orderId: 'o1', deliveries: deliveries));
      expect(key('m07-agreement'), findsOneWidget);
      await tap(tester, key('m07-counter-accept'));
      await tap(tester, key('m07-counter-reject'));
      expect(deliveries.calls, <String>['counter:d2:true', 'counter:d2:false']);
      await unmount(tester);
      final Map<String, Object?> awaiting = <String, Object?>{...countered, 'state': 'AWAITING_CUSTOMER'};
      final _Deliveries again = _Deliveries(deliveryJson(state: 'waiting_driver', agreement: awaiting, incident: false, can: <String>{'decide_fee'}));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(_Orders(orderJson(delivery: deliveryJson(state: 'waiting_driver', agreement: awaiting, incident: false, can: <String>{'decide_fee'}), display: 'SEARCHING_SHIPPER'))), orderId: 'o1', deliveries: again));
      await tap(tester, key('m07-customer-agreed'));
      expect(again.calls, <String>['customer-fee:d2']);
      await unmount(tester);
    });

    testWidgets('an order the customer pays for: the customer decides the fee in 11Food, the shop only waits (no answer buttons)', (WidgetTester tester) async {
      final Map<String, Object?> countered = <String, Object?>{'state': 'COUNTERED', 'proposed_vnd': 15000, 'counter_vnd': 20000, 'reason_code': 'BAD_WEATHER', 'reason_note': null, 'expires_at': '2026-10-20T11:30:00Z'};
      final Map<String, Object?> d = deliveryJson(state: 'waiting_driver', agreement: countered, incident: false, can: <String>{'wait_customer_fee'});
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(_Orders(orderJson(delivery: d, display: 'SEARCHING_SHIPPER'))), orderId: 'o1', deliveries: _Deliveries(d)));
      expect(key('m07-wait-customer-fee'), findsOneWidget);
      expect(key('m07-counter-accept'), findsNothing);
      expect(key('m07-counter-reject'), findsNothing);
      expect(key('m07-customer-agreed'), findsNothing);
      await unmount(tester);
    });

    testWidgets('"Hủy yêu cầu giao" ends only the request (needs a reason) and sits beside "Hủy đơn món" and "Gọi lại shipper", each for its own right', (WidgetTester tester) async {
      final _Deliveries deliveries = _Deliveries(deliveryJson(state: 'accepted', incident: false, can: <String>{'cancel'}));
      final _Orders orders = _Orders(orderJson(delivery: deliveryJson(state: 'accepted', incident: false, can: <String>{'cancel'}), display: 'SHIPPER_COMING', can: <String, bool>{'cancel': true}));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(orders), orderId: 'o1', deliveries: deliveries));
      expect(find.widgetWithText(OutlinedButton, 'Hủy đơn món'), findsOneWidget);
      expect(key('order-call'), findsNothing);
      await tap(tester, key('m07-cancel'));
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      await tester.enterText(key('m07-reason-field'), 'Chờ lâu');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(deliveries.calls, <String>['cancel:d2:Chờ lâu']);
      expect(orders.calls, isEmpty);
      await unmount(tester);
      // After the request ended the order is NOT cancelled: it reads as preparing and offers a new call.
      final Map<String, Object?> ended = deliveryJson(state: 'cancelled_by_merchant', incident: false);
      final _Orders after = _Orders(orderJson(delivery: ended, display: 'PREPARING', can: <String, bool>{'call_shipper': true, 'cancel': true}, story: <Map<String, Object?>>[..._story.sublist(0, 4), <String, Object?>{'at': '2026-10-20T11:30:00Z', 'text': 'Quán đã hủy yêu cầu giao — Chờ lâu'}]));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(after), orderId: 'o1', deliveries: _Deliveries(ended)));
      expect(key('order-call'), findsOneWidget);
      expect(containing('Quán đã hủy yêu cầu giao — Chờ lâu'), findsOneWidget);
      expect(find.text('Đã hủy'), findsNothing);
      expect(containing('Đã hủy đơn'), findsNothing);
      await unmount(tester);
    });

    testWidgets('an order that really ended says so once, with who and why, in the story only', (WidgetTester tester) async {
      final Map<String, Object?> ended = deliveryJson(state: 'cancelled_by_merchant', incident: false);
      final _Orders orders = _Orders(orderJson(delivery: ended, display: 'CANCELLED_BY_SHOP', status: 'CANCELLED_BY_SHOP', endReason: 'Hết nguyên liệu', story: <Map<String, Object?>>[..._story.sublist(0, 3), <String, Object?>{'at': '2026-10-20T12:00:00Z', 'text': 'Quán đã hủy đơn — Hết nguyên liệu'}]));
      await mount(tester, ShopOrderDetailScreen(runtime: runtimeOf(orders), orderId: 'o1', deliveries: _Deliveries(ended)));
      expect(containing('Hết nguyên liệu'), findsOneWidget);
      expect(containing('Lý do:'), findsNothing);
      await unmount(tester);
    });
  });

  group('story card', () {
    testWidgets('time first, oldest first; the date only when the story runs over more than one day; nothing for an empty story', (WidgetTester tester) async {
      final DateTime a = DateTime(2026, 10, 20, 18, 24);
      final DateTime b = DateTime(2026, 10, 20, 18, 25);
      await mount(tester, Scaffold(body: StoryCard(<StoryEntry>[StoryEntry(at: b, text: 'Shipper đã nhận đơn'), StoryEntry(at: a, text: 'Đang tìm shipper')])));
      expect(find.text('18:24'), findsOneWidget);
      expect(find.text('18:25'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Đang tìm shipper')).dy, lessThan(tester.getTopLeft(find.text('Shipper đã nhận đơn')).dy));
      expect(containing('20/10'), findsNothing);
      await unmount(tester);
      await mount(tester, Scaffold(body: StoryCard(<StoryEntry>[StoryEntry(at: a, text: 'Đang tìm shipper'), StoryEntry(at: DateTime(2026, 10, 21, 1, 5), text: 'Giao thành công')])));
      expect(find.text('20/10 18:24'), findsOneWidget);
      expect(find.text('21/10 01:05'), findsOneWidget);
      await unmount(tester);
      await mount(tester, const Scaffold(body: StoryCard(<StoryEntry>[])));
      expect(key('m07-story'), findsNothing);
      await unmount(tester);
    });
  });

  group('direct delivery page', () {
    testWidgets('keeps its own page, draws the story and never the raw log or a repeated result', (WidgetTester tester) async {
      final Map<String, Object?> json = <String, Object?>{
        ...deliveryJson(can: <String>{'resolve_custody'}, story: <Map<String, Object?>>[
          <String, Object?>{'at': '2026-10-20T11:00:00Z', 'text': 'Đã tạo yêu cầu giao, đang tìm shipper'},
          <String, Object?>{'at': '2026-10-20T11:20:00Z', 'text': 'Giao không thành công — Không liên lạc được người nhận'},
        ]),
        'source': 'DIRECT',
        'order_id': null,
      };
      await mount(tester, ShopDeliveryDetailScreen(source: _Deliveries(json), deliveryId: 'd2'));
      expect(key('m07-story'), findsOneWidget);
      expect(containing('Giao không thành công'), findsOneWidget);
      for (final String line in texts(tester)) {
        for (final RegExp bad in _technical) {
          expect(bad.hasMatch(line), isFalse, reason: line);
        }
      }
      expect(key('m07-timeline'), findsNothing);
      await unmount(tester);
    });
  });

  group('wire', () {
    test('the story is read from the server and the raw log is only kept, never drawn; an unknown event label never shows a key', () {
      final OrderView o = OrderView.fromJson(orderJson(delivery: deliveryJson(), story: _story));
      expect(o.story.map((StoryEntry e) => e.text).first, 'Đã đặt đơn');
      expect(o.story, hasLength(5));
      expect(OrderEvent(at: DateTime.utc(2026, 10, 20), type: 'order.something_new', actor: 'SYSTEM', note: null).label, 'Cập nhật đơn');
    });
  });
}
