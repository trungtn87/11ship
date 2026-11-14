import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6d (Codex round 4 on #337): (a)/(b) a late PUT answer must not write back an older profile or refill a profile after session end;
// (c)/(d) a login whose token was stored after the person left the form must not leave that token behind, but must not delete a newer
// attempt's token.

const AppConfig config = AppConfig(
    apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> identityWith(String name, int version) =>
    <String, Object?>{
      ...identityJson(name: name, version: version),
      'account_status': 'ACTIVE'
    };

/// A bridge whose n-th storeToken writes the value at once and then waits for gates[n] (when present), like a slow platform keystore.
class HeldStoreBridge extends FakeDeviceBridge {
  final List<Completer<void>> gates = <Completer<void>>[];
  int stores = 0;

  @override
  Future<void> storeToken(String token) async {
    final int n = stores++;
    this.token = token;
    if (n < gates.length) {
      await gates[n].future;
    }
  }
}

Future<void> until(bool Function() condition) async {
  for (int i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(condition(), isTrue, reason: 'the awaited step never happened');
}

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
      final HeldStoreBridge bridge = HeldStoreBridge()
        ..gates.add(Completer<void>());
      api = FakeApiTransport();
      installAccountRoutes(api);
      session = createSessionController(ClientApp.food, config,
          transport: api, bridge: bridge);

      final Future<bool> login =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();
      bridge.gates.single.complete();

      expect(await login, isFalse);
      expect(bridge.token, isNull,
          reason: 'the token written after the form was left must be removed');

      await session.start();
      expect(session.status, SessionStatus.guest);
      expect(session.identity, isNull);
    });

    test(
        '(d) a newer login has already stored its token: the late older store does not delete that newer token',
        () async {
      final HeldStoreBridge bridge = HeldStoreBridge()
        ..gates.addAll(<Completer<void>>[Completer<void>(), Completer<void>()]);
      api = FakeApiTransport();
      installAccountRoutes(api);
      int logins = 0;
      api.routes['POST /v1/client-auth/login'] =
          (String m, String p, Map<String, String> h, String b) async {
        logins++;
        return json(200, <String, Object?>{
          'data': <String, Object?>{
            ...identityJson(),
            'access_token': 'token-$logins'
          }
        }, headers: <String, String>{
          'x-device-binding-id': '33333333-3333-4333-8333-333333333333',
          'x-device-binding-generation': '1'
        });
      };
      session = createSessionController(ClientApp.food, config,
          transport: api, bridge: bridge);

      final Future<bool> older =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 1);
      session.abandon();

      final Future<bool> newer =
          session.login(phone: '0901234567', password: 'Correct-Horse-9');
      await until(() => bridge.stores == 2);
      expect(bridge.token, 'token-2');

      bridge.gates[0].complete();
      expect(await older, isFalse);
      expect(bridge.token, 'token-2',
          reason:
              'a stale attempt must not delete the token of a newer attempt');

      bridge.gates[1].complete();
      expect(await newer, isTrue);
      expect(bridge.token, 'token-2');
      expect(session.status, SessionStatus.signedIn);
    });
  });
}
