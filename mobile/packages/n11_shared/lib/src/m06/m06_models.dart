// M06 UI phase (docs/current/M06-design-UI-LOCKED-2026-10-16.md section 5): what the three phone screens may show.
//
// PRIVACY BY TYPE. [OrderOfferView] (what a Shipper sees BEFORE accepting) has no field for a customer phone, a detailed address or a drop-off
// coordinate, so no screen built on it can show one. Money is whole VND; a fee that is not known is `null` (shown "Chưa xác định phí"), never 0.

/// Who pays the delivery fee (the shop picks it when calling a Shipper; payment itself is outside the wallet).
enum FeePayer { customer, shop }

/// 11Food, "Phí giao hàng": what M06 knows about the delivery being requested.
class ShippingFeeView {
  const ShippingFeeView(
      {required this.pickupConfirmed,
      required this.dropoffChosen,
      this.distanceMeters,
      this.feeVnd,
      this.outOfPriceRange = false,
      this.agreement});

  /// The shop position (M02) is confirmed.
  final bool pickupConfirmed;

  /// The customer chose a drop-off position. False when the order only has a text description.
  final bool dropoffChosen;

  /// Route distance in metres from M14; null when there is no valid route (never a straight-line guess).
  final int? distanceMeters;

  /// Fee from the policy in force; null = not determined (no drop-off position, no route, or no policy applied).
  final int? feeVnd;

  /// The route distance is beyond the last band: there is no table fee ("Ngoài bảng giá", not 0đ) and nothing is added automatically.
  final bool outOfPriceRange;

  /// null until the shop chose how the fee is set.
  final FeeAgreementView? agreement;

  bool get feeKnown => feeVnd != null && distanceMeters != null;
}

/// Technical cap of a final delivery fee (same as the backend): above it the app refuses the amount instead of clamping it.
const int kAgreedFeeMax = 10000000;

/// How the fee is set: from the three bands, or agreed between the parties.
enum FeeMode { standard, agreed }

/// Why the shop proposes an agreed fee.
enum FeeReason { urgent, bulky, badWeather, outsideTable, other }

String feeReasonText(FeeReason reason) => switch (reason) {
      FeeReason.urgent => 'Gấp',
      FeeReason.bulky => 'Cồng kềnh',
      FeeReason.badWeather => 'Thời tiết xấu',
      FeeReason.outsideTable => 'Ngoài bảng giá',
      FeeReason.other => 'Khác',
    };

/// Where the agreement stands. Only `accepted` and `locked` carry a final fee.
enum AgreementState { proposed, countered, awaitingCustomer, accepted, declined, expired, locked }

/// The fee agreement of one delivery as an app draws it. No phone, address or coordinate is part of it.
class FeeAgreementView {
  const FeeAgreementView({
    required this.mode,
    required this.state,
    required this.payer,
    this.baseFeeVnd,
    this.reason,
    this.reasonNote,
    this.proposedFeeVnd,
    this.counterFeeVnd,
    this.finalFeeVnd,
    this.expiresAt,
  });

  final FeeMode mode;
  final AgreementState state;
  final FeePayer payer;
  final int? baseFeeVnd;
  final FeeReason? reason;
  final String? reasonNote;
  final int? proposedFeeVnd;
  final int? counterFeeVnd;

  /// null until the fee is final (never 0).
  final int? finalFeeVnd;
  final DateTime? expiresAt;
}

/// The result of the eligibility check (M06-B) as the app draws it: eligible, or the reason codes (see [m06ReasonText]).
class EligibilityView {
  const EligibilityView(
      {required this.eligible, this.reasonCodes = const <String>[]});

  final bool eligible;
  final List<String> reasonCodes;
}

/// 11Ship, "Đơn có thể nhận": ONLY what the rules allow before acceptance. No phone, no street address, no map position of the drop-off.
class OrderOfferView {
  const OrderOfferView({
    required this.orderRef,
    required this.shopName,
    required this.pickupArea,
    required this.dropoffArea,
    required this.eligibility,
    this.distanceToShopMeters,
    this.goodsVnd,
    this.shipFeeVnd,
    this.agreement,
  });

  final String orderRef;
  final String shopName;

  /// A district-level description ("Khu vực TP. Cao Bằng"), not an address.
  final String pickupArea;
  final String dropoffArea;
  final int? distanceToShopMeters;
  final int? goodsVnd;

  /// null = "Chưa xác định phí".
  final int? shipFeeVnd;
  final EligibilityView eligibility;

  /// The fee proposal for an AGREED delivery (amount, reason): shown before accepting. No phone, address or coordinate is part of it.
  final FeeAgreementView? agreement;
}

/// One "try to add this order" result of the batching rule (M06-C).
class BatchAttempt {
  const BatchAttempt(
      {required this.label,
      required this.ok,
      this.etaAfter,
      this.addedDelaySeconds,
      this.reasonCode});

  /// "đơn B", "thêm C".
  final String label;
  final bool ok;

  /// The old order's ETA after the batch (null when it could not be computed).
  final DateTime? etaAfter;

  /// Total delay against the ORIGINAL ETA, in seconds (cumulative).
  final int? addedDelaySeconds;
  final String? reasonCode;
}

/// 11Ship, "Đánh giá ghép đơn": the protected order, its ORIGINAL ETA, the limit and the attempts.
class BatchEvaluationView {
  const BatchEvaluationView(
      {required this.orderRef,
      required this.originalEta,
      required this.maxDelaySeconds,
      required this.attempts});

  final String orderRef;
  final DateTime originalEta;
  final int maxDelaySeconds;
  final List<BatchAttempt> attempts;
}

/// Short Vietnamese sentence for each reason code M06 returns (docs/current/M06-BC-eligibility-batching-20261017.md). Unknown codes get a
/// neutral sentence: the app never shows a raw code to a person.
String m06ReasonText(String code) => switch (code) {
      'DRIVER_NOT_ACTIVE' => 'Hồ sơ shipper chưa được duyệt hoặc đang bị khóa.',
      'DRIVER_NOT_ACCEPTING' => 'Bạn đang tắt nhận đơn.',
      'DRIVER_BANK_NOT_VERIFIED' => 'Tài khoản ngân hàng chưa được xác minh.',
      'DELIVERY_NOT_AVAILABLE' =>
        'Đơn này đã có người nhận hoặc không còn tìm shipper.',
      'DELIVERY_SEARCH_EXPIRED' => 'Đơn đã hết thời gian tìm shipper.',
      'LOCATION_UNAVAILABLE' => 'Chưa có vị trí hợp lệ của bạn.',
      'LOCATION_STALE' => 'Vị trí của bạn đã cũ. Hãy bật định vị và thử lại.',
      'SHOP_LOCATION_MISSING' => 'Chưa có vị trí quán để tính khoảng cách.',
      'OUT_OF_SEARCH_RADIUS' => 'Bạn ở ngoài bán kính nhận đơn (3 km).',
      'ACTIVE_LIMIT_REACHED' =>
        'Bạn đã đạt số đơn tối đa được phép nhận cùng lúc.',
      'WALLET_UNAVAILABLE' => 'Chưa đọc được số dư ví.',
      'BALANCE_TOO_LOW' => 'Số dư ví khả dụng chưa đủ để nhận đơn này.',
      'DEPENDENCY_NOT_READY' => 'Hệ thống nhận đơn chưa sẵn sàng.',
      'ROUTE_DATA_UNAVAILABLE' =>
        'Chưa tính được tuyến đường, nên chưa thể ghép đơn.',
      'ROUTE_STALE' => 'Dữ liệu tuyến đã cũ. Hãy kiểm tra lại.',
      'BATCH_ORDER_DATA_MISSING' =>
        'Thiếu tọa độ hoặc ETA của đơn, nên không ghép được.',
      'BATCH_DELAY_EXCEEDED' =>
        'Ghép đơn này sẽ làm đơn đang giao chậm quá giới hạn cho phép.',
      'BATCH_BUDGET_EXCEEDED' =>
        'Chưa đánh giá xong việc ghép đơn. Hãy thử lại.',
      _ => 'Chưa đủ điều kiện nhận đơn này.',
    };
