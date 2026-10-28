import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/v5_preview.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    // Widget tests default to Ahem (black rectangles). Load the actual app
    // font manifest, including Plus Jakarta Sans and MaterialIcons, so the
    // screenshot contains real Vietnamese glyphs and icons.
    final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<dynamic>;
    final loaders = <FontLoader>[];
    for (final entry in manifest) {
      final data = entry as Map<String, dynamic>;
      final loader = FontLoader(data['family'] as String);
      for (final asset in data['fonts'] as List<dynamic>) {
        loader.addFont(rootBundle.load((asset as Map<String, dynamic>)['asset'] as String));
      }
      loaders.add(loader);
    }
    await Future.wait(loaders.map((loader) => loader.load()));
  });

  Future<void> capture(WidgetTester tester, {required bool food}) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(V5PreviewApp(isFood: food));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(food ? 'goldens/11food_home.png' : 'goldens/11ship_home.png'),
    );
  }
  testWidgets('capture actual Flutter 11Food home', (tester) async {
    await capture(tester, food: true);
  });
  testWidgets('capture actual Flutter 11Ship home', (tester) async {
    await capture(tester, food: false);
  });
}
