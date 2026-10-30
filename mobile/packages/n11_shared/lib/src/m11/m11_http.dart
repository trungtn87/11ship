import 'dart:convert';
import 'dart:typed_data';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../m02/menu_models.dart';
import '../m07/m07_source.dart';
import 'm11_models.dart';
import 'm11_source.dart';

// The HTTP side of M11 over the signed session. Answers are parsed strictly (a body that is not the contract is a server failure); a lost
// answer is `offline`, and the screen retries with the SAME Idempotency-Key so a write is never doubled.

M07Failure _failureOf(Object error) {
  if (error is M07Failure) {
    return error;
  }
  if (error is AuthFailure) {
    if (error.code == 'ORDER_MODULE_NOT_READY') {
      return M07Failure(M07FailureKind.notReady, code: error.code);
    }
    return switch (error.kind) {
      AuthFailureKind.unknownOutcome || AuthFailureKind.tls => const M07Failure(M07FailureKind.offline),
      AuthFailureKind.sessionEnded || AuthFailureKind.deviceProofRefused => const M07Failure(M07FailureKind.sessionEnded),
      AuthFailureKind.versionConflict => M07Failure(M07FailureKind.conflict, code: error.code ?? 'VERSION_CONFLICT'),
      AuthFailureKind.serverUnavailable => error.outcomeUnknown ? const M07Failure(M07FailureKind.offline) : const M07Failure(M07FailureKind.server),
      _ => _byCode(error.code),
    };
  }
  if (error is FormatException) {
    return const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
  }
  return const M07Failure(M07FailureKind.server);
}

M07Failure _byCode(String? code) {
  if (code == null) {
    return const M07Failure(M07FailureKind.refused);
  }
  if (code == 'ORDER_MODULE_NOT_READY') {
    return M07Failure(M07FailureKind.notReady, code: code);
  }
  if (code == 'VERSION_CONFLICT' || code.endsWith('_STATE_CONFLICT')) {
    return M07Failure(M07FailureKind.conflict, code: code);
  }
  return M07Failure(M07FailureKind.refused, code: code);
}

class HttpM11Source extends M11Source {
  const HttpM11Source({required this.session});

  final SessionController session;

  Future<Object?> _call(String method, String path, {Object? body, String? key, Set<int> ok = const <int>{200}}) async {
    try {
      final ApiResponse response = await session.protectedCall(method, path, body: body == null ? null : jsonEncode(body), idempotencyKey: key);
      if (!ok.contains(response.status)) {
        throw failureOf(response);
      }
      return response.data;
    } on Object catch (error) {
      throw _failureOf(error);
    }
  }

  T _parse<T>(Object? data, T Function(Object?) parse) {
    try {
      return parse(data);
    } on FormatException {
      throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
    }
  }

  static String _query(Map<String, String?> values) {
    final List<String> parts = <String>[for (final MapEntry<String, String?> e in values.entries) if (e.value != null) '${e.key}=${Uri.encodeQueryComponent(e.value!)}'];
    return parts.isEmpty ? '' : '?${parts.join('&')}';
  }

  Map<String, Object?> _rating(int stars, String? comment) => <String, Object?>{'stars': stars, if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()};

  // ---- ratings ---------------------------------------------------------------------------------------------------------

  @override
  Future<CustomerOrderReviewState> customerOrder(String orderId) async => _parse(await _call('GET', '/v1/customers/me/orders/$orderId/reviews'), CustomerOrderReviewState.fromJson);

  @override
  Future<void> customerRateShop(String orderId, {required int stars, String? comment, required String key}) async {
    await _call('POST', '/v1/customers/me/orders/$orderId/reviews/shop', body: _rating(stars, comment), key: key, ok: const <int>{200, 201});
  }

  @override
  Future<void> customerRateShipper(String orderId, {required int stars, String? comment, required String key}) async {
    await _call('POST', '/v1/customers/me/orders/$orderId/reviews/shipper', body: _rating(stars, comment), key: key, ok: const <int>{200, 201});
  }

  @override
  Future<CustomerDeliveryReviewState> customerDelivery(String deliveryId) async => _parse(await _call('GET', '/v1/customers/me/deliveries/$deliveryId/review'), CustomerDeliveryReviewState.fromJson);

  @override
  Future<void> customerRateDeliveryShipper(String deliveryId, {required int stars, String? comment, required String key}) async {
    await _call('POST', '/v1/customers/me/deliveries/$deliveryId/review/shipper', body: _rating(stars, comment), key: key, ok: const <int>{200, 201});
  }

  @override
  Future<ShopDeliveryReviewState> shopDelivery(String deliveryId) async => _parse(await _call('GET', '/v1/shop/me/deliveries/$deliveryId/review'), ShopDeliveryReviewState.fromJson);

  @override
  Future<void> shopRateShipper(String deliveryId, {required int stars, String? comment, required String key}) async {
    await _call('POST', '/v1/shop/me/deliveries/$deliveryId/review', body: _rating(stars, comment), key: key, ok: const <int>{200, 201});
  }

  @override
  Future<ShopReviewPage> shopReviews({int? stars}) async => _parse(await _call('GET', '/v1/shop/me/reviews${_query(<String, String?>{'stars': stars?.toString()})}'), ShopReviewPage.fromJson);

  @override
  Future<void> saveReply(String reviewId, {required String body, int? expectedVersion, required String key}) async {
    await _call('PUT', '/v1/shop/me/reviews/$reviewId/reply', body: <String, Object?>{'body': body, if (expectedVersion != null) 'expected_version': expectedVersion}, key: key);
  }

  @override
  Future<ShipperReviewPage> shipperReviews({ReviewSource? source, int? stars}) async {
    final String? wire = source == null ? null : (source == ReviewSource.customer ? 'CUSTOMER' : 'SHOP');
    return _parse(await _call('GET', '/v1/driver/reviews${_query(<String, String?>{'source': wire, 'stars': stars?.toString()})}'), ShipperReviewPage.fromJson);
  }

  @override
  Future<ShopReviewPage> publicShopReviews(String shopId, {int? stars}) async =>
      _parse(await _call('GET', '/v1/shops/$shopId/reviews${_query(<String, String?>{'stars': stars?.toString()})}'), ShopReviewPage.fromJson);

  // ---- complaints ------------------------------------------------------------------------------------------------------

  String _family(M11Role role) => '/v1/${role.prefix}/complaints';

  @override
  Future<String> uploadEvidence(M11Role role, PickedImage image) async {
    final Object? data = await _call('POST', '${_family(role)}/attachments', body: <String, Object?>{'content_type': image.contentType, 'data_base64': base64Encode(image.bytes)}, ok: const <int>{201});
    return _parse(data, (Object? v) => v is Map<String, Object?> && v['attachment_id'] is String ? v['attachment_id']! as String : throw const FormatException('attachment'));
  }

  @override
  Future<Uint8List> evidencePicture(M11Role role, String attachmentId) async {
    try {
      final ApiResponse response = await session.protectedCall('GET', '${_family(role)}/attachments/$attachmentId');
      final List<int>? bytes = response.bodyBytes;
      if (response.status != 200) {
        throw failureOf(response);
      }
      if (bytes == null || bytes.isEmpty) {
        throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
      }
      return Uint8List.fromList(bytes);
    } on Object catch (error) {
      throw _failureOf(error);
    }
  }

  @override
  Future<ComplaintListPage> complaints(M11Role role, {required bool closed}) async =>
      _parse(await _call('GET', '${_family(role)}?scope=${closed ? 'closed' : 'open'}'), ComplaintListPage.fromJson);

  @override
  Future<ComplaintDetail> complaint(M11Role role, String id) async => _parse(await _call('GET', '${_family(role)}/$id'), ComplaintDetail.fromJson);

  @override
  Future<ComplaintFiled> fileComplaint(M11Role role, {required ComplaintSubject subject, required ComplaintCategory category, required String body, List<String> attachmentIds = const <String>[], required String key}) async {
    final Object? data = await _call(
      'POST',
      _family(role),
      body: <String, Object?>{
        'category': category.wire,
        'body': body.trim(),
        if (subject.orderId != null) 'order_id': subject.orderId,
        if (subject.deliveryId != null) 'delivery_id': subject.deliveryId,
        if (subject.reviewId != null) 'review_id': subject.reviewId,
        if (attachmentIds.isNotEmpty) 'attachment_ids': attachmentIds,
      },
      key: key,
      ok: const <int>{200, 201},
    );
    return _parse(data, ComplaintFiled.fromJson);
  }

  @override
  Future<ComplaintDetail> supplement(M11Role role, String id, {String? body, List<String> attachmentIds = const <String>[], required String key}) async {
    final Object? data = await _call('POST', '${_family(role)}/$id/supplement',
        body: <String, Object?>{if (body != null && body.trim().isNotEmpty) 'body': body.trim(), if (attachmentIds.isNotEmpty) 'attachment_ids': attachmentIds}, key: key);
    return _parse(data, ComplaintDetail.fromJson);
  }

  @override
  Future<ComplaintDetail> reconsider(M11Role role, String id, {required String reason, required String key}) async =>
      _parse(await _call('POST', '${_family(role)}/$id/reconsideration', body: <String, Object?>{'reason': reason.trim()}, key: key), ComplaintDetail.fromJson);
}
