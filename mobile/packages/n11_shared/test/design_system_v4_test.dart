import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

void main() {
  final String? screenshots = Platform.environment['N11_V4_SCREENSHOTS'];

  setUpAll(() async {
    final FontLoader fonts = FontLoader('packages/n11_shared/$kFontFamily');
    for (final String weight in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      fonts.addFont(Future<ByteData>.value(ByteData.sublistView(File('assets/fonts/PlusJakartaSans-$weight.ttf').readAsBytesSync())));
    }
    await fonts.load();
  });

  testWidgets('loading and disabled buttons never dispatch; enabled action dispatches once', (WidgetTester tester) async {
    int calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildN11Theme(),
        home: Scaffold(
          body: Column(
            children: <Widget>[
              N11Button(label: 'Nhận đơn', onPressed: () => calls++),
              N11Button(label: 'Đang gửi', loading: true, onPressed: () => calls++),
              const N11Button(label: 'Chưa đủ điều kiện'),
              N11Button(label: 'Liên hệ', compact: true, kind: ButtonKind.ghost, onPressed: () => calls++),
            ],
          ),
        ),
      ),
    );
    await tester.tap(find.text('Đang gửi'));
    await tester.tap(find.text('Chưa đủ điều kiện'));
    expect(calls, 0);
    await tester.tap(find.text('Nhận đơn'));
    expect(calls, 1);
    expect(tester.getSize(find.byType(N11Button).last).height, greaterThanOrEqualTo(48));
    expect(tester.takeException(), isNull);
  });

  testWidgets('search edits and clear preserve caller-owned query updates', (WidgetTester tester) async {
    final TextEditingController controller = TextEditingController();
    addTearDown(controller.dispose);
    final List<String> queries = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildN11Theme(),
        home: Scaffold(
          body: N11SearchField(controller: controller, onChanged: queries.add),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'Ốc Cao Bằng');
    await tester.pump();
    await tester.tap(find.byTooltip('Xóa nội dung tìm kiếm'));
    await tester.pump();
    expect(controller.text, isEmpty);
    expect(queries, <String>['Ốc Cao Bằng', '']);
    expect(find.byTooltip('Xóa nội dung tìm kiếm'), findsNothing);
  });

  for (final double width in <double>[320, 390, 600]) {
    for (final double scale in <double>[1, 1.3, 2]) {
      testWidgets('foundation fits width $width, text scale $scale with keyboard', (WidgetTester tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final TextEditingController controller = TextEditingController();
        addTearDown(controller.dispose);
        final GlobalKey boundary = GlobalKey();
        int selected = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildN11Theme(),
            builder: (BuildContext context, Widget? child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: RepaintBoundary(
              key: boundary,
              child: Scaffold(
                appBar: AppBar(title: const Text('11Food · 11Ship')),
                body: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      const N11Heading('Giao diện V4', sub: 'Tiếng Việt: Ốc, quán, đơn hàng, địa chỉ'),
                      const SizedBox(height: 16),
                      N11SearchField(controller: controller, onChanged: (_) {}),
                      const SizedBox(height: 16),
                      N11Card(
                        child: vstack(<Widget>[
                          const Text('Đơn hàng của bạn', style: N11Text.h2),
                          const N11Chip('Đã hoàn thành', kind: ChipKind.ok),
                          N11Button(label: 'Xác nhận và tiếp tục giao hàng', onPressed: () {}),
                          N11Button(label: 'Xem chi tiết', kind: ButtonKind.secondary, onPressed: () {}),
                          const N11Button(label: 'Đang gửi yêu cầu', loading: true),
                          const N11Button(label: 'Chưa đủ điều kiện'),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: <Widget>[
                          CategoryChip(label: 'Hải sản', selected: true, onSelected: (_) {}),
                          CategoryChip(label: 'Ăn vặt', selected: false, onSelected: (_) {}),
                          const NotificationBadge(count: 123),
                        ],
                      ),
                      const N11Banner(kind: BannerKind.warn, title: 'GPS chưa chính xác', text: 'Kiểm tra vị trí rồi thử lại.'),
                      const SizedBox(height: 12),
                      const N11Banner(kind: BannerKind.error, title: 'Chưa có kết nối', text: 'Kiểm tra mạng và thử lại.'),
                      const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Đơn hàng sẽ xuất hiện tại đây.'),
                      N11Field(fieldKey: const Key('v4-field'), label: 'Địa chỉ giao hàng', controller: controller),
                    ],
                  ),
                ),
                bottomNavigationBar: N11BottomNav(
                  items: const <NavItem>[
                    NavItem(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined),
                    NavItem(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long),
                    NavItem(id: 'income', label: 'Thu nhập', icon: Icons.payments_outlined),
                    NavItem(id: 'notifications', label: 'Thông báo', icon: Icons.notifications_outlined),
                    NavItem(id: 'account', label: 'Tài khoản', icon: Icons.person_outline),
                  ],
                  activeIndex: 0,
                  onSelect: (int i) => selected = i,
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        await tester.tap(find.byKey(const Key('tab-account')));
        expect(selected, 4);
        // Flush the navigation ink repaint before capturing; loading spinners
        // intentionally keep ticking, so pumpAndSettle cannot be used here.
        await tester.pump(const Duration(milliseconds: 200));
        if (screenshots != null && scale == 1) {
          final RenderRepaintBoundary render = tester.renderObject(find.byKey(boundary));
          final ui.Image image = (await tester.runAsync(() => render.toImage(pixelRatio: 1.5)))!;
          final ByteData bytes = (await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png)))!;
          Directory(screenshots).createSync(recursive: true);
          File('$screenshots/foundation-${width.toInt()}.png').writeAsBytesSync(bytes.buffer.asUint8List());
          image.dispose();
        }
        await tester.showKeyboard(find.byType(TextField).first);
        tester.view.viewInsets = const FakeViewPadding(bottom: 280);
        await tester.pump();
        await tester.ensureVisible(find.byKey(const Key('v4-field')));
        await tester.pump();
        expect(tester.takeException(), isNull);
      });
    }
  }
}
