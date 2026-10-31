import 'dart:convert';
import 'dart:typed_data';

import 'n11_shared.dart';

// Test doubles for the account flow (used by the package's own tests and by the two apps' tests). They simulate the contract of
// the server (apps/backend/src/client-device and client-auth) and of the Keystore bridge closely enough to drive the controller
// and the screens end to end. They verify NOTHING cryptographic: signatures are placeholders, the real proofs are checked by the
// backend integration tests and, on a real phone, by the Owner. Never imported by the apps themselves.

class FakeDeviceBridge implements DeviceBridge {
  FakeDeviceBridge({this.supported = true, this.peerState});

  bool supported;
  PeerState? peerState;
  String? token;
  DeviceKeyState? key;
  int generated = 0;
  int signed = 0;
  String? bindingId;
  int? generation;
  final List<String> signedMessages = <String>[];
  Endorsement? endorsement = const Endorsement(bindingId: 'b-peer', authorizerKeyId: 'k-peer', signature: 'c2ln');
  Object? failEndorsement;

  @override
  Future<String> deviceId() async => 'android-test-device-0001';

  @override
  Future<DeviceKeyState?> currentKey() async => key;

  @override
  Future<DeviceKeyState> generateKey(String challengeBase64Url) async {
    if (!supported) {
      throw const DeviceBridgeException(DeviceBridgeFailure.unsupported);
    }
    generated++;
    key = DeviceKeyState(keyId: null, publicKeySpki: base64.encode(utf8.encode('spki-$generated')), chain: <String>[base64.encode(utf8.encode('leaf')), base64.encode(utf8.encode('root'))], bindingId: bindingId, generation: generation);
    return key!;
  }

  @override
  Future<void> saveKeyId(String keyId) async {
    final DeviceKeyState? current = key;
    if (current != null) {
      key = DeviceKeyState(keyId: keyId, publicKeySpki: current.publicKeySpki, chain: current.chain, bindingId: bindingId, generation: generation);
    }
  }

  @override
  Future<void> deleteKey() async => key = null;

  @override
  Future<String> sign(Uint8List message) async {
    signed++;
    signedMessages.add(utf8.decode(message));
    return 'c2lnbmF0dXJl';
  }

  @override
  Future<void> rememberBinding(String bindingId, int generation) async {
    this.bindingId = bindingId;
    this.generation = generation;
    final DeviceKeyState? current = key;
    if (current != null) {
      key = DeviceKeyState(keyId: current.keyId, publicKeySpki: current.publicKeySpki, chain: current.chain, bindingId: bindingId, generation: generation);
    }
  }

  @override
  Future<void> forgetBinding() async {
    bindingId = null;
    generation = null;
  }

  @override
  Future<String?> readToken() async => token;

  @override
  Future<void> storeToken(String token) async => this.token = token;

  @override
  Future<void> clearToken() async => token = null;

  @override
  Future<PeerState?> peer() async => peerState;

  @override
  Future<Endorsement> requestEndorsement({required String challengeId, required String nonce, required String targetApp, required String spkiSha256Hex}) async {
    if (failEndorsement != null) {
      throw failEndorsement!;
    }
    return endorsement!;
  }
}

typedef FakeHandler = Future<ApiResponse> Function(String method, String path, Map<String, String> headers, String body);

/// A scripted server: routes by "METHOD path", records every request, and can be told to lose an answer.
class FakeApiTransport implements ApiTransport {
  FakeApiTransport();

  final Map<String, FakeHandler> routes = <String, FakeHandler>{};
  final List<RecordedRequest> requests = <RecordedRequest>[];
  AuthFailure? failNext;

  @override
  Future<ApiResponse> send(String method, String pathAndQuery, {Map<String, String> headers = const <String, String>{}, List<int>? body}) async {
    final String text = body == null ? '' : utf8.decode(body);
    requests.add(RecordedRequest(method, pathAndQuery, headers, text));
    final AuthFailure? failure = failNext;
    if (failure != null) {
      failNext = null;
      throw failure;
    }
    final FakeHandler? handler = routes['$method $pathAndQuery'];
    if (handler == null) {
      return json(404, <String, Object?>{'error': <String, Object?>{'code': 'NOT_FOUND'}});
    }
    return handler(method, pathAndQuery, headers, text);
  }

  List<RecordedRequest> to(String method, String path) => requests.where((RecordedRequest r) => r.method == method && r.path == path).toList();
}

class RecordedRequest {
  const RecordedRequest(this.method, this.path, this.headers, this.body);

  final String method;
  final String path;
  final Map<String, String> headers;
  final String body;
}

ApiResponse json(int status, Object? body, {Map<String, String> headers = const <String, String>{}}) => ApiResponse(status: status, headers: headers, body: jsonEncode(body));

ApiResponse apiError(int status, String code) => json(status, <String, Object?>{'error': <String, Object?>{'code': code, 'message': 'x', 'request_id': 'r', 'details': <String, Object?>{}}});

Map<String, Object?> identityJson({String name = 'Nguyễn Văn An', int version = 1, String phone = '+84901234567', String active = 'CUSTOMER', String phoneVerification = 'VERIFIED'}) => <String, Object?>{
      'user_id': '11111111-1111-4111-8111-111111111111',
      'phone_normalized': phone,
      'available_roles': <String>['CUSTOMER'],
      'active_role': active,
      'profile': <String, Object?>{'full_name': name, 'version': version},
      'capabilities': <String, Object?>{'customer_access': true, 'shop_profile_read': false, 'shop_manage': false, 'driver_profile_read': false},
      'onboarding': <String, Object?>{'shop': 'NOT_STARTED', 'driver': 'NOT_STARTED'},
      'onboarding_required': false,
      'role_selection_required': false,
      'phone_verification_status': phoneVerification,
      'session': <String, Object?>{'expires_at': '2026-10-20T00:00:00.000Z'},
    };

/// Server doubles for the device protocol and the account endpoints. [registration] is the mode GET /config answers.
void installAccountRoutes(FakeApiTransport transport, {String registration = 'REQUIRED', String token = 'fake-access-token-0123456789'}) {
  int challenge = 0;
  transport.routes['GET /v1/client-auth/config'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'registration_verification': registration}});
  transport.routes['POST /v1/client-auth/device/challenges'] = (String m, String p, Map<String, String> h, String b) async {
    challenge++;
    return json(201, <String, Object?>{'data': <String, Object?>{'challenge_id': '00000000-0000-4000-8000-00000000000$challenge', 'nonce': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'expires_at': '2026-10-13T00:00:00.000Z'}});
  };
  transport.routes['POST /v1/client-auth/device/registrations'] = (String m, String p, Map<String, String> h, String b) async =>
      json(201, <String, Object?>{'data': <String, Object?>{'device_registration_token': 'dG9rZW4', 'key_id': '22222222-2222-4222-8222-222222222222', 'expires_at': '2026-10-13T00:02:00.000Z'}});
  transport.routes['POST /v1/client-auth/register'] = (String m, String p, Map<String, String> h, String b) async =>
      json(201, <String, Object?>{'data': <String, Object?>{...identityJson(), 'access_token': token}}, headers: <String, String>{'x-device-binding-id': '33333333-3333-4333-8333-333333333333', 'x-device-binding-generation': '1'});
  transport.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{...identityJson(), 'access_token': token}}, headers: <String, String>{'x-device-binding-id': '33333333-3333-4333-8333-333333333333', 'x-device-binding-generation': '1'});
  transport.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identityJson()});
  transport.routes['POST /v1/client-auth/logout'] = (String m, String p, Map<String, String> h, String b) async => ApiResponse(status: 204, headers: const <String, String>{}, body: '');
  transport.routes['GET /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{'user_id': '11111111-1111-4111-8111-111111111111', 'full_name': 'Nguyễn Văn An', 'version': 1}});
}

// ---- doubles for the three connected flows (shop, driver, reset) ------------------------------------------------------------

/// A position source that never touches the phone. [next] is what the single press returns; [failure] makes it fail.
class FakeLocationProvider implements LocationProvider {
  LocationFix? next = LocationFix(latitude: 10.0123, longitude: 106.0456, accuracyMeters: 12, takenAt: DateTime.utc(2026, 10, 13));
  LocationFailure? failure;
  int calls = 0;

  @override
  Future<LocationFix> currentFix() async {
    calls++;
    final LocationFailure? failed = failure;
    if (failed != null) {
      throw LocationException(failed);
    }
    return next!;
  }
}

/// The shop side of the server: one owner, one optional profile, ACTIVE areas, complete + context.
class FakeShopServer {
  FakeShopServer(FakeApiTransport transport, {this.areas = const <Map<String, String>>[<String, String>{'service_area_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'name': 'Khu trung tâm'}]}) {
    transport.routes['GET /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': profile});
    transport.routes['GET /v1/onboarding/shop/service-areas'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': areas});
    transport.routes['PUT /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async {
      final Map<String, Object?> body = jsonDecode(b) as Map<String, Object?>;
      puts.add(body);
      final Map<String, Object?>? current = profile;
      if (current != null && body['expected_version'] != current['version']) {
        return apiError(409, 'VERSION_CONFLICT');
      }
      profile = <String, Object?>{
        'shop_id': '44444444-4444-4444-8444-444444444444',
        'name': body['name'],
        'contact_phone': body['contact_phone'],
        'zalo': body['zalo'],
        'facebook': body['facebook'],
        'logo': body.containsKey('logo') ? body['logo'] : current?['logo'],
        'address_text': body['address_text'],
        'pickup_lat': body['pickup_lat'],
        'pickup_lng': body['pickup_lng'],
        'service_area_id': body['service_area_id'],
        'status': 'INCOMPLETE',
        'accepting_orders': false,
        'version': current == null ? 1 : (current['version']! as int) + 1,
      };
      return json(current == null ? 201 : 200, <String, Object?>{'data': profile});
    };
    transport.routes['POST /v1/onboarding/shop/complete'] = (String m, String p, Map<String, String> h, String b) async {
      final Map<String, Object?>? current = profile;
      if (current == null || current['pickup_lat'] == null || current['service_area_id'] == null) {
        return apiError(409, 'SHOP_PROFILE_INCOMPLETE');
      }
      completed++;
      profile = <String, Object?>{...current, 'status': 'ACTIVE', 'version': (current['version']! as int) + 1};
      owner = true;
      return json(200, <String, Object?>{'data': profile});
    };
    transport.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identity()});
    transport.routes['POST /v1/client-auth/context'] = (String m, String p, Map<String, String> h, String b) async {
      final String? wanted = (jsonDecode(b) as Map<String, Object?>)['context'] as String?;
      contexts.add(wanted ?? '');
      if (wanted == 'SHOP_OWNER' && !owner) {
        return apiError(403, 'ROLE_NOT_AVAILABLE');
      }
      active = wanted ?? active;
      return json(200, <String, Object?>{'data': identity()});
    };
  }

  final List<Map<String, String>> areas;
  Map<String, Object?>? profile;
  final List<Map<String, Object?>> puts = <Map<String, Object?>>[];
  final List<String> contexts = <String>[];
  int completed = 0;
  bool owner = false;
  String active = 'CUSTOMER';

  Map<String, Object?> identity() => <String, Object?>{
        ...identityJson(active: active),
        'available_roles': <String>['CUSTOMER', if (owner) 'SHOP_OWNER'],
        'onboarding': <String, Object?>{'shop': profile == null ? 'NOT_STARTED' : (profile!['status'] == 'ACTIVE' ? 'ACTIVE' : 'INCOMPLETE'), 'driver': 'NOT_STARTED'},
      };
}

/// The shop-management side of the server (GET /v1/shop/me, PUT profile, PUT business-hours) with the real rules a screen depends on:
/// an exact expected_version, an Idempotency-Key that replays the stored answer without a second effect, DISABLED = no write.
/// [loseAnswerOnce] commits the next write and then loses the answer (the outcome the app must treat as UNKNOWN).
class FakeShopOpsServer {
  FakeShopOpsServer(FakeApiTransport transport) {
    transport.routes['GET /v1/shop/me'] = (String m, String p, Map<String, String> h, String b) async {
      reads++;
      if (readFailure != null) {
        return apiError(readFailure!, 'SERVICE_UNAVAILABLE');
      }
      return json(200, <String, Object?>{'data': view()});
    };
    transport.routes['GET /v1/onboarding/shop/service-areas'] = (String m, String p, Map<String, String> h, String b) async =>
        json(200, <String, Object?>{'data': <Map<String, String>>[<String, String>{'service_area_id': areaId, 'name': 'Khu trung tâm'}, <String, String>{'service_area_id': otherAreaId, 'name': 'Khu Hòa An'}]});
    transport.routes['GET /v1/onboarding/shop/setup'] = (String m, String p, Map<String, String> h, String b) async {
      setupReads++;
      if (setupFailure != null) {
        return apiError(setupFailure!, 'SERVICE_UNAVAILABLE');
      }
      return json(200, <String, Object?>{'data': setupView()});
    };
    transport.routes['PUT /v1/shop/me/profile'] = (String m, String p, Map<String, String> h, String b) => _write(h, b, 'profile', (Map<String, Object?> body) {
          if (body.containsKey('logo')) logo = body['logo'] as Map<String, Object?>?;
          name = body['name']! as String;
          phone = body['contact_phone']! as String;
          zalo = body['zalo'] as String?;
          facebook = body['facebook'] as String?;
          address = body['address_text']! as String;
          lat = (body['pickup_lat']! as num).toDouble();
          lng = (body['pickup_lng']! as num).toDouble();
          serviceAreaId = body['service_area_id']! as String;
        });
    transport.routes['PUT /v1/shop/me/business-hours'] = (String m, String p, Map<String, String> h, String b) => _write(h, b, 'hours', (Map<String, Object?> body) {
          hours = <Map<String, Object?>>[for (final Object? i in body['intervals']! as List<Object?>) i! as Map<String, Object?>];
        });
  }

  static const String areaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  static const String otherAreaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  Map<String, Object?>? logo;
  String status = 'ACTIVE';
  String name = 'Ốc 11';
  String phone = '+84912345678';
  String? zalo;
  String? facebook;
  String address = '12 Phố Kim Đồng';
  double? lat = 22.6657;
  double? lng = 106.2522;
  String serviceAreaId = areaId;
  int version = 2;
  List<Map<String, Object?>> hours = <Map<String, Object?>>[];
  String reason = 'NO_BUSINESS_HOURS';
  int? readFailure;
  int reads = 0;
  bool loseAnswerOnce = false;

  /// Every write that reached the server and had an effect (a replay does not add one).
  final List<Map<String, Object?>> effects = <Map<String, Object?>>[];

  /// Every write request that arrived, replays included.
  final List<String> arrived = <String>[];
  final Map<String, ApiResponse> _byKey = <String, ApiResponse>{};
  final Map<String, String> _bodyOfKey = <String, String>{};

  /// Issue #190: the setup checklist as the server computes it from this fixture (schedule, point) and [hasSellableDish].
  bool hasSellableDish = false;
  String? requestNote;
  int? setupFailure;
  int setupReads = 0;

  Map<String, Object?> setupView() {
    final bool info = hours.isNotEmpty;
    final bool location = lat != null && lng != null && !(lat == 0 && lng == 0);
    final List<bool> done = <bool>[true, info, location, hasSellableDish];
    const List<String> keys = <String>['ACCOUNT', 'SHOP_INFO', 'LOCATION', 'FIRST_ITEM'];
    const List<List<String>> codes = <List<String>>[<String>[], <String>['BUSINESS_HOURS'], <String>['PICKUP_POINT'], <String>['SELLABLE_ITEM']];
    final bool complete = done.every((bool d) => d);
    final bool locked = status == 'DISABLED';
    final String state = locked ? 'LOCKED' : requestNote != null ? 'NEEDS_REVIEW' : complete && status == 'ACTIVE' ? 'ACTIVATED' : 'INCOMPLETE';
    return <String, Object?>{
      'shop_id': '44444444-4444-4444-8444-444444444444',
      'status': status,
      'version': version,
      'state': state,
      'completed_steps': done.where((bool d) => d).length,
      'total_steps': 4,
      'steps': <Object?>[for (int i = 0; i < 4; i++) <String, Object?>{'key': keys[i], 'done': done[i], 'missing': done[i] ? <String>[] : codes[i]}],
      'missing': <String>[for (int i = 0; i < 4; i++) if (!done[i]) ...codes[i]],
      'public': complete && status == 'ACTIVE',
      'activated': complete && status == 'ACTIVE',
      'activated_at': complete && status == 'ACTIVE' ? '2026-10-25T01:00:00.000Z' : null,
      'request': requestNote == null ? null : <String, Object?>{'note': requestNote, 'requested_at': '2026-10-25T00:00:00.000Z'},
      'lock': locked ? 'ADMIN' : null,
      'availability': <String, Object?>{'online': false, 'reason': reason, 'evaluated_at': '2026-10-25T01:00:00.000Z'},
    };
  }

  Map<String, Object?> view() => <String, Object?>{
        'shop_id': '44444444-4444-4444-8444-444444444444',
        'name': name,
        'logo': logo,
        'contact_phone': phone,
        'zalo': zalo,
        'facebook': facebook,
        'address_text': address,
        'pickup_lat': lat,
        'pickup_lng': lng,
        'service_area_id': serviceAreaId,
        'status': status,
        'version': version,
        'timezone': 'Asia/Ho_Chi_Minh',
        'hours': hours,
        'availability': <String, Object?>{'online': reason == 'ONLINE', 'reason': reason, 'evaluated_at': '2026-10-14T11:30:00.000Z'},
      };

  /// The server edits the shop by itself (another phone): version moves on.
  void changeElsewhere({String? newName}) {
    name = newName ?? '$name (sửa nơi khác)';
    version++;
  }

  Future<ApiResponse> _write(Map<String, String> headers, String body, String kind, void Function(Map<String, Object?> body) apply) async {
    final String key = headers['idempotency-key'] ?? '';
    arrived.add('$kind:$key');
    final ApiResponse? stored = _byKey[key];
    if (stored != null) {
      if (_bodyOfKey[key] != body) {
        return apiError(409, 'IDEMPOTENCY_KEY_REUSED');
      }
      if (loseAnswerOnce) {
        loseAnswerOnce = false;
        throw const AuthFailure(AuthFailureKind.unknownOutcome);
      }
      return stored;
    }
    if (status == 'DISABLED') {
      return apiError(403, 'SHOP_DISABLED');
    }
    final Map<String, Object?> parsed = jsonDecode(body) as Map<String, Object?>;
    if (parsed['expected_version'] != version) {
      return apiError(409, 'VERSION_CONFLICT');
    }
    apply(parsed);
    version++;
    effects.add(<String, Object?>{'kind': kind, 'key': key, ...parsed});
    final ApiResponse response = json(200, <String, Object?>{'data': <String, Object?>{'shop_id': '44444444-4444-4444-8444-444444444444', 'version': version}});
    _byKey[key] = response;
    _bodyOfKey[key] = body;
    if (loseAnswerOnce) {
      loseAnswerOnce = false;
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    return response;
  }
}

/// An in-memory [MenuApi] that follows the rules a screen depends on: exact versions, one effect per Idempotency-Key, soft delete,
/// hidden dishes stay in the owner's list. [loseAnswerOnce] commits the next write and then loses the answer.
class FakeMenuApi implements MenuApi {
  FakeMenuApi({List<MenuCategory>? categories, List<MenuItem>? items})
      : categories = categories ?? <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true), const MenuCategory(id: 'c2', name: 'Hải sản', active: true)],
        items = items ?? <MenuItem>[];

  List<MenuCategory> categories;
  List<MenuItem> items;
  bool loseAnswerOnce = false;
  bool failUploads = false;
  bool failLoads = false;
  int nextId = 1;
  int loads = 0;
  final List<String> arrived = <String>[];
  final List<String> effects = <String>[];
  final Map<String, MenuItem?> _byKey = <String, MenuItem?>{};
  final Set<String> deleted = <String>{};

  static MenuItem item(String id, String name, int price, String category, {bool hidden = false, int version = 1, String? image}) =>
      MenuItem(id: id, name: name, priceVnd: price, categoryId: category, imageRef: image, imageUrl: image == null ? null : 'https://img.test/$image', hidden: hidden, version: version);

  @override
  Future<MenuSnapshot> load() async {
    loads++;
    if (failLoads) {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    return MenuSnapshot(categories: List<MenuCategory>.of(categories), items: List<MenuItem>.of(items));
  }

  @override
  Future<({String ref, String url})> uploadImage(PickedImage image) async {
    arrived.add('upload');
    if (failUploads) {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    final String ref = 'img${nextId++}';
    return (ref: ref, url: 'https://img.test/$ref');
  }

  Future<MenuItem?> _once(String key, String label, MenuItem? Function() apply) async {
    arrived.add('$label:$key');
    if (_byKey.containsKey(key)) {
      if (loseAnswerOnce) {
        loseAnswerOnce = false;
        throw const AuthFailure(AuthFailureKind.unknownOutcome);
      }
      return _byKey[key];
    }
    final MenuItem? result = apply();
    effects.add('$label:$key');
    _byKey[key] = result;
    if (loseAnswerOnce) {
      loseAnswerOnce = false;
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    return result;
  }

  MenuItem _current(String id, int expectedVersion) {
    final int index = items.indexWhere((MenuItem i) => i.id == id);
    if (index < 0 || deleted.contains(id)) {
      throw const AuthFailure(AuthFailureKind.badRequest, code: 'MENU_ITEM_NOT_FOUND', status: 404);
    }
    if (items[index].version != expectedVersion) {
      throw const AuthFailure(AuthFailureKind.versionConflict, code: 'VERSION_CONFLICT', status: 409);
    }
    return items[index];
  }

  String? _urlOf(String? ref) => ref == null ? null : (items.where((MenuItem i) => i.imageRef == ref).map((MenuItem i) => i.imageUrl).firstOrNull ?? 'https://img.test/$ref');

  void _replace(MenuItem next) => items = <MenuItem>[for (final MenuItem i in items) i.id == next.id ? next : i];

  @override
  Future<MenuItem> create(MenuItemInput input, {required String key}) async {
    final MenuItem? made = await _once(key, 'create', () {
      final MenuItem created = MenuItem(id: 'i${nextId++}', name: input.name, description: input.description, priceVnd: input.priceVnd, categoryId: input.categoryId, imageRef: input.imageRef, imageUrl: _urlOf(input.imageRef), hidden: false, version: 1);
      items = <MenuItem>[...items, created];
      return created;
    });
    return made!;
  }

  @override
  Future<MenuItem> update(String id, MenuItemInput input, {required int expectedVersion, required String key}) async {
    final MenuItem? made = await _onceChecked(key, 'update', id, expectedVersion, (MenuItem c) {
      final MenuItem next = MenuItem(id: id, name: input.name, description: input.description, priceVnd: input.priceVnd, categoryId: input.categoryId, imageRef: input.imageRef, imageUrl: _urlOf(input.imageRef), hidden: c.hidden, version: c.version + 1);
      _replace(next);
      return next;
    });
    return made!;
  }

  @override
  Future<MenuItem> setHidden(String id, bool hidden, {required int expectedVersion, required String key}) async {
    final MenuItem? made = await _onceChecked(key, hidden ? 'hide' : 'show', id, expectedVersion, (MenuItem c) {
      final MenuItem next = MenuItem(id: id, name: c.name, description: c.description, priceVnd: c.priceVnd, categoryId: c.categoryId, imageRef: c.imageRef, imageUrl: c.imageUrl, hidden: hidden, version: c.version + 1);
      _replace(next);
      return next;
    });
    return made!;
  }

  @override
  Future<void> delete(String id, {required int expectedVersion, required String key}) async {
    await _onceChecked(key, 'delete', id, expectedVersion, (MenuItem c) {
      deleted.add(id);
      items = <MenuItem>[for (final MenuItem i in items) if (i.id != id) i];
      return null;
    });
  }

  Future<MenuItem?> _onceChecked(String key, String label, String id, int expectedVersion, MenuItem? Function(MenuItem current) apply) async {
    arrived.add('$label:$key');
    if (_byKey.containsKey(key)) {
      if (loseAnswerOnce) {
        loseAnswerOnce = false;
        throw const AuthFailure(AuthFailureKind.unknownOutcome);
      }
      return _byKey[key];
    }
    final MenuItem current = _current(id, expectedVersion);
    final MenuItem? result = apply(current);
    effects.add('$label:$key');
    _byKey[key] = result;
    if (loseAnswerOnce) {
      loseAnswerOnce = false;
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    return result;
  }

  /// Another phone edits a dish: its version moves on.
  void editElsewhere(String id, {String? name, bool? hidden}) {
    final MenuItem c = items.firstWhere((MenuItem i) => i.id == id);
    _replace(MenuItem(id: id, name: name ?? c.name, description: c.description, priceVnd: c.priceVnd, categoryId: c.categoryId, imageRef: c.imageRef, imageUrl: c.imageUrl, hidden: hidden ?? c.hidden, version: c.version + 1));
  }

  void deleteElsewhere(String id) {
    deleted.add(id);
    items = <MenuItem>[for (final MenuItem i in items) if (i.id != id) i];
  }
}

class FakeImagePicker implements ImagePickerPort {
  PickedImage? next = PickedImage(bytes: Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg');
  bool unreadable = false;
  int calls = 0;

  @override
  Future<PickedImage?> pick() async {
    calls++;
    if (unreadable) {
      throw const ImagePickException();
    }
    return next;
  }
}

class FakePublicShopApi implements PublicShopApi {
  FakePublicShopApi(this.view);

  ShopMenuView? view;
  String? failureCode;
  bool offline = false;
  int calls = 0;

  @override
  Future<ShopMenuView> load(String shopId) async {
    calls++;
    if (offline) {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    if (failureCode != null) {
      throw AuthFailure(AuthFailureKind.badRequest, code: failureCode, status: 404);
    }
    return view!;
  }
}

/// An in-memory [DiscoveryApi] with the visible-data rules the screens rely on (shops of ONE area, folded search, open filter, paging).
/// [gate] lets a test hold an answer back to prove the latest request wins.
class FakeDiscoveryApi implements DiscoveryApi {
  Future<AreaChoice?> Function(double latitude, double longitude)? areaResolver;
  @override
  Future<AreaChoice?> resolveArea(double latitude, double longitude) async {
    await _enter(null, 'resolve');
    return areaResolver == null ? null : await areaResolver!(latitude, longitude);
  }

  FakeDiscoveryApi({List<AreaChoice>? areas, List<CategoryChoice>? categories, List<FakeShopEntry>? shops})
      : areaList = areas ?? <AreaChoice>[const AreaChoice(id: 'a1', name: 'Cao Bằng')],
        categoryList = categories ?? <CategoryChoice>[const CategoryChoice(id: 'c1', name: 'Ốc'), const CategoryChoice(id: 'c2', name: 'Hải sản')],
        entries = shops ?? <FakeShopEntry>[];

  List<AreaChoice> areaList;
  List<CategoryChoice> categoryList;
  List<FakeShopEntry> entries;
  bool offline = false;

  /// Road distances in metres by shop id (issue #190). A shop missing here, or mapped to null, has no known road.
  Map<String, int?> roads = <String, int?>{};
  final List<({double latitude, double longitude, List<String> shopIds})> routeRequests = <({double latitude, double longitude, List<String> shopIds})>[];
  bool routeOffline = false;
  Future<void> Function()? routeGate;

  @override
  Future<Map<String, int?>> routeDistances(double latitude, double longitude, List<String> shopIds) async {
    routeRequests.add((latitude: latitude, longitude: longitude, shopIds: List<String>.of(shopIds)));
    await routeGate?.call();
    if (routeOffline) {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
    return <String, int?>{for (final String id in shopIds) if (roads.containsKey(id)) id: roads[id]};
  }
  Future<void> Function(DiscoveryQuery query, String kind)? gate;
  final List<DiscoveryQuery> queries = <DiscoveryQuery>[];

  Future<void> _enter(DiscoveryQuery? q, String kind) async {
    if (q != null) {
      queries.add(q);
      await gate?.call(q, kind);
    }
    if (offline) {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    }
  }

  @override
  Future<List<AreaChoice>> areas() async {
    await _enter(null, 'areas');
    return areaList;
  }

  @override
  Future<List<CategoryChoice>> categories() async {
    await _enter(null, 'categories');
    return categoryList;
  }

  bool _match(FakeShopEntry s, DiscoveryQuery q) => s.areaId == q.areaId && (!q.openOnly || s.reason == 'ONLINE') && (q.categoryId == null || s.dishes.any((FakeDishEntry d) => d.categoryId == q.categoryId));

  @override
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query) async {
    await _enter(query, 'shops');
    final String needle = foldVietnamese(query.term);
    final List<FakeShopEntry> all = <FakeShopEntry>[for (final FakeShopEntry s in entries) if (_match(s, query) && (needle.isEmpty || foldVietnamese(s.name).contains(needle))) s];
    all.sort((FakeShopEntry a, FakeShopEntry b) => (a.reason == 'ONLINE' ? 0 : 1) != (b.reason == 'ONLINE' ? 0 : 1) ? (a.reason == 'ONLINE' ? 0 : 1) - (b.reason == 'ONLINE' ? 0 : 1) : foldVietnamese(a.name).compareTo(foldVietnamese(b.name)));
    final List<FakeShopEntry> page = all.skip(query.offset).take(query.limit).toList();
    return DiscoveryPage<ShopCardData>(items: <ShopCardData>[for (final FakeShopEntry s in page) s.card], hasMore: query.offset + page.length < all.length);
  }

  @override
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query) async {
    await _enter(query, 'dishes');
    final String needle = foldVietnamese(query.term);
    final List<DishHit> all = <DishHit>[
      for (final FakeShopEntry s in entries)
        if (_match(s, query))
          for (final FakeDishEntry d in s.dishes)
            if ((query.categoryId == null || d.categoryId == query.categoryId) && (needle.isEmpty || foldVietnamese(d.name).contains(needle)))
              DishHit(itemId: d.id, name: d.name, priceVnd: d.price, imageUrl: null, shop: s.card),
    ];
    final List<DishHit> page = all.skip(query.offset).take(query.limit).toList();
    return DiscoveryPage<DishHit>(items: page, hasMore: query.offset + page.length < all.length);
  }
}

class FakeShopEntry {
  FakeShopEntry(this.id, this.name, {this.areaId = 'a1', this.reason = 'ONLINE', this.address = '12 Phố Kim Đồng', this.dishes = const <FakeDishEntry>[], this.latitude, this.longitude});

  final String id;
  final String name;
  final String areaId;
  final String reason;
  final String address;
  final List<FakeDishEntry> dishes;
  final double? latitude;
  final double? longitude;

  ShopCardData get card => ShopCardData(shopId: id, name: name, address: address, reason: reason, latitude: latitude, longitude: longitude);
}

class FakeDishEntry {
  const FakeDishEntry(this.id, this.name, this.price, this.categoryId);

  final String id;
  final String name;
  final int price;
  final String categoryId;
}

/// The driver side (M03): GET driver/me is null until the one POST (M01 onboarding); the M03 commands change the profile the way the
/// server does (version +1, bank back to UNVERIFIED on a change, accepting only with every condition). [profile] is the stored profile
/// in the server's own shape; tests may set it directly, and the [walletReady] flag stands in for the M04 answer.
class FakeDriverServer {
  FakeDriverServer(FakeApiTransport transport) {
    transport.routes['GET /v1/driver/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': _view()});
    transport.routes['GET /v1/driver/banks'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'banks': <Object?>[
              <String, Object?>{'code': 'VCB', 'name': 'Vietcombank'},
              <String, Object?>{'code': 'TCB', 'name': 'Techcombank'},
            ],
          },
        });
    transport.routes['POST /v1/onboarding/driver'] = (String m, String p, Map<String, String> h, String b) async {
      posts.add(jsonDecode(b) as Map<String, Object?>);
      final Map<String, Object?> body = posts.last;
      profile ??= <String, Object?>{
        'driver_id': '55555555-5555-4555-8555-555555555555',
        'user_id': '11111111-1111-4111-8111-111111111111',
        'shipper_code': 'SH000001',
        'full_name': body['full_name'],
        'phone': '+84901234567',
        'plate_number': body['plate_number'],
        'status': 'ACTIVE',
        'review_state': 'DRAFT',
        'accepting_deliveries': false,
        'version': 1,
      };
      return json(201, <String, Object?>{'data': <String, Object?>{'driver_id': profile!['driver_id'], 'status': 'ACTIVE', 'accepting_deliveries': false, 'role_granted': true, 'version': 1}});
    };
    transport.routes['PUT /v1/driver/me/profile'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          profile!['full_name'] = body['full_name'];
          profile!['plate_number'] = body['plate_number'];
        });
    transport.routes['PUT /v1/driver/me/bank'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          final String code = body['bank_code']! as String;
          bank = <String, Object?>{
            'bank_code': code,
            'bank_name': code == 'VCB' ? 'Vietcombank' : 'Techcombank',
            'account_number': body['account_number'],
            'account_holder': body['account_holder'],
            'verification_state': 'UNVERIFIED',
            'rejection_reason': null,
          };
          profile!['accepting_deliveries'] = false;
        });
    transport.routes['POST /v1/driver/me/submit'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          if (profile!['status'] != 'PENDING' || (profile!['review_state'] != 'DRAFT' && profile!['review_state'] != 'REJECTED') || bank == null) {
            throw StateError('DRIVER_STATE_CONFLICT');
          }
          profile!['review_state'] = 'SUBMITTED';
          profile!['rejection_reason'] = null;
        });
    transport.routes['POST /v1/driver/me/accepting'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          final bool on = body['accepting']! as bool;
          if (on && (profile!['status'] != 'ACTIVE' || !walletReady)) {
            throw StateError('DRIVER_WALLET_NOT_READY');
          }
          if (on && sendPresence && !locationReady) {
            throw StateError('DRIVER_LOCATION_NOT_READY');
          }
          profile!['accepting_deliveries'] = on;
        });
    transport.routes['POST /v1/driver/me/closure-request'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          // Like the server: a SUSPENDED Shipper may close to get the balance back; the suspension reason stays and the status returns on cancel.
          if (profile!['status'] != 'ACTIVE' && profile!['status'] != 'SUSPENDED') {
            throw StateError('DRIVER_STATE_CONFLICT');
          }
          closureFrom = profile!['status'] as String;
          profile!['status'] = 'CLOSING';
          profile!['accepting_deliveries'] = false;
          closureNote = body['note'] as String?;
        });
    transport.routes['POST /v1/driver/me/closure-cancel'] = (String m, String p, Map<String, String> h, String b) async => _command(p, b, (Map<String, Object?> body) {
          if (profile!['status'] != 'CLOSING') {
            throw StateError('DRIVER_STATE_CONFLICT');
          }
          profile!['status'] = closureFrom;
          closureNote = null;
        });
  }

  /// The stored profile in the server's shape (without bank / readiness / closure, which [_view] derives); null = none yet.
  Map<String, Object?>? profile;

  /// The stored bank account (server shape) or null.
  Map<String, Object?>? bank;
  bool walletReady = false;
  String? closureNote;
  String closureFrom = 'ACTIVE';

  /// 11Ship: when on, the profile carries `presence` and switching on needs [locationReady] (a position reported and still fresh), like the server.
  bool sendPresence = false;
  bool locationReady = false;

  /// A delivery is still in progress (or goods are still with the Shipper): the position must keep being shared.
  bool hasActiveWork = false;
  int locationReports = 0;

  /// PUT /v1/driver/location the way the server answers: the report makes the position fresh and says whether sharing must go on.
  void enableLocationRoutes(FakeApiTransport transport) {
    sendPresence = true;
    transport.routes['PUT /v1/driver/location'] = (String m, String p, Map<String, String> h, String b) async {
      locationReports++;
      locationReady = true;
      final bool intent = profile?['accepting_deliveries'] == true;
      return json(200, <String, Object?>{
        'data': <String, Object?>{'ok': true, 'intent_online': intent, 'has_active_work': hasActiveWork, 'should_share_location': (intent && profile?['status'] == 'ACTIVE') || hasActiveWork},
      });
    };
  }
  final List<Map<String, Object?>> posts = <Map<String, Object?>>[];

  /// What the M03 commands received, in order: path and decoded body.
  final List<(String, Map<String, Object?>)> commands = <(String, Map<String, Object?>)>[];

  Map<String, Object?>? _view() {
    final Map<String, Object?>? stored = profile;
    if (stored == null) {
      return null;
    }
    final String status = stored['status']! as String;
    final String review = stored['review_state']! as String;
    final bool bankVerified = bank != null && bank!['verification_state'] == 'VERIFIED';
    final List<String> blocks = <String>[
      if (status != 'ACTIVE') (status == 'PENDING' ? 'PROFILE_NOT_APPROVED' : (status == 'CLOSING' ? 'CLOSURE_REQUESTED' : 'ACCOUNT_SUSPENDED')),
      if (!walletReady) 'WALLET_NOT_AVAILABLE',
    ];
    final bool editable = status == 'PENDING' && (review == 'DRAFT' || review == 'REJECTED');
    return <String, Object?>{
      ...stored,
      'rejection_reason': stored['rejection_reason'],
      'suspension_reason': stored['suspension_reason'],
      'submitted_at': null,
      'reviewed_at': null,
      'can_edit_profile': editable,
      'can_submit': editable,
      'bank': bank,
      'readiness': <String, Object?>{
        'profile_approved': status == 'ACTIVE',
        'bank_verified': bankVerified,
        'wallet_ready': walletReady,
        'blocks': blocks,
        'can_accept': status == 'ACTIVE' && walletReady,
      },
      'closure': status == 'CLOSING' ? <String, Object?>{'requested_at': '2026-10-17T00:00:00.000Z', 'note': closureNote, 'can_cancel': true, 'from_status': closureFrom} : null,
      if (sendPresence)
        'presence': <String, Object?>{
          'intent_online': stored['accepting_deliveries'] == true,
          'location_ready': locationReady,
          'location_fresh_seconds': 120,
          'can_receive_orders': stored['accepting_deliveries'] == true && status == 'ACTIVE' && walletReady && locationReady,
          'paused_reason': stored['accepting_deliveries'] == true && !locationReady ? 'LOCATION_STALE' : null,
          'has_active_work': hasActiveWork,
          'should_share_location': (stored['accepting_deliveries'] == true && status == 'ACTIVE') || hasActiveWork,
        },
    };
  }

  Future<ApiResponse> _command(String path, String body, void Function(Map<String, Object?> body) apply) async {
    final Map<String, Object?> decoded = jsonDecode(body) as Map<String, Object?>;
    commands.add((path, decoded));
    if (decoded['expected_version'] != profile!['version']) {
      return apiError(409, 'VERSION_CONFLICT');
    }
    try {
      apply(decoded);
    } on StateError catch (error) {
      return apiError(409, error.message.toString());
    }
    profile!['version'] = (profile!['version']! as int) + 1;
    return json(200, <String, Object?>{'data': _view()});
  }
}

/// The public reset routes. [mode] is what GET config answers.
void installResetRoutes(FakeApiTransport transport, {String mode = 'SMS_OTP'}) {
  transport.routes['GET /v1/account-recovery/config'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'mode': mode}});
  // SMS_OTP (issue #102): the same generic answer for every number; the code the fake server accepts is [otp].
  transport.routes['POST /v1/account-recovery/otp'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{'verification_id': '44444444-4444-4444-8444-444444444444', 'expires_in_seconds': 300, 'resend_after_seconds': 60, 'delivery_status': 'PENDING_DELIVERY'}});
  transport.routes['POST /v1/account-recovery/otp/44444444-4444-4444-8444-444444444444/verify'] = (String m, String p, Map<String, String> h, String b) async =>
      b.contains('"123456"') ? json(200, <String, Object?>{'data': <String, Object?>{'verification_token': 'RESET-PROOF-TOKEN-0123456789', 'purpose': 'RESET_PASSWORD', 'expires_in_seconds': 600}}) : apiError(400, 'OTP_INVALID');
  transport.routes['POST /v1/account-recovery/reset'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'next': 'LOGIN'}});
}

/// The public routes of the recovery of an account locked at its owner's request. [mode] is what GET locked/config answers.
void installRecoverRoutes(FakeApiTransport transport, {String mode = 'SMS_OTP'}) {
  transport.routes['GET /v1/account-recovery/locked/config'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'mode': mode}});
  transport.routes['POST /v1/account-recovery/locked/otp'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{'verification_id': '66666666-6666-4666-8666-666666666666', 'expires_in_seconds': 300, 'resend_after_seconds': 60, 'delivery_status': 'PENDING_DELIVERY'}});
  transport.routes['POST /v1/account-recovery/locked/otp/66666666-6666-4666-8666-666666666666/verify'] = (String m, String p, Map<String, String> h, String b) async =>
      b.contains('"123456"') ? json(200, <String, Object?>{'data': <String, Object?>{'verification_token': 'RECOVER-PROOF-TOKEN-0123456789', 'purpose': 'RECOVER_ACCOUNT', 'expires_in_seconds': 600}}) : apiError(400, 'OTP_INVALID');
  transport.routes['POST /v1/account-recovery/locked/recover'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'next': 'LOGIN'}});
}

/// The REGISTER OTP routes. [queued] = the server accepted the code into the SMS queue (PENDING_DELIVERY, then [deliveries] in
/// order); otherwise the provider is synchronous and the answer has no delivery_status. The code the fake accepts is 123456.
void installOtpRoutes(FakeApiTransport transport, {bool queued = true, List<String> deliveries = const <String>['PENDING_DELIVERY', 'SENT']}) {
  const String id = '55555555-5555-4555-8555-555555555555';
  int polls = 0;
  transport.routes['POST /v1/auth/phone-verifications'] = (String m, String p, Map<String, String> h, String b) async =>
      json(201, <String, Object?>{'data': <String, Object?>{'verification_id': id, 'expires_in_seconds': 300, 'resend_after_seconds': 60, if (queued) 'delivery_status': 'PENDING_DELIVERY'}});
  transport.routes['GET /v1/auth/phone-verifications/$id'] = (String m, String p, Map<String, String> h, String b) async {
    final String status = deliveries[polls < deliveries.length ? polls : deliveries.length - 1];
    polls++;
    return json(200, <String, Object?>{'data': <String, Object?>{'delivery_status': status}});
  };
  transport.routes['POST /v1/auth/phone-verifications/$id/verify'] = (String m, String p, Map<String, String> h, String b) async =>
      b.contains('"123456"') ? json(200, <String, Object?>{'data': <String, Object?>{'verification_token': 'REGISTER-PROOF-TOKEN-0123456789', 'purpose': 'REGISTER', 'expires_in_seconds': 600}}) : apiError(400, 'OTP_INVALID');
}


/// A [ContactLauncher] that records what was asked and answers as told (issue #190): [result] false = "no app can handle it".
class FakeContactLauncher implements ContactLauncher {
  bool result = true;
  bool throwing = false;
  final List<String> dialed = <String>[];
  final List<String> opened = <String>[];

  @override
  Future<bool> dial(String phone) async {
    if (throwing) throw StateError('no dialer');
    dialed.add(phone);
    return result;
  }

  @override
  Future<bool> openUrl(String url) async {
    if (throwing) throw StateError('no handler');
    opened.add(url);
    return result;
  }
}
