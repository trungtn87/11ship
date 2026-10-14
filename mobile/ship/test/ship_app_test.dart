import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';

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
    for (final String label in <String>['Trang chủ', 'Đơn hàng', 'Thu nhập', 'Ví', 'Tài khoản']) {
      expect(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)), findsOneWidget, reason: label);
    }
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    expect(images.any((Image i) => i.image is AssetImage && (i.image as AssetImage).assetName == 'assets/brand/logo-11ship-ui.png'), isTrue);
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

  testWidgets('online switch is disabled: no GPS, no fake status', (WidgetTester tester) async {
    await pump(tester, healthy());
    final Switch s = tester.widget<Switch>(find.byKey(const Key('online-switch')));
    expect(s.onChanged, isNull);
    expect(s.value, isFalse);
  });

  testWidgets('income and wallet show unknown "—", never 0 or a balance', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'income');
    expect(find.text('—'), findsOneWidget);
    expect(find.text('Chưa có dữ liệu thu nhập'), findsOneWidget);
    await openTab(tester, 'wallet');
    expect(find.text('—'), findsOneWidget);
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
  testWidgets('account: login/register are open, the driver profile is locked "not on Android", diagnostics reachable with SHA', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    expect(tester.widget<N11Button>(find.byKey(const Key('open-login'))).onPressed, isNotNull);
    expect(tester.widget<N11Button>(find.byKey(const Key('open-register'))).onPressed, isNotNull);
    expect(find.text('Hồ sơ xế'), findsOneWidget);
    expect(find.text(kNotOnAndroidReason), findsWidgets);
    await tester.ensureVisible(find.text('Chẩn đoán kết nối'));
    await tester.tap(find.text('Chẩn đoán kết nối'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining(sha.substring(0, 12)), findsWidgets, reason: texts(tester));
    expect(find.textContaining('Còn sống'), findsWidgets);
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
}
