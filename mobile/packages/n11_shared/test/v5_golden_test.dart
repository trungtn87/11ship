import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/v5_preview.dart';

void main() {
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
