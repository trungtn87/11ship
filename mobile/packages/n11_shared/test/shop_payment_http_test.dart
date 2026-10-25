import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// The REAL shop payment source of 11Food (#198, #199) against a scripted server: the contract path and body of every call, the strict parse of an answer, the
// Idempotency-Key the screen gives, and the doors of the two payment rooms.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String id = 'a1b2c3d4-0000-4000-8000-000000000009';

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

Map<String, Object?> requestJson({String state = 'PENDING', int version = 1, String? reportedAt}) => <String, Object?>{
      'request_id': id,
      'purpose': 'MENU_EXPANSION',
      'amount_requested_vnd': 200000,
      'state': state,
      'reject_reason_code': null,
      'version': version,
      'created_at': '2026-10-25T03:00:00.000Z',
      'reported_at': reportedAt,
      'resolved_at': null,
      'awaiting_check': reportedAt != null && state == 'PENDING',
      'can_report': state == 'PENDING' && reportedAt == null,
      'can_cancel': state == 'PENDING' && reportedAt == null,
    };

ApiResponse ok(int status, Object? data) => json(status, <String, Object?>{'data': data});

void main() {
  test('create sends exactly {purpose, amount_vnd} with the key the screen gave, and reads the request back strictly', () async {
    final t = await signedIn();
    final List<String> seen = <String>[];
    t.api.routes['POST /v1/shop/me/payment-requests'] = (String m, String p, Map<String, String> h, String b) async {
      seen.add('${h['idempotency-key']}|$b');
      return ok(201, requestJson());
    };
    final HttpShopPaymentSource source = HttpShopPaymentSource(session: t.session);
    final ShopPayment made = await source.create(purpose: ShopPaymentPurpose.menuExpansion, amount: 200000, key: 'key-1');
    expect(made.requestId, id);
    expect(made.stateLabel, 'Chưa báo chuyển khoản');
    expect(seen.single.split('|').first, 'key-1');
    expect(jsonDecode(seen.single.split('|').last), <String, Object?>{'purpose': 'MENU_EXPANSION', 'amount_vnd': 200000});
    t.api.routes['POST /v1/shop/me/payment-requests'] = (String m, String p, Map<String, String> h, String b) async => ok(201, <String, Object?>{...requestJson(), 'state': 'DONE'});
    await expectLater(source.create(purpose: ShopPaymentPurpose.other, amount: 5000, key: 'key-2'), throwsA(isA<M07Failure>().having((M07Failure f) => f.code, 'code', 'BAD_RESPONSE')));
  });

  test('report posts an EMPTY body to report-transfer, cancel carries the version, reads use the request path', () async {
    final t = await signedIn();
    final List<String> calls = <String>[];
    t.api.routes['POST /v1/shop/me/payment-requests/$id/report-transfer'] = (String m, String p, Map<String, String> h, String b) async {
      calls.add('report ${h['idempotency-key']} $b');
      return ok(200, requestJson(version: 2, reportedAt: '2026-10-25T04:00:00.000Z'));
    };
    t.api.routes['POST /v1/shop/me/payment-requests/$id/cancel'] = (String m, String p, Map<String, String> h, String b) async {
      calls.add('cancel ${h['idempotency-key']} $b');
      return ok(200, requestJson(state: 'CANCELLED', version: 2));
    };
    t.api.routes['GET /v1/shop/me/payment-requests/$id'] = (String m, String p, Map<String, String> h, String b) async => ok(200, requestJson());
    final HttpShopPaymentSource source = HttpShopPaymentSource(session: t.session);
    final ShopPayment reported = await source.report(id, key: 'k-report');
    expect(reported.awaitingCheck, isTrue);
    expect(reported.stateLabel, 'Chờ kiểm tra');
    await source.cancel(id, version: 1, key: 'k-cancel');
    expect(calls, <String>['report k-report {}', 'cancel k-cancel {"expected_version":1}']);
    expect((await source.detail(id)).canReport, isTrue);
  });

  test('accounts are read as the server gave them (empty stays empty); a refusal keeps its code', () async {
    final t = await signedIn();
    final HttpShopPaymentSource source = HttpShopPaymentSource(session: t.session);
    t.api.routes['GET /v1/shop/me/payment-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async => ok(200, <String, Object?>{'accounts': <Object?>[]});
    expect(await source.accounts(), isEmpty);
    t.api.routes['GET /v1/shop/me/payment-receiving-accounts'] = (String m, String p, Map<String, String> h, String b) async =>
        ok(200, <String, Object?>{'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': 'CONG TY'}]});
    expect((await source.accounts()).single.accountNumber, '0123456789');
    t.api.routes['POST /v1/shop/me/payment-requests'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'SHOP_PAYMENT_OPEN_EXISTS');
    await expectLater(source.create(purpose: ShopPaymentPurpose.other, amount: 1000, key: 'k'), throwsA(isA<M07Failure>().having((M07Failure f) => f.code, 'code', 'SHOP_PAYMENT_OPEN_EXISTS')));
  });

  test('the two payment rooms have their own doors, apart from the order chat', () {
    expect(HttpOrderChatApi.pathOf(const ChatRoomRef(ChatDoor.shopPayment, 'x')), '/v1/shop/me/payment-requests/x/chat');
    expect(HttpOrderChatApi.pathOf(const ChatRoomRef(ChatDoor.shipperTopup, 'x')), '/v1/driver/wallet/topup-requests/x/chat');
    expect(HttpOrderChatApi.pathOf(const ChatRoomRef(ChatDoor.shopOrder, 'x')), '/v1/shop/me/orders/x/chat');
  });

  test('the payment words of the closed codes exist: a closed room, a fast sender, the dish limit', () {
    expect(const M07Failure(M07FailureKind.refused, code: 'PAYMENT_CHAT_CLOSED').message, contains('đã đóng'));
    expect(const M07Failure(M07FailureKind.refused, code: 'PAYMENT_CHAT_RATE_LIMITED').message, contains('quá nhanh'));
    expect(const M07Failure(M07FailureKind.refused, code: 'MENU_VISIBLE_LIMIT_REACHED').message, contains('20 món'));
  });
}
