import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/v5_preview.dart';

void main() {
  for (final brand in [foodBrand, shipBrand]) {
    testWidgets('${brand.name} preview keeps the original PNG logo', (tester) async {
      await tester.pumpWidget(V5PreviewApp(isFood: brand.id == AppId.food));
      await tester.pumpAndSettle();
      final logoFinder = find.byType(BrandLogo);
      expect(logoFinder, findsOneWidget);
      final logo = tester.widget<BrandLogo>(logoFinder);
      expect(logo.brand, same(brand));
      final picture = tester.widget<Image>(
        find.descendant(of: logoFinder, matching: find.byType(Image)),
      );
      final asset = picture.image as AssetImage;
      expect(asset.assetName, brand.logoAsset);
      expect(asset.package, kSharedPackage);
      // Text fallback must never replace the approved PNG.
      expect(find.text(brand.name), findsNothing);
    });
  }
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
