import '../m07/m07_models.dart';

// M10 (food orders) data the phone screens draw. Wire contract: docs/current/M10-implementation-20261018.md. Money is whole VND and a fee that is not
// known is `null` (shown "Chưa xác định phí"), never 0. The status the screens show is the SERVER's `display_status` (Order + latest delivery); the phone
// clock decides nothing. The Order keeps its own snapshot of the dishes, the recipient and the address.

/// The one status an Order shows (server aggregate of the Order and its latest delivery).
enum DisplayStatus { awaitingShop, preparing, ready, searchingShipper, shipperComing, delivering, completed, searchStopped, deliveryFailed, cancelledByCustomer, cancelledByShop, cancelledBySystem, rejected, notCompleted }

DisplayStatus displayStatusOf(String wire) => switch (wire) {
      'AWAITING_SHOP' => DisplayStatus.awaitingShop,
      'PREPARING' => DisplayStatus.preparing,
      'READY' => DisplayStatus.ready,
      'SEARCHING_SHIPPER' => DisplayStatus.searchingShipper,
      'SHIPPER_COMING' => DisplayStatus.shipperComing,
      'DELIVERING' => DisplayStatus.delivering,
      'COMPLETED' => DisplayStatus.completed,
      'SEARCH_STOPPED' => DisplayStatus.searchStopped,
      'DELIVERY_FAILED' => DisplayStatus.deliveryFailed,
      'CANCELLED_BY_CUSTOMER' => DisplayStatus.cancelledByCustomer,
      'CANCELLED_BY_SYSTEM' => DisplayStatus.cancelledBySystem,
      'CANCELLED_BY_SHOP' => DisplayStatus.cancelledByShop,
      'REJECTED' => DisplayStatus.rejected,
      'NOT_COMPLETED' => DisplayStatus.notCompleted,
      _ => throw FormatException('display status $wire'),
    };

extension DisplayStatusText on DisplayStatus {
  String get label => switch (this) {
        DisplayStatus.awaitingShop => 'Chờ quán xác nhận',
        DisplayStatus.preparing => 'Quán đang chuẩn bị',
        DisplayStatus.ready => 'Món đã sẵn sàng — chờ lấy',
        DisplayStatus.searchingShipper => 'Đang tìm shipper',
        DisplayStatus.shipperComing => 'Shipper đang đến quán',
        DisplayStatus.delivering => 'Đang giao',
        DisplayStatus.completed => 'Hoàn thành',
        DisplayStatus.searchStopped => 'Chưa tìm được shipper — quán đang xử lý',
        DisplayStatus.deliveryFailed => 'Giao thất bại — đang xử lý',
        DisplayStatus.cancelledByCustomer || DisplayStatus.cancelledByShop => 'Đã hủy',
        DisplayStatus.cancelledBySystem => 'Hệ thống hủy quá hạn',
        DisplayStatus.rejected => 'Quán từ chối',
        DisplayStatus.notCompleted => 'Không hoàn tất',
      };

  bool get ended => switch (this) {
        DisplayStatus.completed || DisplayStatus.cancelledByCustomer || DisplayStatus.cancelledByShop || DisplayStatus.cancelledBySystem || DisplayStatus.rejected || DisplayStatus.notCompleted => true,
        _ => false,
      };
}

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw const FormatException('object');
List<Object?> _list(Object? v) => v is List<Object?> ? v : throw const FormatException('list');
String _str(Object? v) => v is String ? v : throw const FormatException('string');
String? _strOrNull(Object? v) => v == null ? null : _str(v);
int _int(Object? v) => v is int ? v : throw const FormatException('int');
int? _intOrNull(Object? v) => v == null ? null : _int(v);
bool _bool(Object? v) => v is bool ? v : throw const FormatException('bool');
double? _numOrNull(Object? v) => v == null ? null : (v is num ? v.toDouble() : throw const FormatException('number'));
DateTime _time(Object? v) => DateTime.parse(_str(v));
DateTime? _timeOrNull(Object? v) => v == null ? null : _time(v);

class OrderShop {
  const OrderShop({required this.shopId, required this.name, required this.phone, required this.addressText});

  factory OrderShop.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderShop(shopId: _str(m['shop_id']), name: _str(m['name']), phone: _strOrNull(m['phone']), addressText: _strOrNull(m['address_text']));
  }

  final String shopId;
  final String name;
  final String? phone;
  final String? addressText;
}

class OrderRecipient {
  const OrderRecipient({required this.name, required this.phone, required this.addressText, required this.lat, required this.lng});

  factory OrderRecipient.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderRecipient(name: _str(m['name']), phone: _str(m['phone']), addressText: _str(m['address_text']), lat: _numOrNull(m['lat']), lng: _numOrNull(m['lng']));
  }

  final String name;
  final String phone;
  final String addressText;

  /// The pin saved with the Order (a snapshot of the place); null when the customer gave none. Never invented.
  final double? lat;
  final double? lng;

  bool get hasPin => lat != null && lng != null;
}

class OrderLine {
  const OrderLine({required this.lineId, required this.itemId, required this.name, required this.note, required this.quantity, required this.unitPriceVnd, required this.lineTotalVnd, required this.removed, required this.originalQuantity, required this.originalPriceVnd});

  factory OrderLine.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Object? original = m['original'];
    return OrderLine(
      lineId: _str(m['line_id']),
      itemId: _str(m['menu_item_id']),
      name: _str(m['name']),
      note: _strOrNull(m['note']),
      quantity: _int(m['quantity']),
      unitPriceVnd: _int(m['unit_price_vnd']),
      lineTotalVnd: _int(m['line_total_vnd']),
      removed: _bool(m['removed']),
      originalQuantity: original == null ? null : _int(_obj(original)['quantity']),
      originalPriceVnd: original == null ? null : _int(_obj(original)['unit_price_vnd']),
    );
  }

  final String lineId;
  final String itemId;
  final String name;
  final String? note;
  final int quantity;
  final int unitPriceVnd;
  final int lineTotalVnd;
  final bool removed;

  /// What the customer ordered, when the shop changed the line (quantity, price or removal); null when untouched.
  final int? originalQuantity;
  final int? originalPriceVnd;

  bool get changed => originalQuantity != null;
}

class OrderFee {
  const OrderFee({required this.payer, required this.amountVnd, required this.estimateVnd, required this.status, required this.distanceM});

  factory OrderFee.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderFee(payer: _str(m['payer']), amountVnd: _intOrNull(m['amount_vnd']), estimateVnd: _intOrNull(m['estimate_vnd']), status: _str(m['status']), distanceM: _intOrNull(m['distance_m']));
  }

  final String payer;

  /// The fee of the delivery once it is fixed; null while not known.
  final int? amountVnd;

  /// What the checkout showed (M06) before any delivery existed; null = "Chưa xác định phí".
  final int? estimateVnd;

  /// FINAL / ESTIMATE / UNKNOWN.
  final String status;
  final int? distanceM;

  /// The figure to show: the fixed fee, else the estimate, else null.
  int? get shownVnd => amountVnd ?? estimateVnd;
  bool get isEstimate => amountVnd == null && estimateVnd != null;
  String get payerText => payer == 'SHOP' ? 'Quán trả phí' : 'Khách trả phí';
}

class OrderMoney {
  const OrderMoney({required this.originalItemsVnd, required this.itemsVnd, required this.paidVnd, required this.remainingVnd, required this.fee, required this.expectedTotalVnd});

  factory OrderMoney.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderMoney(
      originalItemsVnd: _int(m['items_original_total_vnd']),
      itemsVnd: _int(m['items_total_vnd']),
      paidVnd: _int(m['paid_vnd']),
      remainingVnd: _int(m['items_remaining_vnd']),
      fee: OrderFee.fromJson(m['fee']),
      expectedTotalVnd: _intOrNull(m['expected_total_vnd']),
    );
  }

  final int originalItemsVnd;
  final int itemsVnd;
  final int paidVnd;
  final int remainingVnd;
  final OrderFee fee;

  /// Dishes + fee when nobody has to guess the fee; null otherwise (the screen must not present a total as complete).
  final int? expectedTotalVnd;
}

/// The latest delivery of the Order as the ORDERING CUSTOMER may see it: no commission, no agreement, no other shop's data. The Shipper and the position
/// exist only while a Shipper holds the delivery; after it ends (or the Shipper gives it back) both are null.
class OrderDelivery {
  const OrderDelivery({required this.deliveryId, required this.code, required this.state, required this.version, required this.feePayer, required this.feeVnd, required this.feeStatus, required this.distanceM, required this.searchExpiresAt, required this.serverNow, required this.shipperName, required this.shipperPhone, required this.plate, required this.location, required this.resultReason, required this.goodsCustody, required this.pickupLat, required this.pickupLng, required this.dropoffLat, required this.dropoffLng});

  factory OrderDelivery.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> fee = _obj(m['fee']);
    final Map<String, Object?> search = _obj(m['search']);
    final Object? shipper = m['shipper'];
    final Object? result = m['result'];
    return OrderDelivery(
      deliveryId: _str(m['delivery_id']),
      code: _str(m['code']),
      state: deliveryStateOf(_str(m['state'])),
      version: _int(m['version']),
      feePayer: _str(fee['payer']),
      feeVnd: _intOrNull(fee['amount_vnd']),
      feeStatus: _str(fee['status']),
      distanceM: _intOrNull(fee['distance_m']),
      searchExpiresAt: _time(search['expires_at']),
      serverNow: _time(search['server_now']),
      shipperName: shipper == null ? null : _str(_obj(shipper)['name']),
      shipperPhone: shipper == null ? null : _strOrNull(_obj(shipper)['phone']),
      plate: shipper == null ? null : _strOrNull(_obj(shipper)['plate_number']),
      location: m['location'] == null ? null : LocationView.fromJson(m['location']),
      resultReason: result == null ? null : _strOrNull(_obj(result)['reason']),
      goodsCustody: _strOrNull(m['goods_custody']),
      pickupLat: m['pickup'] == null ? null : _numOrNull(_obj(m['pickup'])['lat']),
      pickupLng: m['pickup'] == null ? null : _numOrNull(_obj(m['pickup'])['lng']),
      dropoffLat: m['dropoff'] == null ? null : _numOrNull(_obj(m['dropoff'])['lat']),
      dropoffLng: m['dropoff'] == null ? null : _numOrNull(_obj(m['dropoff'])['lng']),
    );
  }

  final String deliveryId;
  final String code;
  final DeliveryState state;
  final int version;
  final String feePayer;
  final int? feeVnd;
  final String feeStatus;
  final int? distanceM;
  final DateTime searchExpiresAt;
  final DateTime serverNow;
  final String? shipperName;
  final String? shipperPhone;
  final String? plate;
  final LocationView? location;
  final String? resultReason;

  /// After a failed delivery: SHIPPER (still with the Shipper / unknown), SHOP (back) or HANDLED.
  final String? goodsCustody;

  /// The points of the call (snapshots made when it was called). Null when the point is unknown; never invented.
  final double? pickupLat;
  final double? pickupLng;
  final double? dropoffLat;
  final double? dropoffLng;

  bool get hasShipper => shipperName != null;
}

class OrderEvent {
  const OrderEvent({required this.at, required this.type, required this.actor, required this.note});

  factory OrderEvent.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderEvent(at: _time(m['at']), type: _str(m['type']), actor: _str(m['actor']), note: _strOrNull(m['note']));
  }

  final DateTime at;
  final String type;
  final String actor;
  final String? note;

  String get label => switch (type) {
        'order.placed' => 'Khách gửi đơn',
        'order.edited' => 'Quán chỉnh đơn',
        'order.confirmed' => 'Quán xác nhận',
        'order.rejected' => 'Quán từ chối',
        'order.cancelled_by_customer' => 'Khách hủy đơn',
        'order.cancelled_by_shop' => 'Quán hủy đơn món',
        'order.confirmation_timeout' || 'order.delivery_timeout' => 'Hệ thống hủy quá hạn',
        'order.confirmation_reminder' => 'Nhắc quán xác nhận',
        'order.cancelled_by_admin' => 'Quản trị hủy đơn',
        'order.ready' => 'Món đã sẵn sàng',
        'order.payment_recorded' => 'Ghi nhận thanh toán',
        'order.shipper_called' => 'Quán gọi shipper',
        'order.shipper_called_again' => 'Quán gọi lại shipper',
        'order.schedule_reminder' => 'Nhắc đến giờ hẹn',
        'order.completed' => 'Giao thành công',
        'order.not_completed' => 'Đóng đơn không hoàn tất',
        'order.not_completed_by_admin' => 'Quản trị đóng đơn không hoàn tất',
        _ => type,
      };
}

class DeliveryBrief {
  const DeliveryBrief({required this.deliveryId, required this.code, required this.state, required this.previousId, required this.createdAt, required this.endReason});

  factory DeliveryBrief.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return DeliveryBrief(deliveryId: _str(m['delivery_id']), code: _str(m['code']), state: deliveryStateOf(_str(m['state'])), previousId: _strOrNull(m['previous_delivery_id']), createdAt: _time(m['created_at']), endReason: _strOrNull(m['end_reason']));
  }

  final String deliveryId;
  final String code;
  final DeliveryState state;
  final String? previousId;
  final DateTime createdAt;
  final String? endReason;
}

class OrderView {
  const OrderView({
    required this.orderId,
    required this.code,
    required this.status,
    required this.display,
    required this.version,
    required this.shop,
    required this.recipient,
    required this.note,
    required this.scheduledFor,
    required this.items,
    required this.money,
    required this.edited,
    required this.changeReason,
    required this.confirmedAt,
    required this.readyAt,
    required this.endedAt,
    required this.endReason,
    required this.endActor,
    required this.createdAt,
    required this.serverNow,
    required this.delivery,
    required this.shopDelivery,
    required this.deliveries,
    required this.scheduleConflict,
    required this.can,
    required this.timeline,
  });

  factory OrderView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Object? delivery = m['delivery'];
    final bool shopSide = delivery is Map<String, Object?> && delivery.containsKey('assignment');
    final Object? can = m['can'];
    return OrderView(
      orderId: _str(m['order_id']),
      code: _str(m['code']),
      status: _str(m['status']),
      display: displayStatusOf(_str(m['display_status'])),
      version: _int(m['version']),
      shop: OrderShop.fromJson(m['shop']),
      recipient: OrderRecipient.fromJson(m['recipient']),
      note: _strOrNull(m['note']),
      scheduledFor: _timeOrNull(m['scheduled_for']),
      items: <OrderLine>[for (final Object? i in _list(m['items'])) OrderLine.fromJson(i)],
      money: OrderMoney.fromJson(m['money']),
      edited: _bool(m['edited']),
      changeReason: _strOrNull(m['change_reason']),
      confirmedAt: _timeOrNull(m['confirmed_at']),
      readyAt: _timeOrNull(m['ready_at']),
      endedAt: _timeOrNull(m['ended_at']),
      endReason: _strOrNull(m['end_reason']),
      endActor: _strOrNull(m['end_actor']),
      createdAt: _time(m['created_at']),
      serverNow: _time(m['server_now']),
      delivery: delivery == null || shopSide ? null : OrderDelivery.fromJson(delivery),
      shopDelivery: delivery != null && shopSide ? DeliveryView.fromJson(delivery) : null,
      deliveries: m['deliveries'] == null ? const <DeliveryBrief>[] : <DeliveryBrief>[for (final Object? d in _list(m['deliveries'])) DeliveryBrief.fromJson(d)],
      scheduleConflict: m['schedule_conflict'] == true,
      can: can is Map<String, Object?> ? <String, bool>{for (final MapEntry<String, Object?> e in can.entries) if (e.value is bool) e.key: e.value! as bool} : const <String, bool>{},
      timeline: m['timeline'] == null ? const <OrderEvent>[] : <OrderEvent>[for (final Object? e in _list(m['timeline'])) OrderEvent.fromJson(e)],
    );
  }

  final String orderId;
  final String code;
  final String status;
  final DisplayStatus display;
  final int version;
  final OrderShop shop;
  final OrderRecipient recipient;
  final String? note;

  /// The time the customer WANTS the food (not a promise): null for "sớm nhất".
  final DateTime? scheduledFor;
  final List<OrderLine> items;
  final OrderMoney money;
  final bool edited;
  final String? changeReason;
  final DateTime? confirmedAt;
  final DateTime? readyAt;
  final DateTime? endedAt;
  final String? endReason;
  final String? endActor;
  final DateTime createdAt;
  final DateTime serverNow;

  /// The customer's view of the latest delivery (customer reader) or the shop's full view (shop reader) — exactly one of them.
  final OrderDelivery? delivery;
  final DeliveryView? shopDelivery;
  final List<DeliveryBrief> deliveries;

  /// The shop changed its hours after accepting a scheduled Order: a warning for the shop; nothing was cancelled.
  final bool scheduleConflict;
  final Map<String, bool> can;
  final List<OrderEvent> timeline;

  bool get isScheduled => scheduledFor != null;
  bool get ready => readyAt != null;
  bool get ended => display.ended;
  bool allowed(String action) => can[action] ?? false;
}

class OrderSummary {
  const OrderSummary({required this.orderId, required this.code, required this.display, required this.version, required this.shopName, required this.recipientName, required this.lineCount, required this.itemsVnd, required this.scheduledFor, required this.ready, required this.edited, required this.needsAttention, required this.createdAt});

  factory OrderSummary.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return OrderSummary(
      orderId: _str(m['order_id']),
      code: _str(m['code']),
      display: displayStatusOf(_str(m['display_status'])),
      version: _int(m['version']),
      shopName: _str(m['shop_name']),
      recipientName: _str(m['recipient_name']),
      lineCount: _int(m['line_count']),
      itemsVnd: _int(m['items_total_vnd']),
      scheduledFor: _timeOrNull(m['scheduled_for']),
      ready: _bool(m['ready']),
      edited: _bool(m['edited']),
      needsAttention: m['needs_attention'] == true,
      createdAt: _time(m['created_at']),
    );
  }

  final String orderId;
  final String code;
  final DisplayStatus display;
  final int version;
  final String shopName;
  final String recipientName;
  final int lineCount;
  final int itemsVnd;
  final DateTime? scheduledFor;
  final bool ready;
  final bool edited;
  final bool needsAttention;
  final DateTime createdAt;
}

class ShopOrderCounts {
  const ShopOrderCounts({required this.pending, required this.preparing, required this.scheduled, required this.delivering, required this.attention});

  factory ShopOrderCounts.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return ShopOrderCounts(pending: _int(m['pending']), preparing: _int(m['preparing']), scheduled: _int(m['scheduled']), delivering: _int(m['delivering']), attention: _int(m['attention']));
  }

  static const ShopOrderCounts zero = ShopOrderCounts(pending: 0, preparing: 0, scheduled: 0, delivering: 0, attention: 0);

  final int pending;
  final int preparing;
  final int scheduled;
  final int delivering;
  final int attention;
}

class OrderList {
  const OrderList({required this.orders, required this.counts});

  final List<OrderSummary> orders;
  final ShopOrderCounts counts;
}

// ---- cart and checkout -----------------------------------------------------------------------------------------------

/// One cart line as the server prices it NOW. [priceVnd] is null when the dish is not on sale any more.
class CartLine {
  const CartLine({required this.itemId, required this.name, required this.note, required this.quantity, required this.priceVnd, required this.available});

  factory CartLine.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return CartLine(itemId: _str(m['item_id']), name: _str(m['name']), note: _strOrNull(m['note']), quantity: _int(m['quantity']), priceVnd: _intOrNull(m['price_vnd']), available: _bool(m['available']));
  }

  final String itemId;
  final String name;
  final String? note;
  final int quantity;
  final int? priceVnd;
  final bool available;

  int get totalVnd => (priceVnd ?? 0) * quantity;

  CartLine copyWith({int? quantity}) => CartLine(itemId: itemId, name: name, note: note, quantity: quantity ?? this.quantity, priceVnd: priceVnd, available: available);
}

class CartView {
  const CartView({required this.shopId, required this.shopName, required this.online, required this.lines, required this.note, required this.itemsVnd, this.feeEstimateVnd});

  factory CartView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> shop = _obj(m['shop']);
    return CartView(
      shopId: _str(shop['shop_id']),
      shopName: _strOrNull(shop['name']) ?? 'Quán',
      online: _bool(shop['online']),
      lines: <CartLine>[for (final Object? l in _list(m['lines'])) CartLine.fromJson(l)],
      note: _strOrNull(m['note']),
      itemsVnd: _int(m['items_total_vnd']),
      feeEstimateVnd: _intOrNull(m['fee_estimate_vnd']),
    );
  }

  final String shopId;
  final String shopName;
  final bool online;
  final List<CartLine> lines;
  final String? note;
  final int itemsVnd;
  /// Provisional entry-tier rate from the active M06 table, not a final delivery fee.
  final int? feeEstimateVnd;
}

/// One dish of a cart or a checkout the phone sends: the dish, the quantity, the note and (placing) the price the customer saw.
class DraftLine {
  const DraftLine({required this.itemId, required this.name, required this.quantity, required this.priceVnd, this.note});

  final String itemId;
  final String name;
  final int quantity;
  final int priceVnd;
  final String? note;

  int get totalVnd => priceVnd * quantity;
}

/// Where the Order goes: an address of the address book (M05; the server reads its current text and pin) or a typed one (a pin is optional).
class DraftAddress {
  const DraftAddress.book(String this.addressId, {required this.text, this.lat, this.lng})
      : typed = false,
        addressText = null;
  const DraftAddress.typed(String this.addressText, {this.lat, this.lng})
      : typed = true,
        addressId = null,
        text = addressText;

  final bool typed;
  final String? addressId;
  final String? addressText;

  /// For display only.
  final String text;
  final double? lat;
  final double? lng;

  bool get hasPin => lat != null && lng != null;

  Map<String, Object?> toJson() => typed
      ? <String, Object?>{'address_text': addressText, if (lat != null && lng != null) ...<String, Object?>{'lat': lat, 'lng': lng}}
      : <String, Object?>{'address_id': addressId};
}

class CheckoutDraft {
  const CheckoutDraft({required this.shopId, required this.shopName, required this.lines, required this.note, required this.recipientName, required this.recipientPhone, required this.address, required this.scheduledFor});

  final String shopId;
  final String shopName;
  final List<DraftLine> lines;
  final String? note;
  final String recipientName;
  final String recipientPhone;
  final DraftAddress address;
  final DateTime? scheduledFor;

  int get itemsVnd => lines.fold(0, (int sum, DraftLine l) => sum + l.totalVnd);
}

class CheckoutPreview {
  const CheckoutPreview({required this.ok, required this.blockers, required this.lines, required this.itemsVnd, required this.feeEstimateVnd, required this.feeDistanceM, required this.expectedTotalVnd});

  factory CheckoutPreview.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> fee = _obj(m['fee']);
    return CheckoutPreview(
      ok: _bool(m['ok']),
      blockers: <String>[for (final Object? b in _list(m['blockers'])) _str(b)],
      lines: <PreviewLine>[for (final Object? l in _list(m['lines'])) PreviewLine.fromJson(l)],
      itemsVnd: _int(m['items_total_vnd']),
      feeEstimateVnd: _intOrNull(fee['estimate_vnd']),
      feeDistanceM: _intOrNull(fee['distance_m']),
      expectedTotalVnd: _intOrNull(m['expected_total_vnd']),
    );
  }

  final bool ok;

  /// SHOP_NOT_OPEN, SCHEDULE_TOO_SOON, SCHEDULE_TOO_FAR, SCHEDULE_OUTSIDE_HOURS, ADDRESS_NOT_FOUND.
  final List<String> blockers;
  final List<PreviewLine> lines;
  final int itemsVnd;

  /// M06's estimate; null = "Chưa xác định phí" (no pin, no route, no price) — never 0.
  final int? feeEstimateVnd;
  final int? feeDistanceM;
  final int? expectedTotalVnd;

  bool lineChanged(DraftLine draft) {
    for (final PreviewLine l in lines) {
      if (l.itemId == draft.itemId && l.note == draft.note) {
        return l.issue != null || (l.priceVnd != null && l.priceVnd != draft.priceVnd);
      }
    }
    return true;
  }
}

class PreviewLine {
  const PreviewLine({required this.itemId, required this.name, required this.note, required this.quantity, required this.priceVnd, required this.issue});

  factory PreviewLine.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return PreviewLine(itemId: _str(m['item_id']), name: _strOrNull(m['name']), note: _strOrNull(m['note']), quantity: _int(m['quantity']), priceVnd: _intOrNull(m['unit_price_vnd']), issue: _strOrNull(m['issue']));
  }

  final String itemId;
  final String? name;
  final String? note;
  final int quantity;
  final int? priceVnd;
  final String? issue;
}

class ReorderResult {
  const ReorderResult({required this.cart, required this.skipped});

  final CartView? cart;
  final List<String> skipped;
}
