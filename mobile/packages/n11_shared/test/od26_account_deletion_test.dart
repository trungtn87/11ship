import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// OD-26 (Owner order 2026-11-23): the owner's own account deletion from the Account tab, from the signed-in app only. Covers: a pre-check that
// blocks (nothing is sent), a balance below the minimum withdrawal that must be agreed before a code is sent, a successful code and
// confirmation (this device signs out), and a wrong code (the form stays).

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

typedef _Env = ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge});

/// A signed-in session (the customer identity from the account routes).
Future<_Env> _signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final FakeDeviceBridge bridge = FakeDeviceBridge()
    ..token = 'stored-token'
    ..key = const DeviceKeyState(keyId: 'k', publicKeySpki: 'c3Bracw=', chain: <String>[], bindingId: 'b', generation: 1);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: bridge);
  await session.start();
  expect(session.status, SessionStatus.signedIn);
  return (session: session, api: api, bridge: bridge);
}

Future<void> _pumpAccount(WidgetTester tester, SessionController session) async {
  tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(
      body: SingleChildScrollView(
        child: AccountTab(
          session: session,
          brand: foodBrand,
          actions: ShellActions(goTab: (String id) {}, openDiagnostics: () {}),
          entries: const <Widget>[],
          showDiagnostics: false,
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _openScreen(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('open-delete-account')));
  await tester.tap(find.byKey(const Key('open-delete-account')));
  await tester.pumpAndSettle();
}

/// The pre-check answer: READY (with the amounts) or BLOCKED (with the reasons).
ApiResponse _precheck({bool ready = true, int balance = 0, List<Map<String, Object?>> blockers = const <Map<String, Object?>>[]}) => json(200, <String, Object?>{
      'data': <String, Object?>{
        'status': ready ? 'READY' : 'BLOCKED',
        'balance_vnd': '$balance',
        'forfeit_vnd': '$balance',
        'withdraw_min_vnd': '10000',
        'blockers': blockers,
      },
    });

void _route(FakeApiTransport api, String key, ApiResponse Function(String body) answer) {
  api.routes[key] = (String m, String p, Map<String, String> h, String b) async => answer(b);
}

void main() {
  testWidgets('a blocked pre-check shows what must be done first, and no code can be requested', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _route(env.api, 'GET /v1/account/deletion/precheck', (String _) => _precheck(ready: false, blockers: <Map<String, Object?>>[
      <String, Object?>{'code': 'ACTIVE_WORK', 'items': <String>['ORDER']},
    ]));
    await _pumpAccount(tester, env.session);
    await _openScreen(tester);
    expect(find.byKey(const Key('delete-blocked')), findsOneWidget);
    expect(find.textContaining('Còn đơn hoặc việc đang xử lý'), findsOneWidget);
    final N11Button send = tester.widget<N11Button>(find.byKey(const Key('delete-send-code')));
    expect(send.onPressed, isNull);
    expect(env.api.to('POST', '/v1/account/deletion/code'), isEmpty);
  });

  testWidgets('a balance below the minimum withdrawal is shown as forfeited, and the code waits until the owner agrees', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _route(env.api, 'GET /v1/account/deletion/precheck', (String _) => _precheck(balance: 5000));
    _route(env.api, 'POST /v1/account/deletion/code', (String _) => json(200, <String, Object?>{'data': <String, Object?>{'verification_id': 'v-1', 'expires_in_seconds': 300, 'resend_after_seconds': 60}}));
    await _pumpAccount(tester, env.session);
    await _openScreen(tester);
    expect(find.byKey(const Key('delete-forfeit')), findsOneWidget);
    expect(find.textContaining('5.000 đ'), findsOneWidget);
    expect((tester.widget<N11Button>(find.byKey(const Key('delete-send-code')))).onPressed, isNull);
    await tester.tap(find.byKey(const Key('delete-forfeit-agree')));
    await tester.pumpAndSettle();
    expect((tester.widget<N11Button>(find.byKey(const Key('delete-send-code')))).onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('delete-send-code')));
    await tester.pumpAndSettle();
    final List<Map<String, Object?>> sent = env.api.to('POST', '/v1/account/deletion/code').map((RecordedRequest call) => jsonDecode(call.body) as Map<String, Object?>).toList();
    expect(sent, <Map<String, Object?>>[<String, Object?>{'accept_forfeit': true, 'forfeit_vnd': '5000'}]);
    expect(find.byKey(const Key('delete-otp')), findsOneWidget);
  });

  testWidgets('the one-time code confirms the erasure: the account is locked and this device signs out at once', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _route(env.api, 'GET /v1/account/deletion/precheck', (String _) => _precheck());
    _route(env.api, 'POST /v1/account/deletion/code', (String _) => json(200, <String, Object?>{'data': <String, Object?>{'verification_id': 'v-1', 'expires_in_seconds': 300, 'resend_after_seconds': 60}}));
    _route(env.api, 'POST /v1/account/deletion/confirm', (String _) => json(200, <String, Object?>{'data': <String, Object?>{'result': 'ERASURE_SCHEDULED'}}));
    await _pumpAccount(tester, env.session);
    await _openScreen(tester);
    await tester.tap(find.byKey(const Key('delete-send-code')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('delete-otp')), '123456');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-confirm-yes')));
    await tester.pumpAndSettle();
    final List<Map<String, Object?>> confirmed = env.api.to('POST', '/v1/account/deletion/confirm').map((RecordedRequest call) => jsonDecode(call.body) as Map<String, Object?>).toList();
    expect(confirmed, <Map<String, Object?>>[<String, Object?>{'verification_id': 'v-1', 'otp': '123456', 'accept_forfeit': false, 'forfeit_vnd': '0'}]);
    expect(env.session.status, isNot(SessionStatus.signedIn));
  });

  testWidgets('a changed balance clears the old consent and asks the owner to confirm the new amount', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    int balance = 5000;
    _route(env.api, 'GET /v1/account/deletion/precheck', (String _) => _precheck(balance: balance));
    _route(env.api, 'POST /v1/account/deletion/code', (String _) => json(200, <String, Object?>{'data': <String, Object?>{'verification_id': 'v-1'}}));
    _route(env.api, 'POST /v1/account/deletion/confirm', (String body) {
      expect((jsonDecode(body) as Map<String, Object?>)['forfeit_vnd'], '5000');
      balance = 7000;
      return json(409, <String, Object?>{'error': <String, Object?>{'code': 'ACCOUNT_ERASURE_CONSENT_REQUIRED'}});
    });
    await _pumpAccount(tester, env.session);
    await _openScreen(tester);
    await tester.tap(find.byKey(const Key('delete-forfeit-agree')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-send-code')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('delete-otp')), '123456');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-confirm-yes')));
    await tester.pumpAndSettle();

    expect(find.textContaining('7.000 đ'), findsOneWidget);
    expect(find.byKey(const Key('delete-otp')), findsNothing);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('delete-forfeit-agree'))).value, isFalse);
    expect(tester.widget<N11Button>(find.byKey(const Key('delete-send-code'))).onPressed, isNull);
    expect(env.session.status, SessionStatus.signedIn);
  });

  testWidgets('a wrong code keeps the form and says so; the session stays', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _route(env.api, 'GET /v1/account/deletion/precheck', (String _) => _precheck());
    _route(env.api, 'POST /v1/account/deletion/code', (String _) => json(200, <String, Object?>{'data': <String, Object?>{'verification_id': 'v-1', 'expires_in_seconds': 300, 'resend_after_seconds': 60}}));
    _route(env.api, 'POST /v1/account/deletion/confirm', (String _) => json(400, <String, Object?>{'error': <String, Object?>{'code': 'OTP_INVALID'}}));
    await _pumpAccount(tester, env.session);
    await _openScreen(tester);
    await tester.tap(find.byKey(const Key('delete-send-code')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('delete-otp')), '000000');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-confirm-yes')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('delete-error')), findsOneWidget);
    expect(env.session.status, SessionStatus.signedIn);
    expect(find.byKey(const Key('delete-otp')), findsOneWidget);
  });
}
