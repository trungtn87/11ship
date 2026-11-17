import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6c (Codex MEDIUM): a background identity read that was in flight BEFORE the profile changed must not write the older profile back.
// The read is held on the wire by a Completer, the profile changes meanwhile, then the old answer is released.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> identityWithProfile(String name, int version) => <String, Object?>{
  ...identityJson(name: name, version: version),
  'account_status': 'ACTIVE',
};

Map<String, Object?> profileJson(String name, int version) => <String, Object?>{'user_id': '11111111-1111-4111-8111-111111111111', 'full_name': name, 'version': version};

void main() {
  late FakeApiTransport api;
  late FakeDeviceBridge bridge;
  late SessionController session;
  DateTime clock = DateTime.utc(2026, 11, 13, 8);

  Future<void> signIn() async {
    api = FakeApiTransport();
    installAccountRoutes(api);
    bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
    session = createSessionController(ClientApp.food, config, transport: api, bridge: bridge, now: () => clock);
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identityWithProfile('Nguyễn Văn An', 1)});
    await session.start();
    expect(session.status, SessionStatus.signedIn);
    expect(session.profile?.version, 1);
    clock = clock.add(const Duration(minutes: 5));
  }

  test('a GET (me) answering the OLD profile, released after a successful save, cannot write it back', () async {
    await signIn();
    api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': profileJson('Tên mới', 2)});
    final Completer<void> release = Completer<void>();
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': identityWithProfile('Nguyễn Văn An', 1)}); // the server's answer before the save
    };

    final Future<void> read = session.refreshIdentityIfStale();
    await Future<void>.delayed(Duration.zero);
    expect(await session.saveProfile('Tên mới', expectedVersion: 1), ProfileSave.saved);
    expect(session.profile?.version, 2);

    int notified = 0;
    session.addListener(() => notified++);
    release.complete();
    await read;

    expect(session.profile?.version, 2, reason: 'the old answer must not roll the saved profile back');
    expect(session.profile?.fullName, 'Tên mới');
    expect(notified, 0, reason: 'nothing visible went back, so nothing is notified');
  });

  test('a GET (me) answering the OLD profile, released after a reload that followed VERSION_CONFLICT, cannot write it back', () async {
    await signIn();
    api.routes['PUT /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'VERSION_CONFLICT');
    api.routes['GET /v1/customer/me/profile'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': profileJson('Bản server mới', 2)});
    final Completer<void> release = Completer<void>();
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': identityWithProfile('Nguyễn Văn An', 1)});
    };

    final Future<void> read = session.refreshIdentityIfStale();
    await Future<void>.delayed(Duration.zero);
    expect(await session.saveProfile('Tên của tôi', expectedVersion: 1), ProfileSave.conflict);
    expect(session.profile?.version, 2);

    release.complete();
    await read;

    expect(session.profile?.version, 2, reason: 'the reload after the conflict is newer than the read in flight');
    expect(session.profile?.fullName, 'Bản server mới');
  });
}
