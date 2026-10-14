import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Writes PNG screenshots of the main 11Food M01 screens, built from the same widgets as the app on the fake server. It is skipped
// unless N11_SCREENSHOTS names an output directory:
//   N11_SCREENSHOTS=/tmp/food-shots flutter test test/screenshots_test.dart
// The shots show fixture data of the fakes (names, numbers); nothing here talks to a server.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

void main() {
  final String? out = Platform.environment['N11_SCREENSHOTS'];

  setUpAll(() async {
    if (out == null) {
      return;
    }
    final FontLoader loader = FontLoader('packages/n11_shared/PlusJakartaSans');
    for (final String w in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      final Uint8List bytes = File('../packages/n11_shared/assets/fonts/PlusJakartaSans-$w.ttf').readAsBytesSync();
      loader.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
  });

  final GlobalKey boundary = GlobalKey();

  Future<void> shot(WidgetTester tester, String name) async {
    final RenderRepaintBoundary object = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => object.toImage(pixelRatio: 2)))!;
    final ByteData? data = (await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png)));
    Directory(out!).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(720, 1480);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpApp(WidgetTester tester, SessionController session, AppFlows flows) async {
    await tester.pumpWidget(RepaintBoundary(key: boundary, child: N11App(brand: foodBrand, tabs: buildFoodTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero)));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('screenshots', skip: out == null, (WidgetTester tester) async {
    phone(tester);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopServer server = FakeShopServer(api);
    installResetRoutes(api);
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    final FakeLocationProvider gps = FakeLocationProvider();
    final AppFlows flows = createFlows(ClientApp.food, session, config, transport: api, location: gps);
    await session.start();

    // Guest: home, welcome (account tab), login, login error, register, reset
    await pumpApp(tester, session, flows);
    await shot(tester, '01-home-guest');
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await shot(tester, '02-welcome');
    await tester.tap(find.byKey(const Key('open-login')));
    await tester.pumpAndSettle();
    await shot(tester, '03-login');
    await tester.enterText(find.byKey(const Key('login-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('login-password')), 'wrong-password-1');
    await tester.pump();
    api.routes['POST /v1/client-auth/login'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'INVALID_CREDENTIALS');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    await shot(tester, '04-login-error');
    await tester.ensureVisible(find.byKey(const Key('to-reset')));
    await tester.tap(find.byKey(const Key('to-reset')));
    await tester.pumpAndSettle();
    await shot(tester, '05-reset');
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('to-register')));
    await tester.tap(find.byKey(const Key('to-register')));
    await tester.pumpAndSettle();
    await shot(tester, '06-register');

    // Signed in: account, shop flow
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    installAccountRoutes(api);
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await pumpApp(tester, session, flows);
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await shot(tester, '07-account');
    await tester.tap(find.byKey(const Key('shop-entry')));
    await tester.pumpAndSettle();
    await shot(tester, '08-shop-empty');
    await tester.tap(find.byKey(const Key('shop-register')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('shop-name')), 'Cơm tấm Cô Ba');
    await tester.enterText(find.byKey(const Key('shop-phone')), '0912345678');
    await tester.enterText(find.byKey(const Key('shop-address')), '12 Nguyễn Huệ, Q.1, TP.HCM');
    await tester.pump();
    await shot(tester, '09-shop-form');
    await tester.ensureVisible(find.byKey(const Key('shop-locate')));
    await tester.tap(find.byKey(const Key('shop-locate')));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(SingleChildScrollView).last, const Offset(0, -900));
    await tester.pumpAndSettle();
    await shot(tester, '10-shop-form-gps');
    expect(server.puts, isEmpty);
  });
}
