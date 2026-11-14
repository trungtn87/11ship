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
  appId: 'vn.eleven.ship',
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
    expect(find.text('Chưa xác định trạng thái hoạt động'), findsOneWidget);
    expect(find.text(kOnlineReason), findsOneWidget);
    expect(find.textContaining('320.000'), findsNothing);
    expect(find.byKey(const Key('home-map-unavailable')), findsOneWidget);
    expect(find.textContaining('trong M01'), findsNothing);
    expect(find.text('Chưa bật chia sẻ vị trí'), findsNothing, reason: 'no separate sharing control or status while there is nothing to say');
    expect(find.byKey(const Key('home-gps-status')), findsNothing);
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
    // S03 guest (Owner 14/11): process card and sign-in actions only; no income figures, no transactions.
    expect(find.byKey(const Key('driver-process-card')), findsOneWidget);
    expect(find.text('Tổng thu nhập'), findsNothing);
    expect(find.text('Giao dịch gần đây'), findsNothing);
    expect(find.byKey(const Key('income-guest-login')), findsOneWidget);
    await openTab(tester, 'notifications');
    expect(find.text('Đăng nhập để xem thông báo của bạn.'), findsOneWidget);
    expect(find.textContaining('₫'), findsNothing);
  });

  testWidgets('S05 guest: "Đăng ký làm shipper" and the process entry; no "Hồ sơ shipper" row', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    expect(find.byKey(const Key('driver-process-entry')), findsOneWidget);
    expect(find.text('Quy trình & quyền lợi tài xế 11Ship'), findsOneWidget);
    expect(find.text('Đăng ký · Duyệt hồ sơ · Nhận đơn'), findsOneWidget);
    expect(find.byKey(const Key('driver-register-note-account')), findsOneWidget);
    expect(find.text('Đăng ký làm shipper'), findsOneWidget);
    // Outlined brand-yellow button with dark text (not a solid yellow fill).
    expect(tester.widget<N11Button>(find.byKey(const Key('open-register'))).kind, ButtonKind.outline);
    expect(find.text('Hồ sơ shipper'), findsNothing);
    // The register action opens the account registration with the 11Ship brand (not a shipper approval).
    await tester.ensureVisible(find.byKey(const Key('open-register')));
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();
    expect(find.byType(RegisterScreen), findsOneWidget);
  });

  testWidgets('S03 guest card: exact process copy and the account-vs-approval note', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'income');
    expect(find.text(kDriverProcessTitle), findsOneWidget);
    expect(find.text(kDriverProcessText), findsOneWidget);
    expect(find.text(kDriverProcessSteps), findsOneWidget);
    expect(find.text(kDriverRegisterNote), findsOneWidget);
    expect(find.textContaining('thu nhập', findRichText: true), findsWidgets);
    // No income figures or commission/benefit amounts for guests.
    expect(find.textContaining('%'), findsNothing);
    expect(find.textContaining('₫'), findsNothing);
  });

  testWidgets('S01 guest: no "Bật định vị ngay" button (its behaviour is a separate PR); gradient header and receiving area still shown', (WidgetTester tester) async {
    await pump(tester, healthy());
    expect(find.text('Bật định vị ngay'), findsNothing);
    // First screen at 390x844: the map panel starts above the bottom navigation (about y 730), so its label is on the first screen.
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    await tester.pump();
    await tester.pump();
    expect(tester.getTopLeft(find.byKey(const Key('home-v5-map-panel'))).dy, lessThan(730));
    expect(find.byKey(const Key('ship-home-header')), findsOneWidget);
    expect(find.text('Khu vực nhận đơn'), findsOneWidget);
  });

  testWidgets('S02 offline orders: "Về trang chủ" switches to the Home tab', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    expect(find.byKey(const Key('orders-home')), findsOneWidget);
    await tester.tap(find.byKey(const Key('orders-home')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('ship-home-scroll')), findsOneWidget);
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
  testWidgets('M06 (#257): orders show no separate offer or batching entry and no "not ready" block', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    expect(find.byKey(const Key('m06-offer-entry')), findsNothing);
    expect(find.byKey(const Key('m06-batch-entry')), findsNothing);
    expect(find.textContaining('Chưa sẵn sàng'), findsNothing);
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
    await tapVisible('register-submit');
    expect(find.text('Mật khẩu nhập lại chưa khớp.'), findsOneWidget);
    expect(api.to('POST', '/v1/auth/phone-verifications'), isEmpty);
    await tester.enterText(find.byKey(const Key('register-confirm-password')), 'Correct-Horse-9');
    await tester.pump();
    await tapVisible('register-submit');
    expect(find.text('Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật.'), findsOneWidget);
    expect(api.to('POST', '/v1/auth/phone-verifications'), isEmpty);
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
