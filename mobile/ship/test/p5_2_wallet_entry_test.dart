import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';

// #295: the wallet is reachable only while the session is the live, signed-in one. Guest, logout, ended / revoked session and starting / unverified show no
// "Ví của tôi" anywhere (Tài khoản, Thu nhập, Trang chủ, notification target); a valid driver and a locked wallet-only driver keep it; a wallet left open
// closes at logout and the next account never sees the previous one's numbers, not even from a late answer.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String idA = '11111111-1111-4111-8111-111111111111';
const String idB = '22222222-2222-4222-8222-222222222222';

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

Map<String, Object?> driverJson({String id = idA, bool locked = false}) => <String, Object?>{
      ...identityJson(active: 'DRIVER'),
      'user_id': id,
      'available_roles': <String>['CUSTOMER', 'DRIVER'],
      'onboarding': <String, Object?>{'shop': 'NOT_STARTED', 'driver': 'ACTIVE'},
      if (locked) 'account_status': 'LOCKED',
      if (locked) 'limited_access': 'WALLET_ONLY',
    };

Map<String, Object?> walletJson(int balance) => <String, Object?>{
      'wallet': <String, Object?>{'provisioned': true, 'balance_vnd': balance, 'held_vnd': 0, 'available_vnd': balance},
      'limits': <String, Object?>{'topup_min_vnd': 100000, 'withdraw_min_vnd': 10000},
      'commission_vnd': 1000,
      'open_withdrawals': 0,
      'driver_status': 'ACTIVE',
      'limited_access': false,
    };

class Rig {
  Rig(this.api, this.session);
  final FakeApiTransport api;
  final SessionController session;

  /// The identity the server answers to the next login / me.
  Map<String, Object?> who = driverJson();

  Future<void> login() => session.login(phone: '0901234567', password: 'Correct-Horse-9');
}

Rig rig({FakeDeviceBridge? bridge}) {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: bridge ?? FakeDeviceBridge());
  final Rig r = Rig(api, session);
  api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async =>
      json(200, <String, Object?>{'data': <String, Object?>{...r.who, 'access_token': 'fake-access-token-0123456789'}}, headers: <String, String>{'x-device-binding-id': '33333333-3333-4333-8333-333333333333', 'x-device-binding-generation': '1'});
  api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': r.who});
  api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': walletJson(150000)});
  api.routes['GET /v1/driver/wallet/transactions'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'items': <Object?>[], 'next_cursor': null}});
  return r;
}

Future<void> boot(WidgetTester tester, Rig r, {bool start = true}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  if (start) {
    await r.session.start();
  }
  await tester.pumpWidget(ListenableBuilder(
    listenable: r.session,
    builder: (BuildContext context, Widget? child) => N11App(navigationIdentity: r.session.identity?.userId, brand: shipBrand, tabs: buildShipTabs(r.session), config: config, transport: healthy(), pollInterval: Duration.zero),
  ));
  await tester.pump();
  await tester.pump();
}

Future<void> openTab(WidgetTester tester, String id) async {
  await tester.tap(find.byKey(Key('tab-$id')));
  await tester.pump();
  await tester.pump();
}

const Key accountEntry = Key('account-wallet-entry');
const Key incomeEntry = Key('wallet-entry');
const String homeButton = 'Ví tiền / Nạp tiền';

/// The entries the issue names: Tài khoản, Thu nhập and the Trang chủ button.
Future<({bool account, bool income, bool home})> entries(WidgetTester tester) async {
  await openTab(tester, 'home');
  final bool home = find.text(homeButton).evaluate().isNotEmpty;
  await openTab(tester, 'income');
  final bool income = find.byKey(incomeEntry).evaluate().isNotEmpty;
  await openTab(tester, 'account');
  final bool account = find.byKey(accountEntry).evaluate().isNotEmpty;
  return (account: account, income: income, home: home);
}

Future<void> loginAndSettle(WidgetTester tester, Rig r) async {
  await r.login();
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('ship account: no voucher-entry for guest or signedIn (OD-28)', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    await openTab(tester, 'account');
    expect(find.byKey(const Key('voucher-entry')), findsNothing);
    expect(find.text('Voucher của tôi'), findsNothing);
    await loginAndSettle(tester, r);
    expect(r.session.status, SessionStatus.signedIn);
    await openTab(tester, 'account');
    expect(find.byKey(const Key('open-logout')), findsOneWidget);
    expect(find.byKey(const Key('voucher-entry')), findsNothing);
    expect(find.text('Voucher của tôi'), findsNothing);
  });

  testWidgets('guest: no wallet entry anywhere', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    expect(r.session.status, SessionStatus.guest);
    final e = await entries(tester);
    expect((e.account, e.income, e.home), (false, false, false));
    expect(find.text('Ví của tôi'), findsNothing);
  });

  testWidgets('starting (the token is still being read): no wallet entry', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r, start: false);
    expect(r.session.status, SessionStatus.starting);
    final e = await entries(tester);
    expect((e.account, e.income, e.home), (false, false, false));
  });

  testWidgets('unverified (a token exists but the server cannot be asked): no wallet entry', (WidgetTester tester) async {
    final Rig r = rig(bridge: FakeDeviceBridge()..token = 'fake-access-token-0123456789');
    r.api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
    await boot(tester, r);
    expect(r.session.status, SessionStatus.unverified);
    final e = await entries(tester);
    expect((e.account, e.income, e.home), (false, false, false));
  });

  testWidgets('a valid driver sees the wallet in Tài khoản and Thu nhập', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    await loginAndSettle(tester, r);
    expect(r.session.status, SessionStatus.signedIn);
    final e = await entries(tester);
    expect(e.account, isTrue);
    expect(e.income, isTrue);
  });

  testWidgets('a locked wallet-only driver keeps the wallet entry', (WidgetTester tester) async {
    final Rig r = rig()..who = driverJson(locked: true);
    await boot(tester, r);
    await loginAndSettle(tester, r);
    expect(r.session.identity?.lockedWalletOnly, isTrue);
    final e = await entries(tester);
    expect(e.account, isTrue);
    expect(e.income, isTrue);
  });

  testWidgets('logout: the entries disappear at once and an open wallet closes', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    await loginAndSettle(tester, r);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(accountEntry));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsOneWidget);
    expect(find.textContaining('150.000'), findsWidgets);

    await r.session.logout();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsNothing);
    expect(find.textContaining('150.000'), findsNothing);
    final e = await entries(tester);
    expect((e.account, e.income, e.home), (false, false, false));
  });

  testWidgets('session ended by the server (401): an open wallet closes and the entries go', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    await loginAndSettle(tester, r);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(accountEntry));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsOneWidget);
    r.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'UNAUTHENTICATED');
    await HttpWalletSource(session: r.session).wallet();
    await tester.pumpAndSettle();
    expect(r.session.status, SessionStatus.guest);
    expect(find.byKey(const Key('wallet-card')), findsNothing);
    final e = await entries(tester);
    expect((e.account, e.income, e.home), (false, false, false));
  });

  testWidgets('A logs out, B logs in: B never sees A\'s balance, not even from A\'s late answer', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    await loginAndSettle(tester, r);
    final Completer<ApiResponse> lateAnswer = Completer<ApiResponse>();
    r.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) => lateAnswer.future;
    await openTab(tester, 'account');
    await tester.tap(find.byKey(accountEntry));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('wallet-card')), findsNothing, reason: 'A\'s answer has not arrived');

    await r.session.logout();
    await tester.pumpAndSettle();
    r.who = driverJson(id: idB);
    r.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': walletJson(7000)});
    await loginAndSettle(tester, r);
    expect(r.session.identity?.userId, idB);

    lateAnswer.complete(json(200, <String, Object?>{'data': walletJson(150000)}));
    await tester.pumpAndSettle();
    expect(find.textContaining('150.000'), findsNothing);
    expect(find.byKey(const Key('wallet-card')), findsNothing, reason: 'A\'s wallet screen is gone');

    await openTab(tester, 'account');
    await tester.tap(find.byKey(accountEntry));
    await tester.pumpAndSettle();
    expect(find.textContaining('7.000'), findsWidgets);
    expect(find.textContaining('150.000'), findsNothing);
  });

  testWidgets('a wallet notification opens the wallet only for a signed-in session', (WidgetTester tester) async {
    final Rig r = rig();
    await boot(tester, r);
    final AppFlows flows = createFlows(ClientApp.ship, r.session, config, transport: r.api);
    final NotificationRouter router = shipNotificationRouter(r.session, flows);
    const OpenOutcome wallet = OpenOutcome(kind: OpenKind.ok, target: NotificationTarget(type: TargetType.walletTxn), expired: false);
    final ShellActions actions = ShellActions(goTab: (String id) {}, openDiagnostics: () {});
    BuildContext context() => tester.element(find.byKey(const Key('tab-home')));

    await router(context(), null, wallet, actions);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsNothing, reason: 'guest');

    await loginAndSettle(tester, r);
    unawaited(router(context(), null, wallet, actions));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsOneWidget, reason: 'signed in');

    await r.session.logout();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsNothing);
    await router(context(), null, wallet, actions);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-card')), findsNothing, reason: 'after logout');
  });
}
