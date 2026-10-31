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

Future<void> registrationDetails(WidgetTester tester) async {
  expect(find.byKey(const Key('register-phone')), findsNothing);
  expect(find.byKey(const Key('otp-request')), findsNothing);
  await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn Văn An');
  await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
  await tester.enterText(find.byKey(const Key('register-confirm')), 'not-matching');
  await tester.ensureVisible(find.byKey(const Key('register-consent')));
  await tester.tap(find.byKey(const Key('register-consent')));
  await tester.pump();
  await tester.ensureVisible(find.byKey(const Key('register-next')));
  await tester.tap(find.byKey(const Key('register-next')));
  await tester.pumpAndSettle();
  expect(find.text('Mật khẩu nhập lại chưa khớp.'), findsOneWidget);
  expect(find.byKey(const Key('purpose-customer')), findsNothing);
  await tester.enterText(find.byKey(const Key('register-confirm')), 'Correct-Horse-9');
  await tester.pump();
  await tester.ensureVisible(find.byKey(const Key('register-next')));
  await tester.tap(find.byKey(const Key('register-next')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('purpose-customer')));
  await tester.pump();
  await tester.tap(find.byKey(const Key('purpose-next')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
  await tester.pump();
}

void main() {
  testWidgets('nested tab navigation keeps one bottom bar and a tab tap returns to its root', (WidgetTester tester) async {
    await tester.pumpWidget(N11App(
      brand: foodBrand,
      config: config,
      transport: healthy(),
      pollInterval: Duration.zero,
      keepBottomNavOnChildRoutes: true,
      tabs: <TabSpec>[
        TabSpec(
          id: 'home',
          label: 'Trang chá»§',
          icon: Icons.home_outlined,
          title: 'Trang chá»§',
          body: (BuildContext context, ShellActions actions) => TextButton(
            key: const Key('open-child'),
            onPressed: () => Navigator.of(context).push(n11Route(const Scaffold(body: Text('Trang con')))),
            child: const Text('Má»Ÿ trang con'),
          ),
        ),
        TabSpec(id: 'orders', label: 'ÄÆ¡n hÃ ng', icon: Icons.receipt_outlined, title: 'ÄÆ¡n hÃ ng', body: (_, __) => const Text('Gá»‘c Ä‘Æ¡n hÃ ng')),
      ],
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-child')));
    await tester.pumpAndSettle();
    expect(find.text('Trang con'), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
    await tester.tap(find.byKey(const Key('tab-home')));
    await tester.pumpAndSettle();
    expect(find.text('Trang con'), findsNothing);
    expect(find.byKey(const Key('open-child')), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
  });

  testWidgets('four tabs for a guest (Gọi ship included) in the agreed order, ready banner shown', (WidgetTester tester) async {
    await pump(tester, healthy());
    for (final String label in <String>['Trang chủ', 'Đơn hàng', 'Gọi ship', 'Tài khoản']) {
      expect(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)), findsOneWidget, reason: label);
    }
    // Ready is quiet: no banner is shown when the server is fine (the diagnostics screen shows the details).
    expect(find.byKey(const Key('connection-banner')), findsNothing);
  });

  testWidgets('back preserves details and purpose; owner UI comes only from server identity', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final SessionController session = await pump(tester, healthy(), api: api);
    await openTab(tester, 'account');
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();
    await registrationDetails(tester);
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('purpose-owner')));
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byKey(const Key('register-name'))).controller!.text, 'Nguyễn Văn An');
    expect(tester.widget<TextField>(find.byKey(const Key('register-confirm'))).controller!.text, 'Correct-Horse-9');
    await tester.ensureVisible(find.byKey(const Key('register-next')));
    await tester.tap(find.byKey(const Key('register-next')));
    await tester.pumpAndSettle();
    expect(tester.widget<ListTile>(find.byKey(const Key('purpose-owner'))).selected, isTrue);
    expect(buildFoodTabs(session).map((TabSpec tab) => tab.id), <String>['home', 'orders', 'call', 'account']);
    expect(api.to('POST', '/v1/client-auth/register'), isEmpty);
  });

  test('owner tab follows server role/profile and never changes context', () async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopServer server = FakeShopServer(api);
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    expect(buildFoodTabs(session).map((TabSpec tab) => tab.id), <String>['home', 'orders', 'call', 'account']);
    server.owner = true;
    await session.refreshIdentity();
    expect(buildFoodTabs(session).map((TabSpec tab) => tab.id), <String>['home', 'orders', 'call', 'shop', 'account']);
    expect(server.contexts, isEmpty);
  });

  testWidgets('home shows the approved logo asset, no test banner and no invented shops', (WidgetTester tester) async {
    await pump(tester, healthy());
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    expect(images.any((Image i) => i.image is AssetImage && (i.image as AssetImage).assetName == 'assets/brand/logo-11food-ui.png' && (i.image as AssetImage).package == 'n11_shared'), isTrue);
    expect(find.textContaining('thử nghiệm'), findsNothing);
    expect(find.textContaining('Bản chạy thử'), findsNothing);
    expect(find.text('Danh sách quán chưa sẵn sàng'), findsOneWidget);
  });

  testWidgets('account: login and register are open, shop management is locked "not on Android" and grants nothing', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    final Finder login = find.byKey(const Key('open-login'));
    final Finder register = find.byKey(const Key('open-register'));
    expect(tester.widget<N11Button>(login).onPressed, isNotNull);
    expect(tester.widget<N11Button>(register).onPressed, isNotNull);
    expect(find.text('Quản lý cửa hàng'), findsNothing);
    expect(find.text('Chẩn đoán kết nối'), findsNothing);
    expect(find.textContaining('chờ backend'), findsNothing, reason: texts(tester));
  });

  testWidgets('orders guest prompt opens the real login screen; no login without a server address', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    await tester.tap(find.byKey(const Key('guest-login')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-submit')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('login-submit')));
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Nhập số điện thoại.'), findsOneWidget);
    expect(find.text('Nhập mật khẩu.'), findsOneWidget);
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
    await registrationDetails(tester);
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
    expect(find.byKey(const Key('logged-out')), findsNothing, reason: 'a confirmed logout shows no banner');
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
    await registrationDetails(tester);
    expect(find.byKey(const Key('otp-code')), findsNothing);
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull);
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

    await tester.ensureVisible(find.byKey(const Key('otp-change-phone')));
    await tester.tap(find.byKey(const Key('otp-change-phone')));
    await tester.pump();
    // Editing the phone drops the proof and closes the submit again.
    await tester.enterText(find.byKey(const Key('register-phone')), '0909999999');
    await tester.pump();
    expect(find.byKey(const Key('otp-verified')), findsNothing);
    expect(tester.widget<N11Button>(find.byKey(const Key('register-submit'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.pump();
    expect(find.byKey(const Key('otp-verified')), findsNothing, reason: 'the proof does not come back by typing the number again');
  });

  testWidgets('account omits removed groups and rows', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    for (final String label in <String>['Trạng thái tài khoản', 'Quản lý cửa hàng', 'Chính sách và điều khoản', 'Chẩn đoán kết nối', 'Trạng thái', 'Cửa hàng']) {
      expect(find.text(label), findsNothing);
    }
    expect(find.text('Trợ giúp'), findsOneWidget);
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

  testWidgets('Home is the discovery: shops from the server, search opens from Home (no search tab), a shop opens its menu', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final FakeApiTransport server = FakeApiTransport();
    installAccountRoutes(server);
    final SessionController session = createSessionController(ClientApp.food, config, transport: server, bridge: FakeDeviceBridge());
    final FakeDiscoveryApi discovery = FakeDiscoveryApi(shops: <FakeShopEntry>[FakeShopEntry('s1', 'Ốc 11', dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương hấp', 120000, 'c1')])]);
    final AppFlows flows = createFlows(ClientApp.food, session, config, transport: server, location: FakeLocationProvider(), discoveryApi: discovery, publicApi: FakePublicShopApi(null));
    await session.start();
    await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tab-search')), findsNothing);
    expect(find.text('Ốc 11'), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-search')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('search-field')), 'oc 11');
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.byKey(const Key('result-shop-s1')), findsOneWidget);
  });

  testWidgets('M06 (#257): the orders tab has no separate "Phí giao hàng" entry or "not ready" block', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'orders');
    expect(find.byKey(const Key('m06-fee-entry')), findsNothing);
    expect(find.textContaining('Chưa sẵn sàng'), findsNothing);
  });
}
