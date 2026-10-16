import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'discovery_models.dart';
import 'menu_models.dart';
import 'schedule.dart';

// The HTTP side of the M02 ports: the owner's menu (signed, device-bound requests of the session), the public shop view and the public
// discovery routes (plain HTTPS, no session). Every answer is parsed strictly; a body that is not what the contract says is
// `badResponse`, never a half-filled screen.

AuthFailure get _bad => const AuthFailure(AuthFailureKind.badResponse);

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw _bad;

List<Object?> _list(Object? v) => v is List<Object?> ? v : throw _bad;

String _str(Object? v) => v is String ? v : throw _bad;

int _int(Object? v) => v is int ? v : throw _bad;

bool _bool(Object? v) => v is bool ? v : throw _bad;

String? _strOrNull(Object? v) => v == null ? null : _str(v);

String imageUrlOf(Uri base, String? imageId) => imageId == null ? '' : base.resolve('/v1/menu-images/$imageId').toString();

/// The owner's menu over the signed session (GET/POST/PUT /v1/shop/me/menu...).
class HttpMenuApi implements MenuApi {
  HttpMenuApi({required this.session, required this.base});

  final SessionController session;
  final Uri base;

  MenuItem _item(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final String? image = _strOrNull(m['image_id']);
    final String status = _str(m['status']);
    if (status != 'VISIBLE' && status != 'HIDDEN') {
      throw _bad;
    }
    return MenuItem(
      id: _str(m['item_id']),
      name: _str(m['name']),
      priceVnd: _int(m['price_vnd']),
      categoryId: _str(m['category_id']),
      imageRef: image,
      imageUrl: image == null ? null : imageUrlOf(base, image),
      hidden: status == 'HIDDEN',
      version: _int(m['version']),
    );
  }

  Future<Object?> _call(String method, String path, {Object? body, String? key, Set<int> ok = const <int>{200}}) async {
    final ApiResponse response = await session.protectedCall(method, path, body: body == null ? null : jsonEncode(body), idempotencyKey: key);
    if (!ok.contains(response.status)) {
      throw failureOf(response);
    }
    return response.data;
  }

  Map<String, Object?> _input(MenuItemInput i) => <String, Object?>{'name': i.name, 'price_vnd': i.priceVnd, 'category_id': i.categoryId, 'image_id': i.imageRef};

  @override
  Future<MenuSnapshot> load() async {
    final Map<String, Object?> data = _obj(await _call('GET', '/v1/shop/me/menu'));
    return MenuSnapshot(
      categories: <MenuCategory>[
        for (final Object? c in _list(data['categories']))
          MenuCategory(id: _str(_obj(c)['category_id']), name: _str(_obj(c)['name']), active: _str(_obj(c)['status']) == 'ACTIVE'),
      ],
      items: <MenuItem>[for (final Object? i in _list(data['items'])) _item(i)],
    );
  }

  @override
  Future<({String ref, String url})> uploadImage(PickedImage image) async {
    final Map<String, Object?> data = _obj(await _call('POST', '/v1/shop/me/menu/images', body: <String, Object?>{'content_type': image.contentType, 'data_base64': base64Encode(image.bytes)}, ok: const <int>{201}));
    final String id = _str(data['image_id']);
    return (ref: id, url: imageUrlOf(base, id));
  }

  @override
  Future<MenuItem> create(MenuItemInput input, {required String key}) async =>
      _item(_obj(await _call('POST', '/v1/shop/me/menu/items', body: _input(input), key: key, ok: const <int>{201}))['item']);

  @override
  Future<MenuItem> update(String id, MenuItemInput input, {required int expectedVersion, required String key}) async =>
      _item(_obj(await _call('PUT', '/v1/shop/me/menu/items/$id', body: <String, Object?>{'expected_version': expectedVersion, ..._input(input)}, key: key))['item']);

  @override
  Future<MenuItem> setHidden(String id, bool hidden, {required int expectedVersion, required String key}) async =>
      _item(_obj(await _call('POST', '/v1/shop/me/menu/items/$id/${hidden ? 'hide' : 'show'}', body: <String, Object?>{'expected_version': expectedVersion}, key: key))['item']);

  @override
  Future<void> delete(String id, {required int expectedVersion, required String key}) async {
    await _call('POST', '/v1/shop/me/menu/items/$id/delete', body: <String, Object?>{'expected_version': expectedVersion}, key: key);
  }
}

ShopCardData _shopCard(Map<String, Object?> m, {String idKey = 'shop_id'}) {
  final Map<String, Object?> availability = _obj(m['availability']);
  _bool(availability['online']);
  return ShopCardData(shopId: _str(m[idKey]), name: _str(m['name']), address: _str(m['address_text']), reason: _str(availability['reason']));
}

/// Public requests need no session: a plain GET over the same HTTPS transport (normal TLS verification).
Future<Object?> _publicGet(ApiTransport transport, String path) async {
  final ApiResponse response = await transport.send('GET', path);
  if (response.status != 200) {
    throw failureOf(response);
  }
  return response.data;
}

class HttpPublicShopApi implements PublicShopApi {
  HttpPublicShopApi({required this.transport, required this.base});

  final ApiTransport transport;
  final Uri base;

  @override
  Future<ShopMenuView> load(String shopId) async {
    final Map<String, Object?> data = _obj(await _publicGet(transport, '/v1/shops/$shopId'));
    final Map<String, Object?> availability = _obj(data['availability']);
    final WeekSchedule? hours = scheduleFromWire(data['hours']);
    if (hours == null) {
      throw _bad;
    }
    final Object? at = availability['evaluated_at'];
    return ShopMenuView(
      name: _str(data['name']),
      address: _str(data['address_text']),
      availabilityReason: _str(availability['reason']),
      serverNow: at is String ? DateTime.tryParse(at) : null,
      hours: hours,
      categories: <PublicCategory>[
        for (final Object? c in _list(data['categories']))
          PublicCategory(
            name: _str(_obj(c)['name']),
            items: <PublicItem>[
              for (final Object? i in _list(_obj(c)['items']))
                PublicItem(
                  id: _str(_obj(i)['item_id']),
                  name: _str(_obj(i)['name']),
                  priceVnd: _int(_obj(i)['price_vnd']),
                  imageUrl: _obj(i)['image_id'] == null ? null : imageUrlOf(base, _str(_obj(i)['image_id'])),
                ),
            ],
          ),
      ],
    );
  }
}

class HttpDiscoveryApi implements DiscoveryApi {
  HttpDiscoveryApi({required this.transport, required this.base});

  final ApiTransport transport;
  final Uri base;

  String _query(DiscoveryQuery q) {
    final Map<String, String> params = <String, String>{
      'area_id': q.areaId,
      if (q.categoryId != null) 'category_id': q.categoryId!,
      if (q.openOnly) 'open_only': 'true',
      if (q.term.trim().isNotEmpty) 'q': q.term.trim(),
      'limit': '${q.limit}',
      if (q.offset > 0) 'offset': '${q.offset}',
    };
    return Uri(queryParameters: params).query;
  }

  @override
  Future<List<AreaChoice>> areas() async => <AreaChoice>[
        for (final Object? a in _list(await _publicGet(transport, '/v1/service-areas'))) AreaChoice(id: _str(_obj(a)['service_area_id']), name: _str(_obj(a)['name'])),
      ];

  @override
  Future<List<CategoryChoice>> categories() async => <CategoryChoice>[
        for (final Object? c in _list(await _publicGet(transport, '/v1/menu-categories'))) CategoryChoice(id: _str(_obj(c)['category_id']), name: _str(_obj(c)['name'])),
      ];

  @override
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query) async {
    final Map<String, Object?> data = _obj(await _publicGet(transport, '/v1/discovery/shops?${_query(query)}'));
    return DiscoveryPage<ShopCardData>(items: <ShopCardData>[for (final Object? s in _list(data['shops'])) _shopCard(_obj(s))], hasMore: _bool(data['has_more']));
  }

  @override
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query) async {
    final Map<String, Object?> data = _obj(await _publicGet(transport, '/v1/discovery/dishes?${_query(query)}'));
    return DiscoveryPage<DishHit>(
      items: <DishHit>[
        for (final Object? d in _list(data['dishes']))
          DishHit(
            itemId: _str(_obj(d)['item_id']),
            name: _str(_obj(d)['name']),
            priceVnd: _int(_obj(d)['price_vnd']),
            imageUrl: _obj(d)['image_id'] == null ? null : imageUrlOf(base, _str(_obj(d)['image_id'])),
            shop: _shopCard(_obj(_obj(d)['shop'])),
          ),
      ],
      hasMore: _bool(data['has_more']),
    );
  }
}
