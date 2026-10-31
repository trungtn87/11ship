import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// The wallet SCREENS fed by the real HTTP source (M04): no sample banner, the real transfer account with no invented content or QR, and the money-safe retry:
// a lost answer to "Yêu cầu rút tiền" keeps the intent, so the next tap resends the SAME command and the server answers with the one record.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String id = 'a1b2c3d4-0000-4000-8000-000000000001';

ApiResponse ok(int status, Object? data) => json(status, <String, Object?>{'data': data});

Map<String, Object?> summary() => <String, Object?>{
      'wallet': <String, Object?>{'provisioned': true, 'balance_vnd': 150000, 'held_vnd': 0, 'available_vnd': 150000},
      'limits': <String, Object?>{'topup_min_vnd': 100000, 'withdraw_min_vnd': 10000},
      'commission_vnd': 1000,
      'open_withdrawals': 0,
      'driver_status': 'ACTIVE',
      'limited_access': false,
    };

Map<String, Object?> withdrawal(String state) => <String, Object?>{
      'withdrawal_id': id,
      'request_code': 'A1B2C3D4',
      'amount_vnd': 50000,
      'state': state,
      'version': 1,
      'can_cancel': state == 'PENDING',
      'created_at': '2026-10-18T09:00:00.000Z',
      'resolved_at': null,
      'account': <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number_masked': '****1098', 'account_holder': 'NGUYEN VAN A'},
    };

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 5200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('topup: the real receiving account is shown, with no sample banner, no invented transfer content and no fake QR', (WidgetTester tester) async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': 'CONG TY 11SHIP'}]});
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, summary());
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupAmountScreen(source: source));
    expect(find.byKey(const Key('wallet-sample-banner')), findsNothing);
    // Request first: the account and the transfer content appear on the detail of the created request, not before it exists.
    expect(find.byKey(const Key('topup-transfer-card')), findsNothing);
    expect(find.byKey(const Key('topup-request-first-note')), findsOneWidget);
    expect(find.byKey(const Key('topup-qr-placeholder')), findsNothing);
    expect(find.byKey(const Key('topup-closing-banner')), findsNothing);
    expect(tester.widget<N11Button>(find.byKey(const Key('topup-continue'))).onPressed, isNotNull);
  });

  testWidgets('topup detail: a PENDING request shows the account and the server transfer code (copyable, restored on reopen); no code is invented for an older request', (WidgetTester tester) async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': 'CONG TY 11SHIP'}]});
    Map<String, Object?> request({String? code}) => <String, Object?>{
          'request_id': id,
          if (code != null) 'transfer_code': code,
          'amount_requested_vnd': 100000,
          'state': 'PENDING',
          'version': 1,
          'created_at': '2026-10-18T09:00:00.000Z',
          'resolved_at': null,
        };
    t.api.routes['GET /v1/driver/wallet/topup-requests/$id'] = (String m, String p, Map<String, String> h, String b) async => ok(200, request(code: 'NAPA1B2C3D4E5'));
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupDetailScreen(source: source, code: id));
    expect(find.byKey(const Key('topup-transfer-card')), findsOneWidget);
    expect(find.text('NAPA1B2C3D4E5'), findsOneWidget);
    expect(find.byKey(const Key('copy-content')), findsOneWidget);
    expect(find.byKey(const Key('topup-transfer-note')), findsOneWidget);
    expect(find.byKey(const Key('topup-cancel')), findsOneWidget);
    t.api.routes['GET /v1/driver/wallet/topup-requests/$id'] = (String m, String p, Map<String, String> h, String b) async => ok(200, request());
    await mount(tester, TopupDetailScreen(key: UniqueKey(), source: HttpWalletSource(session: t.session), code: id));
    expect(find.byKey(const Key('topup-transfer-card')), findsOneWidget);
    expect(find.byKey(const Key('copy-content')), findsNothing);
  });

  testWidgets('topup: CLOSING hides the way to create a request and says why; the balance and history stay readable', (WidgetTester tester) async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': 'CONG TY 11SHIP'}]});
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{...summary(), 'driver_status': 'CLOSING'});
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupAmountScreen(source: source));
    expect(find.byKey(const Key('topup-closing-banner')), findsOneWidget);
    expect(find.text('Đang đóng hoạt động, không thể tạo yêu cầu nạp mới.'), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('topup-continue'))).onPressed, isNull);
    await mount(tester, WalletHomeScreen(key: UniqueKey(), source: HttpWalletSource(session: t.session)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('wallet-topup-closing-note')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('wallet-topup-button'))).onPressed, isNull);
    expect(find.byKey(const Key('wallet-card')), findsOneWidget);
    expect(find.byKey(const Key('wallet-withdraw-button')), findsNothing);
  });

  testWidgets('topup: no receiving account configured means no transfer details and no way to continue', (WidgetTester tester) async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'accounts': <Object?>[]});
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupAmountScreen(source: source));
    expect(find.byKey(const Key('topup-transfer-card')), findsNothing);
    expect(find.byKey(const Key('wallet-failed')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('topup-continue'))).onPressed, isNull);
  });

  testWidgets('withdraw: the balance is the server one; a lost answer keeps the intent and the next tap resends the SAME command', (WidgetTester tester) async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{...summary(), 'driver_status': 'CLOSING'});
    t.api.routes['GET /v1/driver/wallet/withdrawal-account'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
          'account': <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number_masked': '****1098', 'account_holder': 'NGUYEN VAN A', 'verification_state': 'VERIFIED', 'can_withdraw': true},
        });
    t.api.routes['POST /v1/driver/wallet/withdrawals'] = (String m, String p, Map<String, String> h, String b) async => ok(201, withdrawal('PENDING'));
    t.api.routes['GET /v1/driver/wallet/withdrawals/$id'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawal('PENDING'));
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, WithdrawScreen(source: source, closing: true));
    expect(find.text('150.000đ'), findsWidgets);
    expect(find.byKey(const Key('withdraw-account-card')), findsOneWidget);
    // The whole balance, never an amount the person types.
    expect(find.byKey(const Key('withdraw-amount')), findsNothing);
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await tester.tap(find.byKey(const Key('withdraw-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('withdraw-submit-error')), findsOneWidget);
    expect(find.textContaining('ĐÚNG yêu cầu'), findsOneWidget);
    await tester.tap(find.byKey(const Key('withdraw-submit')));
    await tester.pumpAndSettle();
    final posts = t.api.to('POST', '/v1/driver/wallet/withdrawals');
    expect(posts.length, 2);
    expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
    expect(posts[0].body, contains('150000'));
    // The detail of the ONE request is shown with its short code and masked account.
    expect(find.byKey(const Key('withdraw-code')), findsOneWidget);
    expect(find.text('A1B2C3D4'), findsOneWidget);
  });

  testWidgets('history: "Tải thêm" appears only while the server has older rows and appends the next page; no cap, no other change to the screen', (WidgetTester tester) async {
    final t = await signedIn();
    Map<String, Object?> row(String rowId) => <String, Object?>{'id': rowId, 'type': 'topup', 'amount_vnd': 100000, 'at': '2026-10-18T09:20:00.000Z', 'status': 'success', 'order_ref': null, 'request_id': null, 'request_kind': null};
    t.api.routes['GET /v1/driver/wallet/transactions?type=all&limit=50'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'items': <Object?>[row('L:1')], 'next_cursor': 'c1_-1'});
    t.api.routes['GET /v1/driver/wallet/transactions?type=all&limit=50&cursor=c1_-1'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'items': <Object?>[row('L:2'), row('L:3')], 'next_cursor': null});
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TxnHistoryScreen(source: source));
    expect(find.byType(WalletTxnTile), findsNWidgets(1));
    expect(find.byKey(const Key('txn-more')), findsOneWidget);
    await tester.tap(find.byKey(const Key('txn-more')));
    await tester.pumpAndSettle();
    expect(find.byType(WalletTxnTile), findsNWidgets(3));
    expect(find.byKey(const Key('txn-more')), findsNothing);
  });
}
