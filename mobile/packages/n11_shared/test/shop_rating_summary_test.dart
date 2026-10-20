import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

import 'm02_discovery_test.dart' show menuOf;
import 'm11_test.dart' show FakeM11;

class _Ratings extends FakeM11 {
  int calls = 0;
  bool fail = false;
  int count = 12;

  @override
  Future<ShopReviewPage> publicShopReviews(String shopId, {int? stars}) async {
    calls++;
    if (fail) throw Exception('offline');
    return ShopReviewPage(shopName: 'Ốc 11', summary: RatingSummary(
      average: count == 0 ? null : 4.8, count: count,
      distribution: const <int>[0, 0, 0, 2, 10]), items: const <ShopReview>[]);
  }
}

Future<void> _open(WidgetTester tester, _Ratings ratings) async {
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: ShopPublicScreen(
    api: FakePublicShopApi(menuOf('Ốc 11')), shopId: 's1', ratings: ratings,
  )));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('real score and count sit below shop information and open reviews', (tester) async {
    final ratings = _Ratings();
    await _open(tester, ratings);
    expect(find.text('4,8/5 · 12 lượt đánh giá'), findsOneWidget);
    expect(find.text('Đánh giá của khách'), findsNothing);
    expect(tester.getTopLeft(find.byKey(const Key('shop-rating-summary'))).dy,
      greaterThan(tester.getBottomLeft(find.byKey(const Key('shop-view-chip'))).dy));
    expect(ratings.calls, 1);
    await tester.tap(find.byKey(const Key('k01-ratings')));
    await tester.pumpAndSettle();
    expect(find.byType(ShopReviewsScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty score shows zero reviews without an invented star rating', (tester) async {
    await _open(tester, _Ratings()..count = 0);
    expect(find.text('Chưa có đánh giá (0 lượt)'), findsOneWidget);
    expect(find.textContaining('/5'), findsNothing);
  });

  testWidgets('a failed summary stays distinct from zero and can be retried', (tester) async {
    final ratings = _Ratings()..fail = true;
    await _open(tester, ratings);
    expect(find.text('Chưa tải được đánh giá · Thử lại'), findsOneWidget);
    expect(find.textContaining('0 lượt'), findsNothing);
    ratings.fail = false;
    await tester.tap(find.byKey(const Key('k01-ratings')));
    await tester.pumpAndSettle();
    expect(find.text('4,8/5 · 12 lượt đánh giá'), findsOneWidget);
    expect(ratings.calls, 2);
  });
}
