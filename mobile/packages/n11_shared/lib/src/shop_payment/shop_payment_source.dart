import '../m10/order_chat_models.dart';
import 'shop_payment_models.dart';

/// The data seam of the "Thanh toán quán" screens. The server decides every right at every call; a source throws `M07Failure` on a refusal or a lost
/// answer. Every write carries an Idempotency-Key that the SCREEN keeps until it has a definite answer, so a lost answer retried writes nothing twice.
abstract class ShopPaymentSource {
  const ShopPaymentSource();

  /// True only for illustrative data.
  bool get isSample;

  /// The payment conversation of a request ("Trao đổi thanh toán"); null in a build whose source has none.
  OrderChatApi? get chat => null;

  /// The accounts of the system that accept money now; empty until SYSTEM configures one. Never invented.
  Future<List<PaymentAccount>> accounts();

  Future<ShopPaymentPage> list({String? cursor});
  Future<ShopPayment> detail(String requestId);

  /// Asks for [amount] for [purpose]. It takes no money and opens nothing.
  Future<ShopPayment> create({required ShopPaymentPurpose purpose, required int amount, required String key});

  /// "Tôi đã chuyển khoản": ONE mark and a notice for the administration. It confirms nothing, opens no account and grants no right.
  Future<ShopPayment> report(String requestId, {required String key});

  /// Only before the report.
  Future<ShopPayment> cancel(String requestId, {required int version, required String key});
}
