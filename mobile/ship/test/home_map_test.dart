import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14/n11_m14.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_home.dart';

void main() {
  testWidgets(
    'offline region needs no GPS; recenter is explicit; errors are compact and retryable',
    (WidgetTester tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      Future<void> home({Map<String, dynamic>? position}) => tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(),
          home: Scaffold(
            body: ShipHomeLayout(
              reason: kOnlineReason,
              onNotifications: () {},
              position: position,
            ),
          ),
        ),
      );
      await home();
      M14OfflineMap map = tester.widget<M14OfflineMap>(
        find.byType(M14OfflineMap),
      );
      expect(
        map.pins,
        isEmpty,
        reason: 'regional Cao Bang center is not a shipper location',
      );
      expect(map.focusPin, isFalse);
      expect(find.text('Chờ vị trí để hiện bán kính'), findsOneWidget);
      expect(find.text(kShipRadiusLabel), findsNothing);
      expect(
        find.byKey(const Key('home-gps-status')),
        findsNothing,
        reason: 'no status line while there is nothing to say',
      );
      expect(
        tester
            .widget<IconButton>(find.byKey(const Key('home-recenter')))
            .onPressed,
        isNull,
      );
      map.onReady!();
      await tester.pump();
      expect(
        find.bySemanticsLabel('Bản đồ offline Cao Bằng đã hiển thị'),
        findsOneWidget,
      );
      await home(position: <String, dynamic>{'lat': 22.67, 'lon': 106.26});
      map = tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
      expect(map.pins.single['lat'], 22.67);
      expect(map.radiusCircle, containsPair('radius_m', 3000.0));
      expect(map.radiusCircle, containsPair('lat', 22.67));
      expect(
        find.text('Bán kính nhận đơn 3 km quanh vị trí của bạn (đường thẳng)'),
        findsOneWidget,
      );
      expect(find.text('Chờ vị trí để hiện bán kính'), findsNothing);
      expect(map.centerRequest, 0);
      // The honest label is longer and wraps, so the map starts lower; bring the button into view like a person scrolling would.
      await tester.ensureVisible(find.byKey(const Key('home-recenter')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('home-recenter')));
      await tester.pump();
      expect(
        tester.widget<M14OfflineMap>(find.byType(M14OfflineMap)).centerRequest,
        1,
      );
      await home(position: <String, dynamic>{'lat': 22.68, 'lon': 106.27});
      map = tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
      expect(
        map.centerRequest,
        1,
        reason: 'new GPS fixes must not move the camera',
      );
      expect(
        map.radiusCircle,
        containsPair('lat', 22.68),
        reason: 'the visual radius follows GPS without requesting a recenter',
      );
      map.onError!('Không mở được gói bản đồ Cao Bằng');
      await tester.pump();
      expect(find.byType(M14OfflineMap), findsNothing);
      expect(find.byKey(const Key('home-map-unavailable')), findsOneWidget);
      await tester.tap(find.text('Thử lại bản đồ'));
      await tester.pump();
      expect(find.byType(M14OfflineMap), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      debugDefaultTargetPlatformOverride = null;
    },
    skip: !kM14MapEnabled,
  );

  // #294 item 6: inside the 3 km ring the map keeps its own colours, outside is greyed, and a position the ring cannot honestly be drawn around draws nothing.
  Future<M14OfflineMap> homeMap(
    WidgetTester tester, {
    Map<String, dynamic>? position,
    bool exempt = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildN11Theme(),
        home: Scaffold(
          body: ShipHomeLayout(
            reason: kOnlineReason,
            onNotifications: () {},
            position: position,
            radiusExempt: exempt,
          ),
        ),
      ),
    );
    return tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
  }

  testWidgets(
    'ring: no tint inside, grey outside, clear border, 3000 m, honest label',
    (WidgetTester tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final M14OfflineMap map = await homeMap(
        tester,
        position: <String, dynamic>{'lat': 22.67, 'lon': 106.26},
      );
      final Map<String, dynamic> ring = map.radiusCircle!;
      expect(ring['radius_m'], kShipSearchRadiusM);
      expect(kShipSearchRadiusM, 3000.0);
      expect(
        ring.containsKey('fill_color'),
        isFalse,
        reason: 'the old blue tint inside the ring is gone',
      );
      expect(ring['outside_color'], kShipRadiusOutsideColor);
      final int alpha = (kShipRadiusOutsideColor >> 24) & 0xFF;
      expect(alpha, inInclusiveRange(0x40, 0x90), reason: 'medium alpha: names stay readable');
      expect(ring['color'], kShipRadiusBorderColor);
      expect(find.text(kShipRadiusLabel), findsOneWidget);
      expect(find.text(kShipRadiusExemptLabel), findsNothing);
      await tester.pumpWidget(const SizedBox());
      debugDefaultTargetPlatformOverride = null;
    },
    skip: !kM14MapEnabled,
  );

  testWidgets(
    'PLATFORM-exempt account: no grey mask and a label that does not claim the radius limits it',
    (WidgetTester tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final M14OfflineMap map = await homeMap(
        tester,
        position: <String, dynamic>{'lat': 22.67, 'lon': 106.26},
        exempt: true,
      );
      expect(map.radiusCircle, isNotNull);
      expect(map.radiusCircle!.containsKey('outside_color'), isFalse);
      expect(find.text(kShipRadiusExemptLabel), findsOneWidget);
      expect(find.text(kShipRadiusLabel), findsNothing);
      await tester.pumpWidget(const SizedBox());
      debugDefaultTargetPlatformOverride = null;
    },
    skip: !kM14MapEnabled,
  );

  for (final Map<String, dynamic> bad in <Map<String, dynamic>>[
    <String, dynamic>{'lat': 0.0, 'lon': 0.0},
    <String, dynamic>{'lat': 0, 'lon': 0},
    <String, dynamic>{'lat': double.nan, 'lon': 106.26},
    <String, dynamic>{'lat': 22.67, 'lon': double.infinity},
    <String, dynamic>{'lat': 91.0, 'lon': 106.26},
    <String, dynamic>{'lat': 22.67, 'lon': -181.0},
    <String, dynamic>{'lat': '22.67', 'lon': 106.26},
    <String, dynamic>{'lat': 22.67},
  ]) {
    testWidgets(
      'unusable GPS $bad draws no ring and no pin',
      (WidgetTester tester) async {
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        addTearDown(() => debugDefaultTargetPlatformOverride = null);
        final M14OfflineMap map = await homeMap(tester, position: bad);
        expect(map.radiusCircle, isNull);
        expect(map.pins, isEmpty);
        expect(find.text('Chờ vị trí để hiện bán kính'), findsOneWidget);
        expect(
          tester
              .widget<IconButton>(find.byKey(const Key('home-recenter')))
              .onPressed,
          isNull,
        );
        await tester.pumpWidget(const SizedBox());
        debugDefaultTargetPlatformOverride = null;
      },
      skip: !kM14MapEnabled,
    );
  }

  test('shipRadiusCentreUsable accepts real positions only', () {
    expect(shipRadiusCentreUsable(null), isFalse);
    expect(shipRadiusCentreUsable(<String, dynamic>{'lat': 22.67, 'lon': 106.26}), isTrue);
    expect(shipRadiusCentreUsable(<String, dynamic>{'lat': 0.0, 'lon': 106.26}), isTrue, reason: 'only the exact (0,0) pair is a placeholder');
    expect(shipRadiusCentreUsable(<String, dynamic>{'lat': 0, 'lon': 0}), isFalse);
    expect(shipRadiusCentreUsable(<String, dynamic>{'lat': -90.0, 'lon': 180.0}), isTrue);
    expect(shipRadiusCentreUsable(<String, dynamic>{'lat': 90.0001, 'lon': 0.1}), isFalse);
  });

  testWidgets(
    'unknown activity and missing map fit a small phone with large text',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(),
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.8)),
            child: Scaffold(
              body: ShipHomeLayout(
                reason: kOnlineReason,
                onNotifications: () {},
              ),
            ),
          ),
        ),
      );
      expect(find.text('Chưa xác định trạng thái hoạt động'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('online-button')))
            .onPressed,
        isNull,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
    skip: kM14MapEnabled,
  );
}
