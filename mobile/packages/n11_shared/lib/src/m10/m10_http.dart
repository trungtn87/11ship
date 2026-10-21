import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../m07/m07_source.dart';
import 'm10_models.dart';
import 'm10_source.dart';

// The HTTP side of the M10 sources: signed requests of the session (Bearer + device proof). Every answer is parsed strictly; a body that is not what
// the contract says is a server failure, never a half-filled screen. A lost answer is `offline`: the write may or may not have happened, and the screen
// retries with the SAME Idempotency-Key (an Order is also found again by its client reference).

M07Failure _failureOf(Object error) {
  if (error is M07Failure) {
    return error;
  }
  if (error is AuthFailure) {
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
  if (code == 'VERSION_CONFLICT' || code.endsWith('_STATE_CONFLICT') || code == 'ORDER_CART_CHANGED') {
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

T _parse<T>(Object? data, T Function(Object?) parse) {
  try {
    return parse(data);
  } on FormatException {
    throw const M07Failure(M07FailureKind.server, code: 'BAD_RESPONSE');
  }
}

OrderView _order(Object? data) => _parse<OrderView>(data, OrderView.fromJson);

Map<String, Object?> _draftBody(CheckoutDraft d, {required bool withPrice}) => <String, Object?>{
      'shop_id': d.shopId,
      'lines': <Map<String, Object?>>[
        for (final DraftLine l in d.lines) <String, Object?>{'item_id': l.itemId, 'quantity': l.quantity, if (withPrice) 'unit_price_vnd': l.priceVnd, if (l.note != null) 'note': l.note},
      ],
      if (d.note != null) 'note': d.note,
      'recipient_name': d.recipientName,
      'recipient_phone': d.recipientPhone,
      'address': d.address.toJson(),
      if (d.scheduledFor != null) 'scheduled_for': d.scheduledFor!.toUtc().toIso8601String(),
    };

class HttpCustomerOrderSource extends CustomerOrderSource {
  const HttpCustomerOrderSource({required this.session});

  final SessionController session;

  @override
  bool get isSample => false;

  CartView? _cart(Object? data) {
    final Object? cart = data is Map<String, Object?> ? data['cart'] : null;
    return cart == null ? null : _parse<CartView>(cart, CartView.fromJson);
  }

  @override
  Future<CartView?> cart() async => _cart(await _call(session, 'GET', '/v1/customers/me/cart'));

  @override
  Future<CartView?> saveCart({required String shopId, required List<DraftLine> lines, String? note}) async => _cart(await _call(session, 'PUT', '/v1/customers/me/cart', body: <String, Object?>{
        'shop_id': shopId,
        'lines': <Map<String, Object?>>[for (final DraftLine l in lines) <String, Object?>{'item_id': l.itemId, 'quantity': l.quantity, if (l.note != null) 'note': l.note}],
        if (note != null) 'note': note,
      }));

  @override
  Future<void> clearCart() async {
    await _call(session, 'DELETE', '/v1/customers/me/cart');
  }

  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) async => _parse<CheckoutPreview>(await _call(session, 'POST', '/v1/customers/me/orders/preview', body: _draftBody(draft, withPrice: false)), CheckoutPreview.fromJson);

  @override
  Future<OrderView> place(CheckoutDraft draft, {required String clientRef, required String key}) async =>
      _order(await _call(session, 'POST', '/v1/customers/me/orders', body: <String, Object?>{..._draftBody(draft, withPrice: true), 'client_ref': clientRef, 'items_total_vnd': draft.itemsVnd}, key: key, ok: const <int>{200, 201}));

  @override
  Future<OrderView?> lookup(String clientRef) async {
    try {
      return _order(await _call(session, 'GET', '/v1/customers/me/orders/lookup?client_ref=$clientRef'));
    } on M07Failure catch (failure) {
      if (failure.code == 'ORDER_NOT_FOUND') {
        return null;
      }
      rethrow;
    }
  }

  @override
  Future<List<OrderSummary>> list(CustomerScope scope) async {
    final Object? data = await _call(session, 'GET', '/v1/customers/me/orders?scope=${scope.name}&limit=50');
    return _parse<List<OrderSummary>>(data, (Object? d) => <OrderSummary>[for (final Object? o in (d! as Map<String, Object?>)['orders']! as List<Object?>) OrderSummary.fromJson(o)]);
  }

  @override
  Future<OrderView> get(String id) async => _order(await _call(session, 'GET', '/v1/customers/me/orders/$id'));

  @override
  Future<OrderView> cancel(String id, {String? reason, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', '/v1/customers/me/orders/$id/cancel', body: <String, Object?>{'expected_version': expectedVersion, if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim()}, key: key));

  @override
  Future<ReorderResult> reorder(String id, {required bool replaceCart, required String key}) async {
    final Object? data = await _call(session, 'POST', '/v1/customers/me/orders/$id/reorder', body: <String, Object?>{if (replaceCart) 'replace_cart': true}, key: key);
    return _parse<ReorderResult>(data, (Object? d) {
      final Map<String, Object?> m = d! as Map<String, Object?>;
      return ReorderResult(
        cart: m['cart'] == null ? null : CartView.fromJson(m['cart']),
        skipped: <String>[for (final Object? s in m['skipped']! as List<Object?>) (s! as Map<String, Object?>)['name']! as String],
      );
    });
  }
}

class HttpShopOrderSource extends ShopOrderSource {
  const HttpShopOrderSource({required this.session});

  final SessionController session;

  @override
  bool get isSample => false;

  String _path(String id, [String tail = '']) => '/v1/shop/me/orders/$id$tail';

  @override
  Future<OrderList> list({required String filter, String query = '', DateTime? from, DateTime? to}) async {
    final List<String> q = <String>['filter=$filter', 'limit=50', if (query.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(query.trim())}', if (from != null) 'from=${Uri.encodeQueryComponent(from.toUtc().toIso8601String())}', if (to != null) 'to=${Uri.encodeQueryComponent(to.toUtc().toIso8601String())}'];
    final Object? data = await _call(session, 'GET', '/v1/shop/me/orders?${q.join('&')}');
    return _parse<OrderList>(data, (Object? d) {
      final Map<String, Object?> m = d! as Map<String, Object?>;
      return OrderList(orders: <OrderSummary>[for (final Object? o in m['orders']! as List<Object?>) OrderSummary.fromJson(o)], counts: ShopOrderCounts.fromJson(m['counts']));
    });
  }

  @override
  Future<OrderView> get(String id) async => _order(await _call(session, 'GET', _path(id)));

  @override
  Future<OrderView> edit(String id, {required List<LineEdit> changes, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/edit'), body: <String, Object?>{'expected_version': expectedVersion, 'changes': <Object?>[for (final LineEdit c in changes) c.toJson()]}, key: key));

  @override
  Future<OrderView> confirm(String id, {String? changeReason, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/confirm'), body: <String, Object?>{'expected_version': expectedVersion, if (changeReason != null && changeReason.trim().isNotEmpty) 'change_reason': changeReason.trim()}, key: key));

  @override
  Future<OrderView> reject(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/reject'), body: <String, Object?>{'expected_version': expectedVersion, 'reason': reason}, key: key));

  @override
  Future<OrderView> ready(String id, {required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/ready'), body: <String, Object?>{'expected_version': expectedVersion}, key: key));

  @override
  Future<OrderView> recordPayment(String id, {required int paidVnd, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/payment'), body: <String, Object?>{'expected_version': expectedVersion, 'paid_vnd': paidVnd}, key: key));

  @override
  Future<OrderView> callShipper(String id, {required String feePayer, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/call-shipper'), body: <String, Object?>{'expected_version': expectedVersion, 'fee_payer': feePayer}, key: key, ok: const <int>{200, 201}));

  @override
  Future<OrderView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/cancel'), body: <String, Object?>{'expected_version': expectedVersion, 'reason': reason}, key: key));

  @override
  Future<OrderView> closeNotCompleted(String id, {required String reason, required int expectedVersion, required String key}) async =>
      _order(await _call(session, 'POST', _path(id, '/close-not-completed'), body: <String, Object?>{'expected_version': expectedVersion, 'reason': reason}, key: key));

  @override
  Future<void> resolveCustody(String deliveryId, {required String resolution, String? note, required String key}) async {
    await _call(session, 'POST', '/v1/shop/me/deliveries/$deliveryId/custody', body: <String, Object?>{'resolution': resolution, if (note != null && note.trim().isNotEmpty) 'note': note.trim()}, key: key);
  }
}
