import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

import 'm02_shop_views_test.dart' show harness, show, tapKey, Harness;

Future<void> pickTime(WidgetTester tester, String field, String value) async {
  await tapKey(tester, field);
  final List<String> parts = value.split(':');
  final FixedExtentScrollController hours = tester.widget<ListWheelScrollView>(find.byKey(const Key('time-picker-hours'))).controller! as FixedExtentScrollController;
  hours.jumpToItem(int.parse(parts[0]));
  await tester.pumpAndSettle();
  final FixedExtentScrollController minutes = tester.widget<ListWheelScrollView>(find.byKey(const Key('time-picker-minutes'))).controller! as FixedExtentScrollController;
  minutes.jumpToItem(int.parse(parts[1]));
  await tester.pumpAndSettle();
  await tapKey(tester, 'time-picker-done');
}

Future<void> setRange(WidgetTester tester, int i, String open, String close) async {
  await pickTime(tester, 'range-$i-open', open);
  if (find.byKey(Key('range-$i-close')).evaluate().isNotEmpty) {
    await pickTime(tester, 'range-$i-close', close);
  }
}

String textOf(WidgetTester tester, String key) => tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

void main() {
  testWidgets('leaving and reopening removes a definite error, keeps the empty-hours warning', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    h.flows.ops.applyAllWeek(<HourRange>[HourRange(open: '17:00', close: '23:00', kind: RangeKind.day)]);
    h.api.failNext = const AuthFailure(AuthFailureKind.badResponse);
    await h.flows.ops.saveHours();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('hours-error')), findsOneWidget);
    h.flows.ops.revertHours();
    await tester.pumpWidget(const SizedBox());
    await show(tester, HoursScreen(flows: h.flows));
    expect(find.byKey(const Key('hours-error')), findsNothing);
    expect(find.byKey(const Key('hours-fresh')), findsOneWidget);
  });

  testWidgets('F03: no schedule yet -> Cả tuần 17:00-23:00 -> apply -> Chủ nhật 17:00-22:00 -> save -> read back', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    expect(find.byKey(const Key('hours-fresh')), findsOneWidget);
    expect(find.text('Chưa cài giờ hoạt động'), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('hours-save'))).onPressed, isNull, reason: 'nothing to save yet');

    await tapKey(tester, 'hours-all');
    await tapKey(tester, 'editor-add');
    await setRange(tester, 0, '17:00', '23:00');
    await tapKey(tester, 'editor-done');
    expect(find.byKey(const Key('apply7-replace')), findsNothing, reason: 'an empty draft is not overridden');
    expect(find.text('Chưa lưu', skipOffstage: false), findsNothing);
    expect(h.server.arrived, isEmpty, reason: 'applying only changes the draft');
    expect(find.text('17:00 – 23:00'), findsNWidgets(8));

    await tapKey(tester, 'hours-day-6');
    await setRange(tester, 0, '17:00', '22:00');
    await tapKey(tester, 'editor-done');
    expect(find.text('17:00 – 22:00'), findsOneWidget);
    expect(find.text('Tùy chỉnh theo ngày'), findsOneWidget);

    await tapKey(tester, 'hours-save');
    expect(h.server.effects, hasLength(1));
    final List<Object?> sent = h.server.effects.single['intervals']! as List<Object?>;
    expect(sent, hasLength(7));
    expect(sent.last, <String, Object?>{'weekday': 7, 'start_minute': 1020, 'end_minute': 1320, 'end_day_offset': 0});
    expect(sent.first, <String, Object?>{'weekday': 1, 'start_minute': 1020, 'end_minute': 1380, 'end_day_offset': 0});
    expect(h.flows.ops.overview!.version, 3);
    expect(h.flows.ops.hoursDirty, isFalse);
    expect(find.text('Đã lưu lịch hoạt động.'), findsOneWidget);
  });

  testWidgets('applying over a different own schedule asks "Thay lịch của cả 7 ngày?"; Giữ lịch keeps the draft', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    h.server.hours = <Map<String, Object?>>[
      <String, Object?>{'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'end_day_offset': 0},
    ];
    h.server.reason = 'OUTSIDE_BUSINESS_HOURS';
    await show(tester, HoursScreen(flows: h.flows));
    expect(find.text('10:00 – 14:00'), findsOneWidget);
    await tapKey(tester, 'hours-all');
    await tapKey(tester, 'editor-add');
    await setRange(tester, 0, '17:00', '23:00');
    await tapKey(tester, 'editor-done');
    expect(find.text('Thay lịch của cả 7 ngày?'), findsOneWidget);
    await tapKey(tester, 'dlg-keep');
    expect(find.byKey(const Key('editor-done')), findsOneWidget, reason: 'still in the editor');
    await tapKey(tester, 'editor-done');
    await tapKey(tester, 'apply7-replace');
    expect(find.text('17:00 – 23:00'), findsNWidgets(8));
    expect(h.flows.ops.hoursDirty, isTrue);
    expect(h.server.arrived, isEmpty);
  });

  testWidgets('F04: several shifts, overnight Sunday -> Monday, an overlap is reported beside the range, Xong is blocked, fixing it unblocks', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    await tapKey(tester, 'hours-day-6');
    await tapKey(tester, 'editor-add');
    await tapKey(tester, 'range-0-kind-night');
    await setRange(tester, 0, '22:00', '02:00');
    expect(find.textContaining('Giờ đóng thuộc ngày hôm sau (Thứ Hai)'), findsOneWidget);
    await tapKey(tester, 'editor-done');
    expect(find.text('22:00 → 02:00 hôm sau'), findsOneWidget);

    await tapKey(tester, 'hours-day-0');
    await tapKey(tester, 'editor-add');
    await setRange(tester, 0, '01:00', '03:00');
    expect(find.byKey(const Key('range-0-error')), findsOneWidget);
    expect(find.textContaining('Trùng với 22:00 → 02:00 hôm sau (Chủ nhật)'), findsOneWidget);
    expect(tester.widget<N11Button>(find.byKey(const Key('editor-done'))).onPressed, isNull);
    await setRange(tester, 0, '02:00', '03:00');
    expect(find.byKey(const Key('range-0-error')), findsNothing);
    await tapKey(tester, 'editor-add');
    await setRange(tester, 1, '10:00', '14:00');
    await tapKey(tester, 'editor-done');
    expect(find.text('02:00 – 03:00'), findsOneWidget);
    await tapKey(tester, 'hours-save');
    expect(h.server.effects, hasLength(1));
    expect((h.server.effects.single['intervals']! as List<Object?>), hasLength(3));
  });

  testWidgets('wheel picker needs no keyboard, cancel keeps draft, exact minutes and 24:00 remain supported', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    await tapKey(tester, 'hours-day-1');
    await tapKey(tester, 'editor-add');
    expect(tester.widget<TextField>(find.byKey(const Key('range-0-open'))).readOnly, isTrue);
    await tapKey(tester, 'range-0-open');
    expect(tester.testTextInput.isVisible, isFalse);
    await tester.drag(find.byKey(const Key('time-picker-hours')), const Offset(0, -48));
    await tester.pumpAndSettle();
    await tapKey(tester, 'time-picker-cancel');
    expect(textOf(tester, 'range-0-open'), '10:00');
    expect(h.server.arrived, isEmpty);
    await setRange(tester, 0, '17:37', '24:00');
    expect(textOf(tester, 'range-0-open'), '17:37');
    expect(textOf(tester, 'range-0-close'), '24:00');
    expect(find.byKey(const Key('range-0-error')), findsNothing);
    await tapKey(tester, 'range-0-kind-night');
    expect(find.byKey(const Key('range-0-error')), findsOneWidget);
    expect(textOf(tester, 'range-0-close'), '24:00', reason: 'switching kind does not rewrite the draft');
    await tapKey(tester, 'range-0-close');
    final ListWheelScrollView wheel = tester.widget<ListWheelScrollView>(find.byKey(const Key('time-picker-hours')));
    expect(wheel.childDelegate.estimatedChildCount, 24, reason: '24:00 is only offered for a same-day close');
    await tapKey(tester, 'time-picker-cancel');
    expect(textOf(tester, 'range-0-close'), '24:00');
    await pickTime(tester, 'range-0-close', '02:13');
    expect(find.byKey(const Key('range-0-error')), findsNothing);
    expect(h.server.arrived, isEmpty, reason: 'choosing a time only edits the local draft');
  });

  testWidgets('24 giờ is chosen explicitly, mirrors the open time, and 00:00-24:00 reads as Cả ngày', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    await tapKey(tester, 'hours-day-2');
    await tapKey(tester, 'editor-add');
    await setRange(tester, 0, '08:00', '08:00');
    expect(find.byKey(const Key('range-0-error')), findsOneWidget, reason: 'equal times are NOT a 24h shift unless chosen');
    await tapKey(tester, 'range-0-kind-h24');
    expect(find.byKey(const Key('range-0-error')), findsNothing);
    expect(find.text('08:00 hôm sau'), findsOneWidget);
    expect(find.textContaining('Mở từ 08:00 đến cùng giờ hôm sau.'), findsOneWidget);
    await tapKey(tester, 'range-0-kind-day');
    await setRange(tester, 0, '00:00', '24:00');
    expect(find.textContaining('Cả ngày (00:00–24:00).'), findsOneWidget);
    await tapKey(tester, 'editor-done');
    expect(find.text('Cả ngày (00:00–24:00)'), findsOneWidget);
  });

  testWidgets('F05: closing the whole week asks for confirmation; Quay lại sends nothing; leaving a dirty editor asks first', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    h.server.hours = <Map<String, Object?>>[
      <String, Object?>{'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'end_day_offset': 0},
    ];
    await show(tester, HoursScreen(flows: h.flows));
    await tapKey(tester, 'hours-day-0');
    await tapKey(tester, 'range-0-delete');
    expect(find.byKey(const Key('editor-empty')), findsOneWidget);
    await tapKey(tester, 'editor-cancel');
    expect(find.text('Bỏ thay đổi chưa lưu?'), findsOneWidget);
    await tapKey(tester, 'dlg-stay');
    await tapKey(tester, 'editor-done');
    expect(find.text('Đóng cửa'), findsWidgets);
    await tapKey(tester, 'hours-save');
    expect(find.text('Đóng cửa cả tuần?'), findsOneWidget);
    expect(find.text('Quán sẽ đóng cửa cả tuần theo lịch này.'), findsOneWidget);
    await tapKey(tester, 'dlg-back');
    expect(h.server.arrived, isEmpty);
    await tapKey(tester, 'hours-save');
    await tapKey(tester, 'closeall-save');
    expect(h.server.effects.single['intervals'], isEmpty);
  });

  testWidgets('leaving the schedule screen with unsaved changes asks; saved data is untouched', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Builder(builder: (BuildContext context) => Scaffold(body: Center(child: TextButton(key: const Key('open'), onPressed: () => Navigator.of(context).push(n11Route(HoursScreen(flows: h.flows))), child: const Text('go'))))),
    ));
    await tester.tap(find.byKey(const Key('open')));
    await tester.pumpAndSettle();
    await tapKey(tester, 'hours-all');
    await tapKey(tester, 'editor-add');
    await tapKey(tester, 'editor-done');
    await tester.tap(find.byTooltip('Quay lại'));
    await tester.pumpAndSettle();
    expect(find.text('Bỏ thay đổi chưa lưu?'), findsOneWidget);
    await tapKey(tester, 'dlg-leave');
    expect(find.byKey(const Key('hours-all')), findsNothing);
    expect(h.server.arrived, isEmpty);
  });

  testWidgets('an unknown outcome locks the schedule: rows cannot be opened, the banner retries the same request, one effect', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    await show(tester, HoursScreen(flows: h.flows));
    await tapKey(tester, 'hours-all');
    await tapKey(tester, 'editor-add');
    await tapKey(tester, 'editor-done');
    h.server.loseAnswerOnce = true;
    await tapKey(tester, 'hours-save');
    expect(find.byKey(const Key('pending-banner')), findsOneWidget);
    expect(find.text('Chưa xác định được kết quả lưu'), findsOneWidget);
    await tester.tap(find.byKey(const Key('hours-day-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('editor-done')), findsNothing, reason: 'no editor while the outcome is unknown');
    expect(tester.widget<N11Button>(find.byKey(const Key('hours-save'))).onPressed, isNull);
    h.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await tapKey(tester, 'pending-retry');
    expect(find.byKey(const Key('pending-banner')), findsOneWidget);
    await tapKey(tester, 'pending-retry');
    expect(find.byKey(const Key('pending-banner')), findsNothing);
    expect(h.server.effects, hasLength(1));
    expect(h.server.version, 3);
  });

  testWidgets('a DISABLED shop shows the schedule read-only', (WidgetTester tester) async {
    final Harness h = await harness(tester);
    h.server.status = 'DISABLED';
    h.server.reason = 'SHOP_DISABLED';
    await show(tester, HoursScreen(flows: h.flows));
    expect(find.byKey(const Key('hours-readonly')), findsOneWidget);
    expect(find.byKey(const Key('hours-save')), findsNothing);
    await tester.tap(find.byKey(const Key('hours-day-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('editor-done')), findsNothing);
  });

  for (final double width in <double>[360, 390]) {
    testWidgets('layout at ${width.toInt()}px: the editor with long errors and two footer buttons does not overflow, and the footer stays above the keyboard', (WidgetTester tester) async {
      final Harness h = await harness(tester, width: width);
      await show(tester, HoursScreen(flows: h.flows));
      await tapKey(tester, 'hours-day-6');
      await tapKey(tester, 'editor-add');
      await tapKey(tester, 'range-0-kind-night');
      await setRange(tester, 0, '22:00', '02:00');
      await tapKey(tester, 'editor-add');
      await setRange(tester, 1, '23:00', '23:30');
      await tapKey(tester, 'editor-add');
      expect(find.byKey(const Key('range-0-error')), findsOneWidget);
      // The keyboard opens: the footer is still reachable (not covered) and the fields scroll.
      tester.view.viewInsets = const FakeViewPadding(bottom: 300 * 3);
      await tester.pumpAndSettle();
      final Rect done = tester.getRect(find.byKey(const Key('editor-done')));
      expect(done.bottom, lessThanOrEqualTo(800 - 300 + 0.5));
      expect(done.height, greaterThanOrEqualTo(44));
      expect(tester.getRect(find.byKey(const Key('editor-cancel'))).height, greaterThanOrEqualTo(44));
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
