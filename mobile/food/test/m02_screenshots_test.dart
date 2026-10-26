import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// PNG screenshots of the M02 screens (Q01-Q07, K01-K02) built from the app's own widgets on the fakes. Skipped unless N11_SCREENSHOTS
// names an output directory:  N11_SCREENSHOTS=/tmp/m02-shots flutter test test/m02_screenshots_test.dart
// The dishes and shop names in the shots are fixtures of the fakes; nothing here talks to a server.

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
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  final GlobalKey boundary = GlobalKey();

  Future<void> shot(WidgetTester tester, String name) async {
    final RenderRepaintBoundary object = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => object.toImage(pixelRatio: 2)))!;
    final ByteData? data = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out!).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  testWidgets('M02 screenshots', skip: out == null, (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopOpsServer server = FakeShopOpsServer(api)
      ..reason = 'ONLINE'
      ..hours = <Map<String, Object?>>[
        for (int d = 1; d <= 6; d++) <String, Object?>{'weekday': d, 'start_minute': 1020, 'end_minute': 1380, 'end_day_offset': 0},
        <String, Object?>{'weekday': 7, 'start_minute': 1320, 'end_minute': 120, 'end_day_offset': 1},
      ];
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    final FakeMenuApi menu = FakeMenuApi(
      items: <MenuItem>[
        FakeMenuApi.item('a', 'Ốc hương hấp', 120000, 'c1'),
        FakeMenuApi.item('b', 'Ngao hấp', 60000, 'c2'),
        FakeMenuApi.item('c', 'Ốc móng tay xào tỏi', 135000, 'c1', hidden: true),
        FakeMenuApi.item('d', 'Sò điệp nướng mỡ hành phô mai đặc biệt phần lớn ăn kèm bánh tráng và rau thơm các loại', 180000, 'c2'),
      ],
    );
    final M02Flows flows = createM02Flows(
      session: session,
      location: FakeLocationProvider(),
      menuApi: menu,
      picker: FakeImagePicker(),
      pollEvery: Duration.zero,
    );
    addTearDown(flows.dispose);

    Future<void> screen(Widget widget, String name, {double width = 390, double height = 800}) async {
      tester.view.physicalSize = Size(width * 2, height * 2);
      tester.view.devicePixelRatio = 2;
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildN11Theme(), home: widget),
        ),
      );
      await tester.pumpAndSettle();
      await shot(tester, name);
    }

    addTearDown(tester.view.reset);
    await screen(ShopManageScreen(flows: flows), 'q01-manage');
    await screen(HoursScreen(flows: flows), 'q03-hours');
    await screen(ShopProfileScreen(flows: flows), 'q02-profile');
    await screen(ShopProfileScreen(flows: flows, startEditing: true), 'q02-profile-edit');
    await screen(HourEditorScreen(flows: flows, day: 6), 'q04-editor-sunday');
    await screen(HourEditorScreen(flows: flows, day: null), 'q04-editor-all');
    await screen(MenuListScreen(flows: flows), 'q05-menu');
    await screen(MenuListScreen(flows: flows), 'q05-menu-360', width: 360);
    menu.items.isNotEmpty;
    flows.menu.startEdit('d');
    await screen(DishFormScreen(flows: flows), 'q06-dish-edit');
    await screen(DishFormScreen(flows: flows), 'q06-dish-edit-360', width: 360);
    flows.menu.closeForm();
    flows.menu.startNew();
    await screen(DishFormScreen(flows: flows), 'q06-dish-new');
    flows.menu.closeForm();
    await screen(PreviewScreen(flows: flows), 'q07-preview');
    final ShopMenuView view = ShopMenuView(
      name: 'Ốc 11',
      address: '12 Phố Kim Đồng',
      availabilityReason: 'ONLINE',
      serverNow: DateTime.utc(2026, 10, 14, 11, 30),
      hours: scheduleFromWire(server.hours)!,
      categories: const <PublicCategory>[
        PublicCategory(
          name: 'Ốc',
          items: <PublicItem>[PublicItem(id: 'a', name: 'Ốc hương hấp', priceVnd: 120000, imageUrl: null)],
        ),
        PublicCategory(
          name: 'Hải sản',
          items: <PublicItem>[PublicItem(id: 'b', name: 'Ngao hấp', priceVnd: 60000, imageUrl: null)],
        ),
      ],
    );
    await screen(ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's'), 'k01-shop');
    await screen(PublicHoursScreen(view: view), 'k02-hours');
    await screen(
      MenuListScreen(
        flows: createM02Flows(session: session, location: FakeLocationProvider(), pollEvery: Duration.zero),
      ),
      'q05-not-connected',
    );

    final FakeDiscoveryApi discovery = FakeDiscoveryApi(
      shops: <FakeShopEntry>[
        FakeShopEntry('s1', 'Ốc 11', dishes: const <FakeDishEntry>[FakeDishEntry('d1', 'Ốc hương hấp', 120000, 'c1')]),
        FakeShopEntry('s2', 'Hải Sản Phố Cổ', reason: 'OUTSIDE_BUSINESS_HOURS', dishes: const <FakeDishEntry>[FakeDishEntry('d2', 'Ngao hấp', 60000, 'c2')]),
        FakeShopEntry(
          's3',
          'Quán Ăn Chưa Có Lịch Hoạt Động Tên Rất Dài Để Thử Bố Cục',
          reason: 'NO_BUSINESS_HOURS',
          dishes: const <FakeDishEntry>[FakeDishEntry('d3', 'Mực nướng', 150000, 'c2')],
        ),
      ],
    );
    final DiscoveryController home = DiscoveryController(api: discovery);
    await screen(
      Scaffold(
        body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view)),
      ),
      'kp01-home',
    );
    await screen(
      Scaffold(
        body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view)),
      ),
      'kp01-home-360',
      width: 360,
    );
    await screen(
      Scaffold(
        body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view)),
      ),
      'kp01-home-320',
      width: 320,
    );
    await screen(
      Scaffold(
        body: DiscoveryHome(controller: home, publicApi: FakePublicShopApi(view)),
      ),
      'kp01-home-600',
      width: 600,
    );
    await screen(SearchScreen(api: discovery, publicApi: FakePublicShopApi(view), areaId: 'a1', debounce: Duration.zero), 'kp02-search-empty');
    await screen(
      Scaffold(
        body: Builder(builder: (BuildContext context) => FilterSheet(controller: home)),
      ),
      'kp03-filter',
    );
  });
}
