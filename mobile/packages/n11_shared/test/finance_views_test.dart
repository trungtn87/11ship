import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String roomId = '11111111-1111-4111-8111-111111111111';
Future<({SessionController session, FakeApiTransport api})> rig({bool closed = false}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  api.routes['GET /v1/finance/me/receiving-accounts'] = (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{'accounts': <Object?>[<String, Object?>{'bank_id': 'VCB', 'account_number': '0123456789', 'account_holder': '11SHIP'}]}});
  api.routes['GET /v1/finance/me/requests'] = (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{'items': <Object?>[], 'next_before': null}});
  api.routes['GET /v1/finance/me/requests/$roomId'] = (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{
    'request': <String, Object?>{'request_id': roomId, 'state': closed ? 'CONFIRMED' : 'PENDING', 'reported_at': null},
    'messages': <String, Object?>{'items': <Object?>[<String, Object?>{'sequence': '1', 'body': 'Tiền thực nhận được kiểm tra riêng', 'role': 'SYSTEM_EVENT', 'created_at': '2026-10-26T00:00:00Z'}], 'next_before': null},
  }});
  api.routes['POST /v1/finance/me/requests/$roomId/read'] = (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{'ok': true}});
  return (session: session, api: api);
}
void main() {
  testWidgets('creating a request and reporting a transfer are separate commands with configured bank instructions', (WidgetTester tester) async {
    final t = await rig();
    t.api.routes['POST /v1/finance/me/shop-payments'] = (_, __, ___, ____) async => json(201, <String, Object?>{'data': <String, Object?>{'request_id': roomId}});
    t.api.routes['POST /v1/finance/me/requests/$roomId/report-transfer'] = (_, __, ___, ____) async => json(200, <String, Object?>{'data': <String, Object?>{'request_id': roomId}});
    await tester.pumpWidget(MaterialApp(home: FinanceRequestsScreen(session: t.session, shopPayments: true)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '42000');
    await tester.enterText(find.byType(TextField).at(1), 'Xin mở rộng thực đơn');
    await tester.tap(find.widgetWithText(FilledButton, 'Tạo yêu cầu'));
    await tester.pumpAndSettle();
    expect(jsonDecode(t.api.to('POST', '/v1/finance/me/shop-payments').single.body), <String, Object?>{'amount_vnd': 42000, 'note': 'Xin mở rộng thực đơn'});
    expect(t.api.to('POST', '/v1/finance/me/requests/$roomId/report-transfer'), isEmpty);
    expect(find.textContaining('0123456789'), findsOneWidget);
    await tester.ensureVisible(find.text('Tôi đã chuyển khoản'));
    await tester.tap(find.text('Tôi đã chuyển khoản'));
    await tester.pumpAndSettle();
    expect(t.api.to('POST', '/v1/finance/me/requests/$roomId/report-transfer'), hasLength(1));
    await tester.pumpWidget(const SizedBox());
    t.session.dispose();
  });
  testWidgets('an uncertain send keeps the body and idempotency key for an explicit retry', (WidgetTester tester) async {
    final t = await rig();int sends = 0;
    t.api.routes['POST /v1/finance/me/requests/$roomId/messages'] = (_, __, ___, ____) async => ++sends == 1
      ? json(503, <String, Object?>{'error': <String, Object?>{'code': 'SERVICE_UNAVAILABLE'}})
      : json(200, <String, Object?>{'data': <String, Object?>{'sequence': '2'}});
    await tester.pumpWidget(MaterialApp(home: FinanceRequestsScreen(session: t.session, requestId: roomId)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Nhờ kiểm tra giúp');
    await tester.ensureVisible(find.text('Gửi tin nhắn'));
    await tester.tap(find.text('Gửi tin nhắn'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Gửi tin nhắn'));
    await tester.tap(find.text('Gửi tin nhắn'));
    await tester.pumpAndSettle();
    final calls = t.api.to('POST', '/v1/finance/me/requests/$roomId/messages').toList();
    expect(calls, hasLength(2));
    expect(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
    expect(calls[0].body, calls[1].body);
    await tester.pumpWidget(const SizedBox());
    t.session.dispose();
  });
  testWidgets('a settled request keeps history visible with no message or report control', (WidgetTester tester) async {
    final t = await rig(closed: true);
    await tester.pumpWidget(MaterialApp(home: FinanceRequestsScreen(session: t.session, requestId: roomId)));
    await tester.pumpAndSettle();
    expect(find.text('Tiền thực nhận được kiểm tra riêng'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Tôi đã chuyển khoản'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    t.session.dispose();
  });
  test('finance notification target stays separate from order and wallet targets', () {
    expect(NotificationTarget.fromJson(<String, Object?>{'type': 'FINANCE_REQUEST', 'id': roomId}).type, TargetType.financeRequest);
  });
}
