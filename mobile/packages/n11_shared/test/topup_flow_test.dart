import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// M04 top-up flow on the REAL wallet source against a scripted server. Step 1: "Tạo yêu cầu nạp" creates the request and goes straight to its detail
// (no confirmation screen in between). Step 2 (PENDING, waiting for the transfer): no "Trao đổi với quản trị". A CONFIRMED request still offers it.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String requestId = 'a1b2c3d4-0000-4000-8000-000000000002';
const String transferCode = 'NAPA1B2C3D4E';

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

ApiResponse ok(int status, Object? data) => json(status, <String, Object?>{'data': data});

Map<String, Object?> summaryJson() => <String, Object?>{
      'wallet': <String, Object?>{'provisioned': true, 'balance_vnd': 150000, 'held_vnd': 0, 'available_vnd': 150000},
      'limits': <String, Object?>{'topup_min_vnd': 120000, 'withdraw_min_vnd': 15000},
      'commission_vnd': 0,
      'open_withdrawals': 0,
      'driver_status': 'ACTIVE',
      'limited_access': false,
    };

Map<String, Object?> topupJson({String state = 'PENDING', int version = 1, String? reportedAt}) => <String, Object?>{
      'request_id': requestId,
      'amount_requested_vnd': 150000,
      'state': state,
      'version': version,
      'transfer_code': transferCode,
      'created_at': '2026-11-20T09:00:00.000Z',
      'resolved_at': null,
      'reported_at': reportedAt,
    };

void routeReceivingAccount(FakeApiTransport api) {
  api.routes['GET /v1/driver/wallet/topup-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{
        'accounts': <Object?>[
          <String, Object?>{'bank_id': 'MB', 'account_number': '0123456789', 'account_holder': 'CONG TY 11SHIP'},
        ],
      });
  api.routes['GET /v1/driver/wallet'] = (String m, String p, Map<String, String> h, String b) async => ok(200, summaryJson());
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 5200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pump();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('step 1: "Tạo yêu cầu nạp" creates one request and opens its detail directly; the detail offers no "Trao đổi với quản trị" at PENDING',
      (WidgetTester tester) async {
    final t = (await tester.runAsync(() => signedIn()))!;
    routeReceivingAccount(t.api);
    t.api.routes['POST /v1/driver/wallet/topup-requests'] = (String m, String p, Map<String, String> h, String b) async => ok(201, topupJson());
    t.api.routes['GET /v1/driver/wallet/topup-requests/$requestId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson());
    final HttpWalletSource source = HttpWalletSource(session: t.session);

    await tester.runAsync(() => source.transferInfo());
    await mount(tester, TopupAmountScreen(source: source));
    await tester.enterText(find.byKey(const Key('topup-amount')), '150000');
    await tester.pump();
    await tester.tap(find.byKey(const Key('topup-continue')));
    await tester.pump();
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('topup-submit')), findsNothing, reason: 'the confirmation screen is gone');
    expect(find.byKey(const Key('confirm-amount')), findsNothing);
    expect(find.byKey(const Key('topup-cancel')), findsOneWidget, reason: 'the detail of the new request is open');
    expect(find.text('Trao đổi với quản trị'), findsNothing, reason: 'exchange with the admin is not offered before the transfer is reported');
    expect(t.api.to('POST', '/v1/driver/wallet/topup-requests'), hasLength(1), reason: 'exactly one request is created');
  });

  testWidgets('a CONFIRMED request still offers "Trao đổi với quản trị" (existing behaviour kept)', (WidgetTester tester) async {
    final t = (await tester.runAsync(() => signedIn()))!;
    routeReceivingAccount(t.api);
    t.api.routes['GET /v1/driver/wallet/topup-requests/$requestId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson(state: 'CONFIRMED'));
    final HttpWalletSource source = HttpWalletSource(session: t.session);

    await mount(tester, TopupDetailScreen(source: source, code: requestId));
    expect(find.text('Trao đổi với quản trị'), findsOneWidget);
  });

  // M04 step 2b: "Xác nhận đã chuyển tiền" on the real source.
  const String reportPath = '/v1/driver/wallet/topup-requests/$requestId/report';

  testWidgets('report: one tap posts the report, then the request reads "Chờ xác nhận", "Trao đổi với quản trị" appears and "Hủy yêu cầu" is gone',
      (WidgetTester tester) async {
    final t = (await tester.runAsync(() => signedIn()))!;
    routeReceivingAccount(t.api);
    String? reportedAt;
    t.api.routes['GET /v1/driver/wallet/topup-requests/$requestId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson(reportedAt: reportedAt));
    t.api.routes['POST $reportPath'] = (String m, String p, Map<String, String> h, String b) async {
      reportedAt = '2026-11-20T09:30:00.000Z';
      return ok(200, topupJson(reportedAt: reportedAt));
    };
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupDetailScreen(source: source, code: requestId));
    expect(find.text('Trao đổi với quản trị'), findsNothing, reason: 'not before the report');

    await tester.tap(find.byKey(const Key('topup-reported')));
    await tester.pumpAndSettle();

    expect(t.api.to('POST', reportPath), hasLength(1));
    expect(t.api.to('POST', reportPath).single.body, '{}');
    expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Chờ xác nhận');
    expect(find.byKey(const Key('topup-reported')), findsNothing);
    expect(find.text('Trao đổi với quản trị'), findsOneWidget);
    expect(find.byKey(const Key('topup-cancel')), findsNothing, reason: 'Owner 2026-11-27: a reported transfer cannot be cancelled');
    expect(find.byKey(const Key('topup-reported-help')), findsOneWidget);
    expect(find.byKey(const Key('topup-vietqr')), findsNothing);
  });

  testWidgets('report: a lost answer shows a sentence; the retry is the SAME report (same key), and nothing is shown as reported before the answer',
      (WidgetTester tester) async {
    final t = (await tester.runAsync(() => signedIn()))!;
    routeReceivingAccount(t.api);
    t.api.routes['GET /v1/driver/wallet/topup-requests/$requestId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson());
    t.api.routes['POST $reportPath'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson(reportedAt: '2026-11-20T09:30:00.000Z'));
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupDetailScreen(source: source, code: requestId));

    // Armed after the screen has loaded, so the failure lands on the report and not on the read.
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await tester.tap(find.byKey(const Key('topup-reported')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('topup-report-error')), findsOneWidget);
    expect(find.byKey(const Key('topup-reported')), findsOneWidget, reason: 'still waiting for the report to be answered');
    expect(find.text('Trao đổi với quản trị'), findsNothing);

    // The error banner pushed the button down: bring it on screen before the retry.
    await tester.ensureVisible(find.byKey(const Key('topup-reported')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('topup-reported')));
    await tester.pumpAndSettle();
    final List<RecordedRequest> posts = t.api.to('POST', reportPath);
    expect(posts, hasLength(2));
    expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
    expect(find.byKey(const Key('topup-report-error')), findsNothing);
  });

  testWidgets('report: a second tap while the report is in flight sends nothing more', (WidgetTester tester) async {
    final t = (await tester.runAsync(() => signedIn()))!;
    routeReceivingAccount(t.api);
    final Completer<void> gate = Completer<void>();
    t.api.routes['GET /v1/driver/wallet/topup-requests/$requestId'] = (String m, String p, Map<String, String> h, String b) async => ok(200, topupJson());
    t.api.routes['POST $reportPath'] = (String m, String p, Map<String, String> h, String b) async {
      await gate.future;
      return ok(200, topupJson(reportedAt: '2026-11-20T09:30:00.000Z'));
    };
    final HttpWalletSource source = HttpWalletSource(session: t.session);
    await mount(tester, TopupDetailScreen(source: source, code: requestId));

    await tester.tap(find.byKey(const Key('topup-reported')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('topup-reported')), warnIfMissed: false);
    await tester.pump();
    expect(t.api.to('POST', reportPath), hasLength(1));
    gate.complete();
    await tester.pumpAndSettle();
    expect(t.api.to('POST', reportPath), hasLength(1));
  });
}
