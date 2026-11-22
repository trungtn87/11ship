import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// OD-26: the owner's own account deletion from the Account tab. The app calls the public POST /v1/account-deletion/confirm with the
// signed-in phone + CURRENT password. Covers: a wrong password (no lock, form stays), success (signed out at once, guest notice),
// PENDING (session stays), a lost answer (same Idempotency-Key on "Thử lại"), the rate limit, and the two wordings: a driver whose account
// is only LOCKED can sign in again to 11Ship for the wallet (OD-31); everyone else cannot.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String _phone = '+84901234567';
const String _password = 'Correct-Horse-9';
const String _explainNoRelogin = 'không đăng nhập lại được bằng tài khoản này';
const String _explainWalletOnly = 'vẫn đăng nhập lại 11Ship được, chỉ để rút toàn bộ số dư ví';
const String _noticeWalletOnly = 'Bạn vẫn đăng nhập lại 11Ship được, chỉ để rút toàn bộ số dư ví.';
const String _noticeNoRelogin = 'Bạn không đăng nhập lại được bằng tài khoản này.';

typedef _Env = ({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge});

/// A signed-in session. [driver] = the identity holds the DRIVER role (a shipper), so the wallet-only wording applies.
Future<_Env> _signedIn({bool driver = false}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  if (driver) {
    final Map<String, Object?> me = identityJson(active: 'DRIVER')..['available_roles'] = <String>['DRIVER'];
    api.routes['GET /v1/client-auth/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': me});
  }
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

ApiResponse _result(String result) => json(200, <String, Object?>{'data': <String, Object?>{'result': result}});

void main() {
  testWidgets('the deletion entry is the last item of the signed-in Account tab and opens the explanation screen', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    await _pumpAccount(tester, env.session);
    expect(find.byKey(const Key('open-delete-account')), findsOneWidget);
    expect(find.text('Xóa tài khoản'), findsWidgets);

    await tester.tap(find.byKey(const Key('open-delete-account')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('delete-explain')), findsOneWidget);
    expect(find.textContaining('không thể hoàn tác'), findsOneWidget);
    // Nothing is sent until a password is typed and the final confirmation is accepted.
    expect(env.api.to('POST', '/v1/account-deletion/confirm'), isEmpty);
    final N11Button submit = tester.widget<N11Button>(find.byKey(const Key('delete-submit')));
    expect(submit.onPressed, isNull);
  });

  testWidgets('explanation: a customer is told the account cannot be signed in again; a driver is told the wallet can still be withdrawn', (WidgetTester tester) async {
    final _Env customer = await _signedIn();
    await _pumpAccount(tester, customer.session);
    await tester.tap(find.byKey(const Key('open-delete-account')));
    await tester.pumpAndSettle();
    expect(find.textContaining(_explainNoRelogin), findsOneWidget);
    expect(find.textContaining(_explainWalletOnly), findsNothing);
    expect(find.textContaining('chỉ còn rút được toàn bộ số dư ví'), findsNothing);
  });

  testWidgets('explanation: a driver sees the wallet-only wording and no customer sentence', (WidgetTester tester) async {
    final _Env driver = await _signedIn(driver: true);
    await _pumpAccount(tester, driver.session);
    await tester.tap(find.byKey(const Key('open-delete-account')));
    await tester.pumpAndSettle();
    expect(find.textContaining(_explainWalletOnly), findsOneWidget);
    expect(find.textContaining(_explainNoRelogin), findsNothing);
    expect(find.textContaining('chỉ còn rút được toàn bộ số dư ví'), findsNothing);
  });

  testWidgets('a wrong password shows the generic message, does not lock and keeps the person signed in', (WidgetTester tester) async {
    final _Env env = await _signedIn();
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

  testWidgets('DELETED (customer) signs this device out at once and the notice says the account cannot be signed in again', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _answer(env.api, () => _result('DELETED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.session.accountDeletedWalletOnly, isFalse);
    expect(env.bridge.token, isNull);
    expect(find.byKey(const Key('account-deleted')), findsOneWidget);
    expect(find.text('Đã xác nhận xóa tài khoản'), findsOneWidget);
    expect(find.textContaining(_noticeNoRelogin), findsOneWidget);
    // The server already revoked the session: this device does not call logout.
    expect(env.api.to('POST', '/v1/client-auth/logout'), isEmpty);
  });

  testWidgets('LOCKED (customer) gets the same no-relogin notice', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _answer(env.api, () => _result('LOCKED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.bridge.token, isNull);
    expect(env.session.accountDeletedWalletOnly, isFalse);
    expect(find.textContaining(_noticeNoRelogin), findsOneWidget);
    expect(find.textContaining(_noticeWalletOnly), findsNothing);
  });

  testWidgets('LOCKED (driver) signs out and the notice says the driver can sign in again for the wallet only', (WidgetTester tester) async {
    final _Env env = await _signedIn(driver: true);
    _answer(env.api, () => _result('LOCKED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.bridge.token, isNull);
    expect(env.session.accountDeletedWalletOnly, isTrue);
    expect(find.byKey(const Key('account-deleted')), findsOneWidget);
    expect(find.textContaining(_noticeWalletOnly), findsOneWidget);
    expect(find.textContaining(_noticeNoRelogin), findsNothing);
  });

  testWidgets('DELETED (driver, nothing kept) is erased, so the customer wording applies', (WidgetTester tester) async {
    final _Env env = await _signedIn(driver: true);
    _answer(env.api, () => _result('DELETED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(env.session.status, SessionStatus.guest);
    expect(env.session.accountDeletedWalletOnly, isFalse);
    expect(find.textContaining(_noticeNoRelogin), findsOneWidget);
    expect(find.textContaining(_noticeWalletOnly), findsNothing);
  });

  testWidgets('PENDING keeps the session and says the account waits for the current work to finish', (WidgetTester tester) async {
    final _Env env = await _signedIn();
    _answer(env.api, () => _result('PENDING'));
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
    final _Env env = await _signedIn();
    env.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    _answer(env.api, () => _result('DELETED'));
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
    final _Env env = await _signedIn();
    _answer(env.api, () => apiError(429, 'ACCOUNT_DELETE_RATE_LIMITED'));
    await _pumpAccount(tester, env.session);
    await _submit(tester, _password);

    expect(find.byKey(const Key('delete-error')), findsOneWidget);
    expect(find.text('Chưa xóa được tài khoản'), findsOneWidget);
    expect(env.session.status, SessionStatus.signedIn);
  });
}
