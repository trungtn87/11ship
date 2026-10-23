import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// The REAL wallet source of the 11Ship app (M04) against a scripted server: the contract path and body of every read and write, the strict parse of an
// answer, the Idempotency-Key of an intent (kept while the outcome is unknown, forgotten on a definite answer) and the closed mapping from a refusal or a
// lost answer to a sentence. Nothing here moves money: the source only asks the server.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String walletId = 'a1b2c3d4-0000-4000-8000-000000000001';

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

Map<String, Object?> summaryJson({int balance = 150000, int held = 2000}) => <String, Object?>{
      'wallet': <String, Object?>{'provisioned': true, 'balance_vnd': balance, 'held_vnd': held, 'available_vnd': balance - held},
      'limits': <String, Object?>{'topup_min_vnd': 120000, 'withdraw_min_vnd': 15000},
      'commission_vnd': 1000,
      'open_withdrawals': 0,
      'driver_status': 'ACTIVE',
      'limited_access': false,
    };

Map<String, Object?> withdrawalJson({String state = 'PENDING', int version = 1}) => <String, Object?>{
      'withdrawal_id': walletId,
      'request_code': 'A1B2C3D4',
      'amount_vnd': 50000,
      'state': state,
      'version': version,
      'can_cancel': state == 'PENDING',
      'created_at': '2026-10-18T09:00:00.000Z',
      'resolved_at': null,
      'account': <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number_masked': '****1098', 'account_holder': 'NGUYEN VAN A'},
    };

Map<String, Object?> topupJson({String state = 'PENDING', int version = 1}) => <String, Object?>{
      'request_id': walletId,
      'amount_requested_vnd': 150000,
      'state': state,
      'version': version,
      'created_at': '2026-10-18T09:00:00.000Z',
      'resolved_at': null,
    };

ApiResponse ok(int status, Object? data) => json(status, <String, Object?>{'data': data});

void main() {
  test('wallet: B / H come from the server, available is computed, and the minimums the server asks for are learned', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, summaryJson());
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    expect(source.minTopup, kMinTopup);
    final WalletLoad<Wallet> load = await source.wallet();
    expect(load, isA<WalletReady<Wallet>>());
    final Wallet wallet = (load as WalletReady<Wallet>).value;
    expect(wallet.total, 150000);
    expect(wallet.held, 2000);
    expect(wallet.available, 148000);
    expect(source.minTopup, 120000);
    expect(source.minWithdraw, 15000);
    expect(source.isSample, isFalse);
    expect(source.canWrite, isTrue);
  });

  test('wallet: a body that is not the contract is a failed read, never a half-filled screen; a held amount above the balance is refused', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'wallet': <String, Object?>{'balance_vnd': 'x'}});
    expect(await source.wallet(), isA<WalletFailed<Wallet>>());
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, summaryJson(balance: 1000, held: 2000));
    expect(await source.wallet(), isA<WalletFailed<Wallet>>());
    t.api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => apiError(403, 'ROLE_NOT_AVAILABLE');
    final WalletLoad<Wallet> refused = await source.wallet();
    expect(refused, isA<WalletFailed<Wallet>>());
    expect((refused as WalletFailed<Wallet>).message, contains('shipper'));
  });

  test('a guest (no session) reads nothing and cannot write: no number exists', () async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    final HttpWalletSource source = HttpWalletSource(session: session);
    expect(await source.wallet(), isA<WalletNotWired<Wallet>>());
    expect(await source.recentTxns(), isA<WalletNotWired<List<WalletTxn>>>());
    expect(await source.bankAccount(), isA<WalletNotWired<ReceivingAccount>>());
    expect(await source.transferInfo(), isA<WalletNotWired<BankTransferInfo>>());
    expect(source.writes, isNull);
    expect(api.requests.where((RecordedRequest r) => r.path.startsWith('/v1/driver/wallet')), isEmpty);
  });

  test('history: ledger rows are signed, holds and releases are information, pending requests keep their status; an empty history is "empty"', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['GET /v1/driver/wallet/transactions?type=all&limit=3'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
          'items': <Object?>[
            <String, Object?>{'id': 'L:1', 'type': 'topup', 'amount_vnd': 150000, 'at': '2026-10-18T09:30:00.000Z', 'status': 'success', 'order_ref': null, 'request_id': walletId, 'request_kind': 'topup'},
            <String, Object?>{'id': 'L:2', 'type': 'commission', 'amount_vnd': -1000, 'at': '2026-10-18T09:20:00.000Z', 'status': 'success', 'order_ref': 'G-77', 'request_id': null, 'request_kind': null},
            <String, Object?>{'id': 'H:3', 'type': 'hold', 'amount_vnd': 1000, 'at': '2026-10-18T09:10:00.000Z', 'status': 'pending', 'order_ref': 'G-78', 'request_id': null, 'request_kind': null},
          ],
          'next_cursor': null,
        });
    final WalletLoad<List<WalletTxn>> recent = await source.recentTxns();
    final List<WalletTxn> rows = (recent as WalletReady<List<WalletTxn>>).value;
    expect(rows.map((WalletTxn r) => r.type), <TxnType>[TxnType.topup, TxnType.commission, TxnType.hold]);
    expect(rows[0].amount, 150000);
    expect(rows[0].isLedgerMovement, isTrue);
    expect(rows[1].amount, -1000);
    expect(rows[1].orderRef, 'Đơn G-77');
    expect(rows[2].isLedgerMovement, isFalse);
    expect(rows[2].amountText, '1.000đ');
    expect(rows[0].requestCode, walletId);
    t.api.routes['GET /v1/driver/wallet/transactions?type=withdraw&limit=50'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'items': <Object?>[], 'next_cursor': null});
    expect(await source.txns(TxnFilter.withdraw), isA<WalletEmpty<List<WalletTxn>>>());
  });

  test('history: one page at a time with the server cursor, "more" continues where it stopped until the whole history is read (no cap)', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    Map<String, Object?> row(String id) => <String, Object?>{'id': id, 'type': 'commission', 'amount_vnd': -1000, 'at': '2026-10-18T09:20:00.000Z', 'status': 'success', 'order_ref': null, 'request_id': null, 'request_kind': null};
    t.api.routes['GET /v1/driver/wallet/transactions?type=commission&limit=50'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'items': <Object?>[row('L:a')], 'next_cursor': 'abc_-1'});
    t.api.routes['GET /v1/driver/wallet/transactions?type=commission&limit=50&cursor=abc_-1'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'items': <Object?>[row('L:b')], 'next_cursor': 'def_-2'});
    t.api.routes['GET /v1/driver/wallet/transactions?type=commission&limit=50&cursor=def_-2'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'items': <Object?>[row('L:c')], 'next_cursor': null});
    expect(source.hasMoreTxns(TxnFilter.commission), isFalse);
    final List<WalletTxn> first = ((await source.txns(TxnFilter.commission)) as WalletReady<List<WalletTxn>>).value;
    expect(first.map((WalletTxn r) => r.id), <String>['L:a']);
    expect(source.hasMoreTxns(TxnFilter.commission), isTrue);
    final List<WalletTxn> second = ((await source.moreTxns(TxnFilter.commission)) as WalletReady<List<WalletTxn>>).value;
    expect(second.map((WalletTxn r) => r.id), <String>['L:b']);
    expect(source.hasMoreTxns(TxnFilter.commission), isTrue);
    final List<WalletTxn> third = ((await source.moreTxns(TxnFilter.commission)) as WalletReady<List<WalletTxn>>).value;
    expect(third.map((WalletTxn r) => r.id), <String>['L:c']);
    expect(source.hasMoreTxns(TxnFilter.commission), isFalse);
    expect(((await source.moreTxns(TxnFilter.commission)) as WalletReady<List<WalletTxn>>).value, isEmpty);
    // Reloading the filter starts again from the newest page.
    await source.txns(TxnFilter.commission);
    expect(source.hasMoreTxns(TxnFilter.commission), isTrue);
  });

  test('topup request: the contract body with a key; a lost answer keeps the key, the retry is the SAME command, a new amount is a new intent', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['POST /v1/driver/wallet/topup-requests'] = (String m, String p, Map<String, String> h, String b) async => ok(201, topupJson());
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await expectLater(source.createTopup(150000), throwsA(isA<WalletFailure>().having((WalletFailure f) => f.outcomeUnknown, 'outcomeUnknown', isTrue)));
    final TopupRequest created = await source.createTopup(150000);
    expect(created.status, TopupStatus.pending);
    expect(created.amount, 150000);
    expect(created.shownCode, 'A1B2C3D4');
    final List<RecordedRequest> posts = t.api.to('POST', '/v1/driver/wallet/topup-requests');
    expect(posts.length, 2);
    expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
    expect(jsonDecode(posts[1].body), <String, Object?>{'amount_vnd': 150000});
    // The intent is done: the same amount again is a NEW command with a NEW key.
    await source.createTopup(150000);
    final List<RecordedRequest> after = t.api.to('POST', '/v1/driver/wallet/topup-requests');
    expect(after[2].headers['idempotency-key'], isNot(after[1].headers['idempotency-key']));
  });

  test('withdrawal request: refusals are sentences, forget the key, and carry no server text', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['POST /v1/driver/wallet/withdrawals'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'WITHDRAWAL_INSUFFICIENT_AVAILABLE');
    await expectLater(source.createWithdrawal(900000), throwsA(isA<WalletFailure>().having((WalletFailure f) => f.message, 'message', contains('khả dụng'))));
    await expectLater(source.createWithdrawal(900000), throwsA(isA<WalletFailure>()));
    final List<RecordedRequest> posts = t.api.to('POST', '/v1/driver/wallet/withdrawals');
    expect(posts.length, 2);
    expect(posts[0].headers['idempotency-key'], isNot(posts[1].headers['idempotency-key']));
    t.api.routes['POST /v1/driver/wallet/withdrawals'] = (String m, String p, Map<String, String> h, String b) async => ok(201, withdrawalJson());
    final WithdrawalRequest created = await source.createWithdrawal(50000);
    expect(created.status, WithdrawalStatus.pending);
    expect(created.account.maskedNumber, '•••• 1098');
    expect(created.account.bankName, 'Vietcombank');
    expect(created.shownCode, 'A1B2C3D4');
    expect(created.canCancel, isTrue);
  });

  test('withdrawal request: a 5xx outcome-unknown answer keeps the intent so the next tap resends the same command', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['POST /v1/driver/wallet/withdrawals'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'TRANSACTION_OUTCOME_UNKNOWN');
    await expectLater(source.createWithdrawal(50000), throwsA(isA<WalletFailure>().having((WalletFailure f) => f.outcomeUnknown, 'outcomeUnknown', isTrue)));
    t.api.routes['POST /v1/driver/wallet/withdrawals'] = (String m, String p, Map<String, String> h, String b) async => ok(201, withdrawalJson());
    await source.createWithdrawal(50000);
    final List<RecordedRequest> posts = t.api.to('POST', '/v1/driver/wallet/withdrawals');
    expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  });

  test('cancel: reads the version first and sends exactly that version; a request that moved on is refused with a sentence', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['GET /v1/driver/wallet/withdrawals/$walletId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawalJson(version: 3));
    t.api.routes['POST /v1/driver/wallet/withdrawals/$walletId/cancel'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawalJson(state: 'CANCELLED', version: 4));
    await source.cancelWithdrawal(walletId);
    final RecordedRequest sent = t.api.to('POST', '/v1/driver/wallet/withdrawals/$walletId/cancel').single;
    expect(jsonDecode(sent.body), <String, Object?>{'expected_version': 3});
    expect(sent.headers['idempotency-key'], isNotNull);
    t.api.routes['POST /v1/driver/wallet/withdrawals/$walletId/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'WITHDRAWAL_STATE_CONFLICT');
    await expectLater(source.cancelWithdrawal(walletId), throwsA(isA<WalletFailure>().having((WalletFailure f) => f.message, 'message', contains('không hủy được'))));
    t.api.routes['GET /v1/driver/wallet/topup-requests/$walletId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson(version: 2));
    t.api.routes['POST /v1/driver/wallet/topup-requests/$walletId/cancel'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson(state: 'CANCELLED', version: 3));
    await source.cancelTopup(walletId);
    expect(jsonDecode(t.api.to('POST', '/v1/driver/wallet/topup-requests/$walletId/cancel').single.body), <String, Object?>{'expected_version': 2});
  });

  test('states: reconciliation shows as "needs reconcile", PAID as completed', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['GET /v1/driver/wallet/withdrawals/$walletId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawalJson(state: 'RECONCILIATION'));
    expect(((await source.withdrawal(walletId)) as WalletReady<WithdrawalRequest>).value.status, WithdrawalStatus.needsReconcile);
    t.api.routes['GET /v1/driver/wallet/withdrawals/$walletId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawalJson(state: 'PAID'));
    expect(((await source.withdrawal(walletId)) as WalletReady<WithdrawalRequest>).value.status, WithdrawalStatus.completed);
    t.api.routes['GET /v1/driver/wallet/withdrawals/$walletId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, withdrawalJson(state: 'WHATEVER'));
    expect(await source.withdrawal(walletId), isA<WalletFailed<WithdrawalRequest>>());
  });

  test('bank account: unverified or absent is never shown as a receiving account; the number is masked; topup info is the REAL account and invents no content', () async {
    final t = await signedIn();
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    t.api.routes['GET /v1/driver/wallet/withdrawal-account'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'account': null});
    expect(await source.bankAccount(), isA<WalletEmpty<ReceivingAccount>>());
    t.api.routes['GET /v1/driver/wallet/withdrawal-account'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
          'account': <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number_masked': '****1098', 'account_holder': 'NGUYEN VAN A', 'verification_state': 'UNVERIFIED', 'can_withdraw': false},
        });
    expect(await source.bankAccount(), isA<WalletFailed<ReceivingAccount>>());
    t.api.routes['GET /v1/driver/wallet/withdrawal-account'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
          'account': <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number_masked': '****1098', 'account_holder': 'NGUYEN VAN A', 'verification_state': 'VERIFIED', 'can_withdraw': true},
        });
    final ReceivingAccount account = ((await source.bankAccount()) as WalletReady<ReceivingAccount>).value;
    expect(account.maskedNumber, '•••• 1098');
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'accounts': <Object?>[]});
    expect(await source.transferInfo(), isA<WalletFailed<BankTransferInfo>>());
    t.api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
          'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': 'CONG TY 11SHIP'}],
        });
    final BankTransferInfo info = ((await source.transferInfo()) as WalletReady<BankTransferInfo>).value;
    expect(info.accountNumber, '0123456789');
    expect(info.holder, 'CONG TY 11SHIP');
    expect(info.content, isNull);
  });
}
