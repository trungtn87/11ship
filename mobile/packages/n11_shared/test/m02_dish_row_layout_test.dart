import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Regression: at a 360dp screen or a large text scale the "+" of a customer menu row fell under the price and "Đã bán", so each card was very tall.
// The + must stay on the same line as the (long, wrapping) dish name, on the right, without overflow, and still add to the basket.

const String longName = 'Ốc hương hấp sả ớt đặc biệt kèm bơ tỏi và rau răm loại một';
final SampleDish dish = kSampleDishes[0];
final Key addKey = Key('dish-add-${dish.id}');

Future<(CartController, List<int>)> pumpRow(WidgetTester tester, double scale) async {
  tester.view.physicalSize = const Size(360 * 3, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final CartController cart = CartController(source: SampleCustomerOrders(SampleOrderStore()));
  final List<int> taps = <int>[];
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(
      body: Builder(
        builder: (BuildContext context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: DishRow(
              name: longName,
              price: '135.000đ',
              imageUrl: null,
              sub: 'Đã bán 120',
              chip: DishStepper(cart: cart, shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: dish.id, name: longName, priceVnd: dish.priceVnd),
              onTap: () => taps.add(1),
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.pump();
  return (cart, taps);
}

void main() {
  for (final double scale in <double>[1.0, 1.3, 2.0]) {
    testWidgets('customer menu row at 360dp, text scale $scale: no overflow, + on the name line, + adds to basket, card opens dish', (tester) async {
      final (CartController cart, List<int> taps) = await pumpRow(tester, scale);

      expect(tester.takeException(), isNull, reason: 'a RenderFlex overflow would be reported here');

      final Rect nameRect = tester.getRect(find.text(longName));
      final Rect headerRect = tester.getRect(find.ancestor(of: find.text(longName), matching: find.byType(Row)).first);
      final Rect plusRect = tester.getRect(find.byKey(addKey));

      expect(plusRect.center.dy, inInclusiveRange(headerRect.top, headerRect.bottom), reason: 'the + must be on the name line, not under the price');
      expect(plusRect.left, greaterThanOrEqualTo(nameRect.right), reason: 'the + sits to the right of the name');
      expect(plusRect.right, lessThanOrEqualTo(headerRect.right + 0.5), reason: 'the + is not pushed out of the row');
      expect(plusRect.width, greaterThanOrEqualTo(44), reason: 'the + keeps a 44dp tap target');

      await tester.tap(find.byKey(addKey));
      await tester.pumpAndSettle();
      expect(cart.quantityOf(dish.id), 1, reason: 'the + still adds the dish to the basket');
      expect(tester.takeException(), isNull);

      await tester.tap(find.text(longName));
      await tester.pump();
      expect(taps, hasLength(1), reason: 'tapping the card still opens the dish');
    });
  }
}
