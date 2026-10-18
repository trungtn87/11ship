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
  tester.view.physicalSize = const Size(1080, 7200);
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

FeeAgreementView _agreement(AgreementState state, {int? finalFee}) => FeeAgreementView(
      mode: FeeMode.agreed,
      state: state,
      payer: FeePayer.customer,
      baseFeeVnd: 15000,
      reason: FeeReason.badWeather,
      proposedFeeVnd: 25000,
      counterFeeVnd: state == AgreementState.countered || state == AgreementState.awaitingCustomer || state == AgreementState.accepted ? 30000 : null,
      finalFeeVnd: finalFee,
      expiresAt: DateTime(2026, 10, 18, 9, 30),
    );

class _ShopActions implements ShopFeeActions {
  _ShopActions({this.fail = false});
  final bool fail;
  final List<String> calls = <String>[];
  Future<void> _do(String c) async {
    calls.add(c);
    if (fail) {
      throw StateError('x');
    }
  }

  @override
  Future<void> useStandard(FeePayer payer) => _do('standard:${payer.name}');
  @override
  Future<void> propose({required FeePayer payer, required FeeReason reason, String? note, required int amountVnd}) =>
      _do('propose:${payer.name}:${reason.name}:$note:$amountVnd');
  @override
  Future<void> acceptCounter() => _do('accept');
  @override
  Future<void> rejectCounter() => _do('reject');
}

class _ShipActions implements ShipperFeeActions {
  final List<String> calls = <String>[];
  @override
  Future<void> agree() async => calls.add('agree');
  @override
  Future<void> skip() async => calls.add('skip');
  @override
  Future<void> counter(int amountVnd) async => calls.add('counter:$amountVnd');
}

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

    testWidgets('without M07 actions the request button is disabled with its reason and nothing is sent',
        (WidgetTester tester) async {
      await mount(tester, const ShippingFeeScreen(source: SampleM06Source()));
      expect(text(kAgreementReason), findsOneWidget);
      expect(find.byKey(const Key('m06-fee-submit')), findsNothing);
      expect(find.byKey(const Key('m06-mode-standard')), findsOneWidget);
      expect(find.byKey(const Key('m06-mode-agreed')), findsOneWidget);
    });

    testWidgets('standard mode gives M07 the chosen payer', (WidgetTester tester) async {
      final _ShopActions actions = _ShopActions();
      await mount(tester, ShippingFeeScreen(source: const SampleM06Source(), actions: actions));
      await tester.tap(find.byKey(const Key('m06-payer-shop')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('m06-fee-submit')));
      await tester.pump();
      expect(actions.calls, <String>['standard:shop']);
    });

    testWidgets('agreed mode: needs a reason and a whole-VND amount; OTHER needs a note; a phone number in the note is refused',
        (WidgetTester tester) async {
      final _ShopActions actions = _ShopActions();
      await mount(tester, ShippingFeeScreen(source: const SampleM06Source(), actions: actions));
      await tester.tap(find.byKey(const Key('m06-mode-agreed')));
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất phí'), isTrue);
      await tester.tap(find.byKey(const Key('m06-reason-other')));
      await tester.enterText(find.byKey(const Key('m06-agreed-amount')), '25000');
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất phí'), isTrue); // OTHER without a note
      await tester.enterText(find.byKey(const Key('m06-agreed-note')), 'Gọi 0912345678 nhé');
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất phí'), isTrue);
      expect(containing('số điện thoại'), findsWidgets);
      await tester.enterText(find.byKey(const Key('m06-agreed-note')), 'Hàng nặng');
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất phí'), isFalse);
      await tester.enterText(find.byKey(const Key('m06-agreed-amount')), '12000000'); // above the cap: refused, not clamped
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất phí'), isTrue);
      await tester.enterText(find.byKey(const Key('m06-agreed-amount')), '25000');
      await tester.pump();
      expect(containing('khách phải đồng ý'), findsOneWidget);
      await tester.tap(find.byKey(const Key('m06-fee-submit')));
      await tester.pump();
      expect(actions.calls, <String>['propose:customer:other:Hàng nặng:25000']);
    });

    testWidgets('out of the price table: "Ngoài bảng giá", never 0đ; only an agreement can go on',
        (WidgetTester tester) async {
      await mount(tester, ShippingFeeScreen(source: const SampleM06Source(outOfPriceRange: true), actions: _ShopActions()));
      expect(tester.widget<Text>(find.byKey(const Key('m06-fee-amount'))).data, kOutOfRangeText);
      expect(find.byKey(const Key('m06-fee-out-of-range-note')), findsOneWidget);
      expect(money(), findsNothing);
      expect(find.byKey(const Key('m06-reason-outsideTable')), findsOneWidget); // agreed mode is forced
    });

    testWidgets('a failed send shows "Chưa gửi được" and lets the shop try again', (WidgetTester tester) async {
      final _ShopActions actions = _ShopActions(fail: true);
      await mount(tester, ShippingFeeScreen(source: const SampleM06Source(), actions: actions));
      await tester.tap(find.byKey(const Key('m06-fee-submit')));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('m06-agreement-error')), findsOneWidget);
      expect(disabled(tester, 'Dùng phí theo bảng giá'), isFalse);
    });

    testWidgets('countered: shows the shipper amount and the original proposal; reject keeps the search going',
        (WidgetTester tester) async {
      final _ShopActions actions = _ShopActions();
      await mount(tester, ShippingFeeScreen(source: SampleM06Source(agreement: _agreement(AgreementState.countered)), actions: actions));
      expect(text('Shipper đề xuất mức khác'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-counter'))).data, '30.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-proposed'))).data, '25.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-final'))).data, 'Chưa chốt');
      expect(find.byKey(const Key('m06-counter-reject-note')), findsOneWidget);
      await tester.tap(find.byKey(const Key('m06-counter-reject')));
      await tester.pump();
      await tester.pump();
      await tester.tap(find.byKey(const Key('m06-counter-accept')));
      await tester.pump();
      expect(actions.calls, <String>['reject', 'accept']);
    });

    testWidgets('countered without M07 actions: both answers disabled with the reason', (WidgetTester tester) async {
      await mount(tester, ShippingFeeScreen(source: SampleM06Source(agreement: _agreement(AgreementState.countered))));
      expect(disabled(tester, 'Đồng ý'), isTrue);
      expect(disabled(tester, 'Từ chối'), isTrue);
      expect(text(kAgreementReason), findsOneWidget);
    });

    testWidgets('customer pays and the amount differs: pending, not final, until the customer agrees',
        (WidgetTester tester) async {
      await mount(tester, ShippingFeeScreen(source: SampleM06Source(agreement: _agreement(AgreementState.awaitingCustomer))));
      expect(text('Chờ khách xác nhận'), findsOneWidget);
      expect(find.byKey(const Key('m06-agreement-awaiting-customer')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-final'))).data, 'Chưa chốt');
    });

    testWidgets('accepted shows the final fee', (WidgetTester tester) async {
      await mount(tester, ShippingFeeScreen(source: SampleM06Source(agreement: _agreement(AgreementState.accepted, finalFee: 30000))));
      expect(text('Đã chốt phí'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-final'))).data, '30.000đ');
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

  group('11Ship: phí thỏa thuận trước khi nhận (sample data)', () {
    testWidgets('proposed: shows amount and reason, agree / skip / counter; no private data', (WidgetTester tester) async {
      final _ShipActions actions = _ShipActions();
      await mount(tester, OrderOfferScreen(source: SampleM06Source(agreement: _agreement(AgreementState.proposed)), actions: actions, onAccept: () {}));
      expect(tester.widget<Text>(find.byKey(const Key('m06-offer-fee'))).data, '25.000đ (đề xuất)');
      expect(tester.widget<Text>(find.byKey(const Key('m06-agreement-reason'))).data, 'Thời tiết xấu');
      final Iterable<String> texts = tester.widgetList<Text>(find.byType(Text)).map((Text t) => t.data ?? '');
      expect(texts.any((String s) => RegExp(r'(\+84|\b0\d{9}\b)').hasMatch(s)), isFalse);
      expect(button('Nhận đơn'), findsNothing); // cannot accept before the fee is final
      await tester.tap(find.byKey(const Key('m06-fee-agree')));
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const Key('m06-fee-skip')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(actions.calls, <String>['agree', 'skip']);
    });

    testWidgets('counter amount must be whole VND within the cap', (WidgetTester tester) async {
      final _ShipActions actions = _ShipActions();
      await mount(tester, OrderOfferScreen(source: SampleM06Source(agreement: _agreement(AgreementState.proposed)), actions: actions));
      await tester.tap(find.byKey(const Key('m06-fee-counter-open')));
      await tester.pump();
      final Finder field = find.byKey(const Key('m06-counter-amount'));
      await tester.enterText(field, '99999999');
      await tester.pump();
      expect(disabled(tester, 'Gửi đề xuất'), isTrue);
      await tester.enterText(field, '30000');
      await tester.pump();
      await tester.tap(find.byKey(const Key('m06-counter-send')));
      await tester.pump();
      expect(actions.calls, <String>['counter:30000']);
    });

    testWidgets('without M07 actions the answers are disabled with the reason', (WidgetTester tester) async {
      await mount(tester, OrderOfferScreen(source: SampleM06Source(agreement: _agreement(AgreementState.proposed))));
      expect(disabled(tester, 'Đồng ý mức phí'), isTrue);
      expect(text(kAgreementReason), findsWidgets);
    });

    testWidgets('countered: waits for the shop, nothing to accept yet', (WidgetTester tester) async {
      await mount(tester, OrderOfferScreen(source: SampleM06Source(agreement: _agreement(AgreementState.countered)), onAccept: () {}));
      expect(find.byKey(const Key('m06-offer-waiting-shop')), findsOneWidget);
      expect(find.byKey(const Key('m06-offer-accept')), findsNothing);
    });

    testWidgets('accepted: the final fee shows and "Nhận đơn" is M07\'s', (WidgetTester tester) async {
      await mount(tester, OrderOfferScreen(source: SampleM06Source(agreement: _agreement(AgreementState.accepted, finalFee: 30000)), onAccept: () {}));
      expect(tester.widget<Text>(find.byKey(const Key('m06-offer-fee'))).data, '30.000đ');
      expect(find.byKey(const Key('m06-offer-accept')), findsOneWidget);
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
