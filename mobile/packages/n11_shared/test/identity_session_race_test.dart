import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6c (Codex MEDIUM, round 3): every async answer that writes the identity or the profile must drop when a newer write or a session end
// happened after it started. Each test holds one answer on the wire (Completer), moves the state meanwhile, then releases the old answer.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> identityWith(String name, int version) => <String, Object?>{...identityJson(name: name, version: version), 'account_status': 'ACTIVE'};

Map<String, Object?> profileJson(String name, int version) => <String, Object?>{'user_id': '11111111-1111-4111-8111-111111111111', 'full_name': name, 'version': version};

void main() {
  late FakeApiTransport api;
  late SessionController session;
  DateTime clock = DateTime.utc(2026, 11, 13, 8);

  Future<void> signIn() async {
    api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
    session = createSessionController(ClientApp.food, config, transport: api, bridge: bridge, now: () => clock);
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identityWith('Nguyễn Văn An', 1)});
    await session.start();
    expect(session.status, SessionStatus.signedIn);
    expect(session.profile?.version, 1);
    clock = clock.add(const Duration(minutes: 5));
  }

  void saveAnswersVersion2() {
    api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': profileJson('Tên mới', 2)});
  }

  test('(a) refreshIdentity() holds the A-v1 answer; Save B-v2 lands; the old answer is released: the saved profile stays', () async {
    await signIn();
    saveAnswersVersion2();
    final Completer<void> release = Completer<void>();
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': identityWith('Nguyễn Văn An', 1)});
    };

    final Future<void> read = session.refreshIdentity();
    await Future<void>.delayed(Duration.zero);
    expect(await session.saveProfile('Tên mới', expectedVersion: 1), ProfileSave.saved);

    int notified = 0;
    session.addListener(() => notified++);
    release.complete();
    await read;

    expect(session.profile?.version, 2, reason: 'the old identity answer must not roll the saved profile back');
    expect(session.profile?.fullName, 'Tên mới');
    expect(notified, 0);
  });

  test('(b) loadProfile() holds the A-v1 answer; Save B-v2 lands; the old answer is released: the saved profile stays', () async {
    await signIn();
    saveAnswersVersion2();
    final Completer<void> release = Completer<void>();
    api.routes['GET /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': profileJson('Nguyễn Văn An', 1)});
    };

    final Future<bool> load = session.loadProfile();
    await Future<void>.delayed(Duration.zero);
    expect(await session.saveProfile('Tên mới', expectedVersion: 1), ProfileSave.saved);

    release.complete();
    await load;

    expect(session.profile?.version, 2, reason: 'the old profile answer must not roll the saved profile back');
    expect(session.profile?.fullName, 'Tên mới');
  });

  test('(c) a 200 answer held across a 401 session end is not installed: the session stays guest with no identity or profile', () async {
    await signIn();
    final Completer<void> release = Completer<void>();
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': identityWith('Nguyễn Văn An', 1)});
    };
    api.routes['GET /v1/other/protected'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');

    final Future<void> read = session.refreshIdentity();
    await Future<void>.delayed(Duration.zero);
    await expectLater(session.protectedCall('GET', '/v1/other/protected'), throwsA(isA<AuthFailure>()));
    expect(session.status, SessionStatus.guest);

    release.complete();
    await read;

    expect(session.status, SessionStatus.guest);
    expect(session.identity, isNull, reason: 'a request of the ended session must not refill the identity');
    expect(session.profile, isNull);
  });

  test('(d) selectContext() holds its answer; Save B-v2 lands; the old answer is released: the saved profile stays', () async {
    await signIn();
    saveAnswersVersion2();
    final Completer<void> release = Completer<void>();
    api.routes['POST /v1/client-auth/context'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': identityWith('Nguyễn Văn An', 1)});
    };

    final Future<void> select = session.selectContext('CUSTOMER');
    await Future<void>.delayed(Duration.zero);
    expect(await session.saveProfile('Tên mới', expectedVersion: 1), ProfileSave.saved);

    release.complete();
    await select;

    expect(session.profile?.version, 2, reason: 'the old context answer must not roll the saved profile back');
    expect(session.profile?.fullName, 'Tên mới');
  });

  test('regression: a refresh that starts AFTER the save is still applied', () async {
    await signIn();
    saveAnswersVersion2();
    expect(await session.saveProfile('Tên mới', expectedVersion: 1), ProfileSave.saved);
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identityWith('Tên thứ ba', 3)});

    await session.refreshIdentityIfStale();

    expect(session.profile?.version, 3);
    expect(session.profile?.fullName, 'Tên thứ ba');
  });
}
