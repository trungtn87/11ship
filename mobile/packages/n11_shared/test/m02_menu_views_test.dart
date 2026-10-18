import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

import 'm02_shop_views_test.dart' show harness, show, tapKey, Harness;

FakeMenuApi seeded() => FakeMenuApi(items: <MenuItem>[
      FakeMenuApi.item('a', 'Ốc hương hấp', 120000, 'c1', image: 'p1'),
      FakeMenuApi.item('b', 'Ngao hấp', 60000, 'c2'),
      FakeMenuApi.item('c', 'Ốc móng tay xào tỏi', 135000, 'c1', hidden: true),
      FakeMenuApi.item('d', 'Sò điệp nướng mỡ hành phô mai đặc biệt phần lớn ăn kèm bánh tráng và rau thơm các loại', 180000, 'c2'),
    ]);

Future<void> openForm(WidgetTester tester, Harness h, String? id) async {
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: MenuListScreen(flows: h.flows),
  ));
  await tester.pumpAndSettle();
  await tapKey(tester, id == null ? 'menu-add' : 'dish-$id');
}

String textOf(WidgetTester tester, String key) => tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

void main() {
  testWidgets('the menu is not connected in this build: Q05 says so (no add button, no fake dishes, no retry that cannot work)', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    final M02Flows flows = createM02Flows(session: h.session, location: h.gps, pollEvery: Duration.zero);
    addTearDown(flows.dispose);
    await show(tester, MenuListScreen(flows: flows));
    expect(find.text('Chưa nối máy chủ'), findsOneWidget);
    expect(find.byKey(const Key('menu-add')), findsNothing);
    expect(find.byKey(const Key('menu-add-empty')), findsNothing);
    expect(find.byKey(const Key('menu-search')), findsNothing);
  });

  testWidgets('F06: empty menu -> add a dish without a picture -> it appears in the list; a group is chosen when there are several', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: FakeMenuApi());
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.text('Chưa có món trong thực đơn'), findsOneWidget);
    await tapKey(tester, 'menu-add-empty');
    expect(find.text('Thêm món'), findsWidgets);
    await tapKey(tester, 'dish-save');
    expect(find.text('Nhập tên món.'), findsOneWidget);
    expect(find.text('Nhập giá lớn hơn 0.'), findsOneWidget);
    expect(find.text('Chọn một nhóm món.'), findsOneWidget);
    expect(h.menuApi.arrived, isEmpty);
    await tester.enterText(find.byKey(const Key('dish-name')), '  Ốc len xào dừa ');
    await tester.enterText(find.byKey(const Key('dish-price')), '90000');
    await tester.pump();
    expect(textOf(tester, 'dish-price'), '90.000');
    await tapKey(tester, 'dish-cat-c1');
    await tapKey(tester, 'dish-save');
    expect(h.menuApi.effects, hasLength(1));
    expect(find.text('Ốc len xào dừa'), findsOneWidget);
    expect(find.text('90.000 đ'), findsOneWidget);
    expect(find.text('Đã thêm món.'), findsOneWidget);
    expect(find.byKey(const Key('dish-save')), findsNothing, reason: 'back on the list');
  });

  testWidgets('with a single active group it is chosen for the person and the selector is hidden', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: FakeMenuApi(categories: <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true), const MenuCategory(id: 'c9', name: 'Cũ', active: false)]));
    await openFormEmpty(tester, h);
    expect(find.byKey(const Key('dish-single-group')), findsOneWidget);
    expect(find.byKey(const Key('dish-cat-c1')), findsNothing);
  });

  testWidgets('no active group: "Chưa có nhóm món để lựa chọn" with Thử lại, no fake group', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: FakeMenuApi(categories: <MenuCategory>[]));
    await openFormEmpty(tester, h);
    expect(find.text('Chưa có nhóm món để lựa chọn'), findsOneWidget);
    expect(find.byKey(const Key('dish-name')), findsNothing);
    h.menuApi.categories = <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true)];
    await tapKey(tester, 'groups-retry');
    expect(find.byKey(const Key('dish-name')), findsOneWidget);
  });

  testWidgets('search ignores case and marks, filters work, no match says so with Xóa bộ lọc, hidden dishes are dimmed and labelled', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.text('4 món · 1 đang ẩn'), findsOneWidget);
    expect(find.text('Đang ẩn'), findsWidgets);
    await tester.enterText(find.byKey(const Key('menu-search')), 'OC HUONG');
    await tester.pump();
    expect(find.byKey(const Key('dish-a')), findsOneWidget);
    expect(find.byKey(const Key('dish-b')), findsNothing);
    await tester.enterText(find.byKey(const Key('menu-search')), 'khong co mon nay');
    await tester.pump();
    expect(find.text('Không tìm thấy món phù hợp'), findsOneWidget);
    expect(find.text('Chưa có món trong thực đơn'), findsNothing, reason: 'a miss is not an empty menu');
    await tapKey(tester, 'menu-clear-filters');
    expect(find.byKey(const Key('dish-b')), findsOneWidget);
    await tapKey(tester, 'menu-filter-off');
    expect(find.byKey(const Key('dish-c')), findsOneWidget);
    expect(find.byKey(const Key('dish-a')), findsNothing);
    await tapKey(tester, 'menu-filter-all');
    await tapKey(tester, 'menu-cat-c2');
    expect(find.byKey(const Key('dish-b')), findsOneWidget);
    expect(find.byKey(const Key('dish-a')), findsNothing);
  });

  testWidgets('a group that was switched off is still named and marked Ngừng hoạt động', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: FakeMenuApi(
      categories: <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true), const MenuCategory(id: 'c9', name: 'Đồ uống', active: false)],
      items: <MenuItem>[FakeMenuApi.item('x', 'Trà đá', 5000, 'c9')],
    ));
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.text('Đồ uống · Ngừng hoạt động'), findsOneWidget);
    await tapKey(tester, 'dish-x');
    expect(find.byKey(const Key('dish-cat-c9')), findsOneWidget);
    expect(find.textContaining('Ngừng hoạt động · chỉ giữ liên kết hiện có'), findsOneWidget);
    expect(tester.widget<N11ChoiceCard>(find.byKey(const Key('dish-cat-c9'))).selected, isTrue);
  });

  testWidgets('F09/F10: hide asks first and the list shows Đang ẩn; Hiện món needs no dialog; delete asks and the dish is gone; a dirty form must be saved or reverted first', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await openForm(tester, h, 'b');
    await tester.enterText(find.byKey(const Key('dish-name')), 'Ngao hấp sả');
    await tester.pump();
    await tapKey(tester, 'dish-toggle');
    expect(find.text('Lưu hoặc bỏ thay đổi trước'), findsOneWidget);
    await tapKey(tester, 'needsave-revert');
    expect(textOf(tester, 'dish-name'), 'Ngao hấp');
    await tapKey(tester, 'dish-toggle');
    expect(find.text('Ẩn món này?'), findsOneWidget);
    expect(find.text('Món sẽ không xuất hiện trong thực đơn của khách. Bạn có thể hiện lại.'), findsOneWidget);
    await tapKey(tester, 'dlg-keep');
    expect(h.menuApi.effects, isEmpty);
    await tapKey(tester, 'dish-toggle');
    await tapKey(tester, 'hide-confirm');
    expect(h.menuApi.effects, hasLength(1));
    expect(find.text('Đang ẩn'), findsWidgets);
    expect(find.text('Hiện món'), findsOneWidget);
    await tapKey(tester, 'dish-toggle');
    expect(find.text('Ẩn món này?'), findsNothing, reason: 'showing again loses nothing, so no dialog');
    expect(h.menuApi.items.firstWhere((MenuItem i) => i.id == 'b').hidden, isFalse);
    await tapKey(tester, 'dish-more');
    await tapKey(tester, 'sheet-delete');
    expect(find.text('Xóa món khỏi thực đơn?'), findsOneWidget);
    expect(find.text('Món sẽ được đưa khỏi danh sách quản lý và thực đơn của khách.'), findsOneWidget);
    await tapKey(tester, 'delete-confirm');
    expect(find.byKey(const Key('dish-b')), findsNothing);
    expect(find.text('Đã xóa món.'), findsOneWidget);
    expect(h.menuApi.items.any((MenuItem i) => i.id == 'b'), isFalse);
  });

  testWidgets('F07: pick a picture (uploads at once), a failed replace keeps the old picture and offers other / retry / remove; the save sends the uploaded picture', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await openForm(tester, h, 'a');
    expect(find.byKey(const Key('image-replace')), findsOneWidget);
    h.menuApi.failUploads = true;
    await tapKey(tester, 'image-replace');
    expect(find.byKey(const Key('image-error')), findsOneWidget);
    expect(find.textContaining('Ảnh hiện tại của món vẫn được giữ'), findsOneWidget);
    expect(find.byKey(const Key('image-other')), findsOneWidget);
    expect(find.byKey(const Key('image-retry')), findsOneWidget);
    expect(find.byKey(const Key('image-remove')), findsOneWidget);
    h.menuApi.failUploads = false;
    await tapKey(tester, 'image-retry');
    expect(find.byKey(const Key('image-error')), findsNothing);
    await tapKey(tester, 'dish-save');
    expect(h.menuApi.items.firstWhere((MenuItem i) => i.id == 'a').imageRef, 'img1');
  });

  testWidgets('removing the picture only changes the draft; Hủy leaves the dish as saved', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await openForm(tester, h, 'a');
    await tapKey(tester, 'image-remove');
    expect(find.byKey(const Key('image-pick')), findsOneWidget);
    expect(h.menuApi.items.first.imageRef, 'p1');
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    expect(find.text('Bỏ thay đổi chưa lưu?'), findsOneWidget);
    await tapKey(tester, 'dlg-leave');
    expect(h.menuApi.items.first.imageRef, 'p1');
    expect(h.menuApi.arrived, isEmpty);
  });

  testWidgets('F08: a conflict keeps the draft; Tải bản mới asks twice; a dish deleted elsewhere cannot be saved again', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await openForm(tester, h, 'b');
    await tester.enterText(find.byKey(const Key('dish-price')), '70000');
    await tester.pump();
    h.menuApi.editElsewhere('b', name: 'Ngao hấp sả');
    await tapKey(tester, 'dish-save');
    expect(find.text('Dữ liệu đã được cập nhật ở nơi khác.'), findsOneWidget);
    await tapKey(tester, 'dlg-load');
    expect(find.text('Thay bản nháp bằng bản mới?'), findsOneWidget);
    await tapKey(tester, 'dlg-back');
    expect(textOf(tester, 'dish-price'), '70.000', reason: 'the draft is kept until the person confirms');
    await tapKey(tester, 'dish-save');
    await tapKey(tester, 'dlg-load');
    await tapKey(tester, 'dlg-confirm');
    expect(textOf(tester, 'dish-name'), 'Ngao hấp sả');
    expect(textOf(tester, 'dish-price'), '60.000');
    await tester.enterText(find.byKey(const Key('dish-price')), '80000');
    await tester.pump();
    h.menuApi.deleteElsewhere('b');
    await tapKey(tester, 'dish-save');
    expect(find.text('Món không còn trong thực đơn'), findsOneWidget);
    expect(find.byKey(const Key('dish-save')), findsNothing);
    expect(find.byKey(const Key('dish-back-list')), findsOneWidget);
    expect(h.menuApi.items.any((MenuItem i) => i.id == 'b'), isFalse);
  });

  testWidgets('a re-read that fails keeps the dishes with "Chưa cập nhật" + Thử lại (not stuck on loading); the retry clears it once the network is back', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.text('Ngao hấp'), findsOneWidget);
    expect(find.byKey(const Key('menu-stale')), findsNothing);
    h.menuApi.failLoads = true;
    await h.flows.menu.load();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('menu-stale')), findsOneWidget);
    expect(find.text('Chưa cập nhật'), findsOneWidget);
    expect(find.text('Ngao hấp'), findsOneWidget);
    await tapKey(tester, 'menu-stale-retry');
    expect(find.byKey(const Key('menu-stale')), findsOneWidget, reason: 'still offline: the warning stays and the button is usable again');
    h.menuApi.failLoads = false;
    await tapKey(tester, 'menu-stale-retry');
    expect(find.byKey(const Key('menu-stale')), findsNothing);
    expect(find.text('Ngao hấp'), findsOneWidget);
  });

  testWidgets('a first read that fails shows the load failure with Thử lại, not an empty menu; the retry loads it', (WidgetTester tester) async {
    final FakeMenuApi api = seeded()..failLoads = true;
    final Harness h = await harness(tester, menu: api);
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.text('Chưa có món trong thực đơn'), findsNothing);
    expect(find.byType(M02LoadFailed), findsOneWidget);
    api.failLoads = false;
    await tapKey(tester, 'm02-retry');
    expect(find.text('Ngao hấp'), findsOneWidget);
  });

  testWidgets('an unknown outcome on a dish locks the form; the retry sends the same operation once', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    await openForm(tester, h, 'b');
    await tester.enterText(find.byKey(const Key('dish-price')), '65000');
    await tester.pump();
    h.menuApi.loseAnswerOnce = true;
    await tapKey(tester, 'dish-save');
    expect(find.byKey(const Key('pending-banner')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('dish-price'))).enabled, isFalse);
    expect(tester.widget<N11Button>(find.byKey(const Key('dish-save'))).onPressed, isNull);
    await tapKey(tester, 'pending-retry');
    expect(find.byKey(const Key('pending-banner')), findsNothing);
    expect(h.menuApi.effects, hasLength(1));
    expect(h.menuApi.items.firstWhere((MenuItem i) => i.id == 'b').priceVnd, 65000);
  });

  testWidgets('a DISABLED shop: the menu is read-only (no add, no save), with the reason', (WidgetTester tester) async {
    final Harness h = await harness(tester, menu: seeded());
    h.server.status = 'DISABLED';
    h.server.reason = 'SHOP_DISABLED';
    await h.flows.ops.load();
    await show(tester, MenuListScreen(flows: h.flows));
    expect(find.byKey(const Key('menu-readonly')), findsOneWidget);
    expect(find.byKey(const Key('menu-add')), findsNothing);
    await tapKey(tester, 'dish-b');
    expect(find.byKey(const Key('dish-readonly')), findsOneWidget);
    expect(find.byKey(const Key('dish-save')), findsNothing);
    expect(find.byKey(const Key('dish-toggle')), findsNothing);
    expect(tester.widget<TextField>(find.byKey(const Key('dish-name'))).enabled, isFalse);
  });

  for (final double width in <double>[360, 390]) {
    testWidgets('layout at ${width.toInt()}px: long dish names and the form with a keyboard do not overflow; the save button stays reachable', (WidgetTester tester) async {
      final Harness h = await harness(tester, width: width, menu: seeded());
      await show(tester, MenuListScreen(flows: h.flows));
      expect(tester.takeException(), isNull);
      for (final String key in <String>['dish-a', 'dish-d', 'menu-add']) {
        expect(tester.getSize(find.byKey(Key(key))).height, greaterThanOrEqualTo(44));
      }
      await tapKey(tester, 'dish-d');
      tester.view.viewInsets = const FakeViewPadding(bottom: 300 * 3);
      await tester.pumpAndSettle();
      final Rect save = tester.getRect(find.byKey(const Key('dish-save')));
      expect(save.bottom, lessThanOrEqualTo(800 - 300 + 0.5));
      await tester.enterText(find.byKey(const Key('dish-price')), '99999999');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
    });
  }
}

Future<void> openFormEmpty(WidgetTester tester, Harness h) async {
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: MenuListScreen(flows: h.flows)));
  await tester.pumpAndSettle();
  await tapKey(tester, 'menu-add-empty');
}
