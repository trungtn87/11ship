import '../m02/menu_models.dart';
import '../m07/m07_source.dart';
import 'm11_models.dart';

// The data seam of the M11 screens (ratings and complaints). A screen asks a source and draws whatever comes back; it never invents a value.
// Failures reuse [M07Failure]: the same kinds (offline = outcome unknown, retry with the SAME key; conflict = reload) and the shared screens'
// banner and action helpers. The HTTP source is m11_http.dart. There is no sample source: M11 shows real data only.

abstract class M11Source {
  const M11Source();

  // ---- ratings ---------------------------------------------------------------------------------------------------------

  /// Customer: the shop and Shipper of one order and what may still be rated.
  Future<CustomerOrderReviewState> customerOrder(String orderId);
  Future<void> customerRateShop(String orderId, {required int stars, String? comment, required String key});
  Future<void> customerRateShipper(String orderId, {required int stars, String? comment, required String key});

  /// Shop: may it rate the Shipper of this delivery, and what it rated.
  Future<ShopDeliveryReviewState> shopDelivery(String deliveryId);
  Future<void> shopRateShipper(String deliveryId, {required int stars, String? comment, required String key});

  /// Shop: its own customer ratings with its replies.
  Future<ShopReviewPage> shopReviews({int? stars});
  Future<void> saveReply(String reviewId, {required String body, int? expectedVersion, required String key});

  /// Shipper: the scores about them by source.
  Future<ShipperReviewPage> shipperReviews({ReviewSource? source, int? stars});

  /// What anybody sees on a shop's page.
  Future<ShopReviewPage> publicShopReviews(String shopId, {int? stars});

  // ---- complaints ------------------------------------------------------------------------------------------------------

  Future<String> uploadEvidence(M11Role role, PickedImage image);
  Future<ComplaintListPage> complaints(M11Role role, {required bool closed});
  Future<ComplaintDetail> complaint(M11Role role, String id);
  Future<ComplaintFiled> fileComplaint(M11Role role, {required ComplaintSubject subject, required ComplaintCategory category, required String body, List<String> attachmentIds = const <String>[], required String key});
  Future<ComplaintDetail> supplement(M11Role role, String id, {String? body, List<String> attachmentIds = const <String>[], required String key});
  Future<ComplaintDetail> reconsider(M11Role role, String id, {required String reason, required String key});
}

/// The failure a screen shows for something the person did wrong before any request.
M07Failure m11LocalRefusal(String code) => M07Failure(M07FailureKind.refused, code: code);
