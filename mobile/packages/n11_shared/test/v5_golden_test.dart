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
      final family = data['family'] as String;
      // Package widgets specify package: 'n11_shared'. When golden tests run
      // from the n11_shared root, FontManifest may list the unprefixed family.
      // Register both forms, otherwise Ahem renders unreadable black squares.
      final aliases = <String>{family};
      if (!family.startsWith('packages/')) {
        aliases.add('packages/n11_shared/$family');
      }
      for (final alias in aliases) {
        final loader = FontLoader(alias);
        for (final asset in data['fonts'] as List<dynamic>) {
          loader.addFont(rootBundle.load((asset as Map<String, dynamic>)['asset'] as String));
        }
        loaders.add(loader);
      }
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
  // These are screenshot generators, not regression tests until checked-in
  // baselines exist. Normal flutter test must not compare missing PNG files.
  // The dedicated workflow runs flutter test --update-goldens, which enables
  // autoUpdateGoldenFiles and writes 390x844 PNG screenshots as artifacts.
  testWidgets('capture actual Flutter 11Food home', (tester) async {
    await capture(tester, food: true);
  }, skip: !autoUpdateGoldenFiles);
  testWidgets('capture actual Flutter 11Ship home', (tester) async {
    await capture(tester, food: false);
  }, skip: !autoUpdateGoldenFiles);
}
