import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../m10/m10_http.dart' show HttpOrderChatApi;
import '../m10/order_chat_models.dart' show OrderChatApi;
import 'm07_models.dart';
import 'm07_source.dart';

// The HTTP side of the M07 sources: signed requests of the session (Bearer + device proof). Every answer is parsed strictly; a body that is
// not what the contract says is a server failure, never a half-filled screen. A lost answer is `offline`: the write may or may not have
// happened, and the screen retries with the SAME Idempotency-Key.

M07Failure _failureOf(Object error) {
  if (error is M07Failure) {
    return error;
  }
  if (error is AuthFailure) {
    if (error.code == 'ORDER_MODULE_NOT_READY') {
      return M07Failure(M07FailureKind.notReady, code: error.code, requestId: error.requestId);
    }
    final M07Failure mapped = switch (error.kind) {
      AuthFailureKind.unknownOutcome || AuthFailureKind.tls => const M07Failure(M07FailureKind.offline),
      AuthFailureKind.sessionEnded || AuthFailureKind.deviceProofRefused => const M07Failure(M07FailureKind.sessionEnded),
      AuthFailureKind.versionConflict => M07Failure(M07FailureKind.conflict, code: error.code ?? 'VERSION_CONFLICT'),
      AuthFailureKind.serverUnavailable => error.outcomeUnknown ? const M07Failure(M07FailureKind.offline) : const M07Failure(M07FailureKind.server),
      _ => _byCode(error.code),
    };
    return M07Failure(mapped.kind, code: mapped.code, requestId: error.requestId);
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
  if (code == 'VERSION_CONFLICT' || code.endsWith('_STATE_CONFLICT') || code == 'DELIVERY_ALREADY_TAKEN') {
    return M07Failure(M07FailureKind.conflict, code: code);
  }
  return M07Failure(M07FailureKind.refused, code: code);
}

Future<Object?> _call(SessionController session, String method, String path, {Object? body, String? key, Set<int> ok = const <int>{200}}) async {
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

DeliveryView _delivery(Object? data) {
  try {
    return DeliveryView.fromJson(data is Map<String, Object?> && data['delivery'] != null ? data['delivery'] : data);
  } on FormatException {
    throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
  }
}

List<T> _items<T>(Object? data, String field, T Function(Object?) parse) {
  try {
    final Object? list = data is Map<String, Object?> ? data[field] : null;
    if (list is! List<Object?>) {
      throw const FormatException('list');
    }
    return <T>[for (final Object? item in list) parse(item)];
  } on FormatException {
    throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
  }
}

class HttpShopDeliverySource extends ShopDeliverySource {
  const HttpShopDeliverySource({required this.session});

  final SessionController session;

  @override
  OrderChatApi get chat => HttpOrderChatApi(session: session);

  @override
  bool get isSample => false;

  String _path(String id, [String tail = '']) => '/v1/shop/me/deliveries/$id$tail';

  @override
  Future<List<DeliveryView>> list({required bool history, String query = ''}) async {
    final String q = query.trim().isEmpty ? '' : '&q=${Uri.encodeQueryComponent(query.trim())}';
    final Object? data = await _call(session, 'GET', '/v1/shop/me/deliveries?scope=${history ? 'history' : 'active'}$q');
    return _items<DeliveryView>(data, 'deliveries', DeliveryView.fromJson);
  }

  @override
  Future<List<DeliveryView>> listFiltered({String filter = 'all', String query = '', DateTime? from, DateTime? to, int offset = 0}) async {
    final List<String> params = <String>[
      'scope=all',
      'filter=${Uri.encodeQueryComponent(filter)}',
      'limit=50',
      'offset=$offset',
      if (query.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(query.trim())}',
      if (from != null) 'from=${Uri.encodeQueryComponent(from.toUtc().toIso8601String())}',
      if (to != null) 'to=${Uri.encodeQueryComponent(to.toUtc().toIso8601String())}',
    ];
    final Object? data = await _call(session, 'GET', '/v1/shop/me/deliveries?${params.join('&')}');
    return _items<DeliveryView>(data, 'deliveries', DeliveryView.fromJson);
  }

  @override
  Future<DeliveryView> get(String id) async => _delivery(await _call(session, 'GET', _path(id)));

  @override
  Future<DeliveryView> create(NewDeliveryInput input, {required String key}) async =>
      _delivery(await _call(session, 'POST', '/v1/shop/me/deliveries', body: input.toJson(), key: key, ok: const <int>{200, 201}));

  @override
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/cancel'), body: <String, Object?>{'reason': reason, 'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> recall(String id, {required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/recall'), body: <String, Object?>{}, key: key, ok: const <int>{200, 201}));

  @override
  Future<DeliveryView> answerCounter(String id, {required bool accept, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, accept ? '/fee/counter-accept' : '/fee/counter-reject'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> confirmCustomerFee(String id, {required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/fee/customer-confirm'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  Future<List<FeeBand>> feeBands() async => _items<FeeBand>(await _call(session, 'GET', '/v1/shop/me/delivery-fee-bands'), 'bands', FeeBand.fromJson);

  @override
  Future<DeliveryView> resolveCustody(String id, {required String resolution, String? note, required String key}) async => _delivery(await _call(session, 'POST', _path(id, '/custody'),
      body: <String, Object?>{'resolution': resolution, if (note != null && note.trim().isNotEmpty) 'note': note.trim()}, key: key));
}

class HttpShipperDeliverySource extends ShipperDeliverySource {
  const HttpShipperDeliverySource({required this.session});

  final SessionController session;

  @override
  OrderChatApi get chat => HttpOrderChatApi(session: session);

  @override
  bool get isSample => false;

  String _path(String id, [String tail = '']) => '/v1/driver/deliveries/$id$tail';

  @override
  Future<List<OfferView>> offers() async => _items<OfferView>(await _call(session, 'GET', '/v1/driver/deliveries/offers'), 'offers', OfferView.fromJson);

  @override
  Future<List<DeliveryView>> mine({required bool history}) async =>
      _items<DeliveryView>(await _call(session, 'GET', '/v1/driver/deliveries/mine?scope=${history ? 'history' : 'active'}'), 'deliveries', DeliveryView.fromJson);

  @override
  Future<DeliveryView> get(String id) async => _delivery(await _call(session, 'GET', _path(id)));

  @override
  Future<DeliveryView> accept(String id, {required String key}) async => _delivery(await _call(session, 'POST', _path(id, '/accept'), body: <String, Object?>{}, key: key));

  @override
  Future<DeliveryView> release(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/release'), body: <String, Object?>{'reason': reason, 'expected_version': expectedVersion}, key: key));

  OfferView _offer(Object? data) {
    try {
      return OfferView.fromJson(data is Map<String, Object?> && data['offer'] != null ? data['offer'] : data);
    } on FormatException {
      throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
    }
  }

  @override
  Future<OfferView> feeAgree(String id, {required String key}) async => _offer(await _call(session, 'POST', _path(id, '/fee/agree'), body: <String, Object?>{}, key: key));

  @override
  Future<void> feeSkip(String id, {required String key}) async {
    await _call(session, 'POST', _path(id, '/fee/skip'), body: <String, Object?>{}, key: key);
  }

  @override
  Future<OfferView> feeCounter(String id, {required int amountVnd, required String key}) async =>
      _offer(await _call(session, 'POST', _path(id, '/fee/counter'), body: <String, Object?>{'amount_vnd': amountVnd}, key: key));

  @override
  Future<DeliveryView> confirmFee(String id, {required int feeVnd, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/destination'), body: <String, Object?>{'fee_vnd': feeVnd, 'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> pickup(String id, {required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/pickup'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  @override
  Future<DeliveryView> decideAddressChange(
    String id, {
    required bool accept,
    String? reason,
    required int expectedVersion,
    required String key,
  }) async =>
      _delivery(await _call(
        session,
        'POST',
        _path(id, '/address-change-request/decide'),
        body: <String, Object?>{
          'accept': accept,
          if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
          'expected_version': expectedVersion,
        },
        key: key,
      ));

  @override
  Future<DeliveryView> complete(String id, {required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/complete'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));
}

class HttpCustomerDeliverySource extends CustomerDeliverySource {
  const HttpCustomerDeliverySource({required this.session});

  @override
  final SessionController session;

  @override
  OrderChatApi get chat => HttpOrderChatApi(session: session);

  @override
  bool get isSample => false;

  String _path(String id, [String tail = '']) => '/v1/customers/me/deliveries/$id$tail';

  @override
  Future<List<DeliveryView>> list({required bool history}) async {
    final Object? data = await _call(session, 'GET', '/v1/customers/me/deliveries?scope=${history ? 'history' : 'active'}');
    return _items<DeliveryView>(data, 'deliveries', DeliveryView.fromJson);
  }

  @override
  Future<DeliveryView> get(String id) async => _delivery(await _call(session, 'GET', _path(id)));

  @override
  Future<DeliveryView> create(NewCustomerDeliveryInput input, {required String key}) async {
    final Map<String, Object?> body = <String, Object?>{
      'sender_name': input.senderName,
      'sender_phone': input.senderPhone,
      'pickup_address_text': input.pickupAddressText,
      if (input.pickupLat != null) 'pickup_lat': input.pickupLat,
      if (input.pickupLng != null) 'pickup_lng': input.pickupLng,
      'recipient_name': input.recipientName,
      'recipient_phone': input.recipientPhone,
      'dropoff_address_text': input.dropoffAddressText,
      if (input.dropoffLat != null) 'dropoff_lat': input.dropoffLat,
      if (input.dropoffLng != null) 'dropoff_lng': input.dropoffLng,
      'goods_description': input.goodsDescription,
      'goods_value_vnd': input.goodsValueVnd,
      'cod_vnd': input.codVnd,
      'fee_payer': input.feePayer,
      if (input.note != null && input.note!.isNotEmpty) 'note': input.note,
      if (input.agreedFee != null)
        'agreed_fee': <String, Object?>{
          'amount_vnd': input.agreedFee!.amountVnd,
          'reason_code': input.agreedFee!.reasonCode,
          if (input.agreedFee!.reasonNote != null) 'reason_note': input.agreedFee!.reasonNote,
        },
    };
    return _delivery(await _call(session, 'POST', '/v1/customers/me/deliveries', body: body, key: key, ok: const <int>{201}));
  }

  @override
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/cancel'), body: <String, Object?>{'reason': reason, 'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> cancelAfterPickup(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/cancel-after-pickup'), body: <String, Object?>{'reason': reason, 'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> counterAccept(String id, {required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/fee/counter-accept'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  Future<DeliveryView> counterReject(String id, {required int expectedVersion, required String key}) async =>
      _delivery(await _call(session, 'POST', _path(id, '/fee/counter-reject'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  Future<TrackingLinkResult> createTrackingLink(String id) async {
    final Object? data = await _call(session, 'POST', _path(id, '/tracking-link'), ok: const <int>{201});
    return TrackingLinkResult.fromJson(data);
  }

  @override
  Future<TrackingLinkStatus> getTrackingLinkStatus(String id) async {
    final Object? data = await _call(session, 'GET', _path(id, '/tracking-link'));
    return TrackingLinkStatus.fromJson(data);
  }

  @override
  Future<TrackingLinkStatus> toggleTrackingLocation(String id, {required bool shareLocation}) async {
    final Object? data = await _call(session, 'POST', _path(id, '/tracking-link/toggle-location'), body: <String, Object?>{'share_location': shareLocation});
    return TrackingLinkStatus.fromJson(data);
  }

  @override
  @override
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
  }) async =>
      _delivery(await _call(
        session,
        'POST',
        _path(id, '/address-change-request'),
        body: <String, Object?>{
          'recipient_name': recipientName,
          'recipient_phone': recipientPhone,
          'dropoff_address_text': addressText,
          if (lat != null && lng != null) 'dropoff_lat': lat,
          if (lat != null && lng != null) 'dropoff_lng': lng,
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          'expected_version': expectedVersion,
        },
        key: key,
        ok: const <int>{200, 201},
      ));

  @override
  Future<DeliveryView> cancelAddressChange(
    String id, {
    required int expectedVersion,
    required String key,
  }) async =>
      _delivery(await _call(
        session,
        'POST',
        _path(id, '/address-change-request/cancel'),
        body: <String, Object?>{'expected_version': expectedVersion},
        key: key,
      ));

  @override
  Future<void> revokeTrackingLink(String id) async {
    await _call(session, 'POST', _path(id, '/tracking-link/revoke'));
  }
}
