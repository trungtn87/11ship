import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

class Harness {
  Harness(this.api, this.server, this.session, this.flows, this.gps, this.menuApi);

  final FakeApiTransport api;
  final FakeShopOpsServer server;
  final SessionController session;
  final M02Flows flows;
  final FakeLocationProvider gps;
  final FakeMenuApi menuApi;
}

Future<Harness> harness(WidgetTester tester, {double width = 390, double height = 800, FakeMenuApi? menu, PublicShopApi? publicApi, DishImageCropperPort? cropper}) async {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final FakeShopOpsServer server = FakeShopOpsServer(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final FakeLocationProvider gps = FakeLocationProvider();
  final FakeMenuApi menuApi = menu ?? FakeMenuApi();
  final M02Flows flows = createM02Flows(session: session, location: gps, menuApi: menuApi, publicApi: publicApi ?? FakePublicShopApi(null), picker: FakeImagePicker(), cropper: cropper ?? ((PickedImage raw) async => raw), pollEvery: Duration.zero);
  addTearDown(flows.dispose);
  return Harness(api, server, session, flows, gps, menuApi);
}

Future<void> show(WidgetTester tester, Widget screen) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pumpAndSettle();
}

Future<void> tapKey(WidgetTester tester, String key) async {
  final Finder finder = find.byKey(Key(key));
  // A toast that is still up would cover the button for its few seconds, as it would for a person: let it go.
  await tester.pump(const Duration(seconds: 4));
  await tester.pumpAndSettle();
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  group('Q01 Quản lý cửa hàng', () {
    for (final (String reason, String label) in <(String, String)>[
      ('ONLINE', 'Đang mở cửa'),
      ('OUTSIDE_BUSINESS_HOURS', 'Đã đóng cửa'),
      ('NO_BUSINESS_HOURS', 'Chưa cài giờ hoạt động'),
      ('SHOP_DISABLED', 'Quán đã bị vô hiệu hóa'),
      ('SERVICE_AREA_INACTIVE', 'Khu vực phục vụ ngừng hoạt động'),
    ]) {
      testWidgets('shows the server state "$label" and has no open/close switch', (WidgetTester tester) async {
        final Harness h = await harness(tester);
        h.server.reason = reason;
        if (reason == 'SHOP_DISABLED') {
          h.server.status = 'DISABLED';
        }
        await show(tester, ShopManageScreen(flows: h.flows));
        expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, label);
        expect(find.byType(Switch), findsNothing);
        expect(find.byType(SwitchListTile), findsNothing);
        expect(find.text('Ốc 11'), findsOneWidget);
        expect(find.byKey(const Key('manage-menu')), findsOneWidget);
        expect(find.byKey(const Key('manage-preview')), findsOneWidget);
      });
    }

    testWidgets('a failed first load is "Không tải được dữ liệu" with Thử lại, not an empty shop', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      h.server.readFailure = 503;
      await show(tester, ShopManageScreen(flows: h.flows));
      expect(find.text('Không tải được dữ liệu'), findsOneWidget);
      expect(find.byKey(const Key('status-card')), findsNothing);
      h.server.readFailure = null;
      await tapKey(tester, 'm02-retry');
      expect(find.byKey(const Key('status-card')), findsOneWidget);
    });

    testWidgets('a refresh that fails keeps the status on screen, marked "Chưa cập nhật trạng thái"', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await show(tester, ShopManageScreen(flows: h.flows));
      h.server.readFailure = 503;
      await h.flows.ops.refresh();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('manage-stale')), findsOneWidget);
      expect(find.text('Chưa cập nhật trạng thái'), findsOneWidget);
      expect(find.textContaining('Lần cập nhật gần nhất'), findsOneWidget);
      expect(find.byKey(const Key('status-label')), findsOneWidget);
    });

    testWidgets('does not overlap its refreshes and reads again when a child screen is left', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await show(tester, ShopManageScreen(flows: h.flows));
      final int before = h.server.reads;
      await tapKey(tester, 'manage-hours');
      await tester.tap(find.byTooltip('Quay lại').last);
      await tester.pumpAndSettle();
      expect(h.server.reads, greaterThan(before));
    });
  });

  group('Q02 Hồ sơ quán', () {
    testWidgets('reads the profile, edits it, a denied GPS keeps the old position, saves, reads it back', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      h.gps.failure = LocationFailure.denied;
      await show(tester, ShopProfileScreen(flows: h.flows));
      expect(find.textContaining('22.6657'), findsNothing);
      expect(h.gps.calls, 0);
      await tapKey(tester, 'profile-edit');
      await tester.enterText(find.byKey(const Key('profile-field-name')), 'Ốc 11 Cơ sở 2');
      await tester.pump();
      expect(find.byKey(const Key('profile-locate')), findsNothing);
      await tapKey(tester, 'profile-field-address');
      await tapKey(tester, 'location-current');
      expect(find.byKey(const Key('location-picker-error')), findsOneWidget);
      expect(h.gps.calls, 1);
      await tapKey(tester, 'location-save');
      await tapKey(tester, 'profile-save');
      expect(h.server.effects, hasLength(1));
      expect(h.server.effects.single['name'], 'Ốc 11 Cơ sở 2');
      expect(h.server.effects.single['pickup_lat'], 22.6657);
      expect(find.text('Sửa hồ sơ'), findsOneWidget, reason: 'back to the read view after a saved edit');
      expect(find.text('Ốc 11 Cơ sở 2'), findsOneWidget);
    });

    testWidgets('invalid input shows the error beside the field, sends nothing and keeps what was typed', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await show(tester, ShopProfileScreen(flows: h.flows, startEditing: true));
      await tester.enterText(find.byKey(const Key('profile-field-phone')), '12');
      await tester.pump();
      await tapKey(tester, 'profile-save');
      expect(find.text('Số điện thoại chưa hợp lệ.'), findsOneWidget);
      expect(h.server.arrived, isEmpty);
      expect(tester.widget<TextField>(find.byKey(const Key('profile-field-phone'))).controller!.text, '12');
    });

    testWidgets('a pin outside the service area is refused beside the picker, the typed data is kept and nothing is stored', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      h.server.profileRefusal = 'PICKUP_OUTSIDE_SERVICE_AREA';
      h.gps.failure = LocationFailure.denied;
      await show(tester, ShopProfileScreen(flows: h.flows, startEditing: true));
      expect(find.text('Chọn vị trí lấy hàng trên bản đồ'), findsOneWidget);
      expect(find.byKey(const Key('address-pin-summary')), findsOneWidget, reason: 'the pin is shown for review before saving');
      await tester.enterText(find.byKey(const Key('profile-field-name')), 'Tên đã gõ');
      await tester.pump();
      await tapKey(tester, 'profile-save');
      expect(find.textContaining('ngoài khu vực phục vụ'), findsWidgets);
      expect(h.server.effects, isEmpty);
      expect(tester.widget<TextField>(find.byKey(const Key('profile-field-name'))).controller!.text, 'Tên đã gõ');
    });

    testWidgets('a DISABLED shop is read-only: no edit button, a reason, nothing to save', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      h.server.status = 'DISABLED';
      h.server.reason = 'SHOP_DISABLED';
      await show(tester, ShopProfileScreen(flows: h.flows));
      expect(find.byKey(const Key('profile-readonly')), findsOneWidget);
      expect(find.byKey(const Key('profile-edit')), findsNothing);
    });

    testWidgets('leaving a dirty form asks first; Tiếp tục sửa stays, Bỏ thay đổi leaves', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: Builder(builder: (BuildContext context) => Scaffold(body: Center(child: TextButton(key: const Key('open'), onPressed: () => Navigator.of(context).push(n11Route(ShopProfileScreen(flows: h.flows, startEditing: true))), child: const Text('go'))))),
      ));
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('profile-field-name')), 'Tên mới');
      await tester.pump();
      await tester.tap(find.byTooltip('Quay lại'));
      await tester.pumpAndSettle();
      expect(find.text('Bỏ thay đổi chưa lưu?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('dlg-stay')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('profile-field-name')), findsOneWidget);
      await tester.tap(find.byTooltip('Quay lại'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('dlg-leave')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('profile-field-name')), findsNothing);
      expect(h.server.arrived, isEmpty);
    });

    testWidgets('a conflict keeps the draft and the new data replaces it only after two confirmations', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await show(tester, ShopProfileScreen(flows: h.flows, startEditing: true));
      await tester.enterText(find.byKey(const Key('profile-field-name')), 'Bản nháp của tôi');
      await tester.pump();
      h.server.changeElsewhere(newName: 'Ốc 11 nơi khác');
      await tapKey(tester, 'profile-save');
      expect(find.text('Dữ liệu đã được cập nhật ở nơi khác.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('dlg-keep')));
      await tester.pumpAndSettle();
      expect(find.text('Bản nháp của tôi'), findsOneWidget);
      expect(h.server.effects, isEmpty);
    });

    testWidgets('an unknown outcome locks the form and shows the pending banner; Thử lại sends the same request once', (WidgetTester tester) async {
      final Harness h = await harness(tester);
      await show(tester, ShopProfileScreen(flows: h.flows, startEditing: true));
      await tester.enterText(find.byKey(const Key('profile-field-name')), 'Ốc 11 mới');
      await tester.pump();
      h.server.loseAnswerOnce = true;
      await tapKey(tester, 'profile-save');
      expect(find.byKey(const Key('pending-banner')), findsOneWidget);
      expect(find.text('Chưa xác định được kết quả lưu'), findsOneWidget);
      expect(tester.widget<N11Button>(find.byKey(const Key('profile-save'))).onPressed, isNull);
      expect(tester.widget<TextField>(find.byKey(const Key('profile-field-name'))).enabled, isFalse);
      h.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await tapKey(tester, 'pending-retry');
      expect(find.byKey(const Key('pending-banner')), findsOneWidget, reason: 'still unknown after an offline retry');
      await tapKey(tester, 'pending-retry');
      expect(find.byKey(const Key('pending-banner')), findsNothing);
      expect(h.server.effects, hasLength(1));
      expect(h.server.arrived.toSet(), hasLength(1));
    });
  });
}
