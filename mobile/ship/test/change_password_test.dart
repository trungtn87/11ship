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
    final SessionController session = createSessionController(ClientApp.ship, const AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env'), transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    api.routes['POST /v1/client-auth/change-password'] = (String m, String p, Map<String, String> h, String b) async {
      expect(h['authorization'], isNotEmpty);
      expect(h['idempotency-key'], isNotEmpty);
      expect(h['x-device-signature'], isNull);
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
  Future<({SessionController session, FakeApiTransport api})> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final SessionController session = createSessionController(ClientApp.ship, const AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env'), transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => Scaffold(body: N11Button(key: const Key('open'), label: 'Account root', onPressed: () => Navigator.of(context).push(n11Route(ChangePasswordScreen(session: session))))))));
    await tester.tap(find.byKey(const Key('open')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('password-current')), 'Correct-Horse-9');
    await tester.enterText(find.byKey(const Key('password-new')), 'new-password-123');
    await tester.enterText(find.byKey(const Key('password-confirm')), 'new-password-123');
    await tester.pump();
    return (session: session, api: api);
  }

  Future<void> save(WidgetTester tester) async {
    await tester.ensureVisible(find.byKey(const Key('password-submit')));
    await tester.tap(find.byKey(const Key('password-submit')));
    await tester.pumpAndSettle();
  }

  testWidgets('an unknown outcome retries the same body/key and preserves the signed session', (WidgetTester tester) async {
    final fixture = await open(tester);
    int attempts = 0;
    fixture.api.routes['POST /v1/client-auth/change-password'] = (String m, String p, Map<String, String> h, String b) async {
      if (++attempts == 1) throw const AuthFailure(AuthFailureKind.unknownOutcome);
      return json(200, <String, Object?>{'data': <String, Object?>{'changed': true}});
    };
    await save(tester);
    expect(find.byKey(const Key('password-error')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('password-new'))).enabled, isFalse);
    await save(tester);
    final List<RecordedRequest> calls = fixture.api.to('POST', '/v1/client-auth/change-password');
    expect(calls.length, 2);
    expect(calls[0].body, calls[1].body);
    expect(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
    expect(fixture.session.status, SessionStatus.signedIn);
    expect(find.byKey(const Key('password-saved')), findsOneWidget);
  });

  testWidgets('an expired session leaves the password form and clears credentials', (WidgetTester tester) async {
    final fixture = await open(tester);
    fixture.api.routes['POST /v1/client-auth/change-password'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_EXPIRED');
    await save(tester);
    expect(fixture.session.status, SessionStatus.guest);
    expect(find.byKey(const Key('password-current')), findsNothing);
    expect(find.text('Account root'), findsOneWidget);
  });

}
