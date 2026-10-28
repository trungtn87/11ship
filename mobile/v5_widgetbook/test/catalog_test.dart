import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:widgetbook/widgetbook.dart';

import 'package:v5_widgetbook/catalog.dart';

void main() {
  test('catalog includes two real V5 apps and shared design system', () {
    final directories = buildV5Catalog();
    expect(directories, hasLength(3));
    final food = directories[0] as WidgetbookFolder;
    final ship = directories[1] as WidgetbookFolder;
    final common = directories[2] as WidgetbookFolder;
    expect(food.name, '11Food V5');
    expect(ship.name, '11Ship V5');
    expect(common.name, 'Shared Design System');
    final foodHome = food.children!.single as WidgetbookComponent;
    final shipHome = ship.children!.single as WidgetbookComponent;
    expect(foodHome.useCases, hasLength(2)); // customer and owner
    expect(shipHome.useCases, hasLength(1)); // shipper, 5 tabs
    expect(foodHome.useCases.first.designLink, contains('node-id=6-2'));
    expect(shipHome.useCases.first.designLink, contains('node-id=7-2'));
    expect(common.children!.whereType<WidgetbookComponent>(), hasLength(4));
  });

  testWidgets('Widgetbook previews the actual 11Ship tabs without backend',
      (tester) async {
    tester.view.physicalSize = const Size(1100, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: V5PhonePreview(isFood: false)),
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('v5-ship-home')), findsOneWidget);
    await tester.tap(find.byKey(const Key('v5-tab-2')));
    await tester.pumpAndSettle();
    expect(find.text('Thu nhập'), findsWidgets);
  });
}
