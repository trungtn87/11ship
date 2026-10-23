import '../m07/m07_source.dart';
import 'm10_models.dart';

// The data seam of the M10 screens. A screen asks a source and draws what comes back; it never invents a value. Real builds use the HTTP sources
// (m10_http.dart) over the signed session. [SampleCustomerOrders]/[SampleShopOrders] (m10_sample.dart) feed the tests and the design preview
// (--dart-define=M10_UI_PREVIEW=true) only, always labelled "Dữ liệu minh họa". A source throws [M07Failure] (the failure type of the order and delivery
// flows) on a refusal or a lost answer; the screen keeps the person's input and retries with the SAME operation key.

/// What a refusal means to the person, in words. Codes of M10; anything else falls back to the generic text of its kind.
/// It never shows a lookup code or request id: those stay in the server log.
String m10FailureText(M07Failure failure) => _m10FailureText(failure);

String _m10FailureText(M07Failure failure) {
  switch (failure.code) {
    case 'ORDER_NOT_FOUND':
      return 'Không tìm thấy đơn này.';
    case 'ORDER_STATE_CONFLICT' || 'VERSION_CONFLICT':
      return 'Đơn vừa thay đổi. Đã tải lại, hãy kiểm tra rồi thử lại.';
    case 'ORDER_CART_CHANGED':
      return 'Giá hoặc món đã thay đổi. Hãy kiểm tra lại giỏ rồi gửi lại.';
    case 'ORDER_SHOP_NOT_OPEN':
      return 'Quán chưa nhận đơn lúc này. Hãy chọn giờ hẹn hoặc quay lại sau.';
    case 'ORDER_SCHEDULE_INVALID':
      return 'Giờ hẹn chưa phù hợp với lịch hoạt động của quán.';
    case 'ORDER_ADDRESS_INVALID':
      return 'Địa chỉ giao không còn dùng được. Hãy chọn lại địa chỉ.';
    case 'ORDER_EMPTY':
      return 'Đơn không còn món nào nên chưa xác nhận được.';
    case 'ORDER_CHANGE_REASON_REQUIRED':
      return 'Đơn đã được chỉnh nên cần ghi lý do khi xác nhận.';
    case 'ORDER_CART_OTHER_SHOP':
      return 'Giỏ đang có món của quán khác.';
    case 'AFTER_PICKUP_NO_CANCEL':
      return 'Shipper đã lấy hàng nên quán không hủy đơn món được nữa. Chỉ khách đặt đơn mới hủy được; hãy gọi khách để thống nhất.';
    case 'CANCEL_NOT_ALLOWED':
      return 'Sau khi shipper lấy hàng, chỉ người tạo đơn mới hủy được.';
    case 'FEE_REQUIRED':
      return 'Chưa tính được phí giao tự động. Hãy nhập mức phí đề xuất cho shipper rồi gọi lại.';
    case 'RECALL_BLOCKED_GOODS_OUT':
      return 'Hàng chưa về quán hoặc chưa được xử lý nên chưa thực hiện được.';
    case 'SHOP_PROFILE_INCOMPLETE':
      return 'Quán chưa có vị trí lấy hàng. Hãy hoàn tất hồ sơ quán.';
    case 'DELIVERY_STATE_CONFLICT':
      return 'Yêu cầu giao vừa thay đổi. Đã tải lại, hãy kiểm tra rồi thử lại.';
    case 'ROLE_NOT_AVAILABLE':
      return 'Tài khoản chưa có quyền dùng chức năng này.';
  }
  return failure.message;
}

enum CustomerScope { processing, scheduled, history }

/// A delivery fee the shop proposes when the table cannot price the order: a reason (M06 code), an optional note and the amount.
class AgreedFeeProposal {
  const AgreedFeeProposal({required this.reasonCode, this.reasonNote, required this.amountVnd});

  final String reasonCode;
  final String? reasonNote;
  final int amountVnd;

  Map<String, Object?> toJson() => <String, Object?>{'reason_code': reasonCode, if (reasonNote != null && reasonNote!.trim().isNotEmpty) 'reason_note': reasonNote!.trim(), 'amount_vnd': amountVnd};
}

/// One change of the shop to a line of an Order that still waits for confirmation.
class LineEdit {
  const LineEdit({required this.lineId, this.quantity, this.priceVnd, this.remove = false});

  final String lineId;
  final int? quantity;
  final int? priceVnd;
  final bool remove;

  Map<String, Object?> toJson() => <String, Object?>{'line_id': lineId, if (remove) 'remove': true, if (!remove && quantity != null) 'quantity': quantity, if (!remove && priceVnd != null) 'unit_price_vnd': priceVnd};
}

/// The customer side (11Food).
abstract class CustomerOrderSource {
  const CustomerOrderSource();

  /// True only for illustrative data: every screen then carries the sample banner.
  bool get isSample;

  /// The saved cart as the server prices it now; null when there is none.
  Future<CartView?> cart();
  Future<CartView?> saveCart({required String shopId, required List<DraftLine> lines, String? note});
  Future<void> clearCart();
  Future<CheckoutPreview> preview(CheckoutDraft draft);

  /// [clientRef] is the id of THIS attempt: the same one is used for every retry, so a lost answer never makes two Orders.
  Future<OrderView> place(CheckoutDraft draft, {required String clientRef, required String key});

  /// Did an attempt whose answer was lost reach the server? Null when it did not.
  Future<OrderView?> lookup(String clientRef);
  Future<List<OrderSummary>> list(CustomerScope scope);
  Future<OrderView> get(String id);
  Future<OrderView> cancel(String id, {String? reason, required int expectedVersion, required String key});

  /// After the Shipper picked up the goods the customer who placed the order is the only one who can cancel it (a reason is required).
  Future<OrderView> cancelAfterPickup(String id, {required String reason, required int expectedVersion, required String key});

  /// The customer, as the payer, answers the delivery fee the Shipper proposed. [deliveryVersion] is `OrderDelivery.version`.
  Future<OrderView> decideFee(String id, {required bool accept, required int deliveryVersion, required String key});
  Future<ReorderResult> reorder(String id, {required bool replaceCart, required String key});
}

/// The shop side (11Food).
abstract class ShopOrderSource {
  const ShopOrderSource();

  bool get isSample;

  /// [filter]: all, pending, preparing, scheduled, delivering, attention, history.
  Future<OrderList> list({required String filter, String query = '', DateTime? from, DateTime? to});

  /// HTTP sources paginate on the server; sample sources keep the in-memory preview.
  Future<OrderList> listPage({required String filter, String query = '', DateTime? from, DateTime? to, int offset = 0}) =>
      list(filter: filter, query: query, from: from, to: to);
  Future<OrderView> get(String id);
  Future<OrderView> edit(String id, {required List<LineEdit> changes, required int expectedVersion, required String key});
  Future<OrderView> confirm(String id, {String? changeReason, required int expectedVersion, required String key});
  Future<OrderView> reject(String id, {required String reason, required int expectedVersion, required String key});

  /// "Gọi shipper" means the dishes are ready: a delivery from the confirmed snapshot (also a new call after a stopped search / cancelled request /
  /// settled goods). [agreedFee] is given only when the server answered FEE_REQUIRED: the fee could not be priced automatically.
  Future<OrderView> callShipper(String id, {required String feePayer, AgreedFeeProposal? agreedFee, required int expectedVersion, required String key});
  Future<OrderView> cancel(String id, {required String reason, required int expectedVersion, required String key});
  Future<OrderView> closeNotCompleted(String id, {required String reason, required int expectedVersion, required String key});

  /// After a failed delivery (goods): the existing M07 command.
  Future<void> resolveCustody(String deliveryId, {required String resolution, String? note, required String key});
}
