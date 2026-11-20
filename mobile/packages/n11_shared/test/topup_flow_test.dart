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

Map<String, Object?> topupJson({String state = 'PENDING', int version = 1}) => <String, Object?>{
      'request_id': requestId,
      'amount_requested_vnd': 150000,
      'state': state,
      'version': version,
      'transfer_code': transferCode,
      'created_at': '2026-11-20T09:00:00.000Z',
      'resolved_at': null,
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
}
