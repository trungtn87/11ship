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
