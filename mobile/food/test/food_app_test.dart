import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const String sha = '0123456789abcdef0123456789abcdef01234567';

const AppConfig config = AppConfig(
  apiBaseUrl: 'https://103.9.78.67.sslip.io',
  appId: 'vn.eleven.food.test',
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

Future<SessionController> pump(WidgetTester tester, HealthTransport transport, {AppConfig cfg = config, FakeApiTransport? api, FakeDeviceBridge? bridge}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport server = api ?? FakeApiTransport();
  if (api == null) {
    installAccountRoutes(server);
  }
  final SessionController session = createSessionController(ClientApp.food, cfg, transport: server, bridge: bridge ?? FakeDeviceBridge());
  await session.start();
  await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(session), config: cfg, transport: transport, pollInterval: Duration.zero));
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
  testWidgets('four tabs in the agreed order, ready banner shown', (WidgetTester tester) async {
    await pump(tester, healthy());
    for (final String label in <String>['Trang chủ', 'Tìm kiếm', 'Đơn hàng', 'Tài khoản']) {
      expect(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)), findsOneWidget, reason: label);
    }
    // Ready is quiet: no banner is shown when the server is fine (the diagnostics screen shows the details).
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

  testWidgets('home shows the approved logo asset, no test banner and no invented shops', (WidgetTester tester) async {
    await pump(tester, healthy());
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    expect(images.any((Image i) => i.image is AssetImage && (i.image as AssetImage).assetName == 'assets/brand/logo-11food-ui.png' && (i.image as AssetImage).package == 'n11_shared'), isTrue);
    expect(find.textContaining('thử nghiệm'), findsNothing);
    expect(find.textContaining('Bản chạy thử'), findsNothing);
    expect(find.text('Chưa có quán để hiển thị'), findsOneWidget);
  });

  testWidgets('account: login and register are open, shop management is locked "not on Android" and grants nothing', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    final Finder login = find.byKey(const Key('open-login'));
    final Finder register = find.byKey(const Key('open-register'));
    expect(tester.widget<N11Button>(login).onPressed, isNotNull);
    expect(tester.widget<N11Button>(register).onPressed, isNotNull);
    expect(find.text('Quản lý cửa hàng'), findsOneWidget);
    expect(find.text(kNotOnAndroidReason), findsWidgets);
    expect(find.textContaining('chờ backend'), findsNothing, reason: texts(tester));
  });

  testWidgets('home guest prompt opens the real login screen; no login without a server address', (WidgetTester tester) async {
    await pump(tester, healthy());
    await tester.tap(find.byKey(const Key('guest-login')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-submit')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('login-submit'))).onPressed, isNull, reason: 'empty form');
  });

  testWidgets('without a server address the account buttons are unavailable and say why', (WidgetTester tester) async {
    await pump(tester, (Uri uri, Duration t) async => const RawHealthResponse(status: 200, body: ''), cfg: const AppConfig());
    await openTab(tester, 'account');
    expect(tester.widget<N11Button>(find.byKey(const Key('open-login'))).onPressed, isNull);
    expect(find.text(kNoServerReason), findsWidgets);
  });

  testWidgets('register (SMS code) -> signed-in account -> profile -> logout, all on the shell', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installOtpRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge();
    await pump(tester, healthy(), api: api, bridge: bridge);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Bản test'), findsNothing);
    expect(find.textContaining('thử nghiệm'), findsNothing);
    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn Văn An');
    await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
    await tester.pump();
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull, reason: 'consent not ticked and phone not verified');
    await tester.ensureVisible(find.byKey(const Key('register-consent')));
    await tester.tap(find.byKey(const Key('register-consent')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('otp-request')));
    await tester.tap(find.byKey(const Key('otp-request')));
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('otp-code')), '123456');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('otp-verify')));
    await tester.tap(find.byKey(const Key('otp-verify')));
    await tester.pump();
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('register-submit')));
    await tester.tap(find.byKey(const Key('register-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('account-name')), findsOneWidget);
    expect(find.text('Nguyễn Văn An'), findsOneWidget);
    expect(bridge.token, isNotNull);
    final String registerBody = api.to('POST', '/v1/client-auth/register').single.body;
    expect(registerBody, contains('verification_token'));
    expect(registerBody, contains('"platform":"ANDROID"'));
    expect(registerBody, contains('"app":"FOOD"'));
    await tester.ensureVisible(find.byKey(const Key('open-logout')));
    await tester.tap(find.byKey(const Key('open-logout')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('logout-confirm')));
    await tester.pumpAndSettle();
    expect(bridge.token, isNull);
    expect(find.byKey(const Key('open-login')), findsOneWidget);
    expect(find.byKey(const Key('logged-out')), findsOneWidget);
  });

  testWidgets('register (REQUIRED, issue #102): the code field appears only after the SMS was SENT; the proof rides in the register body', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installOtpRoutes(api);
    final FakeDeviceBridge bridge = FakeDeviceBridge();
    await pump(tester, healthy(), api: api, bridge: bridge);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('required-note')), findsOneWidget);
    expect(find.byKey(const Key('otp-code')), findsNothing);
    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn Văn An');
    await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
    await tester.ensureVisible(find.byKey(const Key('register-consent')));
    await tester.tap(find.byKey(const Key('register-consent')));
    await tester.pump();
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull, reason: 'the phone is not verified yet');

    await tester.ensureVisible(find.byKey(const Key('otp-request')));
    await tester.tap(find.byKey(const Key('otp-request')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('otp-waiting')), findsOneWidget, reason: 'queued, not sent yet');
    expect(find.byKey(const Key('otp-code')), findsNothing);
    // The first poll (3 s) still says PENDING_DELIVERY, the second one SENT.
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.byKey(const Key('otp-code')), findsNothing);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.byKey(const Key('otp-code')), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull, reason: 'a sent code is not a verified phone');

    await tester.enterText(find.byKey(const Key('otp-code')), '123456');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('otp-verify')));
    await tester.tap(find.byKey(const Key('otp-verify')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('otp-verified')), findsOneWidget);

    // Editing the phone drops the proof and closes the submit again.
    await tester.enterText(find.byKey(const Key('register-phone')), '0909999999');
    await tester.pump();
    expect(find.byKey(const Key('otp-verified')), findsNothing);
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.pump();
    expect(find.byKey(const Key('otp-verified')), findsNothing, reason: 'the proof does not come back by typing the number again');
  });

  testWidgets('account: "Chính sách và điều khoản" opens the real terms and privacy texts, without an account', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    await tester.ensureVisible(find.byKey(const Key('policy-entry')));
    await tester.tap(find.byKey(const Key('policy-entry')));
    await tester.pumpAndSettle();
    expect(find.text(kTermsText), findsOneWidget);
    expect(find.text(kPrivacyText), findsOneWidget);
    expect(find.textContaining('thử nghiệm'), findsNothing);
  });

  testWidgets('offline then retry recovers', (WidgetTester tester) async {
    bool online = false;
    await pump(tester, (Uri uri, Duration t) async {
      if (!online) {
        throw const SocketException('down');
      }
      return RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');
    });
    expect(find.text('Không có kết nối mạng'), findsOneWidget);
    online = true;
    await tester.tap(find.byKey(const Key('connection-retry')));
    await tester.pump();
    await tester.pump();
    expect(find.text('Không có kết nối mạng'), findsNothing, reason: texts(tester));
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

  testWidgets('backend not ready (503) is told apart from offline', (WidgetTester tester) async {
    await pump(tester, (Uri uri, Duration t) async => uri.path == kLivePath ? const RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}') : const RawHealthResponse(status: 503, body: ''));
    expect(find.text('Máy chủ chưa sẵn sàng'), findsOneWidget);
  });

  testWidgets('missing API_BASE_URL says so and makes no request', (WidgetTester tester) async {
    int calls = 0;
    await pump(tester, (Uri uri, Duration t) async {
      calls++;
      return const RawHealthResponse(status: 200, body: '');
    }, cfg: const AppConfig());
    expect(find.text('Chưa cấu hình địa chỉ máy chủ'), findsOneWidget);
    expect(calls, 0);
  });

  testWidgets('search text survives switching tabs and opening diagnostics', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'search');
    await tester.enterText(find.byKey(const Key('search-field')), 'phở');
    await tester.pump();
    await openTab(tester, 'orders');
    await openTab(tester, 'search');
    expect(find.text('phở'), findsOneWidget);
    expect(find.text('Chưa tìm được kết quả'), findsOneWidget);
    await tester.tap(find.byKey(const Key('search-clear')));
    await tester.pump();
    expect(find.text('phở'), findsNothing);
  });

  testWidgets('diagnostics screen shows version, source SHA and both probes; back returns', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    await tester.ensureVisible(find.text('Chẩn đoán kết nối'));
    await tester.tap(find.text('Chẩn đoán kết nối'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('0.1.0'), findsWidgets, reason: texts(tester));
    expect(find.textContaining(sha.substring(0, 12)), findsWidgets);
    expect(find.textContaining('Còn sống'), findsWidgets);
    expect(find.textContaining('Sẵn sàng'), findsWidgets);
    expect(find.byKey(const Key('diag-recheck')), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(find.byKey(const Key('diag-recheck')), findsNothing);
  });
}
