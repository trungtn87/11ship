import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

// #387: a pin changed before the native map view exists must reach the native side once the view is created. The platform view creation is held
// until the test releases it, so the pin change happens in the gap where the channel is not yet known.

Map<String, dynamic> _pin(double lat, double lon) => <String, dynamic>{'lat': lat, 'lon': lon, 'label': 'Ghim', 'color': 0xFFC0392B};

void main() {
  testWidgets('a pin set before the native view is created is sent when it is created (not dropped)', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final TestDefaultBinaryMessengerBinding binding = TestDefaultBinaryMessengerBinding.instance;
    try {
    final Completer<void> releaseCreate = Completer<void>();
    final List<MethodCall> nativeCalls = <MethodCall>[];
    int? viewId;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform_views, (MethodCall call) async {
      if (call.method == 'create') {
        viewId = (call.arguments as Map<Object?, Object?>)['id'] as int;
        final MethodChannel nativeChannel = MethodChannel('vn.eleven/m14/map/$viewId');
        binding.defaultBinaryMessenger.setMockMethodCallHandler(nativeChannel, (MethodCall c) async {
          nativeCalls.add(c);
          if (c.method == 'state') return <String, Object?>{'ready': false, 'error': null};
          return null;
        });
        await releaseCreate.future;
        return 1;
      }
      return null;
    });

    // The screen opens with no pin, then the person taps before the native view is ready to receive anything.
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: M14OfflineMap(pins: const <Map<String, dynamic>>[], onPoint: (double a, double b, bool c) {}))));
    await tester.pump();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: M14OfflineMap(pins: <Map<String, dynamic>>[_pin(22.66, 106.25)], onPoint: (double a, double b, bool c) {}))));
    await tester.pump();
    expect(viewId, isNotNull, reason: 'the platform view was asked to be created');
    expect(nativeCalls.where((MethodCall c) => c.method == 'update'), isEmpty);

    releaseCreate.complete();
    await tester.pumpAndSettle();

    final List<MethodCall> updates = nativeCalls.where((MethodCall c) => c.method == 'update').toList();
    expect(updates, isNotEmpty, reason: 'the pin changed before the channel existed and must still reach the native map');
    final Map<dynamic, dynamic> sent = updates.last.arguments as Map<dynamic, dynamic>;
    final List<dynamic> pins = sent['pins'] as List<dynamic>;
    expect(pins, hasLength(1));
    expect((pins.single as Map<dynamic, dynamic>)['lat'], 22.66);
    expect((pins.single as Map<dynamic, dynamic>)['lon'], 106.25);
    } finally {
      debugDefaultTargetPlatformOverride = null;
      binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform_views, null);
    }
  });
}
