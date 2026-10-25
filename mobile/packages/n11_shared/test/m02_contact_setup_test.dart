import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #190: the quick contact on the shop page (B) and the setup checklist x/4 (section 1).

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

ShopMenuView viewWith(ShopContact contact, {String reason = 'ONLINE'}) => ShopMenuView(
      name: 'Ốc 11',
      address: '12 Phố Kim Đồng',
      availabilityReason: reason,
      serverNow: DateTime.utc(2026, 10, 25, 3),
      hours: emptyWeek(),
      contact: contact,
      categories: const <PublicCategory>[PublicCategory(name: 'Ốc', items: <PublicItem>[PublicItem(id: 'd1', name: 'Ốc hương hấp', priceVnd: 120000, imageUrl: null)])],
    );

Future<void> pumpShop(WidgetTester tester, ShopMenuView view, ContactLauncher launcher) async {
  tester.view.physicalSize = const Size(390 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's1', contactLauncher: launcher)));
  await tester.pumpAndSettle();
}

void main() {
  group('ShopContact', () {
    test('keeps a valid phone and https links on the fixed hosts; anything else is dropped on its own, nothing is guessed', () {
      final ShopContact ok = ShopContact.fromWire(<String, Object?>{'phone': '+84912345678', 'zalo_url': 'https://zalo.me/0912345678', 'messenger_url': 'https://m.me/quan.oc.11', 'facebook_url': 'https://www.facebook.com/quan.oc.11'});
      expect(ok.phone, '+84912345678');
      expect(ok.phoneText, '0912 345 678');
      expect(ok.zaloUrl, 'https://zalo.me/0912345678');
      expect(ok.messengerUrl, 'https://m.me/quan.oc.11');
      expect(ShopContact.fromWire(<String, Object?>{'facebook_url': 'https://www.facebook.com/profile.php?id=100012345678901'}).facebookUrl, 'https://www.facebook.com/profile.php?id=100012345678901');
      for (final String bad in <String>['javascript:alert(1)', 'http://zalo.me/0912345678', 'https://zalo.me.evil.example/0912345678', 'https://evil.example/zalo.me/0912345678', 'https://user@zalo.me/0912345678', 'https://zalo.me:8443/0912345678', 'https://zalo.me/a/b', 'https://zalo.me/0912345678#x', 'https://zalo.me/0912345678?x=1', ' https://zalo.me/0912345678', 'intent://zalo.me/#Intent;end', '']) {
        expect(ShopContact.fromWire(<String, Object?>{'zalo_url': bad}).zaloUrl, isNull, reason: bad);
      }
      expect(ShopContact.fromWire(<String, Object?>{'messenger_url': 'https://www.facebook.com/quan'}).messengerUrl, isNull);
      expect(ShopContact.fromWire(<String, Object?>{'phone': '0912345678'}).phone, isNull);
      expect(ShopContact.fromWire(<String, Object?>{'phone': '+8491234567'}).phone, isNull);
      for (final Object? bad in <Object?>[null, 'x', 5, <Object?>[], <String, Object?>{'phone': 5, 'zalo_url': 5}]) {
        expect(ShopContact.fromWire(bad).isEmpty, isTrue);
      }
    });

    test('HttpPublicShopApi reads the contact and never fails because of it (an older server sends none)', () async {
      final FakeApiTransport transport = FakeApiTransport();
      final HttpPublicShopApi api = HttpPublicShopApi(transport: transport, base: Uri.parse('https://api.example.test'));
      Map<String, Object?> body(Object? contact) => <String, Object?>{
            'data': <String, Object?>{
              'shop_id': 's1', 'name': 'Ốc 11', 'address_text': 'x', 'timezone': 'Asia/Ho_Chi_Minh',
              'availability': <String, Object?>{'online': true, 'reason': 'ONLINE', 'evaluated_at': '2026-10-25T03:00:00.000Z'},
              'hours': <Object?>[], 'categories': <Object?>[],
              if (contact != 'absent') 'contact': contact,
            },
          };
      transport.routes['GET /v1/shops/s1'] = (_, __, ___, ____) async => json(200, body(<String, Object?>{'phone': '+84912345678', 'zalo_url': null, 'messenger_url': 'https://m.me/quan.oc.11', 'facebook_url': null}));
      final ShopMenuView full = await api.load('s1');
      expect(full.contact.phone, '+84912345678');
      expect(full.contact.zaloUrl, isNull);
      expect(full.contact.messengerUrl, 'https://m.me/quan.oc.11');
      transport.routes['GET /v1/shops/s1'] = (_, __, ___, ____) async => json(200, body('absent'));
      expect((await api.load('s1')).contact.isEmpty, isTrue);
      transport.routes['GET /v1/shops/s1'] = (_, __, ___, ____) async => json(200, body('garbage'));
      expect((await api.load('s1')).contact.isEmpty, isTrue);
    });
  });

  group('ShopPublicScreen contact bar', () {
    testWidgets('shows the shop phone and Gọi điện / Zalo / Messenger only for data that exists; Gọi điện opens the dialer with the shop number', (WidgetTester tester) async {
      final FakeContactLauncher launcher = FakeContactLauncher();
      await pumpShop(tester, viewWith(const ShopContact(phone: '+84912345678', zaloUrl: 'https://zalo.me/0912345678', messengerUrl: 'https://m.me/quan.oc.11')), launcher);
      expect(find.text('Điện thoại quán: 0912 345 678'), findsOneWidget);
      expect(find.byKey(const Key('shop-contact-call')), findsOneWidget);
      expect(find.byKey(const Key('shop-contact-zalo')), findsOneWidget);
      expect(find.byKey(const Key('shop-contact-messenger')), findsOneWidget);
      await tester.tap(find.byKey(const Key('shop-contact-call')));
      await tester.tap(find.byKey(const Key('shop-contact-zalo')));
      await tester.tap(find.byKey(const Key('shop-contact-messenger')));
      await tester.pumpAndSettle();
      expect(launcher.dialed, <String>['+84912345678']);
      expect(launcher.opened, <String>['https://zalo.me/0912345678', 'https://m.me/quan.oc.11']);
    });

    testWidgets('a missing field hides only its own button; no contact at all draws no bar and no crash', (WidgetTester tester) async {
      await pumpShop(tester, viewWith(const ShopContact(phone: '+84912345678')), FakeContactLauncher());
      expect(find.byKey(const Key('shop-contact-call')), findsOneWidget);
      expect(find.byKey(const Key('shop-contact-zalo')), findsNothing);
      expect(find.byKey(const Key('shop-contact-messenger')), findsNothing);
      await pumpShop(tester, viewWith(ShopContact.none), FakeContactLauncher());
      expect(find.byKey(const Key('shop-contact-phone')), findsNothing);
      expect(find.byKey(const Key('shop-contact-call')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an app that cannot be opened (or a launcher that fails) does not crash: the value is copied and the person is told', (WidgetTester tester) async {
      final List<MethodCall> clipboard = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (MethodCall call) async {
        clipboard.add(call);
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      final FakeContactLauncher launcher = FakeContactLauncher()..result = false;
      await pumpShop(tester, viewWith(const ShopContact(phone: '+84912345678', zaloUrl: 'https://zalo.me/0912345678')), launcher);
      await tester.tap(find.byKey(const Key('shop-contact-zalo')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('Không mở được Zalo'), findsOneWidget);
      expect(clipboard.where((MethodCall c) => c.method == 'Clipboard.setData').single.arguments, <String, Object?>{'text': 'https://zalo.me/0912345678'});
      expect(tester.takeException(), isNull);
    });

    testWidgets('a launcher that throws is the same: no crash, the number is copied', (WidgetTester tester) async {
      final List<MethodCall> clipboard = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (MethodCall call) async {
        clipboard.add(call);
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await pumpShop(tester, viewWith(const ShopContact(phone: '+84912345678')), FakeContactLauncher()..throwing = true);
      await tester.tap(find.byKey(const Key('shop-contact-call')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('Không mở được ứng dụng gọi điện'), findsOneWidget);
      expect(clipboard.where((MethodCall c) => c.method == 'Clipboard.setData').single.arguments, <String, Object?>{'text': '+84912345678'});
      expect(tester.takeException(), isNull);
    });

    testWidgets('the owner\'s own preview never shows quick-contact buttons (it is the menu as customers see it)', (WidgetTester tester) async {
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: SingleChildScrollView(child: ShopMenuContent(view: viewWith(const ShopContact(phone: '+84912345678')), preview: true, onHours: () {})))));
      expect(find.byKey(const Key('shop-contact-call')), findsNothing);
    });
  });

  group('ShopSetup', () {
    Map<String, Object?> body({int done = 2, String state = 'INCOMPLETE', bool isPublic = false, Object? request, Object? lock}) => <String, Object?>{
          'shop_id': 'x', 'status': 'ACTIVE', 'version': 2, 'state': state, 'completed_steps': done, 'total_steps': 4,
          'steps': <Object?>[
            <String, Object?>{'key': 'ACCOUNT', 'done': true, 'missing': <String>[]},
            <String, Object?>{'key': 'SHOP_INFO', 'done': done > 2, 'missing': done > 2 ? <String>[] : <String>['BUSINESS_HOURS']},
            <String, Object?>{'key': 'LOCATION', 'done': true, 'missing': <String>[]},
            <String, Object?>{'key': 'FIRST_ITEM', 'done': done > 3, 'missing': done > 3 ? <String>[] : <String>['SELLABLE_ITEM']},
          ],
          'missing': <String>[if (done <= 2) 'BUSINESS_HOURS', if (done <= 3) 'SELLABLE_ITEM'],
          'public': isPublic, 'activated': isPublic, 'activated_at': null, 'request': request, 'lock': lock,
          'availability': <String, Object?>{'online': false, 'reason': 'NO_BUSINESS_HOURS', 'evaluated_at': '2026-10-25T01:00:00.000Z'},
        };

    test('is read strictly: any other shape is null', () {
      expect(ShopSetup.tryParse(body())?.completedSteps, 2);
      expect(ShopSetup.tryParse(body(done: 4, state: 'ACTIVATED', isPublic: true))?.isActivated, isTrue);
      expect(ShopSetup.tryParse(body(request: <String, Object?>{'note': 'Thêm ảnh', 'requested_at': 'x'}))?.requestNote, 'Thêm ảnh');
      for (final Object? bad in <Object?>[null, 'x', <String, Object?>{}, body(done: 9), (body()..['state'] = 'DONE'), (body()..['total_steps'] = 3), (body()..['steps'] = <Object?>[]), (body()..['public'] = 'yes'), body(request: 5)]) {
        expect(ShopSetup.tryParse(bad), isNull);
      }
    });

    testWidgets('the card shows x/4, the four steps with what is missing, the automatic activation line and opens the right step on a tap', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(390 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final List<String> tapped = <String>[];
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: SingleChildScrollView(child: ShopSetupChecklist(setup: ShopSetup.tryParse(body())!, onStep: (String key, List<String> missing) => tapped.add('$key:${missing.join(',')}'))))));
      expect(find.text('Hoàn tất thiết lập cửa hàng'), findsOneWidget);
      expect(find.text('2/4'), findsOneWidget);
      expect(find.text('Còn thiếu: giờ hoạt động.'), findsOneWidget);
      expect(find.text('Còn thiếu: món đang bán có giá và ảnh.'), findsOneWidget);
      expect(find.text('Kích hoạt cửa hàng'), findsOneWidget);
      expect(find.text('Tự động khi đủ 4 bước, không cần chờ duyệt.'), findsOneWidget);
      expect(find.textContaining('Gửi duyệt'), findsNothing);
      expect(find.textContaining('Chờ xét duyệt'), findsNothing);
      await tester.tap(find.byKey(const Key('setup-step-ACCOUNT')));
      await tester.tap(find.byKey(const Key('setup-step-LOCATION')));
      await tester.tap(find.byKey(const Key('setup-step-SHOP_INFO')));
      await tester.tap(find.byKey(const Key('setup-step-FIRST_ITEM')));
      expect(tapped, <String>['SHOP_INFO:BUSINESS_HOURS', 'FIRST_ITEM:SELLABLE_ITEM']); // a step that is done does nothing
    });

    testWidgets('a lock and an administrator request are shown as such', (WidgetTester tester) async {
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: SingleChildScrollView(child: ShopSetupChecklist(setup: ShopSetup.tryParse(body(state: 'LOCKED', lock: 'ADMIN', request: <String, Object?>{'note': 'Thêm ảnh món', 'requested_at': 'x'}))!, onStep: (_, __) {})))));
      expect(find.byKey(const Key('setup-locked')), findsOneWidget);
      expect(find.text('Thêm ảnh món'), findsOneWidget);
      expect(find.text('Tạm khóa'), findsOneWidget);
    });
  });

  group('Setup on the shop management screen', () {
    Future<({FakeShopOpsServer server, M02Flows flows})> open(WidgetTester tester) async {
      tester.view.physicalSize = const Size(390 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      final FakeShopOpsServer server = FakeShopOpsServer(api);
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      await session.login(phone: '0901234567', password: 'Correct-Horse-9');
      final M02Flows flows = createM02Flows(session: session, location: FakeLocationProvider(), menuApi: FakeMenuApi(), picker: FakeImagePicker(), pollEvery: Duration.zero);
      addTearDown(flows.dispose);
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: ShopManageScreen(flows: flows)));
      await tester.pumpAndSettle();
      return (server: server, flows: flows);
    }

    testWidgets('the checklist is read from the SERVER, tapping a missing step opens its screen, and when the server activates the shop the message appears once and the checklist goes', (WidgetTester tester) async {
      final r = await open(tester);
      expect(find.text('Hoàn tất thiết lập cửa hàng'), findsOneWidget);
      expect(find.text('2/4'), findsOneWidget); // account + point; no schedule, no dish
      expect(r.server.setupReads, 1);
      await tester.tap(find.byKey(const Key('setup-step-SHOP_INFO')));
      await tester.pumpAndSettle();
      expect(find.text('Giờ hoạt động'), findsWidgets); // the schedule screen (only the hours are missing in this step)
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
      expect(r.server.setupReads, greaterThan(1)); // coming back reads the setup again
      // The owner finishes the last two conditions elsewhere; the server activates; the next read shows the message and no checklist.
      r.server.hours = <Map<String, Object?>>[for (int d = 1; d <= 7; d++) <String, Object?>{'weekday': d, 'start_minute': 0, 'end_minute': 1440, 'end_day_offset': 0}];
      r.server.hasSellableDish = true;
      await r.flows.setup.refresh();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('setup-ready')), findsOneWidget);
      expect(find.text('Cửa hàng của bạn đã sẵn sàng!'), findsOneWidget);
      expect(find.text('Khách hàng có thể tìm thấy quán và đặt món khi quán mở cửa.'), findsOneWidget);
      expect(find.text('Hoàn tất thiết lập cửa hàng'), findsNothing);
      await tester.tap(find.byKey(const Key('setup-ready-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('setup-ready')), findsNothing);
      await r.flows.setup.refresh();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('setup-ready')), findsNothing); // once
    });

    testWidgets('reload and offline: the last server answer is kept and marked out of date; a first failure is an error with a retry, not 0/4', (WidgetTester tester) async {
      final r = await open(tester);
      expect(find.text('2/4'), findsOneWidget);
      r.server.setupFailure = 503;
      await r.flows.setup.refresh();
      await tester.pumpAndSettle();
      expect(find.text('2/4'), findsOneWidget);
      expect(find.byKey(const Key('setup-stale')), findsOneWidget);
      r.server.setupFailure = null;
      await tester.tap(find.byKey(const Key('setup-retry')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('setup-stale')), findsNothing);
    });
  });
}
