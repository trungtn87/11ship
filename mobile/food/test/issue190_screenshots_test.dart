import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// PNG renders of the issue #190 screens (setup checklist x/4, the "ready" message, the shop page with quick contact, Home with road distances),
// built from the app's own widgets on the fakes. Skipped unless N11_SCREENSHOTS names an output directory. Fixture data, not device acceptance.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

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
    final ByteData? data = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out!).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  testWidgets('issue 190 screenshots', skip: out == null, (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopOpsServer server = FakeShopOpsServer(api)..reason = 'NO_BUSINESS_HOURS';
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    final M02Flows flows = createM02Flows(session: session, location: FakeLocationProvider(), menuApi: FakeMenuApi(), picker: FakeImagePicker(), pollEvery: Duration.zero);
    addTearDown(flows.dispose);

    Future<void> screen(Widget widget, String name, {double width = 390, double height = 800}) async {
      tester.view.physicalSize = Size(width * 2, height * 2);
      tester.view.devicePixelRatio = 2;
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(RepaintBoundary(key: boundary, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildN11Theme(), home: widget)));
      await tester.pumpAndSettle();
      await shot(tester, name);
    }

    addTearDown(tester.view.reset);
    // 2/4: the account and the GPS point exist; the schedule and the first dish do not.
    await screen(ShopManageScreen(flows: flows), 'setup-1-two-of-four', height: 1100);
    // 3/4: the owner set the schedule.
    server.hours = <Map<String, Object?>>[for (int d = 1; d <= 7; d++) <String, Object?>{'weekday': d, 'start_minute': 1020, 'end_minute': 1380, 'end_day_offset': 0}];
    await flows.setup.refresh();
    await flows.ops.refresh();
    await screen(ShopManageScreen(flows: flows), 'setup-2-three-of-four', height: 1100);
    // The server activates the shop (the first dish with a picture exists): the message, once, and no checklist any more.
    server
      ..hasSellableDish = true
      ..reason = 'ONLINE';
    await flows.setup.refresh();
    await flows.ops.refresh();
    await screen(ShopManageScreen(flows: flows), 'setup-3-ready');

    final ShopMenuView view = ShopMenuView(
      name: 'Ốc 11',
      address: '12 Phố Kim Đồng, Cao Bằng',
      availabilityReason: 'ONLINE',
      serverNow: DateTime.utc(2026, 10, 25, 3),
      hours: scheduleFromWire(server.hours)!,
      contact: const ShopContact(phone: '+84912345678', zaloUrl: 'https://zalo.me/0912345678', messengerUrl: 'https://m.me/quan.oc.11'),
      categories: const <PublicCategory>[
        PublicCategory(name: 'Ốc', items: <PublicItem>[PublicItem(id: 'a', name: 'Ốc hương hấp', priceVnd: 120000, imageUrl: null)]),
      ],
    );
    await screen(ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's', contactLauncher: FakeContactLauncher()), 'shop-quick-contact');
    await screen(ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's', contactLauncher: FakeContactLauncher()), 'shop-quick-contact-360', width: 360);

    final FakeDiscoveryApi discovery = FakeDiscoveryApi(shops: <FakeShopEntry>[
      FakeShopEntry('s1', 'Ốc 11', latitude: 10.02, longitude: 106.05, dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương hấp', 120000, 'c1')]),
      FakeShopEntry('s2', 'Hải Sản Phố Cổ', reason: 'OUTSIDE_BUSINESS_HOURS', latitude: 10.03, longitude: 106.06, dishes: const <FakeDishEntry>[FakeDishEntry('d2', 'Ngao hấp', 60000, 'c2')]),
      FakeShopEntry('s3', 'Bún Chả Hà Nội', latitude: 10.04, longitude: 106.07, dishes: const <FakeDishEntry>[FakeDishEntry('d3', 'Bún chả', 45000, 'c2')]),
    ])
      ..roads = <String, int?>{'s1': 3400, 's2': null, 's3': 12800}
      ..areaResolver = (double lat, double lng) async => const AreaChoice(id: 'a1', name: 'Cao Bằng');
    final DiscoveryController home = DiscoveryController(api: discovery, position: DiscoveryPosition(provider: FakeLocationProvider()));
    addTearDown(home.dispose);
    await screen(Scaffold(body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view))), 'home-road-distance');
    await screen(Scaffold(body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view))), 'home-road-distance-360', width: 360);
  });
}
