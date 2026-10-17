import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// M06 UI phase tests: the real (not ready) state shows no fee/offer/evaluation and no enabled action; sample data is always labelled; an unknown
// fee is never 0đ; nothing a Shipper must not see before accepting is on the offer screen; M07's actions are never simulated.

class _Failing implements ShippingFeeSource {
  @override
  bool get isSample => false;

  @override
  Future<M06Load<ShippingFeeView>> fee() async =>
      const M06Failed<ShippingFeeView>('Máy chủ không phản hồi.');
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 4200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pump();
  await tester.pump();
}

Finder text(String value) => find.text(value);
Finder containing(String value) => find.textContaining(value);
// An amount on its own ("15.000đ"), not a sentence that mentions one.
Finder money() => find.byWidgetPredicate((Widget w) =>
    w is Text && RegExp(r'^\d+(\.\d{3})*đ$').hasMatch(w.data ?? ''));
Finder button(String label) => find.widgetWithText(N11Button, label);
bool disabled(WidgetTester tester, String label) =>
    tester.widget<N11Button>(button(label)).onPressed == null;

void main() {
  group('real build: nothing is connected, so nothing is shown or enabled', () {
    testWidgets(
        'fee screen says what is missing, shows no figure and keeps "Tiếp tục" disabled with its reason',
        (WidgetTester tester) async {
      await mount(tester, const ShippingFeeScreen(source: NotReadySource()));
      expect(find.byKey(const Key('m06-fee-not-ready')), findsOneWidget);
      expect(containing('M07'), findsWidgets);
      expect(containing('M14'), findsWidgets);
      expect(money(), findsNothing);
      expect(find.byKey(const Key('m06-fee-amount')), findsNothing);
      expect(find.byKey(const Key('m06-sample-banner')), findsNothing);
      expect(button('Tiếp tục'),
          findsNothing); // the not-ready state replaces the whole body
    });

    testWidgets('offer screen shows no order, no money and cannot accept',
        (WidgetTester tester) async {
      await mount(tester, const OrderOfferScreen(source: NotReadySource()));
      expect(find.byKey(const Key('m06-offer-not-ready')), findsOneWidget);
      expect(money(), findsNothing);
      expect(containing('#GH-'), findsNothing);
      expect(button('Nhận đơn'), findsNothing);
    });

    testWidgets('batch screen shows no evaluation',
        (WidgetTester tester) async {
      await mount(
          tester, const BatchEvaluationScreen(source: NotReadySource()));
      expect(find.byKey(const Key('m06-batch-not-ready')), findsOneWidget);
      expect(containing('ETA'), findsNothing);
      expect(containing('Đạt'), findsNothing);
    });

    testWidgets('a failed read offers "Thử lại" and reads again',
        (WidgetTester tester) async {
      await mount(tester, ShippingFeeScreen(source: _Failing()));
      expect(find.byKey(const Key('m06-fee-failed')), findsOneWidget);
      await tester.tap(find.byKey(const Key('m06-fee-retry')));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('m06-fee-failed')), findsOneWidget);
    });

    test(
        'the default sources of a build are "not ready" unless the preview flag is on',
        () {
      expect(kM06UiPreview, isFalse);
      expect(buildM06Sources().fee.isSample, isFalse);
      expect(buildM06Sources(preview: true).fee.isSample, isTrue);
    });
  });

  group('11Food: Phí giao hàng (sample data)', () {
    testWidgets(
        'shows pickup, drop-off, distance, fee and payer as approved, and labels the data as a sample',
        (WidgetTester tester) async {
      await mount(tester, const ShippingFeeScreen(source: SampleM06Source()));
      expect(find.byKey(const Key('m06-sample-banner')), findsOneWidget);
      expect(text('Tọa độ quán đã xác nhận'), findsOneWidget);
      expect(text('Khách đã chọn vị trí giao'), findsOneWidget);
      expect(
          tester.widget<Text>(find.byKey(const Key('m06-fee-distance'))).data,
          '5,5 km');
      expect(tester.widget<Text>(find.byKey(const Key('m06-fee-amount'))).data,
          '15.000đ');
      expect(text('Khách trả ship'), findsOneWidget);
      expect(text('Quán trả ship'), findsOneWidget);
    });

    testWidgets(
        'a fee that is not known reads "Chưa xác định phí", never 0đ, and does not block the request',
        (WidgetTester tester) async {
      await mount(tester,
          const ShippingFeeScreen(source: SampleM06Source(feeKnown: false)));
      expect(tester.widget<Text>(find.byKey(const Key('m06-fee-amount'))).data,
          kFeeUnknownText);
      expect(
          tester.widget<Text>(find.byKey(const Key('m06-fee-distance'))).data,
          'Chưa có');
      expect(money(), findsNothing);
      expect(containing('0đ'),
          findsOneWidget); // only the sentence "không tự coi là 0đ"
      expect(find.byKey(const Key('m06-fee-unknown-note')), findsOneWidget);
    });

    testWidgets(
        '"Tiếp tục" is M07\'s: disabled with its reason without M07, and gives M07 the chosen payer when M07 provides it',
        (WidgetTester tester) async {
      await mount(tester, const ShippingFeeScreen(source: SampleM06Source()));
      expect(disabled(tester, 'Tiếp tục'), isTrue);
      expect(text(kContinueReason), findsOneWidget);

      FeePayer? chosen;
      await mount(
          tester,
          ShippingFeeScreen(
              source: const SampleM06Source(),
              onContinue: (FeePayer payer) => chosen = payer));
      await tester.tap(find.byKey(const Key('m06-payer-shop')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('m06-fee-continue')));
      expect(chosen, FeePayer.shop);
    });
  });

  group('11Ship: Đơn có thể nhận (sample data)', () {
    testWidgets(
        'shows only what is allowed before accepting: no phone, no street address, no map',
        (WidgetTester tester) async {
      await mount(tester, const OrderOfferScreen(source: SampleM06Source()));
      expect(text('#GH-1024'), findsOneWidget);
      expect(containing('Quán Ốc 11'), findsOneWidget);
      expect(containing('Khu vực TP. Cao Bằng'), findsOneWidget);
      expect(containing('chưa mở địa chỉ chi tiết'), findsOneWidget);
      expect(
          tester.widget<Text>(find.byKey(const Key('m06-offer-distance'))).data,
          '2,8 km');
      expect(tester.widget<Text>(find.byKey(const Key('m06-offer-goods'))).data,
          '180.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('m06-offer-fee'))).data,
          '15.000đ');
      // Nothing that looks like a phone number, a street address or a map.
      final Iterable<String> texts = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text t) => t.data ?? '');
      expect(texts.any((String s) => RegExp(r'(\+84|\b0\d{9}\b)').hasMatch(s)),
          isFalse);
      expect(
          texts.any((String s) =>
              RegExp(r'(số \d+|\bngõ\b|\bngách\b|đường [A-ZĐ])',
                      caseSensitive: false)
                  .hasMatch(s) &&
              !s.contains('Đường giao')),
          isFalse);
      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.map), findsNothing);
      expect(containing('Không hiển thị số điện thoại khách'), findsOneWidget);
    });

    testWidgets(
        'shows "Đủ điều kiện nhận đơn" but never accepts by itself: "Nhận đơn" is M07\'s',
        (WidgetTester tester) async {
      await mount(tester, const OrderOfferScreen(source: SampleM06Source()));
      expect(find.byKey(const Key('m06-offer-eligible')), findsOneWidget);
      expect(disabled(tester, 'Nhận đơn'), isTrue);
      expect(text(kAcceptReason), findsOneWidget);

      int accepted = 0;
      await mount(
          tester,
          OrderOfferScreen(
              source: const SampleM06Source(), onAccept: () => accepted++));
      expect(accepted, 0);
      await tester.tap(find.byKey(const Key('m06-offer-accept')));
      expect(accepted, 1);
    });

    testWidgets(
        'not eligible: the reasons are sentences (never codes) and "Nhận đơn" stays disabled even if M07 gave an action',
        (WidgetTester tester) async {
      await mount(
        tester,
        OrderOfferScreen(
            source: const SampleM06Source(
                eligible: false,
                reasonCodes: <String>[
                  'BALANCE_TOO_LOW',
                  'ACTIVE_LIMIT_REACHED'
                ]),
            onAccept: () {}),
      );
      expect(find.byKey(const Key('m06-offer-not-eligible')), findsOneWidget);
      expect(containing('Số dư ví khả dụng chưa đủ'), findsOneWidget);
      expect(containing('đạt số đơn tối đa'), findsOneWidget);
      expect(containing('BALANCE_TOO_LOW'), findsNothing);
      expect(
          tester
              .widget<N11Button>(find.byKey(const Key('m06-offer-accept')))
              .onPressed,
          isNull);
    });

    testWidgets('an unknown ship fee reads "Chưa xác định phí", never 0đ',
        (WidgetTester tester) async {
      await mount(tester,
          const OrderOfferScreen(source: SampleM06Source(feeKnown: false)));
      expect(tester.widget<Text>(find.byKey(const Key('m06-offer-fee'))).data,
          kFeeUnknownText);
    });
  });

  group('11Ship: Đánh giá ghép đơn (sample data)', () {
    testWidgets(
        'shows the ORIGINAL ETA, the accepted attempt (+3 min) and the refused one (+7 min cumulative, over the 5 minute limit)',
        (WidgetTester tester) async {
      await mount(
          tester, const BatchEvaluationScreen(source: SampleM06Source()));
      expect(
          tester
              .widget<Text>(find.byKey(const Key('m06-batch-original-eta')))
              .data,
          '18:30');
      expect(containing('Chậm thêm tối đa'), findsOneWidget);
      expect(containing('5 phút'), findsWidgets);
      expect(containing('✓ Thử ghép đơn B — Đạt'), findsOneWidget);
      expect(containing('ETA của A sau ghép: 18:33'), findsOneWidget);
      expect(containing('Chậm thêm 3 phút so với ETA gốc'), findsOneWidget);
      expect(containing('✕ Thử ghép thêm C — Không đạt'), findsOneWidget);
      expect(containing('ETA của A sau ghép: 18:37'), findsOneWidget);
      expect(containing('Chậm cộng dồn 7 phút, vượt giới hạn 5 phút'),
          findsOneWidget);
      expect(containing('M07 phải kiểm tra lại'), findsOneWidget);
    });

    testWidgets(
        'has no accept action: the button only says what cannot be accepted',
        (WidgetTester tester) async {
      await mount(
          tester, const BatchEvaluationScreen(source: SampleM06Source()));
      expect(disabled(tester, 'Không thể nhận thêm C'), isTrue);
    });
  });

  group('reason sentences', () {
    test(
        'every code M06 returns has its own short sentence, and an unknown code gets a neutral one (no raw code)',
        () {
      const List<String> codes = <String>[
        'DRIVER_NOT_ACTIVE',
        'DRIVER_NOT_ACCEPTING',
        'DRIVER_BANK_NOT_VERIFIED',
        'DELIVERY_NOT_AVAILABLE',
        'DELIVERY_SEARCH_EXPIRED',
        'LOCATION_UNAVAILABLE',
        'LOCATION_STALE',
        'SHOP_LOCATION_MISSING',
        'OUT_OF_SEARCH_RADIUS',
        'ACTIVE_LIMIT_REACHED',
        'WALLET_UNAVAILABLE',
        'BALANCE_TOO_LOW',
        'DEPENDENCY_NOT_READY',
        'ROUTE_DATA_UNAVAILABLE',
        'ROUTE_STALE',
        'BATCH_ORDER_DATA_MISSING',
        'BATCH_DELAY_EXCEEDED',
        'BATCH_BUDGET_EXCEEDED',
      ];
      final Set<String> seen = <String>{};
      for (final String code in codes) {
        final String sentence = m06ReasonText(code);
        expect(sentence, isNotEmpty);
        expect(sentence.contains('_'), isFalse, reason: code);
        expect(sentence, isNot(m06ReasonText('SOMETHING_NEW')), reason: code);
        seen.add(sentence);
      }
      expect(seen.length, codes.length);
      expect(m06ReasonText('SOMETHING_NEW'), 'Chưa đủ điều kiện nhận đơn này.');
    });
  });
}
