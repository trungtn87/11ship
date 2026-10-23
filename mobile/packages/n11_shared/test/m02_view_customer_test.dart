import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

import 'm02_shop_views_test.dart' show harness, show, tapKey, Harness;

FakeMenuApi seeded() => FakeMenuApi(items: <MenuItem>[
      FakeMenuApi.item('a', 'Ốc hương hấp', 120000, 'c1', image: 'p1'),
      FakeMenuApi.item('b', 'Ngao hấp', 60000, 'c2'),
      FakeMenuApi.item('c', 'Ốc móng tay xào tỏi', 135000, 'c1', hidden: true),
    ]);

WeekSchedule week() {
  final WeekSchedule w = emptyWeek();
  for (int d = 0; d < 6; d++) {
    w[d] = <HourRange>[HourRange(open: '17:00', close: '23:00', kind: RangeKind.day)];
  }
  w[6] = <HourRange>[HourRange(open: '22:00', close: '02:00', kind: RangeKind.night)];
  return w;
}

ShopMenuView customerView({String reason = 'OUTSIDE_BUSINESS_HOURS', bool items = true, bool hours = true}) => ShopMenuView(
      name: 'Ốc 11',
      address: '12 Phố Kim Đồng',
      availabilityReason: reason,
      serverNow: DateTime.utc(2026, 10, 14, 11, 30), // Wednesday 18:30 in Vietnam
      hours: hours ? week() : emptyWeek(),
      categories: items
          ? const <PublicCategory>[
              PublicCategory(name: 'Ốc', items: <PublicItem>[PublicItem(id: 'a', name: 'Ốc hương hấp', priceVnd: 120000, imageUrl: null, soldCount: 120)]),
              PublicCategory(name: 'Hải sản', items: <PublicItem>[PublicItem(id: 'b', name: 'Ngao hấp', priceVnd: 60000, imageUrl: null, soldCount: 0)]),
            ]
          : const <PublicCategory>[],
    );

void main() {
  testWidgets('unavailable public logo falls back without hiding the menu or hours action', (tester) async {
    await harness(tester, width: 320);
    final view = ShopMenuView(name: 'Ốc 11', address: 'Cao Bằng', availabilityReason: 'ONLINE', serverNow: null, hours: week(), categories: customerView().categories, logoUrl: 'https://example.test/missing-logo.png');
    await show(tester, ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's1'));
    expect(find.descendant(of: find.byKey(const Key('shop-view-logo')), matching: find.byIcon(Icons.storefront_outlined)), findsOneWidget);
    expect(find.text('Ốc hương hấp'), findsOneWidget);
    await tapKey(tester, 'shop-view-hours');
    expect(find.text('Giờ Việt Nam · chỉ xem'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('F09: the preview leaves hidden dishes out and says so; showing a dish brings it back', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await show(tester, PreviewScreen(flows: h.flows));
    expect(find.text('Xem trước'), findsOneWidget);
    expect(find.text('Ốc hương hấp'), findsOneWidget);
    expect(find.text('Ngao hấp'), findsOneWidget);
    expect(find.text('Ốc móng tay xào tỏi'), findsNothing);
    expect(find.text('Món đang ẩn không hiển thị trong bản xem trước.'), findsOneWidget);
    expect(find.text('Quán hiện chưa hiển thị cho khách'), findsNothing);
    // No basket, no order, no payment.
    for (final String word in <String>['Mua', 'Đặt ngay', 'Giỏ hàng', 'Thanh toán']) {
      expect(find.text(word), findsNothing);
    }
    h.menuApi.editElsewhere('c', hidden: false);
    await h.flows.menu.load();
    await tester.pumpAndSettle();
    expect(find.text('Ốc móng tay xào tỏi'), findsOneWidget);
    expect(find.text('Món đang ẩn không hiển thị trong bản xem trước.'), findsNothing);
  });

  testWidgets('the preview of a shop that customers cannot see yet says so; an empty menu says so', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: FakeMenuApi());
    h.server.status = 'DISABLED';
    h.server.reason = 'SHOP_DISABLED';
    await show(tester, PreviewScreen(flows: h.flows));
    expect(find.byKey(const Key('preview-not-public')), findsOneWidget);
    expect(find.text('Quán chưa có món để hiển thị.'), findsOneWidget);
    expect(find.byKey(const Key('preview-as-customer')), findsNothing);
  });

  testWidgets('the preview where the menu is not connected says so and shows no dish', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    final M02Flows flows = createM02Flows(session: h.session, location: h.gps, pollEvery: Duration.zero);
    addTearDown(flows.dispose);
    await show(tester, PreviewScreen(flows: flows));
    expect(find.text('Chưa nối máy chủ'), findsOneWidget);
  });

  testWidgets('F11: K01 shows a closed shop WITH its menu, no purchase controls, then K02 and back', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    final FakePublicShopApi api = FakePublicShopApi(customerView());
    await show(tester, ShopPublicScreen(api: api, shopId: 's1'));
    expect(find.text('Đã đóng cửa'), findsOneWidget);
    expect(find.text('Ốc hương hấp'), findsOneWidget);
    expect(find.text('120.000 đ'), findsOneWidget);
    expect(find.text('Đã bán 120'), findsOneWidget);
    expect(find.text('Đã bán 0'), findsOneWidget);
    expect(find.text('Xem trước'), findsNothing);
    for (final String word in <String>['Mua', 'Đặt ngay', '+', 'Giỏ hàng']) {
      expect(find.text(word), findsNothing);
    }
    await tapKey(tester, 'shop-view-hours');
    expect(find.text('Giờ Việt Nam · chỉ xem'), findsOneWidget);
    expect(find.text('Hôm nay'), findsOneWidget);
    expect(tester.widget<Text>(find.descendant(of: find.byKey(const Key('k02-day-2')), matching: find.text('Thứ Tư'))).data, 'Thứ Tư');
    expect(find.descendant(of: find.byKey(const Key('k02-day-2')), matching: find.text('Hôm nay')), findsOneWidget, reason: 'today comes from the server instant (Wednesday 18:30 Vietnam)');
    expect(find.text('22:00 → 02:00 hôm sau'), findsOneWidget);
    expect(find.text('Ca qua đêm: giờ đóng thuộc ngày hôm sau.'), findsOneWidget);
    expect(find.byKey(const Key('editor-add')), findsNothing);
    expect(find.text('Cả tuần'), findsNothing);
    await tester.tap(find.byTooltip('Quay lại').last);
    await tester.pumpAndSettle();
    expect(find.text('Ốc hương hấp'), findsOneWidget);
    expect(h.menuApi.arrived, isEmpty);
  });

  testWidgets('K01 chips: open, closed, no schedule; no schedule in K02 says so but the menu stays', (WidgetTester tester) async {
    await harness(tester);
    for (final (String reason, String chip) in <(String, String)>[('ONLINE', 'Đang mở cửa'), ('NO_BUSINESS_HOURS', 'Chưa cài giờ hoạt động')]) {
      await show(tester, ShopPublicScreen(api: FakePublicShopApi(customerView(reason: reason, hours: reason != 'NO_BUSINESS_HOURS')), shopId: 's1'));
      expect(find.text(chip), findsOneWidget);
      expect(find.text('Ốc hương hấp'), findsOneWidget);
    }
    await tapKey(tester, 'shop-view-hours');
    expect(find.text('Quán chưa cài giờ hoạt động.'), findsOneWidget);
  });

  testWidgets('K01 with no dish says so; not found and unavailable are different screens; the reason is never shown', (WidgetTester tester) async {
    await harness(tester);
    await show(tester, ShopPublicScreen(api: FakePublicShopApi(customerView(items: false)), shopId: 's1'));
    expect(find.text('Quán chưa có món để hiển thị.'), findsOneWidget);
    await show(tester, ShopPublicScreen(api: FakePublicShopApi(null)..failureCode = 'SHOP_NOT_FOUND', shopId: 's1'));
    expect(find.text('Không tìm thấy quán.'), findsOneWidget);
    expect(find.byKey(const Key('k01-retry')), findsNothing);
    final FakePublicShopApi gone = FakePublicShopApi(null)..failureCode = 'SHOP_UNAVAILABLE';
    await show(tester, ShopPublicScreen(api: gone, shopId: 's1'));
    expect(find.text('Quán hiện không khả dụng'), findsOneWidget);
    expect(find.textContaining('DISABLED'), findsNothing);
    await tapKey(tester, 'k01-retry');
    expect(gone.calls, 2);
  });

  testWidgets('K01: a network failure is not "unavailable"; loaded data stays with a not-up-to-date note', (WidgetTester tester) async {
    await harness(tester);
    final FakePublicShopApi offline = FakePublicShopApi(null)..offline = true;
    await show(tester, ShopPublicScreen(api: offline, shopId: 's1'));
    expect(find.text('Không tải được dữ liệu'), findsOneWidget);
    expect(find.text('Quán hiện không khả dụng'), findsNothing);
    offline.offline = false;
    offline.view = customerView();
    await tapKey(tester, 'm02-retry');
    expect(find.text('Ốc hương hấp'), findsOneWidget);
  });

  test('PublicShopController: data that was loaded stays (marked stale) when a refresh fails; not found / unavailable drop it', () async {
    final FakePublicShopApi api = FakePublicShopApi(customerView());
    final PublicShopController c = PublicShopController(api: api, shopId: 's1');
    await c.load();
    expect(c.state, PublicLoad.ready);
    api.offline = true;
    await c.load();
    expect(c.state, PublicLoad.ready);
    expect(c.stale, isTrue);
    expect(c.view!.name, 'Ốc 11');
    api.offline = false;
    await c.load();
    expect(c.stale, isFalse);
    api.failureCode = 'SHOP_UNAVAILABLE';
    await c.load();
    expect(c.state, PublicLoad.unavailable);
    expect(c.view, isNull);
  });

  testWidgets('K01 where the public shop is not connected says so (no sample shop)', (WidgetTester tester) async {
    await harness(tester);
    await show(tester, const ShopPublicScreen(api: UnwiredPublicShopApi(), shopId: 's1'));
    expect(find.text('Chưa nối máy chủ'), findsOneWidget);
    expect(find.text('Ốc 11'), findsNothing);
  });

  for (final double width in <double>[320, 360, 390]) {
    testWidgets('layout at ${width.toInt()}px: K01 with a very long shop and dish name does not overflow', (WidgetTester tester) async {
      await harness(tester, width: width);
      final ShopMenuView view = ShopMenuView(
        name: 'Quán Ốc Mười Một Chi Nhánh Số Hai Đường Kim Đồng Phường Hợp Giang Thành Phố Cao Bằng',
        address: '12 Phố Kim Đồng, Phường Hợp Giang, Thành phố Cao Bằng, Tỉnh Cao Bằng, Việt Nam',
        availabilityReason: 'ONLINE',
        serverNow: DateTime.utc(2026, 10, 14, 11, 30),
        hours: week(),
        categories: const <PublicCategory>[PublicCategory(name: 'Nhóm món có tên rất dài để thử bố cục', items: <PublicItem>[PublicItem(id: 'x', name: 'Sò điệp nướng mỡ hành phô mai đặc biệt phần lớn ăn kèm bánh tráng và rau thơm các loại', priceVnd: 99999999, imageUrl: null)])],
      );
      await show(tester, ShopPublicScreen(api: FakePublicShopApi(view), shopId: 's1'));
      expect(tester.takeException(), isNull);
      expect(find.text('99.999.999 đ'), findsOneWidget);
      final Size logo = tester.getSize(find.byKey(const Key('shop-view-logo')));
      expect(logo.width, closeTo(logo.height, .01));
      expect(tester.getTopLeft(find.byKey(const Key('shop-view-logo'))).dx, lessThan(tester.getTopLeft(find.byKey(const Key('shop-view-name'))).dx));
    });
  }
}
