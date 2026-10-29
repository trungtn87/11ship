import 'package:flutter/foundation.dart';

import '../m07/m07_source.dart';
import 'm10_models.dart';
import 'm10_source.dart';
import 'order_chat_models.dart';
import 'order_chat_sample.dart';

// ILLUSTRATIVE data for the tests and the design preview (--dart-define=M10_UI_PREVIEW=true). It is a small in-memory stand-in for the server: one store
// shared by a customer source and a shop source, so a flow (send -> the shop confirms -> the customer sees it) can be walked through. It builds the very
// JSON the server sends and parses it with the production models, so the wire contract is exercised too. It is NEVER wired into a real build and every
// screen fed by it shows "Dữ liệu minh họa". Names, prices and addresses here are made up.

const bool kM10UiPreview = bool.fromEnvironment('M10_UI_PREVIEW');

const String kSampleShopId = '00000000-0000-4000-8000-0000000000a1';

class SampleDish {
  const SampleDish(this.id, this.name, this.priceVnd);

  final String id;
  final String name;
  final int priceVnd;
}

const List<SampleDish> kSampleDishes = <SampleDish>[
  SampleDish('00000000-0000-4000-8000-00000000d001', 'Phở bò tái', 45000),
  SampleDish('00000000-0000-4000-8000-00000000d002', 'Bún chả', 40000),
  SampleDish('00000000-0000-4000-8000-00000000d003', 'Trà đá', 5000),
];

class _Line {
  _Line(this.id, this.dish, this.note, this.quantity, this.priceVnd)
      : originalQuantity = quantity,
        originalPriceVnd = priceVnd;

  final String id;
  final SampleDish dish;
  final String? note;
  int quantity;
  int priceVnd;
  bool removed = false;
  final int originalQuantity;
  final int originalPriceVnd;
}

class _Order {
  _Order(this.id, this.code, this.clientRef, this.createdAt);

  final String id;
  final String code;
  final String clientRef;
  final DateTime createdAt;
  String status = 'PENDING_CONFIRMATION';
  int version = 1;
  bool edited = false;
  String? changeReason;
  int paid = 0;
  int? feeEstimate;
  int? feeFixed;
  String feePayer = 'CUSTOMER';
  DateTime? scheduledFor;
  String? note;
  String? endReason;
  String? endActor;
  String? deliveryState;

  /// A Shipper's other fee waiting for the customer's answer (the customer pays), or null.
  int? feeCounter;
  int deliveries = 0;
  String recipientName = 'Người nhận';
  String recipientPhone = '+84912345678';
  String addressText = '12 Phố Huế, Hai Bà Trưng, Hà Nội';
  double? lat;
  double? lng;
  final List<_Line> lines = <_Line>[];
  final List<(String, String, String?)> events = <(String, String, String?)>[];
}

/// The shared stand-in for the server.
class SampleOrderStore {
  /// The chat of the sample orders: one in-memory room, shared by the customer and the shop source.
  late final SampleOrderChat chat = SampleOrderChat(milestonesOf: _milestonesOf, openOf: _isOpen);
  final List<_Order> _orders = <_Order>[];
  List<DraftLine> _cart = <DraftLine>[];
  String? _cartShop;
  int _next = 1;

  /// The code of an Order (the shop reads it; the customer never does), for assertions in tests.
  String codeOf(String id) => _find(id).code;

  /// Orders the sample "server" holds, for assertions in tests.
  int get orderCount => _orders.length;

  /// The drop-off point the newest Order was sent with (null = no pin), for assertions in tests.
  (double?, double?) get lastPin => _orders.isEmpty ? (null, null) : (_orders.last.lat, _orders.last.lng);
  int placeAttempts = 0;

  /// A test can make the NEXT `place` lose its answer after the server stored the Order.
  bool dropNextPlaceAnswer = false;

  /// A test can make the fee table unable to price the next call (the server answers FEE_REQUIRED until the shop proposes a fee).
  bool feeNeedsProposal = false;

  /// The fee the shop proposed in its last call, for assertions in tests.
  AgreedFeeProposal? lastProposal;

  /// The shop changes a price after the customer saw it (for the "price changed" case).
  void changePrice(String dishId, int priceVnd) {
    _priceOverride[dishId] = priceVnd;
  }

  final Map<String, int> _priceOverride = <String, int>{};
  final Set<String> _gone = <String>{};
  void removeDish(String dishId) => _gone.add(dishId);

  int priceOf(SampleDish d) => _priceOverride[d.id] ?? d.priceVnd;

  Map<String, Object?> _line(_Line l) => <String, Object?>{
        'line_id': l.id,
        'menu_item_id': l.dish.id,
        'name': l.dish.name,
        'note': l.note,
        'quantity': l.quantity,
        'unit_price_vnd': l.priceVnd,
        'line_total_vnd': l.removed ? 0 : l.priceVnd * l.quantity,
        'removed': l.removed,
        'original': l.quantity != l.originalQuantity || l.priceVnd != l.originalPriceVnd || l.removed ? <String, Object?>{'quantity': l.originalQuantity, 'unit_price_vnd': l.originalPriceVnd} : null,
      };

  int _items(_Order o) => o.lines.where((_Line l) => !l.removed).fold(0, (int s, _Line l) => s + l.priceVnd * l.quantity);

  String _display(_Order o) {
    switch (o.status) {
      case 'PENDING_CONFIRMATION':
        return 'AWAITING_SHOP';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'CANCELLED_BY_CUSTOMER':
        return 'CANCELLED_BY_CUSTOMER';
      case 'CANCELLED_BY_SHOP':
        return 'CANCELLED_BY_SHOP';
      case 'REJECTED_BY_SHOP':
        return 'REJECTED';
      case 'NOT_COMPLETED':
        return 'NOT_COMPLETED';
    }
    return switch (o.deliveryState) {
      'waiting_driver' => 'SEARCHING_SHIPPER',
      'accepted' => 'SHIPPER_COMING',
      'delivering' => 'DELIVERING',
      'search_stopped' => 'SEARCH_STOPPED',
      'failed' => 'DELIVERY_FAILED',
      _ => 'PREPARING',
    };
  }

  Map<String, Object?> _money(_Order o) => <String, Object?>{
        'items_original_total_vnd': o.lines.fold<int>(0, (int s, _Line l) => s + l.originalPriceVnd * l.originalQuantity),
        'items_total_vnd': _items(o),
        'paid_vnd': o.paid,
        'items_remaining_vnd': _items(o) - o.paid,
        'fee': <String, Object?>{'payer': o.feePayer, 'amount_vnd': o.feeFixed, 'estimate_vnd': o.feeEstimate, 'status': o.feeFixed != null ? 'FINAL' : (o.feeEstimate != null ? 'ESTIMATE' : 'UNKNOWN'), 'distance_m': o.feeEstimate == null ? null : 2500},
        'expected_total_vnd': o.feeFixed != null ? _items(o) + (o.feePayer == 'SHOP' ? 0 : o.feeFixed!) : (o.feeEstimate != null && o.deliveryState == null ? _items(o) + o.feeEstimate! : null),
      };

  Map<String, Object?> _viewJson(_Order o, {required bool shop}) {
    final DateTime now = DateTime.now().toUtc();
    final bool running = o.status == 'PREPARING';
    return <String, Object?>{
      'order_id': o.id,
      'code': o.code,
      'status': o.status,
      'display_status': _display(o),
      'version': o.version,
      'shop': <String, Object?>{
        'shop_id': kSampleShopId,
        'name': 'Quán Phở Minh họa',
        'phone': '+84900000001',
        'address_text': '5 Phố Cổ, Hoàn Kiếm, Hà Nội',
        if (!shop) 'contact': <String, Object?>{'phone': '+84900000001', 'zalo_url': 'https://zalo.me/0900000001', 'messenger_url': 'https://m.me/quanphominh'}
      },
      'recipient': <String, Object?>{'name': o.recipientName, 'phone': o.recipientPhone, 'address_text': o.addressText, 'lat': o.lat, 'lng': o.lng},
      'note': o.note,
      'scheduled_for': o.scheduledFor?.toUtc().toIso8601String(),
      'items': <Object?>[for (final _Line l in o.lines) _line(l)],
      'money': _money(o),
      'edited': o.edited,
      'change_reason': o.changeReason,
      'confirmed_at': o.status == 'PENDING_CONFIRMATION' ? null : now.toIso8601String(),
      'ended_at': o.status == 'PENDING_CONFIRMATION' || o.status == 'PREPARING' ? null : now.toIso8601String(),
      'end_actor': o.endActor,
      'end_reason': o.endReason,
      'created_at': o.createdAt.toUtc().toIso8601String(),
      'updated_at': now.toIso8601String(),
      'server_now': now.toIso8601String(),
      'delivery': shop || o.deliveryState == null
          ? null
          : <String, Object?>{
              'delivery_id': '${o.id}-d${o.deliveries}',
              'code': 'G-${o.code.substring(3)}',
              'state': o.deliveryState,
              'version': 1,
              'fee': <String, Object?>{'payer': o.feePayer, 'amount_vnd': o.feeFixed, 'status': o.feeFixed == null ? 'UNKNOWN' : 'FINAL', 'distance_m': 2500},
              'fee_decision': o.feeCounter == null ? null : <String, Object?>{'state': 'COUNTERED', 'current_vnd': o.feeFixed, 'offered_vnd': o.feeCounter, 'expires_at': now.add(const Duration(minutes: 20)).toIso8601String(), 'can_decline': true},
              'search': <String, Object?>{'started_at': now.toIso8601String(), 'expires_at': now.add(const Duration(minutes: 30)).toIso8601String(), 'server_now': now.toIso8601String(), 'stopped_at': null},
              'shipper': o.deliveryState == 'accepted' || o.deliveryState == 'delivering' ? <String, Object?>{'name': 'Shipper Minh Họa', 'phone': '+84911111111', 'plate_number': '59X1-123.45', 'accepted_at': now.toIso8601String(), 'picked_up_at': null} : null,
              'location': o.deliveryState == 'accepted' || o.deliveryState == 'delivering' ? <String, Object?>{'lat': 21.001, 'lng': 105.801, 'recorded_at': now.toIso8601String(), 'age_seconds': 20, 'freshness': 'LIVE'} : null,
              'result': null,
              'goods_custody': null,
              'pickup': <String, Object?>{'lat': 21.0, 'lng': 105.8},
              'dropoff': o.lat == null ? null : <String, Object?>{'lat': o.lat, 'lng': o.lng},
              'created_at': now.toIso8601String(),
            },
      if (shop)
        'deliveries': <Object?>[
          for (int i = 0; i < o.deliveries; i++) <String, Object?>{'delivery_id': '${o.id}-d$i', 'code': 'G-${o.code.substring(3)}$i', 'state': i == o.deliveries - 1 ? (o.deliveryState ?? 'cancelled_by_merchant') : 'search_stopped', 'previous_delivery_id': null, 'created_at': now.toIso8601String(), 'ended_at': null, 'end_reason': null},
        ],
      if (shop) 'schedule_conflict': false,
      if (shop)
        'can': <String, Object?>{
          'edit': o.status == 'PENDING_CONFIRMATION',
          'confirm': o.status == 'PENDING_CONFIRMATION' && _items(o) > 0,
          'reject': o.status == 'PENDING_CONFIRMATION',
          'call_shipper': running && (o.deliveryState == null || o.deliveryState == 'search_stopped'),
          'cancel': running && o.deliveryState != 'delivering',
          'close_not_completed': false,
        }
      else
        'can': <String, Object?>{'cancel': o.status == 'PENDING_CONFIRMATION', 'cancel_after_pickup': running && o.deliveryState == 'delivering', 'reorder': true},
      'timeline': <Object?>[
        for (final (String, String, String?) e in o.events) <String, Object?>{'at': now.toIso8601String(), 'type': e.$1, 'actor': e.$2, 'note': e.$3}
      ],
      'story': <Object?>[
        for (final (String, String, String?) e in o.events)
          if (_storyText(e) != null) <String, Object?>{'at': now.toIso8601String(), 'text': _storyText(e)},
      ],
    };
  }

  /// The sample's own plain-words version of an event (the real server writes the story; this only keeps previews and tests readable).
  static String? _storyText((String, String, String?) e) {
    final String? reason = e.$3 == null || e.$3!.isEmpty ? null : e.$3;
    String withReason(String head) => reason == null ? head : '$head — $reason';
    return switch (e.$1) {
      'order.placed' => 'Đã đặt đơn',
      'order.edited' => 'Quán đã chỉnh đơn',
      'order.confirmed' => reason == null ? 'Quán đã xác nhận' : 'Quán đã xác nhận đơn đã chỉnh — $reason',
      'order.rejected' => withReason('Quán đã từ chối đơn'),
      'order.ready' => 'Món đã sẵn sàng',
      'order.shipper_called' => 'Đang tìm shipper',
      'order.shipper_called_again' => 'Quán gọi lại shipper, đang tìm shipper',
      'order.cancelled_by_customer' => withReason('Khách đã hủy đơn'),
      'order.cancelled_by_shop' => withReason('Quán đã hủy đơn'),
      _ => null,
    };
  }

  _Order? _findOrNull(String id) {
    for (final _Order o in _orders) {
      if (o.id == id) {
        return o;
      }
    }
    return null;
  }

  /// The chat's milestones are the order's events in plain words (the server projects the same from the real events); the room closes with the order.
  List<ChatMilestone> _milestonesOf(String id) {
    final _Order? o = _findOrNull(id);
    if (o == null) {
      return const <ChatMilestone>[];
    }
    final DateTime base = o.createdAt;
    final List<ChatMilestone> out = <ChatMilestone>[];
    for (int i = 0; i < o.events.length; i++) {
      final String? text = _storyText(o.events[i]);
      if (text != null) {
        out.add(ChatMilestone(id: 'o:${o.id}:$i', at: base.add(Duration(seconds: i)), text: text));
      }
    }
    return out;
  }

  bool _isOpen(String id) {
    final _Order? o = _findOrNull(id);
    return o != null && !const <String>{'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED'}.contains(o.status);
  }

  /// Seeds one Order in a given state (for the screenshots and the list tests).
  String seed({String status = 'PENDING_CONFIRMATION', String? deliveryState, int? feeCounter, DateTime? scheduledFor, String name = 'Nguyễn Văn An', bool pin = true}) {
    final _Order o = _create(<DraftLine>[DraftLine(itemId: kSampleDishes[0].id, name: kSampleDishes[0].name, quantity: 2, priceVnd: 45000), DraftLine(itemId: kSampleDishes[2].id, name: kSampleDishes[2].name, quantity: 1, priceVnd: 5000, note: 'Ít đá')], 'seed-$_next');
    o.status = status;
    o.deliveryState = deliveryState;
    o.feeCounter = feeCounter;
    o.scheduledFor = scheduledFor;
    o.recipientName = name;
    o.lat = pin ? 21.0 : null;
    o.lng = pin ? 105.82 : null;
    if (deliveryState != null) {
      o.deliveries = 1;
      o.feeFixed = 10000;
    }
    return o.id;
  }

  _Order _create(List<DraftLine> lines, String clientRef) {
    final int n = _next++;
    final _Order o = _Order('00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}', 'DH-${100000 + n}', clientRef, DateTime.now());
    int i = 0;
    for (final DraftLine l in lines) {
      o.lines.add(_Line('line-$n-${i++}', kSampleDishes.firstWhere((SampleDish d) => d.id == l.itemId), l.note, l.quantity, l.priceVnd));
    }
    o.events.add(('order.placed', 'CUSTOMER', null));
    _orders.insert(0, o);
    return o;
  }

  _Order _find(String id) => _orders.firstWhere((_Order o) => o.id == id, orElse: () => throw const M07Failure(M07FailureKind.refused, code: 'ORDER_NOT_FOUND'));
}

void _version(_Order o, int expected) {
  if (o.version != expected) {
    throw const M07Failure(M07FailureKind.conflict, code: 'VERSION_CONFLICT');
  }
}

class SampleCustomerOrders extends CustomerOrderSource {
  SampleCustomerOrders(this.store);

  final SampleOrderStore store;

  @override
  OrderChatApi get chat => store.chat;

  @override
  bool get isSample => true;

  CartView? _view() {
    if (store._cart.isEmpty || store._cartShop == null) {
      return null;
    }
    return CartView(
      shopId: store._cartShop!,
      shopName: 'Quán Phở Minh họa',
      online: true,
      lines: <CartLine>[
        for (final DraftLine l in store._cart)
          CartLine(
            itemId: l.itemId,
            name: l.name,
            note: l.note,
            quantity: l.quantity,
            priceVnd: store._gone.contains(l.itemId) ? null : store.priceOf(kSampleDishes.firstWhere((SampleDish d) => d.id == l.itemId)),
            available: !store._gone.contains(l.itemId),
          ),
      ],
      note: null,
      feeEstimateVnd: 10000,
      itemsVnd: store._cart.fold(0, (int s, DraftLine l) => s + (store._gone.contains(l.itemId) ? 0 : store.priceOf(kSampleDishes.firstWhere((SampleDish d) => d.id == l.itemId)) * l.quantity)),
    );
  }

  @override
  Future<CartView?> cart() async => _view();

  @override
  Future<CartView?> saveCart({required String shopId, required List<DraftLine> lines, String? note}) async {
    store._cart = lines;
    store._cartShop = lines.isEmpty ? null : shopId;
    return _view();
  }

  @override
  Future<void> clearCart() async {
    store._cart = <DraftLine>[];
    store._cartShop = null;
  }

  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) async {
    final List<PreviewLine> lines = <PreviewLine>[
      for (final DraftLine l in draft.lines) PreviewLine(itemId: l.itemId, name: l.name, note: l.note, quantity: l.quantity, priceVnd: store._gone.contains(l.itemId) ? null : store.priceOf(kSampleDishes.firstWhere((SampleDish d) => d.id == l.itemId)), issue: store._gone.contains(l.itemId) ? 'ITEM_UNAVAILABLE' : null),
    ];
    final int items = lines.fold(0, (int s, PreviewLine l) => s + (l.priceVnd ?? 0) * l.quantity);
    const int fee = 10000;
    final bool priced = draft.address.hasPin;
    return CheckoutPreview(ok: lines.every((PreviewLine l) => l.issue == null), blockers: const <String>[], lines: lines, itemsVnd: items, feeEstimateVnd: priced ? fee : null, feeDistanceM: priced ? 2500 : null, expectedTotalVnd: priced ? items + fee + draft.tipVnd : null, tipVnd: draft.tipVnd, feeStatus: priced ? 'PRICED' : 'UNAVAILABLE', feeReason: priced ? null : 'DROPOFF_PIN_MISSING', quoteSnapshot: priced ? 'sample-pinned' : 'sample-no-pin');
  }

  @override
  Future<OrderView> place(CheckoutDraft draft, {required CheckoutPreview preview, required String clientRef, required String key}) async {
    store.placeAttempts += 1;
    for (final _Order existing in store._orders) {
      if (existing.clientRef == clientRef) {
        return OrderView.fromJson(store._viewJson(existing, shop: false));
      }
    }
    for (final DraftLine l in draft.lines) {
      final SampleDish d = kSampleDishes.firstWhere((SampleDish x) => x.id == l.itemId);
      if (store._gone.contains(l.itemId) || store.priceOf(d) != l.priceVnd) {
        throw const M07Failure(M07FailureKind.conflict, code: 'ORDER_CART_CHANGED');
      }
    }
    final _Order o = store._create(draft.lines, clientRef)
      ..recipientName = draft.recipientName
      ..recipientPhone = draft.recipientPhone
      ..addressText = draft.address.text
      ..lat = draft.address.lat
      ..lng = draft.address.lng
      ..scheduledFor = draft.scheduledFor
      ..note = draft.note
      ..feeEstimate = 10000 + draft.tipVnd;
    store._cart = <DraftLine>[];
    store._cartShop = null;
    if (store.dropNextPlaceAnswer) {
      store.dropNextPlaceAnswer = false;
      throw const M07Failure(M07FailureKind.offline);
    }
    return OrderView.fromJson(store._viewJson(o, shop: false));
  }

  @override
  Future<OrderView?> lookup(String clientRef) async {
    for (final _Order o in store._orders) {
      if (o.clientRef == clientRef) {
        return OrderView.fromJson(store._viewJson(o, shop: false));
      }
    }
    return null;
  }

  @override
  Future<List<OrderSummary>> list(CustomerScope scope) async {
    bool ended(_Order o) => !(o.status == 'PENDING_CONFIRMATION' || o.status == 'PREPARING');
    final List<_Order> rows = store._orders
        .where((_Order o) => switch (scope) {
              CustomerScope.processing => !ended(o) && o.scheduledFor == null,
              CustomerScope.scheduled => !ended(o) && o.scheduledFor != null,
              CustomerScope.history => ended(o),
            })
        .toList();
    return <OrderSummary>[for (final _Order o in rows) _summary(store, o, shop: false)];
  }

  @override
  Future<OrderView> get(String id) async => OrderView.fromJson(store._viewJson(store._find(id), shop: false));

  @override
  Future<OrderView> cancel(String id, {String? reason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    if (o.status != 'PENDING_CONFIRMATION') {
      throw const M07Failure(M07FailureKind.conflict, code: 'ORDER_STATE_CONFLICT');
    }
    o
      ..status = 'CANCELLED_BY_CUSTOMER'
      ..endActor = 'CUSTOMER'
      ..endReason = reason
      ..version += 1;
    o.events.add(('order.cancelled_by_customer', 'CUSTOMER', reason));
    return OrderView.fromJson(store._viewJson(o, shop: false));
  }

  @override
  Future<OrderView> cancelAfterPickup(String id, {required String reason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    if (o.status != 'PREPARING' || o.deliveryState != 'delivering') {
      throw const M07Failure(M07FailureKind.conflict, code: 'ORDER_STATE_CONFLICT');
    }
    o
      ..status = 'CANCELLED_BY_CUSTOMER'
      ..endActor = 'CUSTOMER'
      ..endReason = reason
      ..deliveryState = 'cancelled_by_merchant'
      ..version += 1;
    o.events.add(('order.cancelled_by_customer_after_pickup', 'CUSTOMER', reason));
    return OrderView.fromJson(store._viewJson(o, shop: false));
  }

  @override
  Future<OrderView> decideFee(String id, {required bool accept, required int deliveryVersion, required String key}) async {
    final _Order o = store._find(id);
    if (o.feeCounter == null) {
      throw const M07Failure(M07FailureKind.conflict, code: 'DELIVERY_STATE_CONFLICT');
    }
    if (accept) {
      o.feeFixed = o.feeCounter;
    }
    o
      ..feeCounter = null
      ..version += 1;
    o.events.add((accept ? 'order.fee_accepted' : 'order.fee_rejected', 'CUSTOMER', null));
    return OrderView.fromJson(store._viewJson(o, shop: false));
  }

  @override
  Future<ReorderResult> reorder(String id, {required bool replaceCart, required String key}) async {
    final _Order o = store._find(id);
    final List<DraftLine> lines = <DraftLine>[];
    final List<String> skipped = <String>[];
    for (final _Line l in o.lines) {
      if (store._gone.contains(l.dish.id)) {
        skipped.add(l.dish.name);
      } else {
        lines.add(DraftLine(itemId: l.dish.id, name: l.dish.name, quantity: l.originalQuantity, priceVnd: store.priceOf(l.dish), note: l.note));
      }
    }
    if (store._cartShop != null && store._cartShop != kSampleShopId && !replaceCart) {
      throw const M07Failure(M07FailureKind.refused, code: 'ORDER_CART_OTHER_SHOP');
    }
    store._cart = lines;
    store._cartShop = lines.isEmpty ? null : kSampleShopId;
    return ReorderResult(cart: _view(), skipped: skipped);
  }
}

OrderSummary _summary(SampleOrderStore store, _Order o, {required bool shop}) => OrderSummary.fromJson(<String, Object?>{
      'order_id': o.id,
      'code': o.code,
      'status': o.status,
      'display_status': store._display(o),
      'version': o.version,
      'shop_name': 'Quán Phở Minh họa',
      'recipient_name': o.recipientName,
      'line_count': o.lines.where((_Line l) => !l.removed).length,
      'items_total_vnd': store._items(o),
      'scheduled_for': o.scheduledFor?.toUtc().toIso8601String(),
      'edited': o.edited,
      'needs_attention': shop && o.status == 'PREPARING' && (o.deliveryState == 'search_stopped' || o.deliveryState == 'failed'),
      'created_at': o.createdAt.toUtc().toIso8601String(),
      'ended_at': null,
      'server_now': DateTime.now().toUtc().toIso8601String(),
    });

class SampleShopOrders extends ShopOrderSource {
  SampleShopOrders(this.store);

  final SampleOrderStore store;

  @override
  OrderChatApi get chat => store.chat;

  @override
  bool get isSample => true;

  OrderView _v(_Order o) => OrderView.fromJson(store._viewJson(o, shop: true));

  @override
  Future<OrderList> list({required String filter, String query = '', DateTime? from, DateTime? to}) async {
    bool ended(_Order o) => !(o.status == 'PENDING_CONFIRMATION' || o.status == 'PREPARING');
    final List<_Order> rows = store._orders.where((_Order o) {
      if (query.trim().isNotEmpty && !o.code.contains(query.trim()) && !o.recipientName.toLowerCase().contains(query.trim().toLowerCase())) {
        return false;
      }
      if (from != null && o.createdAt.isBefore(from)) return false;
      if (to != null && !o.createdAt.isBefore(to)) return false;
      return switch (filter) {
        'pending' => o.status == 'PENDING_CONFIRMATION',
        'preparing' => o.status == 'PREPARING' && o.deliveryState != 'delivering' && o.deliveryState != 'search_stopped' && o.deliveryState != 'failed',
        'scheduled' => !ended(o) && o.scheduledFor != null,
        'delivering' => o.status == 'PREPARING' && o.deliveryState == 'delivering',
        'attention' => o.status == 'PREPARING' && (o.deliveryState == 'search_stopped' || o.deliveryState == 'failed'),
        'history' => ended(o),
        _ => true,
      };
    }).toList();
    int count(bool Function(_Order) f) => store._orders.where(f).length;
    return OrderList(
      orders: <OrderSummary>[for (final _Order o in rows) _summary(store, o, shop: true)],
      counts: ShopOrderCounts(
        pending: count((_Order o) => o.status == 'PENDING_CONFIRMATION'),
        preparing: count((_Order o) => o.status == 'PREPARING' && o.deliveryState != 'delivering' && o.deliveryState != 'search_stopped' && o.deliveryState != 'failed'),
        scheduled: count((_Order o) => !ended(o) && o.scheduledFor != null),
        delivering: count((_Order o) => o.status == 'PREPARING' && o.deliveryState == 'delivering'),
        attention: count((_Order o) => o.status == 'PREPARING' && (o.deliveryState == 'search_stopped' || o.deliveryState == 'failed')),
      ),
    );
  }

  @override
  Future<OrderView> get(String id) async => _v(store._find(id));

  @override
  Future<OrderView> edit(String id, {required List<LineEdit> changes, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    if (o.status != 'PENDING_CONFIRMATION') {
      throw const M07Failure(M07FailureKind.conflict, code: 'ORDER_STATE_CONFLICT');
    }
    for (final LineEdit c in changes) {
      final _Line l = o.lines.firstWhere((_Line x) => x.id == c.lineId);
      if (c.remove) {
        l.removed = true;
      } else {
        l.quantity = c.quantity ?? l.quantity;
        l.priceVnd = c.priceVnd ?? l.priceVnd;
      }
    }
    o
      ..edited = true
      ..version += 1;
    o.events.add(('order.edited', 'SHOP', null));
    return _v(o);
  }

  @override
  Future<OrderView> confirm(String id, {String? changeReason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    if (o.status != 'PENDING_CONFIRMATION') {
      throw const M07Failure(M07FailureKind.conflict, code: 'ORDER_STATE_CONFLICT');
    }
    if (store._items(o) <= 0) {
      throw const M07Failure(M07FailureKind.refused, code: 'ORDER_EMPTY');
    }
    if (o.edited && (changeReason == null || changeReason.trim().isEmpty)) {
      throw const M07Failure(M07FailureKind.refused, code: 'ORDER_CHANGE_REASON_REQUIRED');
    }
    o
      ..status = 'PREPARING'
      ..changeReason = o.edited ? changeReason : null
      ..version += 1;
    o.events.add(('order.confirmed', 'SHOP', changeReason));
    return _v(o);
  }

  @override
  Future<OrderView> reject(String id, {required String reason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    o
      ..status = 'REJECTED_BY_SHOP'
      ..endActor = 'SHOP'
      ..endReason = reason
      ..version += 1;
    o.events.add(('order.rejected', 'SHOP', reason));
    return _v(o);
  }

  @override
  Future<OrderView> callShipper(String id, {required String feePayer, AgreedFeeProposal? agreedFee, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    if (store.feeNeedsProposal && agreedFee == null) {
      throw const M07Failure(M07FailureKind.refused, code: 'FEE_REQUIRED');
    }
    store.lastProposal = agreedFee;
    o
      ..deliveryState = 'waiting_driver'
      ..deliveries += 1
      ..feePayer = feePayer
      ..feeFixed = agreedFee?.amountVnd ?? o.feeEstimate ?? 10000
      ..version += 1;
    o.events.add((o.deliveries > 1 ? 'order.shipper_called_again' : 'order.shipper_called', 'SHOP', null));
    return _v(o);
  }

  @override
  Future<OrderView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    o
      ..status = 'CANCELLED_BY_SHOP'
      ..endActor = 'SHOP'
      ..endReason = reason
      ..deliveryState = o.deliveryState == null ? null : 'cancelled_by_merchant'
      ..version += 1;
    o.events.add(('order.cancelled_by_shop', 'SHOP', reason));
    return _v(o);
  }

  @override
  Future<OrderView> closeNotCompleted(String id, {required String reason, required int expectedVersion, required String key}) async {
    final _Order o = store._find(id);
    _version(o, expectedVersion);
    o
      ..status = 'NOT_COMPLETED'
      ..endActor = 'SHOP'
      ..endReason = reason
      ..version += 1;
    return _v(o);
  }

  @override
  Future<void> resolveCustody(String deliveryId, {required String resolution, String? note, required String key}) async {}
}

@visibleForTesting
SampleOrderStore newSampleOrderStore() => SampleOrderStore();
