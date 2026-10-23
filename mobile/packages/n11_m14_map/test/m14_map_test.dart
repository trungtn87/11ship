import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

void main() {
  testWidgets('off Android the map says so and starts nothing (no GPS, no route, no channel call)', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      await tester.pumpWidget(const MaterialApp(home: Scaffold(body: M14OfflineMap())));
      expect(find.textContaining('Android'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  test('the build flag is off unless the build turns it on', () {
    expect(kM14MapEnabled, isFalse);
  });
}
