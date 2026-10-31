import '../account/session_controller.dart' show SessionController;
import '../m10/order_chat_models.dart' show OrderChatApi;
import 'm07_models.dart';

// The data seam of the M07 screens. A screen asks a source and draws whatever comes back; it never invents a value.
//
// Real builds use the HTTP sources (m07_http.dart) over the signed session. [SampleShopSource]/[SampleShipperSource] (m07_sample.dart) feed the
// preview build (--dart-define=M07_UI_PREVIEW=true) and the tests only, always labelled "Dữ liệu minh họa". A source throws [M07Failure] on a
// refusal or a lost answer; the screen shows it, keeps the person's input and lets them retry with the SAME operation key.

enum M07FailureKind {
  /// No complete answer (offline, timeout): the outcome of a write is UNKNOWN until the person retries with the same key.
  offline,

  /// The record moved on (VERSION_CONFLICT, *_STATE_CONFLICT): reload and decide again.
  conflict,

  /// The server refused with a business code.
  refused,

  /// A module the action depends on is not connected (for example the Order module).
  notReady,

  /// The session ended or lost its role.
  sessionEnded,

  /// The server could not answer now.
  server,
}

class M07Failure implements Exception {
  const M07Failure(this.kind, {this.code, this.requestId});

  final M07FailureKind kind;
  final String? code;
  final String? requestId;

  String get message => m07FailureText(this);

  @override
  String toString() => 'M07Failure($kind, $code)';
}

/// The sentence the person reads. It never shows a lookup code, a request id or any identifier: those stay in the server log.
String m07FailureText(M07Failure failure) => _m07FailureText(failure);

String _m07FailureText(M07Failure failure) {
  switch (failure.code) {
    case 'DELIVERY_NOT_FOUND':
      return 'Không tìm thấy yêu cầu giao này.';
    case 'DELIVERY_STATE_CONFLICT' || 'VERSION_CONFLICT':
      return 'Yêu cầu giao vừa thay đổi. Đã tải lại, hãy kiểm tra rồi thử lại.';
    case 'DELIVERY_ALREADY_TAKEN':
      return 'Đơn này đã có shipper khác nhận.';
    case 'DELIVERY_SEARCH_EXPIRED':
      return 'Đơn đã hết thời gian tìm shipper.';
    case 'DELIVERY_NOT_ELIGIBLE':
      return 'Bạn chưa đủ điều kiện nhận đơn này.';
    case 'REASON_REQUIRED':
      return 'Cần nhập lý do.';
    case 'AFTER_PICKUP_NO_CANCEL':
      return 'Hàng đã được lấy nên bạn không hủy được nữa. Hãy gọi người tạo đơn để thống nhất.';
    case 'CANCEL_NOT_ALLOWED':
      return 'Sau khi shipper lấy hàng, chỉ người tạo đơn mới hủy được.';
    case 'SHIPPER_FAIL_NOT_ALLOWED':
      return 'Không giao được thì hãy gọi quán để thống nhất, không báo giao thất bại trên ứng dụng.';
    case 'FEE_NOT_CONFIRMED':
      return 'Phí giao chưa được chốt. Hãy nhập mức phí đã thống nhất với bên trả phí.';
    case 'FEE_REQUIRED':
      return 'Chưa tính được phí giao tự động. Hãy chọn mốc phí hoặc nhập mức phí đề xuất rồi gọi lại.';
    case 'DESTINATION_NOT_CONFIRMED':
      return 'Đơn chưa sẵn sàng để lấy hàng. Hãy tải lại rồi thử lại.';
    case 'FEE_LOCKED':
      return 'Phí giao đã chốt, không đổi được nữa.';
    case 'RECALL_BLOCKED_GOODS_OUT':
      return 'Hàng chưa về quán hoặc chưa được xử lý nên chưa gọi lại được.';
    case 'ORDER_MODULE_NOT_READY':
      return 'Đơn từ Order chưa dùng được vì module đặt món chưa sẵn sàng.';
    case 'DELIVERY_INPUT_INVALID':
      return 'Thông tin chưa hợp lệ. Hãy kiểm tra lại các ô đã nhập.';
    case 'REVIEW_NOT_ELIGIBLE':
      return 'Chưa đánh giá được ở thời điểm này.';
    case 'REVIEW_ALREADY_EXISTS':
      return 'Bạn đã đánh giá rồi. Mỗi đối tượng chỉ đánh giá một lần.';
    case 'REVIEW_NOT_FOUND' || 'REVIEW_TARGET_NOT_FOUND' || 'COMPLAINT_TARGET_NOT_FOUND' || 'COMPLAINT_NOT_FOUND':
      return 'Không tìm thấy nội dung này.';
    case 'COMPLAINT_STATE_CONFLICT':
      return 'Hồ sơ vừa thay đổi. Đã tải lại, hãy kiểm tra rồi thử lại.';
    case 'COMPLAINT_ATTACHMENT_INVALID':
      return 'Ảnh không hợp lệ. Dùng ảnh JPEG, PNG hoặc WebP, tối đa 5 MB.';
    case 'COMPLAINT_ATTACHMENT_LIMIT':
      return 'Tối đa 5 ảnh cho mỗi lần gửi.';
    case 'COMPLAINT_FORBIDDEN':
      return 'Bạn không có quyền thực hiện việc này trên hồ sơ.';
    case 'RECONSIDERATION_EXPIRED':
      return 'Đã hết 7 ngày để yêu cầu xem xét lại.';
    case 'RECONSIDERATION_NOT_AVAILABLE':
      return 'Hồ sơ này không còn yêu cầu xem xét lại được.';
    case 'SHOP_PROFILE_INCOMPLETE':
      return 'Quán chưa có vị trí lấy hàng. Hãy hoàn tất hồ sơ quán.';
    case 'ORDER_CHAT_CLOSED':
      return 'Đơn đã kết thúc. Bạn chỉ có thể xem lại trao đổi.';
    case 'ORDER_CHAT_NOT_PARTICIPANT':
      return 'Bạn không còn quyền gửi tin trong trao đổi này.';
    case 'ORDER_CHAT_RATE_LIMITED':
      return 'Bạn gửi quá nhanh. Hãy đợi vài giây rồi gửi lại.';
  }
  return switch (failure.kind) {
    M07FailureKind.offline => 'Chưa gửi được vì mất kết nối. Hãy thử lại.',
    M07FailureKind.conflict => 'Dữ liệu vừa thay đổi. Hãy tải lại rồi thử lại.',
    M07FailureKind.refused => 'Máy chủ không chấp nhận thao tác này.',
    M07FailureKind.notReady => 'Chức năng này chưa sẵn sàng.',
    M07FailureKind.sessionEnded => 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.',
    M07FailureKind.server => 'Máy chủ chưa trả lời được. Hãy thử lại sau.',
  };
}

/// The shop side (11Food).
abstract class ShopDeliverySource {
  const ShopDeliverySource();

  /// The chat of a direct call (no order around it); null in a build whose source has none.
  OrderChatApi? get chat => null;

  /// True only for illustrative data: every screen then carries the sample banner.
  bool get isSample;

  Future<List<DeliveryView>> list({required bool history, String query = ''});

  /// Live HTTP sources filter on the server. Sample sources use this fallback
  /// so previews can display both active and ended requests under 'Tất cả'.
  Future<List<DeliveryView>> listFiltered({String filter = 'all', String query = '', DateTime? from, DateTime? to, int offset = 0}) async {
    final List<DeliveryView> active = await list(history: false, query: query);
    final List<DeliveryView> ended = await list(history: true, query: query);
    final List<DeliveryView> all = <DeliveryView>[...active, ...ended];
    return all.where((DeliveryView item) => filter == 'history' ? ended.contains(item) : switch (filter) {
      'searching' => item.state == DeliveryState.waitingDriver || item.state == DeliveryState.searchStopped,
      'accepted' => item.state == DeliveryState.accepted || item.state == DeliveryState.locationConfirmed,
      'delivering' => item.state == DeliveryState.pickedUp || item.state == DeliveryState.delivering,
      'completed' => item.state == DeliveryState.completed,
      'failed' => item.state == DeliveryState.failed || item.state == DeliveryState.cancelledByMerchant || item.state == DeliveryState.cancelledBySystem,
      _ => true,
    }).toList();
  }
  Future<DeliveryView> get(String id);
  Future<DeliveryView> create(NewDeliveryInput input, {required String key});
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key});

  /// A new delivery for the same goods; the old one stays in the history.
  Future<DeliveryView> recall(String id, {required String key});

  /// The shop answers a Shipper's counter-offer on the fee. Rejecting keeps the original proposal and the search clock.
  Future<DeliveryView> answerCounter(String id, {required bool accept, required int expectedVersion, required String key});

  /// The shop records that the customer agreed to the fee (the customer has no app yet).
  Future<DeliveryView> confirmCustomerFee(String id, {required int expectedVersion, required String key});

  /// The three bands of the fee table (index 0..2) for an address with no map point; empty when no table is in force.
  Future<List<FeeBand>> feeBands();

  /// After a failed delivery: GOODS_RETURNED (back at the shop, may be called again) or HANDLED_NO_RETURN (dealt with, close the incident).
  Future<DeliveryView> resolveCustody(String id, {required String resolution, String? note, required String key});
}

/// The Shipper side (11Ship).
abstract class ShipperDeliverySource {
  const ShipperDeliverySource();

  /// The chat of the delivery the Shipper holds; null in a build whose source has none.
  OrderChatApi? get chat => null;

  bool get isSample;

  Future<List<OfferView>> offers();
  Future<List<DeliveryView>> mine({required bool history});
  Future<DeliveryView> get(String id);
  Future<DeliveryView> accept(String id, {required String key});
  Future<DeliveryView> release(String id, {required String reason, required int expectedVersion, required String key});

  /// M06 fee agreement before accepting: agree to the proposed amount, skip the order, or propose another amount.
  Future<OfferView> feeAgree(String id, {required String key});
  Future<void> feeSkip(String id, {required String key});
  Future<OfferView> feeCounter(String id, {required int amountVnd, required String key});

  /// Only when the server says `can.confirm_fee` (a call that was never priced): the amount agreed with the payer. No map point is needed.
  Future<DeliveryView> confirmFee(String id, {required int feeVnd, required int expectedVersion, required String key});
  Future<DeliveryView> pickup(String id, {required int expectedVersion, required String key});
  Future<DeliveryView> complete(String id, {required int expectedVersion, required String key});
  Future<DeliveryView> decideAddressChange(
    String id, {
    required bool accept,
    String? reason,
    required int expectedVersion,
    required String key,
  }) => throw UnimplementedError();
}

class TrackingLinkResult {
  const TrackingLinkResult({required this.trackingId, required this.token, required this.trackingUrl, required this.shareLocation});

  factory TrackingLinkResult.fromJson(Object? raw) {
    final Map<String, Object?> m = raw is Map<String, Object?> ? raw : throw const FormatException('object');
    return TrackingLinkResult(
      trackingId: m['tracking_id'] as String,
      token: m['token'] as String,
      trackingUrl: m['tracking_url'] as String,
      shareLocation: m['share_location'] as bool? ?? false,
    );
  }

  final String trackingId;
  final String token;
  final String trackingUrl;
  final bool shareLocation;
}

class TrackingLinkStatus {
  const TrackingLinkStatus({required this.hasActiveLink, required this.shareLocation});

  factory TrackingLinkStatus.fromJson(Object? raw) {
    final Map<String, Object?> m = raw is Map<String, Object?> ? raw : throw const FormatException('object');
    return TrackingLinkStatus(
      hasActiveLink: m['has_active_link'] as bool? ?? false,
      shareLocation: m['share_location'] as bool? ?? false,
    );
  }

  final bool hasActiveLink;
  final bool shareLocation;
}

class AgreedFeeInput {
  const AgreedFeeInput({
    required this.amountVnd,
    this.reasonCode = 'CUSTOMER_INITIATED',
    this.reasonNote,
  });

  final int amountVnd;
  final String reasonCode;
  final String? reasonNote;
}

class NewCustomerDeliveryInput {
  const NewCustomerDeliveryInput({
    this.senderName = 'Khách gửi hàng',
    required this.senderPhone,
    required this.pickupAddressText,
    this.pickupLat,
    this.pickupLng,
    required this.recipientName,
    required this.recipientPhone,
    required this.dropoffAddressText,
    this.dropoffLat,
    this.dropoffLng,
    required this.goodsDescription,
    this.goodsValueVnd = 0,
    this.codVnd = 0,
    this.feePayer = 'RECIPIENT',
    this.note,
    this.agreedFee,
  });

  final String senderName;
  final String senderPhone;
  final String pickupAddressText;
  final double? pickupLat;
  final double? pickupLng;
  final String recipientName;
  final String recipientPhone;
  final String dropoffAddressText;
  final double? dropoffLat;
  final double? dropoffLng;
  final String goodsDescription;
  final int goodsValueVnd;
  final int codVnd;
  final String feePayer;
  final String? note;
  final AgreedFeeInput? agreedFee;
}

/// The customer side (11Food): call a shipper directly, track, cancel, decide fee, and share tracking link.
abstract class CustomerDeliverySource {
  const CustomerDeliverySource();

  /// The chat of a customer delivery; null in a build whose source has none.
  OrderChatApi? get chat => null;

  /// The active user session if available.
  SessionController? get session => null;

  bool get isSample;

  Future<List<DeliveryView>> list({required bool history});
  Future<DeliveryView> get(String id);
  Future<DeliveryView> create(NewCustomerDeliveryInput input, {required String key});
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key});
  Future<DeliveryView> cancelAfterPickup(String id, {required String reason, required int expectedVersion, required String key});
  Future<DeliveryView> counterAccept(String id, {required int expectedVersion, required String key});
  Future<DeliveryView> counterReject(String id, {required int expectedVersion, required String key});
  Future<TrackingLinkResult> createTrackingLink(String id);
  Future<TrackingLinkStatus> getTrackingLinkStatus(String id);
  Future<TrackingLinkStatus> toggleTrackingLocation(String id, {required bool shareLocation});
  Future<void> revokeTrackingLink(String id);
  Future<DeliveryView> requestAddressChange(
    String id, {
    required String recipientName,
    required String recipientPhone,
    required String addressText,
    double? lat,
    double? lng,
    String? note,
    required int expectedVersion,
    required String key,
  }) => throw UnimplementedError();
  Future<DeliveryView> cancelAddressChange(
    String id, {
    required int expectedVersion,
    required String key,
  }) => throw UnimplementedError();
}
