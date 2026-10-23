import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
final Uri base = Uri.parse('https://api.example.test');

Map<String, Object?> item({String id = 'i1', String status = 'VISIBLE', int version = 1, String? image}) => <String, Object?>{
      'item_id': id,
      'name': 'Ốc hương hấp',
      'price_vnd': 120000,
      'category_id': 'c1',
      'image_id': image,
      'status': status,
      'version': version,
    };

Future<({SessionController session, FakeApiTransport api, HttpMenuApi menu})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api, menu: HttpMenuApi(session: session, base: base));
}

void main() {
  test('GPS resolve parses configured area and explicit outside-coverage null', () async {
    final FakeApiTransport transport = FakeApiTransport();
    final HttpDiscoveryApi api = HttpDiscoveryApi(transport: transport, base: base);
    transport.routes['GET /v1/service-areas/resolve?latitude=22.67&longitude=106.25'] =
      (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{'service_area_id': 'new-area', 'name': 'Vùng mới'}});
    expect((await api.resolveArea(22.67, 106.25))?.id, 'new-area');
    transport.routes['GET /v1/service-areas/resolve?latitude=0.0&longitude=0.0'] =
      (_, __, ___, ____) async => json(200, <String, Object?>{'data': null});
    expect(await api.resolveArea(0, 0), isNull);
  });

  test('owner menu: the read is parsed, picture URLs point at the public image route, nothing else is invented', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/shop/me/menu'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'shop_id': 's',
            'categories': <Object?>[<String, Object?>{'category_id': 'c1', 'name': 'Ốc', 'status': 'ACTIVE'}, <String, Object?>{'category_id': 'c2', 'name': 'Cũ', 'status': 'INACTIVE'}],
            'items': <Object?>[item(image: 'img-1'), item(id: 'i2', status: 'HIDDEN', version: 3)],
          },
        });
    final MenuSnapshot snapshot = await t.menu.load();
    expect(snapshot.categories.map((MenuCategory c) => c.active), <bool>[true, false]);
    expect(snapshot.items.first.imageUrl, 'https://api.example.test/v1/menu-images/img-1');
    expect(snapshot.items.first.imageRef, 'img-1');
    expect(snapshot.items.last.hidden, isTrue);
    expect(snapshot.items.last.imageUrl, isNull);
    t.api.routes['GET /v1/shop/me/menu'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'categories': 'x', 'items': <Object?>[]}});
    await expectLater(t.menu.load(), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.kind, 'kind', AuthFailureKind.badResponse)));
  });

  test('writes: create/update/hide/show/delete send the contract body with the Idempotency-Key the controller kept; a picture is uploaded as base64', () async {
    final t = await signedIn();
    t.api.routes['POST /v1/shop/me/menu/items'] = (String m, String p, Map<String, String> h, String b) async => json(201, <String, Object?>{'data': <String, Object?>{'item': item()}});
    t.api.routes['PUT /v1/shop/me/menu/items/i1'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'item': item(version: 2)}});
    t.api.routes['POST /v1/shop/me/menu/items/i1/hide'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'item': item(status: 'HIDDEN', version: 3)}});
    t.api.routes['POST /v1/shop/me/menu/items/i1/show'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'item': item(version: 4)}});
    t.api.routes['POST /v1/shop/me/menu/items/i1/delete'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'item': item(status: 'DELETED', version: 5)}});
    t.api.routes['POST /v1/shop/me/menu/images'] = (String m, String p, Map<String, String> h, String b) async => json(201, <String, Object?>{'data': <String, Object?>{'image_id': 'img-9', 'content_type': 'image/jpeg', 'byte_size': 7}});

    const MenuItemInput input = MenuItemInput(name: 'Ốc hương hấp', priceVnd: 120000, categoryId: 'c1', imageRef: null);
    await t.menu.create(input, key: 'key-create');
    expect(jsonDecode(t.api.to('POST', '/v1/shop/me/menu/items').single.body), <String, Object?>{'name': 'Ốc hương hấp', 'price_vnd': 120000, 'category_id': 'c1', 'image_id': null});
    expect(t.api.to('POST', '/v1/shop/me/menu/items').single.headers['idempotency-key'], 'key-create');

    await t.menu.update('i1', const MenuItemInput(name: 'A', priceVnd: 5, categoryId: 'c1', imageRef: 'img-1'), expectedVersion: 1, key: 'key-update');
    expect(jsonDecode(t.api.to('PUT', '/v1/shop/me/menu/items/i1').single.body), <String, Object?>{'expected_version': 1, 'name': 'A', 'price_vnd': 5, 'category_id': 'c1', 'image_id': 'img-1'});

    expect((await t.menu.setHidden('i1', true, expectedVersion: 2, key: 'k3')).hidden, isTrue);
    expect((await t.menu.setHidden('i1', false, expectedVersion: 3, key: 'k4')).hidden, isFalse);
    await t.menu.delete('i1', expectedVersion: 4, key: 'k5');
    expect(jsonDecode(t.api.to('POST', '/v1/shop/me/menu/items/i1/delete').single.body), <String, Object?>{'expected_version': 4});

    final ({String ref, String url}) up = await t.menu.uploadImage(PickedImage(bytes: Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 1, 2, 3, 4]), contentType: 'image/jpeg'));
    expect(up.ref, 'img-9');
    expect(up.url, 'https://api.example.test/v1/menu-images/img-9');
    final Map<String, Object?> sent = jsonDecode(t.api.to('POST', '/v1/shop/me/menu/images').single.body) as Map<String, Object?>;
    expect(sent['content_type'], 'image/jpeg');
    expect(base64Decode(sent['data_base64']! as String), <int>[0xff, 0xd8, 0xff, 1, 2, 3, 4]);
  });

  test('refusals keep their code and kind: conflict, dish gone, shop disabled; a lost answer is an unknown outcome', () async {
    final t = await signedIn();
    t.api.routes['POST /v1/shop/me/menu/items/i1/hide'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'VERSION_CONFLICT');
    t.api.routes['POST /v1/shop/me/menu/items/i2/hide'] = (String m, String p, Map<String, String> h, String b) async => apiError(404, 'MENU_ITEM_NOT_FOUND');
    t.api.routes['POST /v1/shop/me/menu/items/i3/hide'] = (String m, String p, Map<String, String> h, String b) async => apiError(403, 'SHOP_DISABLED');
    await expectLater(t.menu.setHidden('i1', true, expectedVersion: 1, key: 'k'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.kind, 'kind', AuthFailureKind.versionConflict)));
    await expectLater(t.menu.setHidden('i2', true, expectedVersion: 1, key: 'k'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.code, 'code', 'MENU_ITEM_NOT_FOUND')));
    await expectLater(t.menu.setHidden('i3', true, expectedVersion: 1, key: 'k'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.code, 'code', 'SHOP_DISABLED')));
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await expectLater(t.menu.setHidden('i1', true, expectedVersion: 1, key: 'k'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.outcomeUnknown, 'unknown', true)));
  });

  test('public shop view and discovery: plain GETs (no session), strict parsing, the codes of not found / unavailable kept', () async {
    final FakeApiTransport api = FakeApiTransport();
    api.routes['GET /v1/shops/s1'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'shop_id': 's1',
            'logo_url': '/v1/shops/s1/logo?v=3',
            'name': 'Ốc 11',
            'address_text': '12 Phố Kim Đồng',
            'timezone': 'Asia/Ho_Chi_Minh',
            'availability': <String, Object?>{'online': false, 'reason': 'OUTSIDE_BUSINESS_HOURS', 'evaluated_at': '2026-10-14T11:30:00.000Z'},
            'hours': <Object?>[<String, Object?>{'weekday': 1, 'start_minute': 1020, 'end_minute': 1380, 'end_day_offset': 0}],
            'categories': <Object?>[
              <String, Object?>{
                'category_id': 'c1',
                'name': 'Ốc',
                'items': <Object?>[<String, Object?>{'item_id': 'i1', 'name': 'Ốc hương hấp', 'price_vnd': 120000, 'image_id': 'img-1', 'sold_count': 120}],
              },
            ],
          },
        });
    api.routes['GET /v1/shops/s2'] = (String m, String p, Map<String, String> h, String b) async => apiError(404, 'SHOP_NOT_FOUND');
    api.routes['GET /v1/shops/s3'] = (String m, String p, Map<String, String> h, String b) async => apiError(403, 'SHOP_UNAVAILABLE');
    final HttpPublicShopApi shops = HttpPublicShopApi(transport: api, base: base);
    final ShopMenuView view = await shops.load('s1');
    expect(view.logoUrl, 'https://api.example.test/v1/shops/s1/logo?v=3');
    expect(view.availabilityReason, 'OUTSIDE_BUSINESS_HOURS');
    expect(view.serverNow, DateTime.utc(2026, 10, 14, 11, 30));
    expect(view.hours[0].single.open, '17:00');
    expect(view.categories.single.items.single.imageUrl, 'https://api.example.test/v1/menu-images/img-1');
    expect(view.categories.single.items.single.soldCount, 120);
    await expectLater(shops.load('s2'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.code, 'code', 'SHOP_NOT_FOUND')));
    await expectLater(shops.load('s3'), throwsA(isA<AuthFailure>().having((AuthFailure f) => f.code, 'code', 'SHOP_UNAVAILABLE')));
    expect(api.requests.every((RecordedRequest r) => !r.headers.containsKey('authorization')), isTrue);

    api.routes['GET /v1/service-areas'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <Object?>[<String, Object?>{'service_area_id': 'a1', 'name': 'Cao Bằng'}]});
    api.routes['GET /v1/menu-categories'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <Object?>[<String, Object?>{'category_id': 'c1', 'name': 'Ốc'}]});
    api.routes['GET /v1/discovery/shops?area_id=a1&category_id=c1&open_only=true&q=%E1%BB%91c+h%C6%B0%C6%A1ng&limit=30&offset=30'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'shops': <Object?>[<String, Object?>{'shop_id': 's1', 'name': 'Ốc 11', 'logo_url': '/v1/shops/s1/logo?v=4', 'address_text': 'x', 'availability': <String, Object?>{'online': true, 'reason': 'ONLINE'}}],
            'has_more': true,
          },
        });
    final HttpDiscoveryApi discovery = HttpDiscoveryApi(transport: api, base: base);
    api.routes['GET /v1/discovery/dishes?area_id=a1&limit=30'] = (m, p, h, b) async => json(200, <String, Object?>{
      'data': <String, Object?>{'has_more': false, 'dishes': <Object?>[
        <String, Object?>{'item_id': 'i1', 'name': 'Ốc hương hấp', 'price_vnd': 120000, 'image_id': null, 'sold_count': 120,
          'shop': <String, Object?>{'shop_id': 's1', 'name': 'Ốc 11', 'address_text': 'x', 'availability': <String, Object?>{'online': true, 'reason': 'ONLINE'}}},
        <String, Object?>{'item_id': 'i2', 'name': 'Món mới', 'price_vnd': 20000, 'image_id': null,
          'shop': <String, Object?>{'shop_id': 's1', 'name': 'Ốc 11', 'address_text': 'x', 'availability': <String, Object?>{'online': true, 'reason': 'ONLINE'}}},
      ]},
    });
    final soldDishes = await discovery.dishes(const DiscoveryQuery(areaId: 'a1'));
    expect(soldDishes.items.first.soldCount, 120);
    expect(soldDishes.items.last.soldCount, isNull, reason: 'old servers do not supply a count; never invent zero');
    expect((await discovery.areas()).single.name, 'Cao Bằng');
    expect((await discovery.categories()).single.name, 'Ốc');
    final DiscoveryPage<ShopCardData> page = await discovery.shops(const DiscoveryQuery(areaId: 'a1', categoryId: 'c1', openOnly: true, term: ' ốc hương ', offset: 30));
    expect(page.items.single.open, isTrue);
    expect(page.items.single.logoUrl, 'https://api.example.test/v1/shops/s1/logo?v=4');
    expect(page.hasMore, isTrue);
    api.routes['GET /v1/discovery/dishes?area_id=a1&limit=30'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'dishes': <Object?>[
              <String, Object?>{
                'item_id': 'i1',
                'name': 'Ốc hương hấp',
                'price_vnd': 120000,
                'image_id': null,
                'shop': <String, Object?>{'shop_id': 's1', 'name': 'Ốc 11', 'address_text': 'x', 'availability': <String, Object?>{'online': false, 'reason': 'NO_BUSINESS_HOURS'}},
              },
            ],
            'has_more': false,
          },
        });
    final DiscoveryPage<DishHit> dishes = await discovery.dishes(const DiscoveryQuery(areaId: 'a1'));
    expect(dishes.items.single.shop.reason, 'NO_BUSINESS_HOURS');
    expect(dishes.items.single.imageUrl, isNull);
  });
}
