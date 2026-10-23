// M11 (ratings and complaints) data the phone screens draw. Wire contract: docs/current/M11-implementation-20261018.md. Parsed strictly: a body that is
// not what the contract says is a [FormatException], never a half-filled screen. Nothing here invents a value.
//
// PRIVACY BY TYPE. A rating of a Shipper ([ShipperReview]) has no field for who wrote it, only the source (customer or shop). A complaint seen by a
// related party ([ComplaintDetail] with [ComplaintDetail.relation] == party) carries no body and no pictures of the submitter: the server sends none.

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw const FormatException('object');
List<Object?> _list(Object? v) => v is List<Object?> ? v : throw const FormatException('list');
String _str(Object? v) => v is String ? v : throw const FormatException('string');
String? _strOrNull(Object? v) => v == null ? null : _str(v);
int _int(Object? v) => v is int ? v : throw const FormatException('int');
bool _bool(Object? v) => v is bool ? v : throw const FormatException('bool');
DateTime _time(Object? v) => DateTime.parse(_str(v)).toLocal();
DateTime? _timeOrNull(Object? v) => v == null ? null : _time(v);

/// The party a person acts as in M11: which route family of the server they use.
enum M11Role { customer, shop, shipper }

extension M11RoleWire on M11Role {
  /// The path prefix of the role's routes under /v1.
  String get prefix => switch (this) {
        M11Role.customer => 'customers/me',
        M11Role.shop => 'shop/me',
        M11Role.shipper => 'driver',
      };

  String get label => switch (this) {
        M11Role.customer => 'Khách hàng',
        M11Role.shop => 'Quán',
        M11Role.shipper => 'Shipper',
      };
}

// ---- ratings ---------------------------------------------------------------------------------------------------------

/// Average to one decimal and the count; [average] is null when nobody rated (never a default star).
class RatingSummary {
  const RatingSummary({required this.average, required this.count, required this.distribution});

  final double? average;
  final int count;

  /// Index 0 = one star ... index 4 = five stars.
  final List<int> distribution;

  bool get isEmpty => count == 0;

  factory RatingSummary.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final Object? avg = m['average'];
    final Map<String, Object?> d = _obj(m['distribution']);
    if (avg != null && avg is! num) {
      throw const FormatException('average');
    }
    return RatingSummary(
      average: avg == null ? null : (avg as num).toDouble(),
      count: _int(m['count']),
      distribution: <int>[for (final String k in const <String>['1', '2', '3', '4', '5']) _int(d[k])],
    );
  }
}

/// A rating its own author wrote (stars, comment, time).
class OwnReview {
  const OwnReview({required this.reviewId, required this.stars, required this.comment, required this.createdAt});

  final String reviewId;
  final int stars;
  final String? comment;
  final DateTime? createdAt;

  factory OwnReview.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final int stars = _int(m['stars']);
    if (stars < 1 || stars > 5) {
      throw const FormatException('stars');
    }
    return OwnReview(reviewId: _str(m['review_id']), stars: stars, comment: _strOrNull(m['comment']), createdAt: _timeOrNull(m['created_at']));
  }
}

class ShopReply {
  const ShopReply({required this.body, required this.version, required this.updatedAt});

  final String body;

  /// Null on the public page (it carries no version).
  final int? version;
  final DateTime updatedAt;

  factory ShopReply.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final Object? version = m['version'];
    if (version != null && version is! int) {
      throw const FormatException('version');
    }
    return ShopReply(body: _str(m['body']), version: version as int?, updatedAt: _time(m['updated_at']));
  }
}

/// One line of a shop's customer ratings (public page and the shop's own page).
class ShopReview {
  const ShopReview({required this.reviewId, required this.reviewerName, required this.stars, required this.comment, required this.createdAt, required this.reply, this.orderCode});

  final String reviewId;
  final String reviewerName;
  final int stars;
  final String? comment;
  final DateTime createdAt;
  final ShopReply? reply;
  final String? orderCode;

  factory ShopReview.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final int stars = _int(m['stars']);
    if (stars < 1 || stars > 5) {
      throw const FormatException('stars');
    }
    return ShopReview(
      reviewId: _str(m['review_id']),
      reviewerName: _str(m['reviewer_name']),
      stars: stars,
      comment: _strOrNull(m['comment']),
      createdAt: _time(m['created_at']),
      reply: m['reply'] == null ? null : ShopReply.fromJson(m['reply']),
      orderCode: _strOrNull(m['order_code']),
    );
  }
}

class ShopReviewPage {
  const ShopReviewPage({required this.shopName, required this.summary, required this.items});

  final String? shopName;
  final RatingSummary summary;
  final List<ShopReview> items;

  factory ShopReviewPage.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final Object? shop = m['shop'];
    return ShopReviewPage(
      shopName: shop == null ? null : _strOrNull(_obj(shop)['name']),
      summary: RatingSummary.fromJson(m['summary']),
      items: <ShopReview>[for (final Object? e in _list(m['items'])) ShopReview.fromJson(e)],
    );
  }
}

/// The open or closed complaint a Shipper already filed about a rating of them.
class ReviewComplaintRef {
  const ReviewComplaintRef({required this.complaintId, required this.code, required this.status});

  final String complaintId;
  final String code;
  final ComplaintStatus status;

  factory ReviewComplaintRef.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ReviewComplaintRef(complaintId: _str(m['complaint_id']), code: _str(m['code']), status: complaintStatusOf(_str(m['status'])));
  }
}

enum ReviewSource { customer, shop }

class ShipperReview {
  const ShipperReview({required this.reviewId, required this.source, required this.stars, required this.comment, required this.createdAt, required this.complaint});

  final String reviewId;
  final ReviewSource source;
  final int stars;
  final String? comment;
  final DateTime createdAt;
  final ReviewComplaintRef? complaint;

  factory ShipperReview.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final String source = _str(m['source']);
    if (source != 'CUSTOMER' && source != 'SHOP') {
      throw const FormatException('source');
    }
    final int stars = _int(m['stars']);
    if (stars < 1 || stars > 5) {
      throw const FormatException('stars');
    }
    return ShipperReview(
      reviewId: _str(m['review_id']),
      source: source == 'CUSTOMER' ? ReviewSource.customer : ReviewSource.shop,
      stars: stars,
      comment: _strOrNull(m['comment']),
      createdAt: _time(m['created_at']),
      complaint: m['complaint'] == null ? null : ReviewComplaintRef.fromJson(m['complaint']),
    );
  }
}

class ShipperReviewPage {
  const ShipperReviewPage({required this.all, required this.fromCustomers, required this.fromShops, required this.items});

  final RatingSummary all;
  final RatingSummary fromCustomers;
  final RatingSummary fromShops;
  final List<ShipperReview> items;

  factory ShipperReviewPage.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final Map<String, Object?> s = _obj(m['summary']);
    return ShipperReviewPage(
      all: RatingSummary.fromJson(s['all']),
      fromCustomers: RatingSummary.fromJson(s['customer']),
      fromShops: RatingSummary.fromJson(s['shop']),
      items: <ShipperReview>[for (final Object? e in _list(m['items'])) ShipperReview.fromJson(e)],
    );
  }
}

/// The Shipper card shown to the person who rates them: name and the combined score only.
class RatedShipper {
  const RatedShipper({required this.name, required this.code, required this.rating});

  final String name;
  final String code;
  final RatingSummary? rating;

  factory RatedShipper.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return RatedShipper(name: _str(m['name']), code: _str(m['shipper_code']), rating: m['rating'] == null ? null : RatingSummary.fromJson(m['rating']));
  }
}

/// The shop's side of one finished delivery: may it rate the Shipper, and what it already rated.
class ShopDeliveryReviewState {
  const ShopDeliveryReviewState({required this.deliveryCode, required this.shipper, required this.canReview, required this.review});

  final String deliveryCode;
  final RatedShipper? shipper;
  final bool canReview;
  final OwnReview? review;

  factory ShopDeliveryReviewState.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ShopDeliveryReviewState(
      deliveryCode: _str(_obj(m['delivery'])['code']),
      shipper: m['shipper'] == null ? null : RatedShipper.fromJson(m['shipper']),
      canReview: _bool(m['can_review']),
      review: m['review'] == null ? null : OwnReview.fromJson(m['review']),
    );
  }
}

/// The customer's side of one order: the shop and the Shipper they may rate.
class CustomerOrderReviewState {
  const CustomerOrderReviewState({required this.orderCode, required this.orderCompleted, required this.shopName, required this.canReviewShop, required this.shopReview, required this.shipper, required this.canReviewShipper, required this.shipperReview});

  final String orderCode;
  final bool orderCompleted;
  final String shopName;
  final bool canReviewShop;
  final OwnReview? shopReview;
  final RatedShipper? shipper;
  final bool canReviewShipper;
  final OwnReview? shipperReview;

  factory CustomerOrderReviewState.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final Map<String, Object?> order = _obj(m['order']);
    final Map<String, Object?> shop = _obj(m['shop']);
    final Object? shipper = m['shipper'];
    final Map<String, Object?>? ship = shipper == null ? null : _obj(shipper);
    return CustomerOrderReviewState(
      orderCode: _str(order['code']),
      orderCompleted: _bool(order['completed']),
      shopName: _str(shop['name']),
      canReviewShop: _bool(shop['can_review']),
      shopReview: shop['review'] == null ? null : OwnReview.fromJson(shop['review']),
      shipper: ship == null ? null : RatedShipper.fromJson(ship),
      canReviewShipper: ship == null ? false : _bool(ship['can_review']),
      shipperReview: ship == null || ship['review'] == null ? null : OwnReview.fromJson(ship['review']),
    );
  }
}

// ---- complaints ------------------------------------------------------------------------------------------------------

enum ComplaintStatus { pending, inProgress, awaitingInfo, resolved, closedNoAction }

ComplaintStatus complaintStatusOf(String wire) => switch (wire) {
      'PENDING' => ComplaintStatus.pending,
      'IN_PROGRESS' => ComplaintStatus.inProgress,
      'AWAITING_INFO' => ComplaintStatus.awaitingInfo,
      'RESOLVED' => ComplaintStatus.resolved,
      'CLOSED_NO_ACTION' => ComplaintStatus.closedNoAction,
      _ => throw const FormatException('complaint status'),
    };

extension ComplaintStatusText on ComplaintStatus {
  String get label => switch (this) {
        ComplaintStatus.pending => 'Chờ tiếp nhận',
        ComplaintStatus.inProgress => 'Đang xử lý',
        ComplaintStatus.awaitingInfo => 'Chờ bổ sung',
        ComplaintStatus.resolved => 'Đã giải quyết',
        ComplaintStatus.closedNoAction => 'Đóng không xử lý',
      };

  bool get isClosed => this == ComplaintStatus.resolved || this == ComplaintStatus.closedNoAction;
}

enum ComplaintCategory { deliveryResult, goods, moneyFee, service, shipperReview, other }

ComplaintCategory complaintCategoryOf(String wire) => switch (wire) {
      'DELIVERY_RESULT' => ComplaintCategory.deliveryResult,
      'GOODS' => ComplaintCategory.goods,
      'MONEY_FEE' => ComplaintCategory.moneyFee,
      'SERVICE' => ComplaintCategory.service,
      'SHIPPER_REVIEW' => ComplaintCategory.shipperReview,
      'OTHER' => ComplaintCategory.other,
      _ => throw const FormatException('complaint category'),
    };

extension ComplaintCategoryText on ComplaintCategory {
  String get wire => switch (this) {
        ComplaintCategory.deliveryResult => 'DELIVERY_RESULT',
        ComplaintCategory.goods => 'GOODS',
        ComplaintCategory.moneyFee => 'MONEY_FEE',
        ComplaintCategory.service => 'SERVICE',
        ComplaintCategory.shipperReview => 'SHIPPER_REVIEW',
        ComplaintCategory.other => 'OTHER',
      };

  String get label => switch (this) {
        ComplaintCategory.deliveryResult => 'Kết quả giao',
        ComplaintCategory.goods => 'Hàng hóa',
        ComplaintCategory.moneyFee => 'Tiền/phí',
        ComplaintCategory.service => 'Thái độ/phục vụ',
        ComplaintCategory.shipperReview => 'Đánh giá shipper',
        ComplaintCategory.other => 'Khác',
      };
}

/// What a complaint is about. Exactly one id is set; the server decides whether the caller may file about it.
class ComplaintSubject {
  const ComplaintSubject.order(String this.orderId)
      : deliveryId = null,
        reviewId = null;
  const ComplaintSubject.delivery(String this.deliveryId)
      : orderId = null,
        reviewId = null;
  const ComplaintSubject.review(String this.reviewId)
      : orderId = null,
        deliveryId = null;

  final String? orderId;
  final String? deliveryId;
  final String? reviewId;
}

class ComplaintLine {
  ComplaintLine({required this.id, required this.code, required this.category, required this.status, required String relation, required this.relatedCode, required this.summary, required this.createdAt, required this.updatedAt, required this.canRequestReconsideration}) : asParty = relation == 'PARTY';

  final String id;
  final String code;
  final ComplaintCategory category;
  final ComplaintStatus status;
  final bool asParty;
  final String relatedCode;
  final String? summary;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool canRequestReconsideration;

  factory ComplaintLine.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final String relation = _str(m['relation']);
    if (relation != 'SUBMITTER' && relation != 'PARTY') {
      throw const FormatException('relation');
    }
    return ComplaintLine(
      id: _str(m['complaint_id']),
      code: _str(m['code']),
      category: complaintCategoryOf(_str(m['category'])),
      status: complaintStatusOf(_str(m['status'])),
      relation: relation,
      relatedCode: _str(m['related_code']),
      summary: _strOrNull(m['summary']),
      createdAt: _time(m['created_at']),
      updatedAt: _time(m['updated_at']),
      canRequestReconsideration: _bool(m['can_request_reconsideration']),
    );
  }
}

class ComplaintCounts {
  const ComplaintCounts({required this.open, required this.closed});

  final int open;
  final int closed;

  factory ComplaintCounts.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ComplaintCounts(open: _int(m['open']), closed: _int(m['closed']));
  }
}

class ComplaintListPage {
  const ComplaintListPage({required this.counts, required this.own, required this.involvingMe, required this.involvingCounts, required this.serverNow});

  final ComplaintCounts counts;
  final List<ComplaintLine> own;
  final List<ComplaintLine> involvingMe;
  final ComplaintCounts involvingCounts;
  final DateTime serverNow;

  factory ComplaintListPage.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ComplaintListPage(
      counts: ComplaintCounts.fromJson(m['counts']),
      own: <ComplaintLine>[for (final Object? e in _list(m['items'])) ComplaintLine.fromJson(e)],
      involvingMe: <ComplaintLine>[for (final Object? e in _list(m['involving_me'])) ComplaintLine.fromJson(e)],
      involvingCounts: ComplaintCounts.fromJson(m['involving_me_counts']),
      serverNow: _time(m['server_now']),
    );
  }
}

class EvidenceRef {
  const EvidenceRef({required this.id, required this.byteSize});

  final String id;
  final int byteSize;
}

class ThreadLine {
  const ThreadLine({required this.kind, required this.mine, required this.body, required this.createdAt, required this.evidence});

  /// SUBMITTED, APPENDED, SUPPLEMENT, PARTY_RESPONSE, RECEIVED, REQUEST_INFO, CONCLUSION, CLOSED, REOPEN_REQUEST, REOPEN_DECISION.
  final String kind;

  /// Written by the person looking (YOU), as opposed to the support team.
  final bool mine;
  final String? body;
  final DateTime createdAt;
  final List<EvidenceRef> evidence;

  factory ThreadLine.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ThreadLine(
      kind: _str(m['kind']),
      mine: _str(m['author']) == 'YOU',
      body: _strOrNull(m['body']),
      createdAt: _time(m['created_at']),
      evidence: <EvidenceRef>[
        for (final Object? e in _list(m['attachments'])) EvidenceRef(id: _str(_obj(e)['attachment_id']), byteSize: _int(_obj(e)['byte_size'])),
      ],
    );
  }
}

class ReconsiderationLine {
  const ReconsiderationLine({required this.requestedAt, required this.status, required this.decisionReason});

  final DateTime requestedAt;
  final String status;
  final String? decisionReason;
}

class ComplaintDetail {
  const ComplaintDetail({
    required this.id,
    required this.code,
    required this.category,
    required this.status,
    required this.asParty,
    required this.relatedCode,
    required this.body,
    required this.conclusion,
    required this.closeReason,
    required this.createdAt,
    required this.closedAt,
    required this.version,
    required this.awaitingYou,
    required this.canSupplement,
    required this.canRequestReconsideration,
    required this.reconsiderationExpiresAt,
    required this.reconsiderations,
    required this.thread,
    required this.serverNow,
  });

  final String id;
  final String code;
  final ComplaintCategory category;
  final ComplaintStatus status;
  final bool asParty;
  final String relatedCode;

  /// Null for a related party: it is never shown the submitter's text.
  final String? body;
  final String? conclusion;
  final String? closeReason;
  final DateTime createdAt;
  final DateTime? closedAt;
  final int version;

  /// The Administration is waiting for THIS person.
  final bool awaitingYou;
  final bool canSupplement;

  /// Server-decided (inside 7 days of the closing, once per closing): the app never counts days itself.
  final bool canRequestReconsideration;
  final DateTime? reconsiderationExpiresAt;
  final List<ReconsiderationLine> reconsiderations;
  final List<ThreadLine> thread;
  final DateTime serverNow;

  factory ComplaintDetail.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    final String relation = _str(m['relation']);
    if (relation != 'SUBMITTER' && relation != 'PARTY') {
      throw const FormatException('relation');
    }
    return ComplaintDetail(
      id: _str(m['complaint_id']),
      code: _str(m['code']),
      category: complaintCategoryOf(_str(m['category'])),
      status: complaintStatusOf(_str(m['status'])),
      asParty: relation == 'PARTY',
      relatedCode: _str(_obj(m['related'])['code']),
      body: _strOrNull(m['body']),
      conclusion: _strOrNull(m['conclusion']),
      closeReason: _strOrNull(m['close_reason']),
      createdAt: _time(m['created_at']),
      closedAt: _timeOrNull(m['closed_at']),
      version: _int(m['version']),
      awaitingYou: _bool(m['awaiting_you']),
      canSupplement: _bool(m['can_supplement']),
      canRequestReconsideration: _bool(m['can_request_reconsideration']),
      reconsiderationExpiresAt: _timeOrNull(m['reconsideration_expires_at']),
      reconsiderations: <ReconsiderationLine>[
        for (final Object? e in _list(m['reconsiderations']))
          ReconsiderationLine(requestedAt: _time(_obj(e)['requested_at']), status: _str(_obj(e)['status']), decisionReason: _strOrNull(_obj(e)['decision_reason'])),
      ],
      thread: <ThreadLine>[for (final Object? e in _list(m['messages'])) ThreadLine.fromJson(e)],
      serverNow: _time(m['server_now']),
    );
  }
}

/// The answer of opening or adding to a complaint: whether it was added to an older open file instead of creating a new one.
class ComplaintFiled {
  const ComplaintFiled({required this.appended, required this.complaint});

  final bool appended;
  final ComplaintDetail complaint;

  factory ComplaintFiled.fromJson(Object? json) {
    final Map<String, Object?> m = _obj(json);
    return ComplaintFiled(appended: _bool(m['appended']), complaint: ComplaintDetail.fromJson(m['complaint']));
  }
}
