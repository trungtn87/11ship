import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

void main() {
  testWidgets('mismatch blocks, wrong password keeps session, success clears secrets', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final SessionController session = createSessionController(ClientApp.food, const AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env'), transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    api.routes['POST /v1/client-auth/change-password'] = (String m, String p, Map<String, String> h, String b) async {
      expect(h['authorization'], isNotEmpty);
      expect(h['idempotency-key'], isNotEmpty);
      return (jsonDecode(b) as Map<String, Object?>)['current_password'] == 'wrong'
          ? apiError(400, 'CURRENT_PASSWORD_INVALID')
          : json(200, <String, Object?>{'data': <String, Object?>{'changed': true}});
    };
    await tester.pumpWidget(MaterialApp(home: ChangePasswordScreen(session: session)));
    await tester.enterText(find.byKey(const Key('password-current')), 'wrong');
    await tester.enterText(find.byKey(const Key('password-new')), 'new-password-123');
    await tester.enterText(find.byKey(const Key('password-confirm')), 'mismatch');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('password-submit')));
    await tester.tap(find.byKey(const Key('password-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Mật khẩu nhập lại chưa khớp.'), findsOneWidget);
    expect(api.to('POST', '/v1/client-auth/change-password'), isEmpty);
    await tester.enterText(find.byKey(const Key('password-confirm')), 'new-password-123');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('password-submit')));
    await tester.tap(find.byKey(const Key('password-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Mật khẩu hiện tại không đúng.'), findsOneWidget);
    expect(session.status, SessionStatus.signedIn);
    await tester.enterText(find.byKey(const Key('password-current')), 'Correct-Horse-9');
    await tester.ensureVisible(find.byKey(const Key('password-submit')));
    await tester.tap(find.byKey(const Key('password-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('password-saved')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('password-current'))).controller!.text, isEmpty);
  });
}
