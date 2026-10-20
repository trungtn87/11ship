import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:n11_shared/src/flows/shop_logo_data.dart';
import 'package:n11_shared/src/flows/shop_logo_widgets.dart';

import 'm02_shop_views_test.dart' show harness, tapKey;

const String png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEklEQVR4nGN8tEOeAQaYGJAAACppAb0V3EgsAAAAAElFTkSuQmCC';

void main() {
  test('logo data round trips and malformed optional data is rejected', () {
    final ShopLogoData? logo = ShopLogoData.tryParse(<String, Object?>{'content_type': 'image/png', 'data_base64': png});
    expect(logo!.bytes, base64Decode(png));
    expect(ShopLogoData.tryParse(logo.toWire()), logo);
    expect(ShopLogoData.tryParse(<String, Object?>{'content_type': 'image/svg+xml', 'data_base64': png}), isNull);
    expect(ShopLogoData.tryParse(<String, Object?>{'content_type': 'image/png', 'data_base64': 3}), isNull);
  });

  testWidgets('pick, crop square, replace and remove are local edits; cancel and disabled state preserve the logo', (WidgetTester tester) async {
    final h = await harness(tester);
    final FakeImagePicker picker = FakeImagePicker()..next = PickedImage(bytes: base64Decode(png), contentType: 'image/png');
    ShopLogoData? value;
    bool enabled = true;
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: StatefulBuilder(builder: (BuildContext context, StateSetter set) => Scaffold(body: ShopLogoField(
      value: value, picker: picker, session: h.session, enabled: enabled, onChanged: (ShopLogoData? next) => set(() => value = next),
    )))));
    await tapKey(tester, 'shop-logo-pick');
    await tester.runAsync(() async { await Future<void>.delayed(const Duration(milliseconds: 100)); });
    await tester.pumpAndSettle();
    await tapKey(tester, 'shop-logo-crop-done');
    await tester.runAsync(() async { await Future<void>.delayed(const Duration(milliseconds: 100)); });
    await tester.pumpAndSettle();
    expect(value, isNotNull);
    expect(value!.contentType, 'image/png');
    final ShopLogoData original = value!;
    picker.next = null;
    await tapKey(tester, 'shop-logo-pick');
    expect(value, original);
    await tapKey(tester, 'shop-logo-remove');
    expect(value, isNull);
    enabled = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ShopLogoField(value: original, picker: picker, session: h.session, enabled: enabled, onChanged: (_) => fail('disabled')))));
    expect(tester.widget<N11Button>(find.byKey(const Key('shop-logo-pick'))).onPressed, isNull);
    expect(tester.widget<TextButton>(find.byKey(const Key('shop-logo-remove'))).onPressed, isNull);
  });
}
