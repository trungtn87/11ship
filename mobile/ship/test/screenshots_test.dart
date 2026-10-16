import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ship/ship_tabs.dart';
import 'package:ship/ship_home.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Writes PNG screenshots of the main 11Ship M01 screens, built from the same widgets as the app on the fake server. It is skipped
// unless N11_SCREENSHOTS names an output directory:
//   N11_SCREENSHOTS=/tmp/ship-shots flutter test test/screenshots_test.dart
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
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
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
    await tester.pumpWidget(RepaintBoundary(key: boundary, child: N11App(brand: shipBrand, tabs: buildShipTabs(session, flows: flows), config: config, transport: healthy(), pollInterval: Duration.zero)));
    await tester.pump();
    await tester.runAsync(() => precacheImage(const AssetImage('assets/brand/logo-11ship-ui.png', package: 'n11_shared'), tester.element(find.byType(N11App))));
    await tester.pump();
  }

  testWidgets('screenshots', skip: out == null, (WidgetTester tester) async {
    phone(tester);
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installOtpRoutes(api, queued: false);
    installResetRoutes(api);
    FakeDriverServer(api);
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
    final AppFlows flows = createFlows(ClientApp.ship, session, config, transport: api, location: FakeLocationProvider());
    await session.start();
    await pumpApp(tester, session, flows);
    await shot(tester, '01-home-guest');
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await shot(tester, '02-welcome');
    await tester.tap(find.byKey(const Key('open-register')));
    await tester.pumpAndSettle();
    await shot(tester, '03-register');
    await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
    await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn An');
    await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
    await tester.enterText(find.byKey(const Key('register-confirm-password')), 'Correct-Horse-9');
    await tester.ensureVisible(find.byKey(const Key('register-consent')));
    await tester.tap(find.byKey(const Key('register-consent')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('register-submit')));
    await shot(tester, '03a-register-consent');
    await tester.tap(find.byKey(const Key('register-submit')));
    await tester.pumpAndSettle();
    await shot(tester, '03b-register-otp');
    await tester.tap(find.byKey(const Key('register-edit-phone')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await pumpApp(tester, session, flows);
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await shot(tester, '04-account');
    await tester.ensureVisible(find.byKey(const Key('open-change-password')));
    await tester.tap(find.byKey(const Key('open-change-password')));
    await tester.pumpAndSettle();
    await shot(tester, '04b-change-password');
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('driver-entry')));
    await tester.pumpAndSettle();
    await shot(tester, '05-driver-form');
    // Full Online layout under fixture rendering only; not an online session.
    final List<TabSpec> tabs = buildShipTabs(session, flows: flows);
    await tester.pumpWidget(RepaintBoundary(
      key: boundary,
      child: N11App(
        key: const ValueKey<String>('online-visual-app'),
        brand: shipBrand,
        config: config,
        transport: healthy(),
        pollInterval: Duration.zero,
        tabs: <TabSpec>[
          TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', fullBleed: true, showAppBar: false,
            body: (BuildContext context, ShellActions actions) => ShipHomeLayout(online: true, reason: kOnlineReason, onNotifications: () => actions.goTab('notifications'))),
          ...tabs.skip(1),
        ],
      ),
    ));
    await tester.pumpAndSettle();
    await shot(tester, '06-home-online-visual-only');
  });
}
