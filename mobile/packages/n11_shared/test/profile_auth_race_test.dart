import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6d (Codex round 4 on #337; round 1 on #347): (a)/(b) a late PUT answer must not write back an older profile or refill a profile after
// session end. (c)-(f) the platform token store is slow: a write lands when its future completes, so a late store/clear of an older attempt
// must never overwrite or delete the token of a newer attempt, and the token that protectedCall sends is the one left in the store.

const AppConfig config = AppConfig(
    apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> identityWith(String name, int version) =>
    <String, Object?>{
      ...identityJson(name: name, version: version),
      'account_status': 'ACTIVE'
    };

/// A slow platform keystore: each call is counted when it starts; a gate (by call number) holds it; the value lands only when the call
/// completes, so a held older call that completes late really does write after a newer one.
class SlowTokenBridge extends FakeDeviceBridge {
  final Map<int, Completer<void>> storeGates = <int, Completer<void>>{};
  final Map<int, Completer<void>> clearGates = <int, Completer<void>>{};
  int stores = 0;
  int clears = 0;

  @override
  Future<void> storeToken(String value) async {
    final int n = stores++;
    final Completer<void>? gate = storeGates[n];
    if (gate != null) {
      await gate.future;
    }
    token = value;
  }

  @override
  Future<void> clearToken() async {
    final int n = clears++;
    final Completer<void>? gate = clearGates[n];
    if (gate != null) {
      await gate.future;
    }
    token = null;
  }
}

Future<void> until(bool Function() condition) async {
  for (int i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(condition(), isTrue, reason: 'the awaited step never happened');
}

/// Lets already-scheduled microtasks and platform calls run (no gate is released by it).
Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  late FakeApiTransport api;
  late SessionController session;
  DateTime clock = DateTime.utc(2026, 11, 14, 8);

  Future<void> signIn() async {
    api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(
          keyId: 'k',
          publicKeySpki: 'c3Bracw=',
          chain: <String>[],
          bindingId: 'b',
          generation: 1);
    session = createSessionController(ClientApp.food, config,
        transport: api, bridge: bridge, now: () => clock);
    api.routes['GET /v1/client-auth/me'] = (String m, String p,
            Map<String, String> h, String b) async =>
        json(200, <String, Object?>{'data': identityWith('Nguyễn Văn An', 1)});
    await session.start();
    expect(session.status, SessionStatus.signedIn);
    expect(session.profile?.version, 1);
    clock = clock.add(const Duration(minutes: 5));
  }

  /// A fresh session on a slow bridge, with login answers that carry token-1, token-2, ... in order.
  /// [failAt] (1-based call number) answers 401 instead, so that attempt fails before it stores anything.
  SlowTokenBridge slowLoginBridge({int? failAt}) {
    final SlowTokenBridge bridge = SlowTokenBridge();
    api = FakeApiTransport();
    installAccountRoutes(api);
    api.routes['POST /v1/client-auth/login'] =
        (String m, String p, Map<String, String> h, String b) async {
      final int n = api.to('POST', '/v1/client-auth/login').length;
      if (n == failAt) {
        return apiError(401, 'INVALID_CREDENTIALS');
      }
      return json(200, <String, Object?>{
        'data': <String, Object?>{...identityJson(), 'access_token': 'token-$n'}
      }, headers: <String, String>{
        'x-device-binding-id': '33333333-3333-4333-8333-333333333333',
        'x-device-binding-generation': '1'
      });
    };
    session = createSessionController(ClientApp.food, config,
        transport: api, bridge: bridge);
    return bridge;
  }

  Map<String, Object?> profileJson(String name, int version) =>
      <String, Object?>{
        'user_id': '11111111-1111-4111-8111-111111111111',
        'full_name': name,
        'version': version
      };

  group('saveProfile answer ordering', () {
    test(
        '(a) PUT answers v2 late; a refresh already applied v3: the older PUT answer does not roll the profile back',
        () async {
      await signIn();
      final Completer<void> putGate = Completer<void>();
      api.routes['PUT /v1/customer/me/profile'] =
          (String m, String p, Map<String, String> h, String b) async {
        await putGate.future;
        return json(200, <String, Object?>{'data': profileJson('Tên v2', 2)});
      };
      api.routes['GET /v1/client-auth/me'] =
          (String m, String p, Map<String, String> h, String b) async =>
              json(200, <String, Object?>{'data': identityWith('Tên v3', 3)});

      final Future<ProfileSave> save =
          session.saveProfile('Tên v2', expectedVersion: 1);
      await until(() => api.to('PUT', '/v1/customer/me/profile').isNotEmpty);
      await session.refreshIdentity();
      expect(session.profile?.version, 3);

      putGate.complete();
      await save;

      expect(session.profile?.version, 3,
          reason:
              'a newer version already applied must win over the older PUT answer');
      expect(session.profile?.fullName, 'Tên v3');
    });

    test(
        '(b) PUT answer (200) is held; the session ends (401) meanwhile; the answer arrives: the profile is not refilled',
        () async {
      await signIn();
      final Completer<void> putGate = Completer<void>();
      api.routes['PUT /v1/customer/me/profile'] =
          (String m, String p, Map<String, String> h, String b) async {
        await putGate.future;
        return json(200, <String, Object?>{'data': profileJson('Tên v2', 2)});
      };
      api.routes['GET /v1/customer/me/profile'] =
          (String m, String p, Map<String, String> h, String b) async =>
              apiError(401, 'SESSION_REVOKED');

      final Future<ProfileSave> save =
          session.saveProfile('Tên v2', expectedVersion: 1);
      await until(() => api.to('PUT', '/v1/customer/me/profile').isNotEmpty);
      await session.loadProfile();
      expect(session.status, SessionStatus.guest);

      putGate.complete();
      await save;

      expect(session.status, SessionStatus.guest);
      expect(session.profile, isNull,
          reason:
              'a session that ended must not get its personal profile back from a late answer');
      expect(session.identity, isNull);
    });
  });

  group('login token after the form was left', () {
    test(
        '(c) storeToken is still running when the person leaves the form: the token is cleared, and start() does not sign in',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge()
        ..storeGates[0] = Completer<void>();

      final Future<bool> login =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();
      bridge.storeGates[0]!.complete();

      expect(await login, isFalse);
      expect(bridge.token, isNull,
          reason: 'the token written after the form was left must be removed');

      await session.start();
      expect(session.status, SessionStatus.guest);
      expect(session.identity, isNull);
    });

    test(
        '(d) an older store is still running when a newer login starts: its late write and its clear never remove the newer token',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge()
        ..storeGates[0] = Completer<void>();

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();

      final Future<bool> newer =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => api.to('POST', '/v1/client-auth/login').length == 2);

      bridge.storeGates[0]!.complete();
      expect(await older, isFalse);
      expect(await newer, isTrue);
      expect(bridge.token, 'token-2',
          reason: 'the newer attempt is the last write; the stale attempt deletes nothing');
      expect(session.status, SessionStatus.signedIn);
    });

    test(
        '(e) the stale attempt is clearing its token when a newer login starts: the newer token survives the late clear and matches the signed-in identity',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge()
        ..storeGates[0] = Completer<void>()
        ..clearGates[0] = Completer<void>();

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();
      bridge.storeGates[0]!.complete();
      await until(() => bridge.clears == 1);

      final Future<bool> newer =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => api.to('POST', '/v1/client-auth/login').length == 2);
      await settle();

      bridge.clearGates[0]!.complete();
      expect(await older, isFalse);
      expect(await newer, isTrue);
      expect(bridge.token, 'token-2',
          reason: 'the late clear of the stale attempt must not delete the newer token');
      expect(session.status, SessionStatus.signedIn);
      expect(session.identity?.userId, isNotNull);
    });

    test(
        '(f) the older store is held, the person leaves, a newer login completes: after the older store lands, the store holds the newer token and protectedCall sends it',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge()
        ..storeGates[0] = Completer<void>();

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();

      final Future<bool> newer =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => api.to('POST', '/v1/client-auth/login').length == 2);
      await settle();

      bridge.storeGates[0]!.complete();
      expect(await older, isFalse);
      expect(await newer, isTrue);
      expect(bridge.token, 'token-2',
          reason: 'the older store landed late; the newer token must be the last write');

      await session.protectedCall('GET', '/v1/client-auth/me');
      expect(api.to('GET', '/v1/client-auth/me').last.headers['authorization'],
          'Bearer token-2');
    });

    test(
        '(g) the older store is held, the person leaves, a newer login fails before storing: the older token is removed when it lands, and start() does not sign in',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge(failAt: 2)
        ..storeGates[0] = Completer<void>();

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();

      expect(
          await session.login(phone: '0901234567', password: 'Correct-Horse-9'),
          isFalse);
      expect(bridge.stores, 1, reason: 'the failed attempt never reached the store');

      bridge.storeGates[0]!.complete();
      expect(await older, isFalse);
      expect(bridge.token, isNull,
          reason: 'the token of the abandoned attempt is an orphan and must be removed');

      await session.start();
      expect(session.status, SessionStatus.guest);
      expect(session.identity, isNull);
    });

    test(
        '(h) the older store is held, the person leaves, a newer login stores successfully: the last write is the newer token and nothing deletes it',
        () async {
      final SlowTokenBridge bridge = slowLoginBridge()
        ..storeGates[0] = Completer<void>();

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();

      final Future<bool> newer =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => api.to('POST', '/v1/client-auth/login').length == 2);
      await settle();

      bridge.storeGates[0]!.complete();
      expect(await older, isFalse);
      expect(await newer, isTrue);
      expect(bridge.token, 'token-2');
      expect(session.status, SessionStatus.signedIn);
      await session.start();
      expect(session.status, SessionStatus.signedIn);
      expect(session.identity, isNotNull);
    });
  });
}
