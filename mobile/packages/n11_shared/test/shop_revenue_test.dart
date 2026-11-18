import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// #391 Doanh thu quán: the period rules (Vietnam day), the strict reader of the server answers, and the screen states. Figures here are FIXTURE values chosen for
// the test; the screen never ships a number of its own.

final DateTime fixedNow = DateTime.utc(2026, 11, 18, 5); // Vietnam 18/11/2026 12:00

Map<String, Object?> _answer({required String from, required String to, required int days, required List<Map<String, Object?>> daily, int completed = 4, int items = 400000, int? average = 100000}) => <String, Object?>{
      'period': <String, Object?>{'from': from, 'to': to, 'days': days, 'timezone': 'Asia/Ho_Chi_Minh'},
      'summary': <String, Object?>{'completed_count': completed, 'items_total_vnd': items, 'average_items_vnd': average},
      'daily': daily,
    };

Map<String, Object?> _day(String date, int completed, int items) => <String, Object?>{'date': date, 'completed_count': completed, 'items_total_vnd': items};

RevenueSummary _fixture() => const RevenueSummary(
      from: '2026-11-17',
      to: '2026-11-18',
      days: 2,
      completed: 4,
      itemsVnd: 400000,
      averageVnd: 100000,
      daily: <RevenueDay>[
        RevenueDay(date: '2026-11-17', completed: 1, itemsVnd: 100000),
        RevenueDay(date: '2026-11-18', completed: 3, itemsVnd: 300000),
      ],
    );

RevenueOrder _order(String id, String code, String endedAt, int items) => RevenueOrder(orderId: id, code: code, endedAt: endedAt, itemsVnd: items);

class FakeRevenueSource implements RevenueSource {
  FakeRevenueSource({required this.summaries, List<RevenueLoad<RevenueOrdersPage>>? pages})
      : pages = pages ?? <RevenueLoad<RevenueOrdersPage>>[RevenueReady<RevenueOrdersPage>(const RevenueOrdersPage(items: <RevenueOrder>[], nextCursor: null))];

  /// Answers in order; the last one repeats.
  final List<RevenueLoad<RevenueSummary>> summaries;
  final List<RevenueLoad<RevenueOrdersPage>> pages;
  final List<RevenuePeriod> asked = <RevenuePeriod>[];
  final List<String?> cursorsAsked = <String?>[];
  int _summaryCalls = 0;
  int _pageCalls = 0;

  @override
  Future<RevenueLoad<RevenueSummary>> summary(RevenuePeriod period) async {
    asked.add(period);
    final RevenueLoad<RevenueSummary> answer = summaries[(_summaryCalls).clamp(0, summaries.length - 1)];
    _summaryCalls++;
    return answer;
  }

  @override
  Future<RevenueLoad<RevenueOrdersPage>> orders(RevenuePeriod period, {String? cursor}) async {
    cursorsAsked.add(cursor);
    final RevenueLoad<RevenueOrdersPage> answer = pages[(_pageCalls).clamp(0, pages.length - 1)];
    _pageCalls++;
    return answer;
  }
}

Future<void> _pump(WidgetTester tester, RevenueSource source, {Size size = const Size(390, 900), Future<void> Function(String)? openOrder}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(MaterialApp(home: ShopRevenueScreen(source: source, openOrder: openOrder, now: () => fixedNow)));
  await tester.pumpAndSettle();
}

void main() {
  group('period rules', () {
    test('the Vietnam day decides the date: 23:59 VN is the same day, 00:00 VN is the next day', () {
      expect(revenueIsoDay(revenueVnDay(DateTime.utc(2026, 11, 17, 16, 59))), '2026-11-17');
      expect(revenueIsoDay(revenueVnDay(DateTime.utc(2026, 11, 17, 17))), '2026-11-18');
    });

    test('presets end today and include it; a period over 92 days is not valid', () {
      expect(RevenuePeriod.forPreset(RevenuePreset.today, fixedNow).query, 'from=2026-11-18&to=2026-11-18');
      expect(RevenuePeriod.forPreset(RevenuePreset.last7, fixedNow).query, 'from=2026-11-12&to=2026-11-18');
      expect(RevenuePeriod.forPreset(RevenuePreset.last30, fixedNow).days, 30);
      expect(RevenuePeriod(from: DateTime(2026, 8, 1), to: DateTime(2026, 10, 31)).isValid, isTrue);
      expect(RevenuePeriod(from: DateTime(2026, 7, 31), to: DateTime(2026, 10, 31)).isValid, isFalse);
    });
  });

  group('strict reading of the summary', () {
    final RevenuePeriod asked = RevenuePeriod(from: DateTime(2026, 11, 17), to: DateTime(2026, 11, 18));
    List<Map<String, Object?>> days() => <Map<String, Object?>>[_day('2026-11-17', 1, 100000), _day('2026-11-18', 3, 300000)];

    test('reads the figures as the server gave them', () {
      final RevenueSummary s = parseRevenueSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days()), asked);
      expect(s.itemsVnd, 400000);
      expect(s.completed, 4);
      expect(s.averageVnd, 100000);
      expect(s.daily.map((RevenueDay d) => d.date), <String>['2026-11-17', '2026-11-18']);
    });

    test('refuses another period, a wrong daily length, a float, a negative value and an average that does not match the count', () {
      expect(() => parseRevenueSummary(_answer(from: '2026-11-16', to: '2026-11-18', days: 3, daily: days()), asked), throwsFormatException);
      expect(() => parseRevenueSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days().sublist(0, 1)), asked), throwsFormatException);
      final Map<String, Object?> floatItems = _answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days());
      (floatItems['summary']! as Map<String, Object?>)['items_total_vnd'] = 400.5;
      expect(() => parseRevenueSummary(floatItems, asked), throwsFormatException);
      expect(() => parseRevenueSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), items: -1), asked), throwsFormatException);
      expect(() => parseRevenueSummary(_answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: days(), completed: 0, items: 0, average: 5000), asked), throwsFormatException);
    });

    test('an answer with no completed order has no average (null, never 0)', () {
      final RevenueSummary s = parseRevenueSummary(
        _answer(from: '2026-11-17', to: '2026-11-18', days: 2, daily: <Map<String, Object?>>[_day('2026-11-17', 0, 0), _day('2026-11-18', 0, 0)], completed: 0, items: 0, average: null),
        asked,
      );
      expect(s.averageVnd, isNull);
      expect(s.itemsVnd, 0);
    });
  });

  group('strict reading of an orders page', () {
    test('reads the rows and the next cursor; a missing items list is refused', () {
      final RevenueOrdersPage page = parseRevenueOrders(<String, Object?>{
        'items': <Map<String, Object?>>[
          <String, Object?>{'order_id': 'o1', 'code': 'A1', 'ended_at': '2026-11-18T05:00:00.000000Z', 'items_total_vnd': 120000},
        ],
        'next_cursor': 'abc',
      });
      expect(page.items.single.code, 'A1');
      expect(page.nextCursor, 'abc');
      expect(() => parseRevenueOrders(<String, Object?>{'next_cursor': null}), throwsFormatException);
    });
  });

  group('the screen', () {
    testWidgets('shows the dish value with the honest caption, the count, the average and the daily columns', (WidgetTester tester) async {
      await _pump(tester, FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[RevenueReady<RevenueSummary>(_fixture())]));
      expect(tester.widget<Text>(find.byKey(const Key('revenue-total'))).data, '400.000 đ');
      expect(find.textContaining('Chưa phải tiền đã thu'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('revenue-count'))).data, '4');
      expect(tester.widget<Text>(find.byKey(const Key('revenue-average'))).data, '100.000 đ');
      expect(find.byKey(const Key('revenue-bar-0')), findsOneWidget);
      expect(find.byKey(const Key('revenue-bar-1')), findsOneWidget);
      expect(find.textContaining('thực nhận'), findsNothing);
    });

    testWidgets('tapping a column shows its exact numbers', (WidgetTester tester) async {
      await _pump(tester, FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[RevenueReady<RevenueSummary>(_fixture())]));
      await tester.tap(find.byKey(const Key('revenue-bar-1')));
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('revenue-bar-detail'))).data, '18/11 · 3 đơn · 300.000 đ');
    });

    testWidgets('a failed read says "Chưa xác định" everywhere, never 0 đ, and retry asks again', (WidgetTester tester) async {
      final FakeRevenueSource source = FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[
        const RevenueFailed<RevenueSummary>('Chưa tải được doanh thu.'),
        RevenueReady<RevenueSummary>(_fixture()),
      ]);
      await _pump(tester, source);
      expect(tester.widget<Text>(find.byKey(const Key('revenue-total'))).data, 'Chưa xác định');
      expect(tester.widget<Text>(find.byKey(const Key('revenue-count'))).data, 'Chưa xác định');
      expect(find.byKey(const Key('revenue-chart-unknown')), findsOneWidget);
      expect(find.text('0 đ'), findsNothing);
      await tester.tap(find.byKey(const Key('revenue-retry')));
      await tester.pumpAndSettle();
      expect(source.asked.length, 2);
      expect(tester.widget<Text>(find.byKey(const Key('revenue-total'))).data, '400.000 đ');
    });

    testWidgets('no completed order: a real 0 đ, an empty chart state and a dash for the average', (WidgetTester tester) async {
      await _pump(
        tester,
        FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[
          const RevenueReady<RevenueSummary>(RevenueSummary(from: '2026-11-17', to: '2026-11-18', days: 2, completed: 0, itemsVnd: 0, averageVnd: null, daily: <RevenueDay>[
            RevenueDay(date: '2026-11-17', completed: 0, itemsVnd: 0),
            RevenueDay(date: '2026-11-18', completed: 0, itemsVnd: 0),
          ])),
        ]),
      );
      expect(tester.widget<Text>(find.byKey(const Key('revenue-total'))).data, '0 đ');
      expect(tester.widget<Text>(find.byKey(const Key('revenue-average'))).data, '—');
      expect(find.byKey(const Key('revenue-chart-empty')), findsOneWidget);
    });

    testWidgets('choosing "Hôm nay" asks for exactly today (Vietnam day)', (WidgetTester tester) async {
      final FakeRevenueSource source = FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[RevenueReady<RevenueSummary>(_fixture())]);
      await _pump(tester, source);
      expect(source.asked.single.query, 'from=2026-11-12&to=2026-11-18');
      await tester.tap(find.byKey(const Key('revenue-filter-today')));
      await tester.pumpAndSettle();
      expect(source.asked.last.query, 'from=2026-11-18&to=2026-11-18');
    });

    testWidgets('the order list pages with the cursor, and a row opens its order when the screen is given the action', (WidgetTester tester) async {
      final List<String> opened = <String>[];
      final FakeRevenueSource source = FakeRevenueSource(
        summaries: <RevenueLoad<RevenueSummary>>[RevenueReady<RevenueSummary>(_fixture())],
        pages: <RevenueLoad<RevenueOrdersPage>>[
          RevenueReady<RevenueOrdersPage>(RevenueOrdersPage(items: <RevenueOrder>[_order('o1', 'A1', '2026-11-18T05:00:00Z', 120000)], nextCursor: 'c1')),
          RevenueReady<RevenueOrdersPage>(RevenueOrdersPage(items: <RevenueOrder>[_order('o2', 'A2', '2026-11-18T04:00:00Z', 80000)], nextCursor: null)),
        ],
      );
      await _pump(tester, source, openOrder: (String id) async => opened.add(id));
      expect(find.byKey(const Key('revenue-order-o1')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('revenue-more')));
      await tester.tap(find.byKey(const Key('revenue-more')));
      await tester.pumpAndSettle();
      expect(source.cursorsAsked, <String?>[null, 'c1']);
      expect(find.byKey(const Key('revenue-order-o2')), findsOneWidget);
      expect(find.byKey(const Key('revenue-more')), findsNothing);
      await tester.ensureVisible(find.byKey(const Key('revenue-order-o2')));
      await tester.tap(find.byKey(const Key('revenue-order-o2')));
      await tester.pump();
      expect(opened, <String>['o2']);
    });

    testWidgets('a 320dp phone with 30 days shows the screen without overflow', (WidgetTester tester) async {
      final List<RevenueDay> thirty = <RevenueDay>[
        for (int i = 0; i < 30; i++) RevenueDay(date: revenueIsoDay(DateTime.utc(2026, 10, 20).add(Duration(days: i))), completed: i % 3, itemsVnd: 100000 * (i % 3)),
      ];
      final RevenueSummary big = RevenueSummary(from: '2026-10-20', to: '2026-11-18', days: 30, completed: 20, itemsVnd: 2000000, averageVnd: 100000, daily: thirty);
      final FakeRevenueSource source = FakeRevenueSource(summaries: <RevenueLoad<RevenueSummary>>[RevenueReady<RevenueSummary>(big)]);
      await tester.binding.setSurfaceSize(const Size(320, 740));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await _pump(tester, source, size: const Size(320, 740));
      await tester.tap(find.byKey(const Key('revenue-filter-30')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });
}
