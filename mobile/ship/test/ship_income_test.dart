import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ship/ship_income_data.dart';
import 'package:ship/ship_income_view.dart';

// #395 Thu nhập: the period rules (Vietnam day), the strict reader of the server answer, and the screen states. Figures here are FIXTURE values chosen for the
// test; the screen never ships a number of its own.

final DateTime fixedNow = DateTime.utc(2026, 11, 18, 5); // Vietnam 18/11/2026 12:00

Map<String, Object?> _day(String date, int completed, int fee, int commission, bool provisional) => <String, Object?>{
      'date': date,
      'completed_count': completed,
      'fee_vnd': fee,
      'platform_commission_vnd': commission,
      'net_estimated_vnd': fee + commission,
      'net_is_provisional': provisional,
    };

Map<String, Object?> _answer({required String from, required String to, required int days, required List<Map<String, Object?>> daily, int completed = 4, int fee = 42000, int commission = -4500, int? net, bool provisional = true, int? average = 10500}) => <String, Object?>{
      'period': <String, Object?>{'from': from, 'to': to, 'days': days, 'timezone': 'Asia/Ho_Chi_Minh'},
      'summary': <String, Object?>{
        'completed_count': completed,
        'fee_vnd': fee,
        'platform_commission_vnd': commission,
        'net_estimated_vnd': net ?? fee + commission,
        'net_is_provisional': provisional,
        'average_fee_vnd': average,
      },
      'daily': daily,
      'driver_status': 'ACTIVE',
      'limited_access': false,
    };

IncomeSummary _fixtureSummary() => IncomeSummary(
      from: '2026-11-17',
      to: '2026-11-18',
      days: 2,
      completed: 4,
      feeVnd: 42000,
      commissionVnd: -4500,
      netVnd: 37500,
      netProvisional: true,
      averageVnd: 10500,
      daily: const <IncomeDay>[
        IncomeDay(date: '2026-11-17', completed: 1, feeVnd: 10000, commissionVnd: -1000, netVnd: 9000, provisional: false),
        IncomeDay(date: '2026-11-18', completed: 3, feeVnd: 32000, commissionVnd: -3500, netVnd: 28500, provisional: true),
      ],
    );

class FakeIncomeSource implements IncomeSource {
  FakeIncomeSource(this.answers);

  /// Answers in order; the last one repeats.
  final List<IncomeLoad> answers;
  final List<IncomePeriod> asked = <IncomePeriod>[];

  @override
  Future<IncomeLoad> load(IncomePeriod period) async {
    asked.add(period);
    return answers[(asked.length - 1).clamp(0, answers.length - 1)];
  }
}

Future<void> _pump(WidgetTester tester, IncomeSource source, {Size size = const Size(390, 900)}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: IncomeBody(source: source, now: () => fixedNow),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('period rules', () {
    test('the Vietnam day decides the date: 23:59 VN is the same day, 00:00 VN is the next day', () {
      expect(isoDay(vietnamDayOf(DateTime.utc(2026, 11, 17, 16, 59))), '2026-11-17');
      expect(isoDay(vietnamDayOf(DateTime.utc(2026, 11, 17, 17, 0))), '2026-11-18');
    });

    test('presets: today, 7 days and 30 days include today', () {
      final IncomePeriod today = IncomePeriod.forPreset(IncomePreset.today, fixedNow);
      expect(today.query, 'from=2026-11-18&to=2026-11-18');
      expect(today.days, 1);
      final IncomePeriod seven = IncomePeriod.forPreset(IncomePreset.last7, fixedNow);
      expect(seven.query, 'from=2026-11-12&to=2026-11-18');
      expect(seven.days, 7);
      final IncomePeriod thirty = IncomePeriod.forPreset(IncomePreset.last30, fixedNow);
      expect(thirty.days, 30);
      expect(thirty.isValid, isTrue);
    });

    test('a period longer than 92 days, or reversed, is not valid', () {
      expect(IncomePeriod(from: DateTime(2026, 8, 1), to: DateTime(2026, 10, 31)).isValid, isTrue);
      expect(IncomePeriod(from: DateTime(2026, 7, 31), to: DateTime(2026, 10, 31)).isValid, isFalse);
      expect(IncomePeriod(from: DateTime(2026, 11, 18), to: DateTime(2026, 11, 17)).isValid, isFalse);
    });
  });

  group('strict reading of the server answer', () {
    final IncomePeriod asked = IncomePeriod(from: DateTime(2026, 11, 17), to: DateTime(2026, 11, 18));
    List<Map<String, Object?>> days() => <Map<String, Object?>>[_day('2026-11-17', 1, 10000, -1000, false), _day('2026-11-18', 3, 32000, -3500, true)];

    test('reads the figures as the server gave them', () {
      final IncomeSummary s = parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days()), asked);
      expect(s.feeVnd, 42000);
      expect(s.commissionVnd, -4500);
      expect(s.netVnd, 37500);
      expect(s.netProvisional, isTrue);
      expect(s.averageVnd, 10500);
      expect(s.daily.map((IncomeDay d) => d.date), <String>['2026-11-17', '2026-11-18']);
    });

    test('refuses an answer for another period, a wrong daily length, a float, a negative fee, and a net that does not add up', () {
      expect(() => parseIncomeSummary(_answer(from: '2026-11-16', to: '2026-11-18', days: 3, daily: <Map<String, Object?>>[_day('2026-11-16', 0, 0, 0, false), ...days()]), asked), throwsFormatException);
      expect(() => parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days().sublist(0, 1)), asked), throwsFormatException);
      final Map<String, Object?> floatFee = _answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days());
      (floatFee['summary']! as Map<String, Object?>)['fee_vnd'] = 420.5;
      expect(() => parseIncomeSummary(floatFee, asked), throwsFormatException);
      expect(() => parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), fee: -1), asked), throwsFormatException);
      expect(() => parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), net: 1), asked), throwsFormatException);
    });

    test('average is null only when there is no completed delivery, and a positive commission is refused', () {
      expect(() => parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), completed: 0, fee: 0, commission: 0, average: 5000), asked), throwsFormatException);
      expect(() => parseIncomeSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), commission: 500), asked), throwsFormatException);
    });
  });

  group('the screen', () {
    testWidgets('shows the server figures, the commission as a deduction, the provisional tag and the statistics', (tester) async {
      await _pump(tester, FakeIncomeSource(<IncomeLoad>[IncomeReady(_fixtureSummary())]));
      expect(find.text('42.000 đ'), findsWidgets);
      expect(find.byKey(const Key('income-commission')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('income-commission'))).data, '−4.500 đ');
      expect(tester.widget<Text>(find.byKey(const Key('income-net'))).data, '37.500 đ');
      expect(find.text('tạm tính'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('income-count'))).data, '4');
      expect(tester.widget<Text>(find.byKey(const Key('income-average'))).data, '10.500 đ');
      expect(find.textContaining('nhận ngoài app'), findsOneWidget);
      expect(find.text('Thu nhập theo ngày (ước tính)'), findsOneWidget);
    });

    testWidgets('one column per day; tapping a column shows its exact numbers', (tester) async {
      await _pump(tester, FakeIncomeSource(<IncomeLoad>[IncomeReady(_fixtureSummary())]));
      expect(find.byKey(const Key('income-bar-0')), findsOneWidget);
      expect(find.byKey(const Key('income-bar-1')), findsOneWidget);
      await tester.tap(find.byKey(const Key('income-bar-1')));
      await tester.pump();
      expect(
        tester.widget<Text>(find.byKey(const Key('income-bar-detail'))).data,
        '18/11 · 3 đơn · 32.000 đ · hoa hồng −3.500 đ · sau hoa hồng 28.500 đ (tạm tính)',
      );
    });

    testWidgets('a day with no income shows 0 đ, not a blank', (tester) async {
      final IncomeSummary zeroDay = IncomeSummary(
        from: '2026-11-17',
        to: '2026-11-18',
        days: 2,
        completed: 1,
        feeVnd: 20000,
        commissionVnd: 0,
        netVnd: 20000,
        netProvisional: false,
        averageVnd: 20000,
        daily: const <IncomeDay>[
          IncomeDay(date: '2026-11-17', completed: 0, feeVnd: 0, commissionVnd: 0, netVnd: 0, provisional: false),
          IncomeDay(date: '2026-11-18', completed: 1, feeVnd: 20000, commissionVnd: 0, netVnd: 20000, provisional: false),
        ],
      );
      await _pump(tester, FakeIncomeSource(<IncomeLoad>[IncomeReady(zeroDay)]));
      await tester.tap(find.byKey(const Key('income-bar-0')));
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('income-bar-detail'))).data, '17/11 · 0 đơn · 0 đ · sau hoa hồng 0 đ');
    });

    testWidgets('a failed read says "Chưa xác định" everywhere, never 0 đ, and offers a retry that asks again', (tester) async {
      final FakeIncomeSource source = FakeIncomeSource(<IncomeLoad>[const IncomeFailed('Chưa tải được thu nhập.'), IncomeReady(_fixtureSummary())]);
      await _pump(tester, source);
      expect(tester.widget<Text>(find.byKey(const Key('income-commission'))).data, 'Chưa xác định');
      expect(tester.widget<Text>(find.byKey(const Key('income-count'))).data, 'Chưa xác định');
      expect(find.byKey(const Key('income-chart-unknown')), findsOneWidget);
      expect(find.byKey(const Key('income-bar-0')), findsNothing);
      expect(find.text('0 đ'), findsNothing);
      await tester.tap(find.byKey(const Key('income-retry')));
      await tester.pumpAndSettle();
      expect(source.asked.length, 2);
      expect(find.byKey(const Key('income-bar-0')), findsOneWidget);
    });

    testWidgets('no completed delivery in the period: a real 0 đ total, an empty chart state, and a dash for the average', (tester) async {
      final IncomeSummary none = IncomeSummary(
        from: '2026-11-17',
        to: '2026-11-18',
        days: 2,
        completed: 0,
        feeVnd: 0,
        commissionVnd: 0,
        netVnd: 0,
        netProvisional: false,
        averageVnd: null,
        daily: const <IncomeDay>[
          IncomeDay(date: '2026-11-17', completed: 0, feeVnd: 0, commissionVnd: 0, netVnd: 0, provisional: false),
          IncomeDay(date: '2026-11-18', completed: 0, feeVnd: 0, commissionVnd: 0, netVnd: 0, provisional: false),
        ],
      );
      await _pump(tester, FakeIncomeSource(<IncomeLoad>[IncomeReady(none)]));
      expect(tester.widget<Text>(find.byKey(const Key('income-total'))).data, '0 đ');
      expect(tester.widget<Text>(find.byKey(const Key('income-average'))).data, '—');
      expect(find.byKey(const Key('income-chart-empty')), findsOneWidget);
    });

    testWidgets('choosing "Hôm nay" asks the server for exactly today (Vietnam day)', (tester) async {
      final FakeIncomeSource source = FakeIncomeSource(<IncomeLoad>[IncomeReady(_fixtureSummary())]);
      await _pump(tester, source);
      expect(source.asked.single.query, 'from=2026-11-12&to=2026-11-18');
      await tester.tap(find.byKey(const Key('income-filter-today')));
      await tester.pumpAndSettle();
      expect(source.asked.last.query, 'from=2026-11-18&to=2026-11-18');
    });

    testWidgets('a 320dp phone shows the screen without overflow', (tester) async {
      final List<Map<String, Object?>> thirty = <Map<String, Object?>>[];
      final DateTime start = DateTime.utc(2026, 10, 20);
      for (int i = 0; i < 30; i++) {
        final DateTime d = start.add(Duration(days: i));
        thirty.add(<String, Object?>{
          'date': isoDay(d),
          'completed_count': i % 3,
          'fee_vnd': 10000 * (i % 3),
          'platform_commission_vnd': -1000 * (i % 3),
          'net_estimated_vnd': 9000 * (i % 3),
          'net_is_provisional': false,
        });
      }
      final IncomeSummary big = parseIncomeSummary(_answer(from: '2026-10-20', to: '2026-11-18', days: 30, daily: thirty, completed: 20, fee: 200000, commission: -20000, provisional: false, average: 10000), IncomePeriod(from: DateTime(2026, 10, 20), to: DateTime(2026, 11, 18)));
      await _pump(tester, FakeIncomeSource(<IncomeLoad>[IncomeReady(big)]), size: const Size(320, 740));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('income-bar-29')), findsOneWidget);
    });
  });
}
