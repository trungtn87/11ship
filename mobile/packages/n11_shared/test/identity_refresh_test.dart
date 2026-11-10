import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// P5-6c: the app reads `me` again (throttled, epoch-safe) when the server may have changed the account, so an Admin unlock reaches the
// phone without a new login.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> locked({bool deletion = false}) => <String, Object?>{
  ...identityJson(),
  'account_status': 'LOCKED',
  'limited_access': 'WALLET_ONLY',
  if (deletion) 'deletion_locked': true,
};

Map<String, Object?> active() => <String, Object?>{...identityJson(), 'account_status': 'ACTIVE'};

class Harness {
  Harness() {
    api = FakeApiTransport();
    installAccountRoutes(api);
    bridge = FakeDeviceBridge()
      ..token = 'stored-token'
      ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
    session = createSessionController(ClientApp.ship, config, transport: api, bridge: bridge, now: () => clock);
  }

  late final FakeApiTransport api;
  late final FakeDeviceBridge bridge;
  late final SessionController session;
  DateTime clock = DateTime.utc(2026, 11, 9, 8);

  /// What the server says about the account from now on.
  void serverSays(Map<String, Object?> identity) {
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': identity});
  }

  int get meCalls => api.to('GET', '/v1/client-auth/me').length;

  void later(Duration d) => clock = clock.add(d);
}

Future<Harness> signedInAs(Map<String, Object?> identity) async {
  final Harness h = Harness()..serverSays(identity);
  await h.session.start();
  expect(h.session.status, SessionStatus.signedIn);
  return h;
}

void main() {
  test('DELETE_REQUEST lock, Admin unlocks: the next refresh drops lockedWalletOnly and deletionLocked and tells the screens', () async {
    final Harness h = await signedInAs(locked(deletion: true));
    expect(h.session.identity?.lockedWalletOnly, isTrue);
    expect(h.session.identity?.deletionLocked, isTrue);
    int notified = 0;
    h.session.addListener(() => notified++);

    h.serverSays(active());
    h.later(const Duration(minutes: 5));
    await h.session.refreshIdentityIfStale();

    expect(h.session.identity?.lockedWalletOnly, isFalse);
    expect(h.session.identity?.deletionLocked, isFalse);
    expect(notified, 1);
  });

  test('re-locked for another reason (SECURITY / VIOLATION): still limited, and the deletion wording does not come back', () async {
    final Harness h = await signedInAs(locked(deletion: true));
    h.serverSays(locked());
    h.later(const Duration(minutes: 5));
    await h.session.refreshIdentityIfStale();
    expect(h.session.identity?.lockedWalletOnly, isTrue);
    expect(h.session.identity?.deletionLocked, isFalse);
  });

  test('an account locked after sign-in is picked up too', () async {
    final Harness h = await signedInAs(active());
    h.serverSays(locked(deletion: true));
    h.later(const Duration(minutes: 5));
    await h.session.refreshIdentityIfStale();
    expect(h.session.identity?.lockedWalletOnly, isTrue);
    expect(h.session.identity?.deletionLocked, isTrue);
  });

  test('throttle: reads inside the window cost no request, one after it does; concurrent calls share one read', () async {
    final Harness h = await signedInAs(active());
    final int afterStart = h.meCalls;
    h.later(const Duration(minutes: 5));
    await Future.wait(<Future<void>>[for (int i = 0; i < 5; i++) h.session.refreshIdentityIfStale()]);
    expect(h.meCalls, afterStart + 1);
    h.later(const Duration(seconds: 29));
    await h.session.refreshIdentityIfStale();
    expect(h.meCalls, afterStart + 1);
    h.later(const Duration(seconds: 2));
    await h.session.refreshIdentityIfStale();
    expect(h.meCalls, afterStart + 2);
  });

  test('a read that learns nothing rebuilds nothing', () async {
    final Harness h = await signedInAs(active());
    int notified = 0;
    h.session.addListener(() => notified++);
    h.later(const Duration(minutes: 5));
    await h.session.refreshIdentityIfStale();
    expect(notified, 0);
  });

  test('offline / server error keeps the identity as it is and shows nothing', () async {
    final Harness h = await signedInAs(locked(deletion: true));
    int notified = 0;
    h.session.addListener(() => notified++);
    h.later(const Duration(minutes: 5));
    h.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await h.session.refreshIdentityIfStale();
    expect(h.session.status, SessionStatus.signedIn);
    expect(h.session.identity?.deletionLocked, isTrue);
    expect(notified, 0);

    h.later(const Duration(minutes: 5));
    h.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> hd, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
    await h.session.refreshIdentityIfStale();
    expect(h.session.status, SessionStatus.signedIn);
    expect(h.session.identity?.deletionLocked, isTrue);
  });

  test('an answer of an old epoch never overwrites: logout while the read is in flight', () async {
    final Harness h = await signedInAs(locked(deletion: true));
    final Completer<void> release = Completer<void>();
    h.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> hd, String b) async {
      await release.future;
      return json(200, <String, Object?>{'data': active()});
    };
    h.later(const Duration(minutes: 5));
    final Future<void> read = h.session.refreshIdentityIfStale();
    await Future<void>.delayed(Duration.zero);
    await h.session.logout();
    release.complete();
    await read;
    expect(h.session.status, SessionStatus.guest);
    expect(h.session.identity, isNull);
  });

  test('an older answer never overwrites a newer identity read meanwhile (same epoch)', () async {
    final Harness h = await signedInAs(locked(deletion: true));
    final Completer<void> release = Completer<void>();
    int call = 0;
    h.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> hd, String b) async {
      call++;
      if (call == 1) {
        await release.future;
        return json(200, <String, Object?>{'data': locked(deletion: true)}); // the stale answer
      }
      return json(200, <String, Object?>{'data': active()}); // the newer one
    };
    h.later(const Duration(minutes: 5));
    final Future<void> stale = h.session.refreshIdentityIfStale();
    await Future<void>.delayed(Duration.zero);
    await h.session.refreshIdentity(); // an explicit read lands first
    expect(h.session.identity?.lockedWalletOnly, isFalse);
    release.complete();
    await stale;
    expect(h.session.identity?.lockedWalletOnly, isFalse);
    expect(h.session.identity?.deletionLocked, isFalse);
  });

  test('guest sessions are never read', () async {
    final Harness h = Harness();
    h.bridge.token = null;
    await h.session.start();
    expect(h.session.status, SessionStatus.guest);
    h.later(const Duration(minutes: 5));
    await h.session.refreshIdentityIfStale();
    expect(h.meCalls, 0);
  });
}
