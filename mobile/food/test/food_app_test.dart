import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';

const String sha = '0123456789abcdef0123456789abcdef01234567';

const AppConfig config = AppConfig(
  apiBaseUrl: 'https://103.9.78.67.sslip.io',
  appId: 'vn.eleven.food.test',
  versionName: '0.1.0',
  buildNumber: '3',
  sourceSha: sha,
  signing: SigningMode.ephemeral,
);

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(
      status: 200,
      body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}',
    );

Future<void> pump(WidgetTester tester, HealthTransport transport, {AppConfig cfg = config}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(N11App(brand: foodBrand, tabs: buildFoodTabs(), config: cfg, transport: transport, pollInterval: Duration.zero));
  await tester.pump();
  await tester.pump();
}

Future<void> openTab(WidgetTester tester, String id) async {
  await tester.tap(find.byKey(Key('tab-$id')));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('four tabs in the agreed order, ready banner shown', (WidgetTester tester) async {
    await pump(tester, healthy());
    for (final String label in <String>['Trang chủ', 'Tìm kiếm', 'Đơn hàng', 'Tài khoản']) {
      expect(find.descendant(of: find.byType(N11BottomNav), matching: find.text(label)), findsOneWidget, reason: label);
    }
    expect(find.text('Máy chủ sẵn sàng'), findsWidgets);
  });

  testWidgets('home shows the approved logo asset and a test notice, no invented shops', (WidgetTester tester) async {
    await pump(tester, healthy());
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    expect(images.any((Image i) => i.image is AssetImage && (i.image as AssetImage).assetName == 'assets/brand/logo-11food-ui.png' && (i.image as AssetImage).package == 'n11_shared'), isTrue);
    expect(find.text(kTestNoticeTitle), findsOneWidget);
    expect(find.text('Chưa có quán để hiển thị'), findsOneWidget);
  });

  testWidgets('account: login locked with its reason, shop management entry needs login', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    expect(find.text('Quản lý cửa hàng'), findsOneWidget);
    expect(find.text('Cần đăng nhập'), findsWidgets);
    expect(find.text(featureReason(FeatureId.authLogin)), findsWidgets);
    expect(find.text(featureReason(FeatureId.authRegister)), findsWidgets);
    final Finder login = find.widgetWithText(GatedButton, 'Đăng nhập');
    expect(login, findsWidgets);
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
    expect(find.text('Không có kết nối mạng'), findsNothing);
    expect(find.text('Máy chủ sẵn sàng'), findsWidgets);
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

  testWidgets('search text survives switching tabs and opening diagnostics', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'search');
    await tester.enterText(find.byKey(const Key('search-field')), 'phở');
    await tester.pump();
    await openTab(tester, 'orders');
    await openTab(tester, 'search');
    expect(find.text('phở'), findsOneWidget);
    expect(find.text('Chưa tìm được kết quả'), findsOneWidget);
    await tester.tap(find.byKey(const Key('search-clear')));
    await tester.pump();
    expect(find.text('phở'), findsNothing);
  });

  testWidgets('diagnostics screen shows version, source SHA and both probes; back returns', (WidgetTester tester) async {
    await pump(tester, healthy());
    await openTab(tester, 'account');
    await tester.ensureVisible(find.text('Chẩn đoán kết nối'));
    await tester.tap(find.text('Chẩn đoán kết nối'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('0.1.0'), findsWidgets);
    expect(find.textContaining(sha.substring(0, 12)), findsWidgets);
    expect(find.textContaining('Còn sống'), findsWidgets);
    expect(find.textContaining('Sẵn sàng'), findsWidgets);
    expect(find.byKey(const Key('diag-recheck')), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(find.byKey(const Key('diag-recheck')), findsNothing);
  });
}
