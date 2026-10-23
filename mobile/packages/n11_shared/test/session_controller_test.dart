import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) build({ClientApp app = ClientApp.food, FakeDeviceBridge? bridge, String registration = 'REQUIRED'}) {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api, registration: registration);
  final FakeDeviceBridge deviceBridge = bridge ?? FakeDeviceBridge();
  return (session: createSessionController(app, config, transport: api, bridge: deviceBridge), api: api, bridge: deviceBridge);
}

void main() {
  group('cold start', () {
    test('HTTPS setup does not require a device attestation environment', () {
      final session = createSessionController(ClientApp.food, const AppConfig(apiBaseUrl: 'https://api.example.test'), transport: FakeApiTransport(), bridge: FakeDeviceBridge(supported: false));
      expect(session.ready, isTrue);
      session.dispose();
    });

    test('no token: guest, and the server is not asked', () async {
      final t = build();
      await t.session.start();
      expect(t.session.status, SessionStatus.guest);
      expect(t.api.requests, isEmpty);
    });

    test('a stored token is checked with `me` BEFORE anything personal is shown; no device key is needed', () async {
      final t = build();
      t.bridge.token = 'stored-token';
      t.bridge.key = const DeviceKeyState(keyId: '22222222-2222-4222-8222-222222222222', publicKeySpki: 'c3Bracw=', chain: <String>['bGVhZg=='], bindingId: null, generation: null);
      final Future<void> started = t.session.start();
      expect(t.session.status, SessionStatus.starting);
      expect(t.session.identity, isNull);
      await started;
      expect(t.session.status, SessionStatus.signedIn);
      expect(t.session.profile?.fullName, 'Nguyễn Văn An');
      final RecordedRequest me = t.api.to('GET', '/v1/client-auth/me').single;
      expect(me.headers['authorization'], 'Bearer stored-token');
      expect(me.headers['x-device-key-id'], isNull);
      expect(me.headers['x-device-signature'], isNull);
      expect(t.bridge.signedMessages, isEmpty);
    });

    test('401 clears the token and every personal value but KEEPS the device key', () async {
      final t = build();
      t.bridge.token = 'stored-token';
      t.bridge.key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
      t.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      await t.session.start();
      expect(t.session.status, SessionStatus.guest);
      expect(t.session.identity, isNull);
      expect(t.session.profile, isNull);
      expect(t.bridge.token, isNull);
      expect(t.bridge.key, isNotNull);
      expect(t.session.sessionEndedNotice, isTrue);
    });

    test('offline / 503 leaves the session unverified: nothing personal is shown and the token is kept', () async {
      final t = build();
      t.bridge.token = 'stored-token';
      t.bridge.key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: null, generation: null);
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await t.session.start();
      expect(t.session.status, SessionStatus.unverified);
      expect(t.session.identity, isNull);
      expect(t.bridge.token, 'stored-token');
      await t.session.revalidate();
      expect(t.session.status, SessionStatus.signedIn);
    });

    test('legacy device-bound token requires password login and grants nothing', () async {
      final t = build();
      t.bridge.token = 'stored-token';
      t.bridge.key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: null, generation: null);
      t.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(403, 'DEVICE_PROOF_INVALID');
      await t.session.start();
      expect(t.session.status, SessionStatus.guest);
      expect(t.session.identity, isNull);
      expect(t.bridge.token, isNull);
    });
  });

  group('register (SMS-verified) and login', () {
    test('registers with OTP and enters app without enrollment or signatures', () async {
      final t = build();
      await t.session.loadRegistrationMode();
      expect(t.session.registrationMode, RegistrationMode.required);
      expect(await t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'PROOF-TOKEN-0123456789'), isTrue);
      expect(t.session.status, SessionStatus.signedIn);
      expect(t.bridge.generated, 0);
      expect(t.bridge.token, 'fake-access-token-0123456789');
      expect(t.bridge.bindingId, isNull);
      expect(t.bridge.key, isNull);
      final RecordedRequest register = t.api.to('POST', '/v1/client-auth/register').single;
      expect(register.body, contains('"verification_token":"PROOF-TOKEN-0123456789"'));
      expect(register.body, contains('"terms_version":"terms-20261014-v1"'));
      expect(register.body, contains('"privacy_version":"privacy-20261017-v1"'));
      expect(register.headers['x-device-registration'], isNull);
      expect(register.headers['idempotency-key'], matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(t.bridge.signedMessages, isEmpty);
      // The password is in the body only: never in a header, never in storage.
      expect(register.headers.values.join(), isNot(contains('Correct-Horse-9')));
    });

    test('no registration is sent without the phone proof, and a server mode this build does not know opens nothing', () async {
      final t = build();
      await t.session.loadRegistrationMode();
      expect(await t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An'), isFalse);
      expect(t.api.to('POST', '/v1/client-auth/register'), isEmpty);
      final other = build(registration: 'DISABLED_TEST');
      await other.session.loadRegistrationMode();
      expect(other.session.registrationMode, RegistrationMode.unknown);
      expect(await other.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'PROOF-TOKEN-0123456789'), isFalse);
      expect(other.api.to('POST', '/v1/client-auth/register'), isEmpty);
    });

    test('an unreadable configuration leaves the mode unknown (the app never guesses)', () async {
      final t = build();
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await t.session.loadRegistrationMode();
      expect(t.session.registrationMode, RegistrationMode.unknown);
    });

    test('wrong password is a credentials failure: no token, no session-ended notice, no pending retry', () async {
      final t = build();
      t.api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'INVALID_CREDENTIALS');
      expect(await t.session.login(phone: '0901234567', password: 'wrong-password'), isFalse);
      expect(t.session.lastFailure?.kind, AuthFailureKind.invalidCredentials);
      expect(t.session.sessionEndedNotice, isFalse);
      expect(t.session.pending, isNull);
      expect(t.bridge.token, isNull);
      expect(t.session.status, isNot(SessionStatus.signedIn));
    });

    test('a lost answer keeps the SAME key and body; only the person retrying sends them again, with a fresh nonce and signature', () async {
      final t = build();
      int calls = 0;
      final FakeHandler real = t.api.routes['POST /v1/client-auth/login']!;
      t.api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async {
        if (++calls == 1) {
          throw const AuthFailure(AuthFailureKind.unknownOutcome);
        }
        return real(m, p, h, b);
      };
      expect(await t.session.login(phone: '0901234567', password: 'Correct-Horse-9'), isFalse);
      expect(t.session.lastFailure?.kind, AuthFailureKind.unknownOutcome);
      expect(t.session.pending, isNotNull);
      expect(t.session.status, isNot(SessionStatus.signedIn));
      // Nothing is re-sent on its own.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(t.api.to('POST', '/v1/client-auth/login'), hasLength(1));

      expect(await t.session.retryPending(), isTrue);
      final List<RecordedRequest> sent = t.api.to('POST', '/v1/client-auth/login');
      expect(sent, hasLength(2));
      expect(sent[1].body, sent[0].body);
      expect(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key']);
      expect(sent[1].headers['x-device-registration'], sent[0].headers['x-device-registration']);
      expect(sent[1].headers['x-device-nonce'], isNull);
      expect(t.session.status, SessionStatus.signedIn);
      expect(t.session.pending, isNull);
      // No hardware enrollment for either attempt.
      expect(t.api.to('POST', '/v1/client-auth/device/registrations'), isEmpty);
    });

    test('phones without attestation can register and log in without touching device endpoints', () async {
      final t = build(bridge: FakeDeviceBridge(supported: false));
      t.api.routes['POST /v1/client-auth/device/challenges'] = (m, p, h, b) async => apiError(503, 'SERVICE_UNAVAILABLE');
      await t.session.loadRegistrationMode();
      expect(await t.session.register(phone: '0909999999', password: 'Correct-Horse-9', fullName: 'Người Mới', verificationToken: 'PROOF-TOKEN-0123456789'), isTrue);
      await t.session.logout();
      expect(await t.session.login(phone: '0909999999', password: 'Correct-Horse-9'), isTrue);
      expect(t.bridge.generated, 0);
      expect(t.bridge.signedMessages, isEmpty);
      expect(t.api.requests.where((r) => r.path.contains('/device/')), isEmpty);
    });

    test('503 from login preserves Android platform and does not retry another authentication scheme', () async {
      final t = build();
      t.api.routes['POST /v1/client-auth/login'] = (m, p, h, b) async => apiError(503, 'SERVICE_UNAVAILABLE');
      expect(await t.session.login(phone: '0901234567', password: 'Correct-Horse-9'), isFalse);
      expect(t.session.lastFailure?.kind, AuthFailureKind.serverUnavailable);
      expect(t.api.to('POST', '/v1/client-auth/login'), hasLength(1));
      expect(t.api.requests.every((r) => !r.body.contains('"platform":"WEB"')), isTrue);
    });
  });

  group('two apps and password sessions', () {
    for (final app in ClientApp.values) {
      test('${app.label} does not join or sign using a peer binding', () async {
        final t = build(app: app, bridge: FakeDeviceBridge(peerState: const PeerState(bindingId: 'b-peer', keyId: 'k-peer')));
        expect(await t.session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
        expect(t.bridge.generated, 0);
        expect(t.bridge.signedMessages, isEmpty);
        expect(t.api.to('POST', '/v1/client-auth/device/challenges'), isEmpty);
        await t.session.protectedCall('GET', '/v1/client-auth/me');
        expect(t.api.to('GET', '/v1/client-auth/me').single.headers['authorization'], isNotNull);
      });
    }

    test('definite login refusal is not retried automatically', () async {
      final t = build(app: ClientApp.ship);
      t.api.routes['POST /v1/client-auth/login'] = (m, p, h, b) async => apiError(401, 'INVALID_CREDENTIALS');
      expect(await t.session.login(phone: '0902222222', password: 'wrong-password'), isFalse);
      expect(t.api.to('POST', '/v1/client-auth/login'), hasLength(1));
      expect(t.session.pending, isNull);
      expect(t.session.lastFailure?.kind, AuthFailureKind.invalidCredentials);
    });

    test('unknown outcome preserves the exact intent for explicit retry', () async {
      final t = build(app: ClientApp.ship);
      final FakeHandler real = t.api.routes['POST /v1/client-auth/login']!;
      int logins = 0;
      t.api.routes['POST /v1/client-auth/login'] = (m, p, h, b) async => ++logins == 1 ? apiError(504, 'SERVICE_UNAVAILABLE') : real(m, p, h, b);
      expect(await t.session.login(phone: '0902222222', password: 'Correct-Horse-9'), isFalse);
      expect(t.session.pending, isNotNull);
      expect(await t.session.retryPending(), isTrue);
      final attempts = t.api.to('POST', '/v1/client-auth/login');
      expect(attempts[0].headers['idempotency-key'], attempts[1].headers['idempotency-key']);
      expect(attempts[0].body, attempts[1].body);
      expect(t.bridge.generated, 0);
    });
  });

  group('logout and stale answers', () {
    test('204 clears the local session; the request is signed by the key', () async {
      final t = build();
      await t.session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await t.session.logout();
      expect(t.session.status, SessionStatus.guest);
      expect(t.session.identity, isNull);
      expect(t.bridge.token, isNull);
      expect(t.session.logoutUnconfirmed, isFalse);
      expect(t.api.to('POST', '/v1/client-auth/logout').single.headers['x-device-signature'], isNull);
    });

    test('offline logout still clears the phone and says the server has NOT confirmed the revoke', () async {
      final t = build();
      await t.session.login(phone: '0901234567', password: 'Correct-Horse-9');
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await t.session.logout();
      expect(t.session.status, SessionStatus.guest);
      expect(t.bridge.token, isNull);
      expect(t.session.logoutUnconfirmed, isTrue);
    });

    test('a late answer to a request sent before logout never reinstalls the session', () async {
      final t = build();
      final Completer<ApiResponse> gate = Completer<ApiResponse>();
      t.api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) => gate.future;
      final Future<bool> pending = t.session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await t.session.logout();
      gate.complete(json(200, <String, Object?>{'data': <String, Object?>{...identityJson(), 'access_token': 'late-token'}}));
      expect(await pending, isFalse);
      expect(t.session.status, SessionStatus.guest);
      expect(t.session.identity, isNull);
      expect(t.bridge.token, isNull);
    });

    test('issue #168: disposing the registration form cannot invalidate an in-flight shop request', () async {
      final t = build();
      await t.session.loadRegistrationMode();
      expect(await t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'PROOF-TOKEN-0123456789'), isTrue);
      final int activeEpoch = t.session.sessionEpoch;
      final Completer<ApiResponse> reply = Completer<ApiResponse>();
      final Completer<void> requested = Completer<void>();
      t.api.routes['GET /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) {
        requested.complete();
        return reply.future;
      };

      // The shop opens while the register route is still disposing.
      final Future<ApiResponse> shopLoad = t.session.protectedCall('GET', '/v1/onboarding/shop/profile');
      await requested.future;
      t.session.abandon();
      expect(t.session.sessionEpoch, activeEpoch, reason: 'leaving a successful auth form is not a session change');
      reply.complete(json(200, <String, Object?>{'data': null}));
      expect((await shopLoad).status, 200);
      expect(t.session.status, SessionStatus.signedIn);
      expect(t.bridge.token, 'fake-access-token-0123456789');
    });

    test('issue #168: closing an already successful login does not invalidate a signed-in request', () async {
      final t = build();
      expect(await t.session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
      final int activeEpoch = t.session.sessionEpoch;
      t.session.abandon();
      expect(t.session.sessionEpoch, activeEpoch);
      expect((await t.session.protectedCall('GET', '/v1/client-auth/me')).status, 200);
      expect(t.session.status, SessionStatus.signedIn);
    });

    test('issue #168: after disposing auth form, a REAL server 401 still ends the session', () async {
      final t = build();
      expect(await t.session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
      t.session.abandon();
      t.api.routes['GET /v1/onboarding/shop/profile'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_EXPIRED');
      await expectLater(
        t.session.protectedCall('GET', '/v1/onboarding/shop/profile'),
        throwsA(isA<AuthFailure>().having((AuthFailure f) => f.kind, 'kind', AuthFailureKind.sessionEnded)),
      );
      expect(t.session.status, SessionStatus.guest);
      expect(t.bridge.token, isNull);
      expect(t.session.identity, isNull);
      expect(t.session.sessionEndedNotice, isTrue);
    });

    test('issue #168: leaving a registration form BEFORE auth completes still drops its late success', () async {
      final t = build();
      await t.session.loadRegistrationMode();
      final Completer<ApiResponse> reply = Completer<ApiResponse>();
      final Completer<void> requested = Completer<void>();
      t.api.routes['POST /v1/client-auth/register'] = (String m, String p, Map<String, String> h, String b) {
        requested.complete();
        return reply.future;
      };
      final Future<bool> registration = t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'PROOF-TOKEN-0123456789');
      await requested.future;
      t.session.abandon();
      reply.complete(json(201, <String, Object?>{'data': <String, Object?>{...identityJson(), 'access_token': 'late-token'}}));
      expect(await registration, isFalse);
      expect(t.session.status, isNot(SessionStatus.signedIn));
      expect(t.bridge.token, isNull);
    });

    test('leaving the form (abandon) drops the late answer', () async {
      final t = build();
      final Completer<ApiResponse> gate = Completer<ApiResponse>();
      t.api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) => gate.future;
      final Future<bool> pending = t.session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      t.session.abandon();
      gate.complete(json(200, <String, Object?>{'data': <String, Object?>{...identityJson(), 'access_token': 'late-token'}}));
      await pending;
      expect(t.session.status, isNot(SessionStatus.signedIn));
      expect(t.bridge.token, isNull);
    });
  });

  group('own profile', () {
    Future<({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge})> signedIn() async {
      final t = build();
      await t.session.login(phone: '0901234567', password: 'Correct-Horse-9');
      return t;
    }

    test('PUT carries expected_version and a stable key; a saved profile replaces the version', () async {
      final t = await signedIn();
      t.api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async =>
          json(200, <String, Object?>{'data': <String, Object?>{'user_id': 'u', 'full_name': 'Trần Thị Bình', 'version': 2}});
      expect(await t.session.saveProfile('Trần Thị Bình'), ProfileSave.saved);
      final RecordedRequest put = t.api.to('PUT', '/v1/customer/me/profile').single;
      expect(put.body, '{"full_name":"Trần Thị Bình","expected_version":1}');
      expect(put.headers['idempotency-key'], isNotEmpty);
      expect(t.session.profile?.version, 2);
    });

    test('VERSION_CONFLICT reloads the current profile and does not overwrite it', () async {
      final t = await signedIn();
      t.api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'VERSION_CONFLICT');
      t.api.routes['GET /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async =>
          json(200, <String, Object?>{'data': <String, Object?>{'user_id': 'u', 'full_name': 'Tên mới trên máy chủ', 'version': 5}});
      expect(await t.session.saveProfile('Tên của tôi'), ProfileSave.conflict);
      expect(t.session.profile?.fullName, 'Tên mới trên máy chủ');
      expect(t.session.profile?.version, 5);
      expect(t.api.to('PUT', '/v1/customer/me/profile'), hasLength(1));
    });

    test('a lost answer keeps the same Idempotency-Key and body on the person\'s retry, with a new nonce', () async {
      final t = await signedIn();
      int calls = 0;
      t.api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async {
        if (++calls == 1) {
          throw const AuthFailure(AuthFailureKind.unknownOutcome);
        }
        return json(200, <String, Object?>{'data': <String, Object?>{'user_id': 'u', 'full_name': 'Trần Thị Bình', 'version': 2}});
      };
      expect(await t.session.saveProfile('Trần Thị Bình'), ProfileSave.unknown);
      expect(await t.session.saveProfile('Trần Thị Bình'), ProfileSave.saved);
      final List<RecordedRequest> puts = t.api.to('PUT', '/v1/customer/me/profile');
      expect(puts[1].body, puts[0].body);
      expect(puts[1].headers['idempotency-key'], puts[0].headers['idempotency-key']);
      expect(puts[1].headers['x-device-nonce'], isNull);
    });

    test('401 while saving ends the session: token and personal values are cleared, no hardware key is needed', () async {
      final t = await signedIn();
      t.api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
      await t.session.saveProfile('Khác');
      expect(t.session.status, SessionStatus.guest);
      expect(t.session.profile, isNull);
      expect(t.bridge.token, isNull);
      expect(t.bridge.key, isNull);
    });
  });

  test('a build without a server address cannot sign in and makes no request', () async {
    final api = FakeApiTransport();
    final session = createSessionController(ClientApp.food, const AppConfig(), transport: api, bridge: FakeDeviceBridge());
    await session.start();
    expect(session.ready, isFalse);
    expect(await session.login(phone: '0901234567', password: 'x'), isFalse);
    expect(api.requests, isEmpty);
  });

  test('transport refuses cleartext: an http base never sends a token', () async {
    final HttpApiTransport transport = HttpApiTransport(base: Uri.parse('http://example.test'));
    await expectLater(transport.send('GET', '/v1/client-auth/me', headers: <String, String>{'authorization': 'Bearer secret'}), throwsA(isA<AuthFailure>()));
  });

  test('the strict HTTPS origin parser accepts only a plain https origin', () {
    expect(parseApiBaseUrl('https://192.168.1.10:8443')?.toString(), 'https://192.168.1.10:8443');
    for (final String bad in <String>['http://x.test', 'https://x.test/path', 'https://user:p@x.test', 'ftp://x.test', '']) {
      expect(parseApiBaseUrl(bad), isNull, reason: bad);
    }
  });
}
