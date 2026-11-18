import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #385: the vertical Home shop grid tile. Two per row; full-width image, rating only when real, status under the image,
// then name and compact road distance; the address is not on the Home tile.

Future<void> _pumpRow(WidgetTester tester, double width, List<ShopCardData> shops, {bool stale = false}) async {
  tester.view.physicalSize = Size(width * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(N11Space.pad),
        child: Align(
          alignment: Alignment.topCenter,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: HomeShopTile(key: Key('tile-${shops.first.shopId}'), shop: shops.first, stale: stale, onTap: () {})),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: shops.length > 1
                      ? HomeShopTile(key: Key('tile-${shops[1].shopId}'), shop: shops[1], stale: stale, onTap: () {})
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

const ShopCardData rated = ShopCardData(shopId: 'r', name: 'Ốc 11', address: '12 Đường Kim Đồng, Cao Bằng', reason: 'ONLINE', ratingAverage: 4.5, ratingCount: 12);
const ShopCardData unrated = ShopCardData(shopId: 'u', name: 'Quán mới', address: 'Phố Cũ', reason: 'ONLINE');

void main() {
  for (final double width in <double>[320, 360, 390]) {
    testWidgets('a long name, no logo and a rating fit two tiles at ${width.toInt()}px without overflow', (WidgetTester tester) async {
      await _pumpRow(tester, width, const <ShopCardData>[
        ShopCardData(shopId: 'long', name: 'Quán ăn có tên rất rất dài tại Cao Bằng, chi nhánh số hai mươi ba', address: 'x', reason: 'ONLINE', ratingAverage: 4.8, ratingCount: 3),
        rated,
      ]);
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('shop-rating-r')), findsOneWidget);
      expect(tester.getSize(find.byKey(const Key('tile-long'))).height, tester.getSize(find.byKey(const Key('tile-r'))).height);
      final Size image = tester.getSize(find.byKey(const Key('shop-image-frame-long')));
      expect(image.aspectRatio, closeTo(4 / 3, 0.01));
      expect(image.width, closeTo(tester.getSize(find.byKey(const Key('tile-long'))).width - 2, 0.01));
      expect(find.descendant(of: find.byKey(const Key('shop-logo-long')), matching: find.byIcon(Icons.storefront_outlined)), findsOneWidget);
      expect(
        tester.getTopLeft(find.byKey(const Key('shop-status-long'))).dy,
        greaterThanOrEqualTo(tester.getBottomLeft(find.byKey(const Key('shop-image-frame-long'))).dy),
      );
    });
  }

  testWidgets('a real rating shows the score on the logo; no rating shows the honest text and no score', (WidgetTester tester) async {
    await _pumpRow(tester, 390, const <ShopCardData>[rated, unrated]);
    expect(find.text('4.5'), findsOneWidget);
    // Antigravity #385 fix: an unrated tile shows no rating line (the long "Chưa có đánh giá" was cut); no score is invented.
    expect(find.text('Chưa có đánh giá'), findsNothing);
    expect(find.byKey(const Key('shop-rating-u')), findsNothing);
    expect(find.text('4.0'), findsNothing);
  });

  testWidgets('a rating count of zero is not shown as a score even if an average is sent', (WidgetTester tester) async {
    await _pumpRow(tester, 390, const <ShopCardData>[
      ShopCardData(shopId: 'z', name: 'Zero', address: 'a', reason: 'ONLINE', ratingAverage: 5, ratingCount: 0),
    ]);
    expect(find.text('5.0'), findsNothing);
    expect(find.text('Chưa có đánh giá'), findsNothing);
    expect(find.byKey(const Key('shop-rating-z')), findsNothing);
  });

  testWidgets('the Home tile shows open / closed from the data and the address is not on it', (WidgetTester tester) async {
    await _pumpRow(tester, 390, const <ShopCardData>[
      ShopCardData(shopId: 'o', name: 'Mở', address: 'ADDRESS-MARKER-OPEN', reason: 'ONLINE'),
      ShopCardData(shopId: 'c', name: 'Đóng', address: 'ADDRESS-MARKER-CLOSED', reason: 'OUTSIDE_BUSINESS_HOURS'),
    ]);
    expect(find.text('Đang mở cửa'), findsOneWidget);
    expect(find.text('Đã đóng cửa'), findsOneWidget);
    expect(find.textContaining('ADDRESS-MARKER'), findsNothing);
  });

  testWidgets('stale data is kept visible as "Chưa cập nhật", not as open or closed', (WidgetTester tester) async {
    await _pumpRow(tester, 390, const <ShopCardData>[rated], stale: true);
    expect(find.text('Chưa cập nhật'), findsOneWidget);
    expect(find.text('Đang mở cửa'), findsNothing);
  });

  testWidgets('no GPS fix: the distance line shows no kilometres and no straight-line guess', (WidgetTester tester) async {
    await _pumpRow(tester, 390, const <ShopCardData>[
      ShopCardData(shopId: 'g', name: 'Không GPS', address: 'a', reason: 'ONLINE', latitude: 22.66, longitude: 106.25),
    ]);
    expect(find.textContaining(' km'), findsNothing);
    expect(find.textContaining('km'), findsNothing);
  });
}
