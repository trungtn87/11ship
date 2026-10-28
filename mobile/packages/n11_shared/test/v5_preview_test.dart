import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/v5_preview.dart';

void main() {
  testWidgets('11Food owner: four tabs switch without API', (tester) async {
    await tester.pumpWidget(const V5PreviewApp(isFood: true));
    expect(find.byKey(const Key('v5-tab-3')), findsOneWidget);
    await tester.tap(find.byKey(const Key('v5-tab-2')));
    await tester.pumpAndSettle();
    expect(find.text('Quán'), findsWidgets);
    await tester.tap(find.byKey(const Key('v5-tab-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('v5-food-home')), findsOneWidget);
  });
  testWidgets('11Food customer: three tabs switch', (tester) async {
    await tester.pumpWidget(const V5PreviewApp(isFood: true, shopOwner: false));
    expect(find.byKey(const Key('v5-tab-2')), findsOneWidget);
    expect(find.byKey(const Key('v5-tab-3')), findsNothing);
    await tester.tap(find.byKey(const Key('v5-tab-2')));
    await tester.pumpAndSettle();
    expect(find.text('Tài khoản'), findsWidgets);
  });
  testWidgets('11Ship: five tabs and visual-only online toggle', (tester) async {
    await tester.pumpWidget(const V5PreviewApp(isFood: false));
    expect(find.byKey(const Key('v5-tab-4')), findsOneWidget);
    await tester.tap(find.byKey(const Key('v5-online-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('Đang offline'), findsOneWidget);
    await tester.tap(find.byKey(const Key('v5-tab-2')));
    await tester.pumpAndSettle();
    expect(find.text('Thu nhập'), findsWidgets);
    await tester.tap(find.byKey(const Key('v5-tab-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('v5-ship-home')), findsOneWidget);
  });
}
