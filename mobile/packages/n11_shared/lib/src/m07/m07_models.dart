// M07 (delivery flow) data the phone screens draw. Wire contract: docs/current/M07-implementation-20261018.md section 5.
//
// PRIVACY BY TYPE. [OfferView] (what a Shipper sees BEFORE accepting) has no field for a customer phone, a detailed address or a drop-off
// coordinate, so no screen built on it can show one. Money is whole VND; a fee that is not known is `null` (shown "Chưa xác định phí"),
// never 0. A position always carries the time it was recorded; a stale one is never drawn as live.

/// The states of a delivery (docs section 3). `pickedUp` is a milestone: the server moves straight to `delivering`.
enum DeliveryState { waitingDriver, accepted, locationConfirmed, pickedUp, delivering, completed, failed, cancelledByMerchant, cancelledBySystem, searchStopped }

DeliveryState deliveryStateOf(String wire) => switch (wire) {
      'waiting_driver' => DeliveryState.waitingDriver,
      'accepted' => DeliveryState.accepted,
      'location_confirmed' => DeliveryState.locationConfirmed,
      'picked_up' => DeliveryState.pickedUp,
      'delivering' => DeliveryState.delivering,
      'completed' => DeliveryState.completed,
      'failed' => DeliveryState.failed,
      'cancelled_by_system' => DeliveryState.cancelledBySystem,
      'cancelled_by_merchant' => DeliveryState.cancelledByMerchant,
      'search_stopped' => DeliveryState.searchStopped,
      _ => throw FormatException('delivery state $wire'),
    };

extension DeliveryStateText on DeliveryState {
  bool get isActive => switch (this) {
        DeliveryState.waitingDriver || DeliveryState.accepted || DeliveryState.locationConfirmed || DeliveryState.pickedUp || DeliveryState.delivering => true,
        _ => false,
      };

  /// Before the goods are picked up: cancelling is still allowed.
  bool get beforePickup => switch (this) {
        DeliveryState.waitingDriver || DeliveryState.accepted || DeliveryState.locationConfirmed || DeliveryState.searchStopped => true,
        _ => false,
      };

  String get label => switch (this) {
        DeliveryState.waitingDriver => 'Đang tìm shipper',
        DeliveryState.accepted => 'Shipper đã nhận',
        DeliveryState.locationConfirmed => 'Chờ lấy hàng',
        DeliveryState.pickedUp || DeliveryState.delivering => 'Đang giao',
        DeliveryState.completed => 'Giao thành công',
        DeliveryState.failed => 'Giao thất bại',
        DeliveryState.cancelledBySystem => 'Đã hủy yêu cầu giao',
        DeliveryState.cancelledByMerchant => 'Đã hủy yêu cầu giao',
        DeliveryState.searchStopped => 'Đã ngừng tìm',
      };
}

/// Where the latest position stands. `lost` and `stale` are never drawn as live.
enum Freshness { live, stale, lost }

Freshness freshnessOf(String wire) => switch (wire) {
      'LIVE' => Freshness.live,
      'STALE' => Freshness.stale,
      'LOST' => Freshness.lost,
      _ => throw FormatException('freshness $wire'),
    };

// ---- parsing helpers -------------------------------------------------------------------------------------------------

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw const FormatException('object');
List<Object?> _list(Object? v) => v is List<Object?> ? v : throw const FormatException('list');
String _str(Object? v) => v is String ? v : throw const FormatException('string');
String? _strOrNull(Object? v) => v == null ? null : _str(v);
int _int(Object? v) => v is int ? v : throw const FormatException('int');
int? _intOrNull(Object? v) => v == null ? null : _int(v);
bool _bool(Object? v) => v is bool ? v : throw const FormatException('bool');
double _num(Object? v) => v is num ? v.toDouble() : throw const FormatException('number');
double? _numOrNull(Object? v) => v == null ? null : _num(v);
DateTime _time(Object? v) => DateTime.parse(_str(v));
DateTime? _timeOrNull(Object? v) => v == null ? null : _time(v);

// ---- delivery --------------------------------------------------------------------------------------------------------

class AgreementSummary {
  const AgreementSummary({required this.state, required this.proposedVnd, this.counterVnd, required this.reasonCode, this.reasonNote, required this.expiresAt});

  factory AgreementSummary.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return AgreementSummary(
      state: _str(m['state']),
      proposedVnd: _int(m['proposed_vnd']),
      counterVnd: _intOrNull(m['counter_vnd']),
      reasonCode: _str(m['reason_code']),
      reasonNote: _strOrNull(m['reason_note']),
      expiresAt: _time(m['expires_at']),
    );
  }

  /// PROPOSED, COUNTERED, AWAITING_CUSTOMER, ACCEPTED, DECLINED, EXPIRED or LOCKED (M06).
  final String state;
  final int proposedVnd;
  final int? counterVnd;
  final String reasonCode;
  final String? reasonNote;
  final DateTime expiresAt;
}

class FeeView {
  const FeeView({required this.mode, required this.payer, required this.status, this.amountVnd, this.distanceM, this.agreement});

  factory FeeView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final String payer = _str(m['payer']);
    if (payer != 'CUSTOMER' && payer != 'SHOP') {
      throw const FormatException('payer');
    }
    return FeeView(
      mode: _str(m['mode']),
      payer: payer,
      status: _str(m['status']),
      amountVnd: _intOrNull(m['amount_vnd']),
      distanceM: _intOrNull(m['distance_m']),
      agreement: m['agreement'] == null ? null : AgreementSummary.fromJson(m['agreement']),
    );
  }

  /// STANDARD, AGREED or PICKUP_AGREEMENT.
  final String mode;

  /// CUSTOMER or SHOP.
  final String payer;

  /// FINAL, UNKNOWN, PENDING_AGREEMENT or AWAITING_CUSTOMER.
  final String status;

  /// null = not determined: shown "Chưa xác định phí", never 0đ.
  final int? amountVnd;
  final int? distanceM;
  final AgreementSummary? agreement;

  bool get isFinal => status == 'FINAL' && amountVnd != null;
  String get payerText => payer == 'CUSTOMER' ? 'Khách trả ship' : 'Quán trả ship';
}

class RecipientView {
  const RecipientView({required this.name, this.phone, this.addressText, this.lat, this.lng});

  factory RecipientView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return RecipientView(name: _str(m['name']), phone: _strOrNull(m['phone']), addressText: _strOrNull(m['address_text']), lat: _numOrNull(m['lat']), lng: _numOrNull(m['lng']));
  }

  final String name;
  final String? phone;
  final String? addressText;
  final double? lat;
  final double? lng;

  bool get hasPoint => lat != null && lng != null;
}

class PickupView {
  const PickupView({required this.shopName, this.phone, this.addressText, this.lat, this.lng});

  factory PickupView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return PickupView(shopName: _str(m['shop_name']), phone: _strOrNull(m['phone']), addressText: _strOrNull(m['address_text']), lat: _numOrNull(m['lat']), lng: _numOrNull(m['lng']));
  }

  final String shopName;
  final String? phone;
  final String? addressText;
  final double? lat;
  final double? lng;
}

class GoodsView {
  const GoodsView({required this.description, required this.valueVnd, required this.paidVnd});

  factory GoodsView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return GoodsView(description: _str(m['description']), valueVnd: _int(m['value_vnd']), paidVnd: _int(m['paid_vnd']));
  }

  final String description;
  final int valueVnd;
  final int paidVnd;

  int get unpaidVnd => valueVnd - paidVnd;
}

class SearchView {
  const SearchView({required this.startedAt, required this.expiresAt, required this.serverNow, this.stoppedAt});

  factory SearchView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return SearchView(startedAt: _time(m['started_at']), expiresAt: _time(m['expires_at']), serverNow: _time(m['server_now']), stoppedAt: _timeOrNull(m['stopped_at']));
  }

  final DateTime startedAt;
  final DateTime expiresAt;

  /// The server clock when the answer was made: the countdown is drawn from it, never from the phone clock.
  final DateTime serverNow;
  final DateTime? stoppedAt;

  /// Whole minutes the search has been running at [serverNow].
  int get elapsedMinutes => serverNow.difference(startedAt).inMinutes;

  Duration get remaining {
    final Duration left = expiresAt.difference(serverNow);
    return left.isNegative ? Duration.zero : left;
  }
}

class AssignmentView {
  const AssignmentView({required this.assignmentId, required this.shipperName, this.shipperPhone, this.plateNumber, required this.acceptedAt, this.pickedUpAt, required this.destinationConfirmed});

  factory AssignmentView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> s = _obj(m['shipper']);
    return AssignmentView(
      assignmentId: _str(m['assignment_id']),
      shipperName: _str(s['name']),
      shipperPhone: _strOrNull(s['phone']),
      plateNumber: _strOrNull(s['plate_number']),
      acceptedAt: _time(m['accepted_at']),
      pickedUpAt: _timeOrNull(m['picked_up_at']),
      destinationConfirmed: _bool(m['destination_confirmed']),
    );
  }

  final String assignmentId;
  final String shipperName;
  final String? shipperPhone;
  final String? plateNumber;
  final DateTime acceptedAt;
  final DateTime? pickedUpAt;
  final bool destinationConfirmed;
}

class LocationView {
  const LocationView({required this.lat, required this.lng, required this.recordedAt, required this.ageSeconds, required this.freshness});

  factory LocationView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return LocationView(lat: _num(m['lat']), lng: _num(m['lng']), recordedAt: _time(m['recorded_at']), ageSeconds: _int(m['age_seconds']), freshness: freshnessOf(_str(m['freshness'])));
  }

  final double lat;
  final double lng;
  final DateTime recordedAt;
  final int ageSeconds;
  final Freshness freshness;
}

class ResultView {
  const ResultView({required this.outcome, required this.at, this.reason, this.goodsCondition});

  factory ResultView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return ResultView(outcome: _str(m['outcome']), at: _time(m['at']), reason: _strOrNull(m['reason']), goodsCondition: _strOrNull(m['goods_condition']));
  }

  final String outcome;
  final DateTime at;
  final String? reason;
  final String? goodsCondition;
}

/// Who holds the goods after a failed delivery. Responsibility is not tied to the terminal state.
class IncidentView {
  const IncidentView({required this.incidentId, required this.status, required this.custody, required this.reason, required this.openedAt});

  factory IncidentView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return IncidentView(incidentId: _str(m['incident_id']), status: _str(m['status']), custody: _str(m['custody']), reason: _str(m['reason']), openedAt: _time(m['opened_at']));
  }

  final String incidentId;

  /// OPEN or CLOSED.
  final String status;

  /// SHIPPER (still with the Shipper or unknown), SHOP (back at the shop) or HANDLED (dealt with, no new delivery).
  final String custody;
  final String reason;
  final DateTime openedAt;

  bool get isOpen => status == 'OPEN';

  String get custodyText => switch (custody) {
        'SHOP' => 'Hàng đã về quán',
        'HANDLED' => 'Đã xử lý, không giao tiếp',
        _ => 'Hàng đang ở shipper hoặc chưa rõ',
      };
}

class TimelineEntry {
  const TimelineEntry({required this.at, required this.type, required this.actor, this.note});

  factory TimelineEntry.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return TimelineEntry(at: _time(m['at']), type: _str(m['type']), actor: _str(m['actor']), note: _strOrNull(m['note']));
  }

  final DateTime at;
  final String type;
  final String actor;
  final String? note;
}

/// One milestone of "Diễn biến", already put in plain words by the server (no event key, no internal code). Shown by [StoryCard].
class StoryEntry {
  const StoryEntry({required this.at, required this.text});

  factory StoryEntry.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return StoryEntry(at: _time(m['at']), text: _str(m['text']));
  }

  final DateTime at;
  final String text;
}

List<StoryEntry> storyOf(Object? raw) => <StoryEntry>[for (final Object? t in _list(raw ?? <Object?>[])) StoryEntry.fromJson(t)];

/// One delivery as the shop (full) or the assigned Shipper (after accepting) sees it. The server decides which fields are filled;
/// a field the caller may not see is null.
class DeliveryView {
  const DeliveryView({
    required this.deliveryId,
    required this.code,
    required this.source,
    this.orderId,
    this.previousDeliveryId,
    required this.state,
    this.ownOutcome,
    required this.version,
    required this.pickup,
    required this.recipient,
    required this.goods,
    required this.fee,
    required this.search,
    this.note,
    this.assignment,
    this.location,
    this.result,
    this.incident,
    this.can = const <String>{},
    this.timeline = const <TimelineEntry>[],
    this.story = const <StoryEntry>[],
  });

  factory DeliveryView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> can = _obj(m['can'] ?? <String, Object?>{});
    return DeliveryView(
      deliveryId: _str(m['delivery_id']),
      code: _str(m['display_code'] ?? m['code']),
      source: _str(m['source']),
      orderId: _strOrNull(m['order_id']),
      previousDeliveryId: _strOrNull(m['previous_delivery_id']),
      state: deliveryStateOf(_str(m['state'])),
      ownOutcome: _strOrNull(m['own_outcome']),
      version: _int(m['version']),
      pickup: PickupView.fromJson(m['pickup']),
      recipient: RecipientView.fromJson(m['recipient']),
      goods: GoodsView.fromJson(m['goods']),
      fee: FeeView.fromJson(m['fee']),
      search: SearchView.fromJson(m['search']),
      note: _strOrNull(m['note']),
      assignment: m['assignment'] == null ? null : AssignmentView.fromJson(m['assignment']),
      location: m['location'] == null ? null : LocationView.fromJson(m['location']),
      result: m['result'] == null ? null : ResultView.fromJson(m['result']),
      incident: m['incident'] == null ? null : IncidentView.fromJson(m['incident']),
      can: <String>{for (final MapEntry<String, Object?> e in can.entries) if (_bool(e.value)) e.key},
      timeline: <TimelineEntry>[for (final Object? t in _list(m['timeline'] ?? <Object?>[])) TimelineEntry.fromJson(t)],
      story: storyOf(m['story']),
    );
  }

  final String deliveryId;
  final String code;

  /// DIRECT (the shop called a Shipper for an outside order) or ORDER (from a confirmed M10 order).
  final String source;
  final String? orderId;
  final String? previousDeliveryId;
  final DeliveryState state;

  /// Only in the Shipper's own history, when the delivery ended without this Shipper finishing it: `released` (they gave it back), `released_by_admin`
  /// or `cancelled_by_shop`. The delivery's own state is then what happened to the delivery, not to this Shipper.
  final String? ownOutcome;
  final int version;
  final PickupView pickup;
  final RecipientView recipient;
  final GoodsView goods;
  final FeeView fee;
  final SearchView search;
  final String? note;
  final AssignmentView? assignment;
  final LocationView? location;
  final ResultView? result;
  final IncidentView? incident;

  /// Actions the server allows now (`cancel`, `recall`, `resolve_custody`, `release`, `confirm_destination`, `pickup`, `complete`, `fail`...).
  final Set<String> can;
  final List<TimelineEntry> timeline;

  /// The milestones for the screen (plain words); [timeline] is the raw log and is never drawn.
  final List<StoryEntry> story;

  bool allows(String action) => can.contains(action);

  /// A copy with some parts replaced (used by the sample source and by tests). `clear*` drop an optional part.
  DeliveryView copyWith({
    DeliveryState? state,
    int? version,
    RecipientView? recipient,
    FeeView? fee,
    SearchView? search,
    AssignmentView? assignment,
    bool clearAssignment = false,
    LocationView? location,
    bool clearLocation = false,
    ResultView? result,
    IncidentView? incident,
    Set<String>? can,
    List<TimelineEntry>? timeline,
    List<StoryEntry>? story,
  }) =>
      DeliveryView(
        deliveryId: deliveryId,
        code: code,
        source: source,
        orderId: orderId,
        previousDeliveryId: previousDeliveryId,
        state: state ?? this.state,
        ownOutcome: ownOutcome,
        version: version ?? this.version,
        pickup: pickup,
        recipient: recipient ?? this.recipient,
        goods: goods,
        fee: fee ?? this.fee,
        search: search ?? this.search,
        note: note,
        assignment: clearAssignment ? null : (assignment ?? this.assignment),
        location: clearLocation ? null : (location ?? this.location),
        result: result ?? this.result,
        incident: incident ?? this.incident,
        can: can ?? this.can,
        timeline: timeline ?? this.timeline,
        story: story ?? this.story,
      );

  /// The drop-off position is missing: the Shipper pins it and confirms the fee before pickup.
  bool get needsDestination => !recipient.hasPoint;
}

/// What a Shipper sees BEFORE accepting.
class OfferView {
  const OfferView({
    required this.deliveryId,
    required this.code,
    required this.shopName,
    this.shopAreaText,
    this.distanceToShopM,
    this.dropoffAreaText,
    required this.destinationKnown,
    required this.goodsValueVnd,
    required this.unpaidVnd,
    this.feeVnd,
    required this.feeStatus,
    required this.feePayer,
    required this.expiresAt,
    required this.serverNow,
    required this.eligible,
    this.reasons = const <String>[],
    this.agreement,
  });

  factory OfferView.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Map<String, Object?> shop = _obj(m['shop']);
    return OfferView(
      deliveryId: _str(m['delivery_id']),
      code: _str(m['display_code'] ?? m['code']),
      shopName: _str(shop['name']),
      shopAreaText: _strOrNull(shop['area_text']),
      distanceToShopM: _intOrNull(m['distance_to_shop_m']),
      dropoffAreaText: _strOrNull(m['dropoff_area_text']),
      destinationKnown: _bool(m['destination_known']),
      goodsValueVnd: _int(m['goods_value_vnd']),
      unpaidVnd: _int(m['unpaid_vnd']),
      feeVnd: _intOrNull(m['fee_vnd']),
      feeStatus: _str(m['fee_status']),
      feePayer: _str(m['fee_payer']),
      expiresAt: _time(m['search_expires_at']),
      serverNow: _time(m['server_now']),
      eligible: _bool(m['eligible']),
      reasons: <String>[for (final Object? r in _list(m['reasons'] ?? <Object?>[])) _str(r)],
      agreement: m['agreement'] == null ? null : AgreementSummary.fromJson(m['agreement']),
    );
  }

  final String deliveryId;
  final String code;
  final String shopName;
  final String? shopAreaText;
  final int? distanceToShopM;
  final String? dropoffAreaText;
  final bool destinationKnown;
  final int goodsValueVnd;
  final int unpaidVnd;
  final int? feeVnd;
  final String feeStatus;
  final String feePayer;
  final DateTime expiresAt;
  final DateTime serverNow;
  final bool eligible;
  final List<String> reasons;
  final AgreementSummary? agreement;

  Duration get remaining {
    final Duration left = expiresAt.difference(serverNow);
    return left.isNegative ? Duration.zero : left;
  }
}

// ---- inputs ----------------------------------------------------------------------------------------------------------

/// Why a Shipper could not deliver. Closed list; the server refuses any other code.
const List<(String, String)> kFailReasons = <(String, String)>[
  ('RECIPIENT_UNREACHABLE', 'Không liên lạc được người nhận'),
  ('RECIPIENT_REFUSED', 'Người nhận từ chối nhận hàng'),
  ('ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ'),
  ('GOODS_PROBLEM', 'Hàng hỏng hoặc thất lạc'),
  ('VEHICLE_PROBLEM', 'Xe hoặc thiết bị gặp sự cố'),
  ('OTHER', 'Lý do khác'),
];

/// Where the goods are when delivery fails. Closed list.
const List<(String, String)> kGoodsConditions = <(String, String)>[
  ('WITH_SHIPPER', 'Hàng còn ở shipper'),
  ('RETURNED_TO_SHOP', 'Đã trả về quán'),
  ('HANDED_TO_RECIPIENT', 'Đã đưa người nhận / người khác'),
  ('LOST_OR_DAMAGED', 'Hàng mất hoặc hỏng'),
];

class NewDeliveryInput {
  const NewDeliveryInput({
    required this.recipientName,
    required this.recipientPhone,
    required this.addressText,
    this.lat,
    this.lng,
    required this.goodsDescription,
    required this.goodsValueVnd,
    required this.paidVnd,
    required this.feePayer,
    this.note,
    this.agreedReasonCode,
    this.agreedReasonNote,
    this.agreedAmountVnd,
  });

  final String recipientName;
  final String recipientPhone;
  final String addressText;
  final double? lat;
  final double? lng;
  final String goodsDescription;
  final int goodsValueVnd;
  final int paidVnd;

  /// CUSTOMER or SHOP.
  final String feePayer;
  final String? note;

  /// Set only when the shop chose "Thỏa thuận" (M06 AGREED): the reason code, an optional note and the proposed amount.
  final String? agreedReasonCode;
  final String? agreedReasonNote;
  final int? agreedAmountVnd;

  bool get agreed => agreedAmountVnd != null;

  Map<String, Object?> toJson() => <String, Object?>{
        'recipient_name': recipientName,
        'recipient_phone': recipientPhone,
        'dropoff_address_text': addressText,
        if (lat != null && lng != null) 'dropoff_lat': lat,
        if (lat != null && lng != null) 'dropoff_lng': lng,
        'goods_description': goodsDescription,
        'goods_value_vnd': goodsValueVnd,
        'paid_vnd': paidVnd,
        'fee_payer': feePayer,
        if (note != null && note!.isNotEmpty) 'note': note,
        if (agreed) 'agreed_fee': <String, Object?>{'reason_code': agreedReasonCode, if (agreedReasonNote != null && agreedReasonNote!.isNotEmpty) 'reason_note': agreedReasonNote, 'amount_vnd': agreedAmountVnd},
      };
}
