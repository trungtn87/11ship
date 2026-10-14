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

Map<String, Object?> identityJson({String name = 'Nguyễn Văn An', int version = 1, String phone = '+84901234567', String active = 'CUSTOMER'}) => <String, Object?>{
      'user_id': '11111111-1111-4111-8111-111111111111',
      'phone_normalized': phone,
      'available_roles': <String>['CUSTOMER'],
      'active_role': active,
      'profile': <String, Object?>{'full_name': name, 'version': version},
      'capabilities': <String, Object?>{'customer_access': true, 'shop_profile_read': false, 'shop_manage': false, 'driver_profile_read': false},
      'onboarding': <String, Object?>{'shop': 'NOT_STARTED', 'driver': 'NOT_STARTED'},
      'onboarding_required': false,
      'role_selection_required': false,
      'session': <String, Object?>{'expires_at': '2026-10-20T00:00:00.000Z'},
    };

/// Server doubles for the device protocol and the account endpoints. [registration] is the mode GET /config answers.
void installAccountRoutes(FakeApiTransport transport, {String registration = 'DISABLED_TEST', String token = 'fake-access-token-0123456789'}) {
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

/// The driver side: GET driver/me is null until the one POST; the status is whatever the test sets.
class FakeDriverServer {
  FakeDriverServer(FakeApiTransport transport) {
    transport.routes['GET /v1/driver/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': profile});
    transport.routes['POST /v1/onboarding/driver'] = (String m, String p, Map<String, String> h, String b) async {
      posts.add(jsonDecode(b) as Map<String, Object?>);
      final Map<String, Object?> body = posts.last;
      profile ??= <String, Object?>{
        'driver_id': '55555555-5555-4555-8555-555555555555',
        'full_name': body['full_name'],
        'plate_number': body['plate_number'],
        'driver_type': 'EXTERNAL',
        'status': 'PENDING',
        'accepting_deliveries': false,
        'version': 1,
      };
      return json(201, <String, Object?>{'data': profile});
    };
  }

  Map<String, Object?>? profile;
  final List<Map<String, Object?>> posts = <Map<String, Object?>>[];
}

/// The public reset routes. [mode] is what GET config answers.
void installResetRoutes(FakeApiTransport transport, {String mode = 'DISABLED_TEST'}) {
  transport.routes['GET /v1/account-recovery/config'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'mode': mode}});
  transport.routes['POST /v1/account-recovery/reset-test'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'next': 'LOGIN'}});
  // SMS_OTP (issue #102): the same generic answer for every number; the code the fake server accepts is [otp].
  transport.routes['POST /v1/account-recovery/otp'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{'verification_id': '44444444-4444-4444-8444-444444444444', 'expires_in_seconds': 300, 'resend_after_seconds': 60, 'delivery_status': 'PENDING_DELIVERY'}});
  transport.routes['POST /v1/account-recovery/otp/44444444-4444-4444-8444-444444444444/verify'] = (String m, String p, Map<String, String> h, String b) async =>
      b.contains('"123456"') ? json(200, <String, Object?>{'data': <String, Object?>{'verification_token': 'RESET-PROOF-TOKEN-0123456789', 'purpose': 'RESET_PASSWORD', 'expires_in_seconds': 600}}) : apiError(400, 'OTP_INVALID');
  transport.routes['POST /v1/account-recovery/reset'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'next': 'LOGIN'}});
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
