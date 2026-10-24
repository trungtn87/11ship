import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14/n11_m14.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_home.dart';

void main() {
  testWidgets('offline region needs no GPS; recenter is explicit; errors are compact and retryable', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    Future<void> home({Map<String, dynamic>? position}) => tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(), home: Scaffold(body: ShipHomeLayout(reason: kOnlineReason,
        onNotifications: () {}, position: position)),
    ));
    await home();
    M14OfflineMap map = tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
    expect(map.pins, isEmpty, reason: 'regional Cao Bang center is not a shipper location');
    expect(map.focusPin, isFalse);
    expect(find.byKey(const Key('home-gps-status')), findsNothing, reason: 'no status line while there is nothing to say');
    expect(tester.widget<IconButton>(find.byKey(const Key('home-recenter'))).onPressed, isNull);
    map.onReady!();
    await home(position: <String, dynamic>{'lat': 22.67, 'lon': 106.26});
    map = tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
    expect(map.pins.single['lat'], 22.67);
    expect(map.centerRequest, 0);
    await tester.tap(find.byKey(const Key('home-recenter')));
    await tester.pump();
    expect(tester.widget<M14OfflineMap>(find.byType(M14OfflineMap)).centerRequest, 1);
    await home(position: <String, dynamic>{'lat': 22.68, 'lon': 106.27});
    map = tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
    expect(map.centerRequest, 1, reason: 'new GPS fixes must not move the camera');
    map.onError!('Không mở được gói bản đồ Cao Bằng');
    await tester.pump();
    expect(find.byType(M14OfflineMap), findsNothing);
    expect(find.byKey(const Key('home-map-unavailable')), findsOneWidget);
    await tester.tap(find.text('Thử lại bản đồ'));
    await tester.pump();
    expect(find.byType(M14OfflineMap), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  }, skip: !kM14MapEnabled);

  testWidgets('unknown activity and missing map fit a small phone with large text', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.8)),
      child: Scaffold(body: ShipHomeLayout(reason: kOnlineReason, onNotifications: () {})),
    )));
    expect(find.text('Chưa xác định trạng thái hoạt động'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('online-button'))).onPressed, isNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  }, skip: kM14MapEnabled);
}
