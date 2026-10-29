import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'address_models.dart';

AuthFailure get _bad => const AuthFailure(AuthFailureKind.badResponse);

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw _bad;
String _str(Object? v) => v is String ? v : throw _bad;
String? _strOrNull(Object? v) => v == null ? null : (v is String ? v : throw _bad);
int _int(Object? v) => v is int ? v : throw _bad;
bool _bool(Object? v) => v is bool ? v : throw _bad;
double? _numOrNull(Object? v) => v == null ? null : (v is num ? v.toDouble() : throw _bad);

DeliveryAddress parseAddress(Object? raw) {
  final Map<String, Object?> m = _obj(raw);
  final AddressLabel? label = AddressLabel.parse(m['label']);
  if (label == null) {
    throw _bad;
  }
  return DeliveryAddress(
    id: _str(m['id']),
    label: label,
    displayName: _strOrNull(m['display_name']),
    recipientName: _strOrNull(m['recipient_name']),
    contactPhone: _str(m['contact_phone']),
    addressText: _str(m['address_description']),
    deliveryNote: _strOrNull(m['delivery_note']),
    isPickupDefault: m.containsKey('is_pickup_default') ? _bool(m['is_pickup_default']) : false,
    isDeliveryDefault: m.containsKey('is_delivery_default') ? _bool(m['is_delivery_default']) : _bool(m['is_default']),
    version: _int(m['version']),
    latitude: _numOrNull(m['latitude']),
    longitude: _numOrNull(m['longitude']),
  );
}

/// /v1/customers/me/addresses over the signed session (the M01 token and device proof are added by [SessionController]).
class HttpAddressApi implements AddressApi {
  HttpAddressApi({required this.session});

  final SessionController session;

  Future<Object?> _call(String method, String path, {Object? body, String? key, Set<int> ok = const <int>{200}}) async {
    final ApiResponse response = await session.protectedCall(method, path, body: body == null ? null : jsonEncode(body), idempotencyKey: key);
    if (!ok.contains(response.status)) {
      throw failureOf(response);
    }
    return response.data;
  }

  Map<String, Object?> _fields(AddressInput i) => <String, Object?>{
        'label': i.label.code,
        'display_name': i.displayName.trim(),
        'recipient_name': i.recipientName.trim(),
        'contact_phone': i.phone.trim(),
        'address_description': i.addressText.trim(),
        'delivery_note': i.note.trim(),
        if (i.latitude != null && i.longitude != null) ...<String, Object?>{'latitude': i.latitude, 'longitude': i.longitude},
      };

  @override
  Future<List<DeliveryAddress>> list() async {
    final Object? list = _obj(await _call('GET', '/v1/customers/me/addresses'))['addresses'];
    if (list is! List<Object?>) {
      throw _bad;
    }
    return <DeliveryAddress>[for (final Object? a in list) parseAddress(a)];
  }

  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) async => parseAddress(
        await _call('POST', '/v1/customers/me/addresses', body: <String, Object?>{..._fields(input), 'is_pickup_default': input.pickupDefault, 'is_delivery_default': input.deliveryDefault}, key: key, ok: const <int>{201}),
      );

  @override
  Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key}) async => parseAddress(
        await _call('PATCH', '/v1/customers/me/addresses/$id', body: <String, Object?>{'expected_version': expectedVersion, ..._fields(input), 'is_pickup_default': input.pickupDefault, 'is_delivery_default': input.deliveryDefault}, key: key),
      );

  @override
  Future<String?> delete(String id, {required String key}) async {
    final Map<String, Object?> data = _obj(await _call('DELETE', '/v1/customers/me/addresses/$id', key: key));
    return _strOrNull(data['default_address_id']);
  }

  @override
  Future<void> setDefault(String id, {required String key}) async {
    await _call('PUT', '/v1/customers/me/addresses/$id/default', key: key);
  }

  @override
  Future<void> setDefaultKind(String id, AddressDefaultKind kind, bool enabled, {required String key}) async {
    await _call(enabled ? 'PUT' : 'DELETE', '/v1/customers/me/addresses/$id/defaults/${kind.name}', key: key);
  }
}
