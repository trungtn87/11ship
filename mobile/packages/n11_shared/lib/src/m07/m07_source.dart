import '../account/models.dart';
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

String m07FailureText(M07Failure failure) => withRequestTrace(_m07FailureText(failure), failure.requestId);

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
      return 'Đã nhận hàng nên không hủy được nữa.';
    case 'FEE_NOT_CONFIRMED':
      return 'Phí giao chưa được chốt.';
    case 'DESTINATION_NOT_CONFIRMED':
      return 'Cần ghim điểm giao và xác nhận phí trước khi nhận hàng.';
    case 'FEE_LOCKED':
      return 'Phí đã khóa sau khi nhận hàng.';
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

  /// True only for illustrative data: every screen then carries the sample banner.
  bool get isSample;

  Future<List<DeliveryView>> list({required bool history, String query = ''});

  /// Live HTTP sources filter on the server. Sample sources use this fallback
  /// so previews can display both active and ended requests under 'Tất cả'.
  Future<List<DeliveryView>> listFiltered({String filter = 'all', String query = '', DateTime? from, DateTime? to}) async {
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

  /// After a failed delivery: GOODS_RETURNED (back at the shop, may be called again) or HANDLED_NO_RETURN (dealt with, close the incident).
  Future<DeliveryView> resolveCustody(String id, {required String resolution, String? note, required String key});
}

/// The Shipper side (11Ship).
abstract class ShipperDeliverySource {
  const ShipperDeliverySource();

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
  Future<DeliveryView> confirmDestination(String id, {required double lat, required double lng, int? feeVnd, required int expectedVersion, required String key});
  Future<DeliveryView> pickup(String id, {required int expectedVersion, required String key});
  Future<DeliveryView> complete(String id, {required int expectedVersion, required String key});
  Future<DeliveryView> fail(String id, {required String reasonCode, String? note, required String goodsCondition, required int expectedVersion, required String key});
}
