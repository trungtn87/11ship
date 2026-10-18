import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';
import 'package:ship/ship_home.dart';

const String sha = '0123456789abcdef0123456789abcdef01234567';

const AppConfig config = AppConfig(
  apiBaseUrl: 'https://103.9.78.67.sslip.io',
  appId: 'vn.eleven.ship.test',
  versionName: '0.1.0',
  buildNumber: '3',
  sourceSha: sha,
  signing: SigningMode.stable,
  deviceEnvironment: 'fixture-env',
);

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(
      status: 200,
      body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}',
    );

Future<SessionController> pump(WidgetTester tester, HealthTransport transport, {FakeApiTransport? api, FakeDeviceBridge? bridge}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport server = api ?? FakeApiTransport();
  if (api == null) {
    installAccountRoutes(server);
  }
  final SessionController session = createSessionController(ClientApp.ship, config, transport: server, bridge: bridge ?? FakeDeviceBridge());
  await session.start();
  await tester.pumpWidget(N11App(brand: shipBrand, tabs: buildShipTabs(session), config: config, transport: transport, pollInterval: Duration.zero));
  await tester.pump();
  await tester.pump();
  return session;
}

Future<void> openTab(WidgetTester tester, String id) async {
  await tester.tap(find.byKey(Key('tab-$id')));
  await tester.pump();
  await tester.pump();
}

String texts(WidgetTester tester) {
  final String all = tester.widgetList<Text>(find.byType(Text)).map((Text t) => t.data ?? t.textSpan?.toPlainText() ?? '').where((String s) => s.isNotEmpty).join('|');
  return all.length > 700 ? all.substring(0, 700) : all;
}

void main() {
  testWidgets('five tabs in the agreed order and the 11Ship logo', (WidgetTester tester) async {
    await pump(tester, healthy());
    for (final String label in <String>['Trang chủ', 'Đơn hàng', 'Thu nhập', 'Thông báo', 'Tài khoản']) {
      expect(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)), findsOneWidget, reason: label);
    }
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    expect(images.any((Image i) => i.image is AssetImage && (i.image as AssetImage).assetName == 'assets/brand/logo-11ship-ui.png'), isTrue);
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

  testWidgets('online action stays locked: no GPS or invented statistics', (WidgetTester tester) async {
    await pump(tester, healthy());
    final FilledButton button = tester.widget<FilledButton>(find.byKey(const Key('online-button')));
    expect(button.onPressed, isNull);
    expect(find.text('Bạn đang offline'), findsOneWidget);
    expect(find.text(kOnlineReason), findsOneWidget);
    expect(find.textContaining('320.000'), findsNothing);
    expect(find.byKey(const Key('home-map')), findsOneWidget);
  });

  testWidgets('home bell opens notifications', (WidgetTester tester) async {
    await pump(tester, healthy());
    await tester.tap(find.byKey(const Key('home-notifications')));
    await tester.pumpAndSettle();
    // A guest has no inbox: the page asks to sign in and shows no notification of anyone.
    expect(find.text('Đăng nhập để xem thông báo của bạn.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('both activity layouts fit narrow screens with large text', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    for (final bool online in <bool>[false, true]) {
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: MediaQuery(
          data: const MediaQueryData(size: Size(320, 640), textScaler: TextScaler.linear(1.8)),
          child: Scaffold(body: SingleChildScrollView(child: ShipActivityPanel(online: online, reason: kOnlineReason))),
        ),
      ));
      await tester.pump();
      expect(find.text(online ? 'Bạn đang online' : 'Bạn đang offline'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('online-button'))).onPressed, isNull);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('income remains unknown and notifications introduce no fake data', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'income');
    expect(find.text('—'), findsOneWidget);
    expect(find.text('Chưa có dữ liệu thu nhập'), findsOneWidget);
    await openTab(tester, 'notifications');
    expect(find.text('Đăng nhập để xem thông báo của bạn.'), findsOneWidget);
    expect(find.textContaining('₫'), findsNothing);
  });

  testWidgets('orders view toggles between active and history, both empty', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    expect(find.byKey(const Key('orders-active')), findsOneWidget);
    expect(find.text('Chưa có đơn hàng'), findsWidgets);
    await tester.tap(find.byKey(const Key('orders-history')));
    await tester.pump();
    expect(find.text('Chưa có đơn hàng'), findsWidgets);
  });
  testWidgets('M06: orders reach the offer and batching screens, which say they are not ready (no order, no money, nothing to accept)', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    expect(find.byKey(const Key('m06-offer-entry')), findsOneWidget);
    expect(find.byKey(const Key('m06-batch-entry')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('m06-offer-entry')));
    await tester.tap(find.byKey(const Key('m06-offer-entry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('m06-offer-not-ready')), findsOneWidget);
    expect(find.widgetWithText(N11Button, 'Nhận đơn'), findsNothing);
    expect(find.byKey(const Key('m06-sample-banner')), findsNothing);
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('m06-batch-entry')));
    await tester.tap(find.byKey(const Key('m06-batch-entry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('m06-batch-not-ready')), findsOneWidget);
    expect(find.textContaining('ETA gốc'), findsNothing);
  });

  testWidgets('account hides status, policy and diagnostics while preserving profile actions', (WidgetTester tester) async {
    final SessionController session = await pump(tester, healthy());
    await openTab(tester, 'account');
    expect(tester.widget<N11Button>(find.byKey(const Key('open-login'))).onPressed, isNotNull);
    expect(tester.widget<N11Button>(find.byKey(const Key('open-register'))).onPressed, isNotNull);
    expect(find.text('Chính sách và điều khoản'), findsNothing);
    expect(find.text('Chẩn đoán kết nối'), findsNothing);
    expect(find.byKey(const Key('open-change-password')), findsNothing);
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await tester.pumpAndSettle();
    expect(find.text('Trạng thái tài khoản'), findsNothing);
    expect(find.text('Trạng thái'), findsNothing);
    expect(find.byKey(const Key('open-profile')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('open-change-password')));
    await tester.tap(find.byKey(const Key('open-change-password')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('password-current')), findsOneWidget);
    expect(find.byKey(const Key('password-new')), findsOneWidget);
    expect(find.byKey(const Key('password-confirm')), findsOneWidget);
  });

  testWidgets('login with a wrong password is a credentials error, not a session end; then a right one signs in', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    int attempt = 0;
    final FakeHandler ok = api.routes['POST /v1/client-auth/login']!;
    api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async => ++attempt == 1 ? apiError(401, 'INVALID_CREDENTIALS') : ok(m, p, h, b);
    final FakeDeviceBridge bridge = FakeDeviceBridge();
    await pump(tester, healthy(), api: api, bridge: bridge);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(const Key('open-login')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('login-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('login-password')), 'Correct-Horse-9');
    await tester.pump();
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Số điện thoại hoặc mật khẩu không đúng. Vui lòng thử lại.'), findsOneWidget);
    expect(find.byKey(const Key('session-ended')), findsNothing);
    expect(bridge.token, isNull);
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('account-name')), findsOneWidget);
    expect(bridge.token, isNotNull);
    expect(api.to('POST', '/v1/client-auth/login').first.body, contains('"app":"SHIP"'));
  });

  testWidgets('registration has two steps, preserves input and creates an account only after OTP', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installOtpRoutes(api, queued: false);
    await pump(tester, healthy(), api: api);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();

    Future<void> tapVisible(String key) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.tap(find.byKey(Key(key)));
      await tester.pumpAndSettle();
    }

    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn An');
    await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
    await tester.enterText(find.byKey(const Key('register-confirm-password')), 'Wrong-Password');
    await tester.pump();
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('register-confirm-password')), 'Correct-Horse-9');
    await tester.pump();
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull, reason: 'consent is required');
    // No scrolling through the terms is required before consent.
    await tapVisible('register-consent');
    await tapVisible('register-submit');
    expect(find.byKey(const Key('register-otp-phone')), findsOneWidget);
    expect(find.byKey(const Key('register-password')), findsNothing);
    expect(api.to('POST', '/v1/client-auth/register'), isEmpty);

    await tapVisible('register-edit-phone');
    expect(tester.widget<TextField>(find.byKey(const Key('register-phone'))).controller!.text, '0901234567');
    expect(tester.widget<TextField>(find.byKey(const Key('register-name'))).controller!.text, 'Nguyễn An');
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('register-consent'))).value, isTrue);
    await tester.enterText(find.byKey(const Key('register-phone')), '0909999999');
    await tester.pump();
    await tapVisible('register-submit');
    expect(find.text('0909999999'), findsOneWidget);
    expect(api.to('POST', '/v1/auth/phone-verifications').length, 2);
    await tester.enterText(find.byKey(const Key('otp-code')), '000000');
    await tapVisible('otp-verify');
    expect(api.to('POST', '/v1/client-auth/register'), isEmpty);
    await tester.enterText(find.byKey(const Key('otp-code')), '123456');
    await tapVisible('otp-verify');
    expect(api.to('POST', '/v1/client-auth/register').single.body, contains('REGISTER-PROOF-TOKEN-0123456789'));
    expect(find.byKey(const Key('account-name')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('offline then retry recovers', (WidgetTester tester) async {
    bool slow = true;
    await pump(tester, (Uri uri, Duration t) async {
      if (slow) {
        throw const SocketException('x');
      }
      return RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');
    });
    expect(find.text('Không có kết nối mạng'), findsOneWidget);
    slow = false;
    await tester.tap(find.byKey(const Key('connection-retry')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

}
