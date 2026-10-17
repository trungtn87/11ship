import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

HourRange day(String o, String c) => HourRange(open: o, close: c, kind: RangeKind.day);
HourRange night(String o, String c) => HourRange(open: o, close: c, kind: RangeKind.night);
HourRange h24(String o) => HourRange(open: o, close: o, kind: RangeKind.h24);

WeekSchedule week(List<List<HourRange>> days) => <List<HourRange>>[...days, for (int i = days.length; i < 7; i++) <HourRange>[]];

void main() {
  test('a normal week passes and its wire form is exact to the minute', () {
    final WeekSchedule w = week(<List<HourRange>>[<HourRange>[day('10:00', '14:00'), day('17:00', '23:00')], <HourRange>[day('07:05', '07:06')]]);
    final ScheduleCheck check = checkSchedule(w);
    expect(check.ok, isTrue);
    expect(check.total, 3);
    expect(scheduleToWire(w), <Map<String, int>>[
      <String, int>{'weekday': 1, 'start_minute': 600, 'end_minute': 840, 'end_day_offset': 0},
      <String, int>{'weekday': 1, 'start_minute': 1020, 'end_minute': 1380, 'end_day_offset': 0},
      <String, int>{'weekday': 2, 'start_minute': 425, 'end_minute': 426, 'end_day_offset': 0},
    ]);
  });

  test('24:00 closes a same-day range, never an overnight one; all-day reads as Cả ngày', () {
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[day('00:00', '24:00')]])).ok, isTrue);
    expect(rangeText(day('00:00', '24:00')), 'Cả ngày (00:00–24:00)');
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[night('22:00', '24:00')]])).ok, isFalse);
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[day('10:00', '24:01')]])).ok, isFalse);
  });

  test('wrong times are reported, never changed', () {
    final HourRange r = day('25:00', '12:61');
    final ScheduleCheck check = checkSchedule(week(<List<HourRange>>[<HourRange>[r]]));
    expect(check.errors['0:0'], isNotNull);
    expect(r.open, '25:00');
    expect(r.close, '12:61');
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[day('12:00', '12:00')]])).errors['0:0'], 'Giờ đóng phải sau giờ mở.');
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[night('02:00', '22:00')]])).errors['0:0'], contains('Qua đêm'));
  });

  test('Sunday overnight is checked against Monday, including the wrap Sunday -> Monday', () {
    final WeekSchedule w = week(<List<HourRange>>[<HourRange>[day('01:00', '03:00')], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[night('22:00', '02:00')]]);
    final ScheduleCheck check = checkSchedule(w);
    expect(check.errors.keys, containsAll(<String>['0:0', '6:0']));
    expect(check.errors['0:0'], contains('Chủ nhật'));
    final WeekSchedule adjacent = week(<List<HourRange>>[<HourRange>[day('02:00', '03:00')], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[], <HourRange>[night('22:00', '02:00')]]);
    expect(checkSchedule(adjacent).ok, isTrue, reason: 'adjacent ranges are legal and are not merged');
    expect(adjacent[0], hasLength(1));
  });

  test('a 24-hour range overlaps the next day and the same time next day is not an automatic 24h', () {
    final WeekSchedule w = week(<List<HourRange>>[<HourRange>[h24('08:00')], <HourRange>[day('07:00', '10:00')]]);
    expect(checkSchedule(w).errors.keys, containsAll(<String>['0:0', '1:0']));
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[h24('08:00')]])).ok, isTrue);
    expect(checkSchedule(week(<List<HourRange>>[<HourRange>[day('08:00', '08:00')]])).ok, isFalse);
  });

  test('the same all-week range spreading over 7 days with an overnight tail overlaps itself', () {
    final WeekSchedule w = <List<HourRange>>[for (int i = 0; i < 7; i++) <HourRange>[night('22:00', '23:00')]];
    expect(checkSchedule(w).ok, isFalse, reason: 'closes 23:00 the next day, which is after the next night opens');
  });

  test('at most 28 ranges in the week', () {
    final WeekSchedule w = <List<HourRange>>[for (int i = 0; i < 7; i++) <HourRange>[for (int j = 0; j < 4; j++) day(formatHm(j * 360), formatHm(j * 360 + 60))]];
    expect(checkSchedule(w).ok, isTrue);
    w[0].add(day('23:00', '23:30'));
    expect(checkSchedule(w).totalError, contains('28'));
  });

  test('wire round trip: day, overnight, 24h from a non-midnight start, midnight 24h becomes Cả ngày', () {
    final WeekSchedule w = week(<List<HourRange>>[<HourRange>[day('10:00', '14:00')], <HourRange>[night('22:00', '00:00')], <HourRange>[h24('08:00')], <HourRange>[], <HourRange>[h24('00:00')]]);
    expect(checkSchedule(w).ok, isTrue);
    final List<Map<String, int>> wire = scheduleToWire(w);
    expect(wire[3], <String, int>{'weekday': 5, 'start_minute': 0, 'end_minute': 1440, 'end_day_offset': 0});
    final WeekSchedule back = scheduleFromWire(wire)!;
    expect(back[0].single, day('10:00', '14:00'));
    expect(back[1].single, night('22:00', '00:00'));
    expect(back[2].single, h24('08:00'));
    expect(back[4].single, day('00:00', '24:00'));
  });

  test('an unusable answer is refused instead of guessed', () {
    expect(scheduleFromWire('x'), isNull);
    expect(scheduleFromWire(<Object?>[<String, Object?>{'weekday': 9, 'start_minute': 0, 'end_minute': 10, 'end_day_offset': 0}]), isNull);
    expect(scheduleFromWire(<Object?>[]), isNotNull);
  });

  test('money and search folding', () {
    expect(formatVnd(120000), '120.000 đ');
    expect(formatVnd(5000), '5.000 đ');
    expect(formatVnd(999), '999 đ');
    expect(groupDigits('1x2y0000'), '120.000');
    expect(foldVietnamese('Ốc hương hấp'), 'oc huong hap');
    expect(foldVietnamese('Đồ uống'), 'do uong');
  });
}
