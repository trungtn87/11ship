import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// OD-26: the owner's own account deletion from the Account tab. The app calls the public POST /v1/account-deletion/confirm with the
// signed-in phone + CURRENT password. Covers: a wrong password (no lock, form stays), success (signed out at once, guest notice), PENDING
// (session stays, "đang chờ hoàn tất việc hiện tại"), a lost answer (same Idempotency-Key on "Thử lại") and the rate limit.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String _phone = '+84901234567';
const String _password = 'Correct-Horse-9';

Future<({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge})> _signedIn() async {
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

/// Opens the deletion screen from the Account tab, types the password and presses the final button, confirming in the dialog.
Future<void> _submit(WidgetTester tester, String password) async {
  await tester.ensureVisible(find.byKey(const Key('open-delete-account')));
  await tester.tap(find.byKey(const Key('open-delete-account')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('delete-password')), password);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('delete-submit')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('delete-confirm-yes')));
  await tester.pumpAndSettle();
}

void _answer(FakeApiTransport api, ApiResponse Function() answer) {
  api.routes['POST /v1/account-deletion/confirm'] = (String m, String p, Map<String, String> h, String b) async => answer();
}

void main() {
  testWidgets('the deletion entry is the last item of the signed-in Account tab and opens the explanation screen', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    await _pumpAccount(tester, env.session);
    expect(find.byKey(const Key('open-delete-account')), findsOneWidget);
    expect(find.text('Xóa tài khoản'), findsWidgets);

    await tester.tap(find.byKey(const Key('open-delete-account')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('delete-explain')), findsOneWidget);
    expect(find.textContaining('không thể hoàn tác'), findsOneWidget);
    // Nothing is sent until a password is typed and the final confirmation is accepted.
    expect(env.api.to('POST', '/v1/account-deletion/confirm'), isEmpty);
    final N11Button submit = tester.widget<N11Button>(find.byKey(const Key("delete-submit")));
    expect(submit.onPressed, isNull);
  });

  testWidgets('a wrong password shows the generic message, does not lock and keeps the person signed in', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    _answer(env.api, () => apiError(401, 'INVALID_CREDENTIALS'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, 'sai-mat-khau');

    expect(find.byKey(const Key('delete-error')), findsOneWidget);
    expect(find.text('Mật khẩu chưa đúng'), findsOneWidget);
    expect(find.textContaining('không khóa tài khoản'), findsOneWidget);
    expect(env.session.status, SessionStatus.signedIn);
    expect(env.session.accountDeletedNotice, isFalse);
    final List<RecordedRequest> sent = env.api.to('POST', '/v1/account-deletion/confirm');
    expect(sent, hasLength(1));
    expect(jsonDecode(sent.single.body), <String, Object?>{'phone': _phone, 'password': 'sai-mat-khau'});
    expect(sent.single.headers.containsKey('authorization'), isFalse);
  });

  testWidgets('DELETED signs this device out at once and the Account tab shows the confirmed notice', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    _answer(env.api, () => json(200, <String, Object?>{'data': <String, Object?>{'result': 'DELETED'}}));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.bridge.token, isNull);
    expect(find.byKey(const Key('account-deleted')), findsOneWidget);
    expect(find.text('Đã xác nhận xóa tài khoản'), findsOneWidget);
    // The server already revoked the session: this device does not call logout.
    expect(env.api.to('POST', '/v1/client-auth/logout'), isEmpty);
  });

  testWidgets('LOCKED is treated like DELETED: signed out with the same notice', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    _answer(env.api, () => json(200, <String, Object?>{'data': <String, Object?>{'result': 'LOCKED'}}));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.bridge.token, isNull);
    expect(find.byKey(const Key('account-deleted')), findsOneWidget);
  });

  testWidgets('PENDING keeps the session and says the account waits for the current work to finish', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    _answer(env.api, () => json(200, <String, Object?>{'data': <String, Object?>{'result': 'PENDING'}}));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.signedIn);
    expect(env.bridge.token, 'stored-token');
    expect(find.byKey(const Key('delete-pending')), findsOneWidget);
    expect(find.textContaining('đang chờ hoàn tất việc hiện tại'), findsOneWidget);
    // The request is finished: the button cannot send it again.
    expect(tester.widget<N11Button>(find.byKey(const Key('delete-submit'))).onPressed, isNull);
  });

  testWidgets('a lost answer keeps the form and "Thử lại" resends the SAME request with the same Idempotency-Key', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    env.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    _answer(env.api, () => json(200, <String, Object?>{'data': <String, Object?>{'result': 'DELETED'}}));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(find.byKey(const Key('delete-error')), findsOneWidget);
    expect(find.textContaining('Thử lại'), findsWidgets);
    expect(env.session.status, SessionStatus.signedIn);

    await tester.tap(find.byKey(const Key('delete-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-confirm-yes')));
    await tester.pumpAndSettle();

    final List<RecordedRequest> sent = env.api.to('POST', '/v1/account-deletion/confirm');
    expect(sent, hasLength(2));
    expect(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key']);
    expect(sent[1].body, sent[0].body);
    expect(env.session.status, SessionStatus.guest);
  });

  testWidgets('the rate limit is shown as a refusal and the session stays', (WidgetTester tester) async {
    final ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) env = await _signedIn();
    _answer(env.api, () => apiError(429, 'ACCOUNT_DELETE_RATE_LIMITED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(find.byKey(const Key('delete-error')), findsOneWidget);
    expect(find.text('Chưa xóa được tài khoản'), findsOneWidget);
    expect(env.session.status, SessionStatus.signedIn);
  });
}
