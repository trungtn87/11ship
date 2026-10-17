import 'm02_format.dart';

// The weekly schedule of a shop as the owner edits it (Q03/Q04) and as the server stores it (PUT /v1/shop/me/business-hours,
// docs/tasks/M02-A-shop-management.md section 3). Pure logic, no I/O. Times are exact to the minute and are NEVER changed for the
// person: an invalid time is reported, not repaired.
//
// A server interval is (weekday 1..7, start_minute 0..1439, end_minute 0..1440, end_day_offset 0|1), the close exclusive:
//   same day      18:00-23:00  -> start=1080 end=1380 offset=0   (the close may be 24:00 = 1440)
//   overnight     22:00-02:00  -> start=1320 end=120  offset=1   (the close belongs to the next day)
//   24 hours      start=end, offset=1 (00:00 as the start is stored as 0 -> 1440 offset 0, which reads back as "Cả ngày")

enum RangeKind { day, night, h24 }

/// The most intervals a week may hold (the server refuses more).
const int kMaxIntervalsPerWeek = 28;

class HourRange {
  HourRange({required this.open, required this.close, required this.kind});

  /// "HH:MM" exactly as typed or loaded.
  String open;
  String close;
  RangeKind kind;

  HourRange copy() => HourRange(open: open, close: close, kind: kind);

  @override
  bool operator ==(Object other) => other is HourRange && other.open == open && other.close == close && other.kind == kind;

  @override
  int get hashCode => Object.hash(open, close, kind);
}

typedef WeekSchedule = List<List<HourRange>>;

WeekSchedule emptyWeek() => List<List<HourRange>>.generate(7, (int _) => <HourRange>[]);

WeekSchedule copyWeek(WeekSchedule week) => <List<HourRange>>[for (final List<HourRange> day in week) <HourRange>[for (final HourRange r in day) r.copy()]];

bool sameWeek(WeekSchedule a, WeekSchedule b) {
  for (int d = 0; d < 7; d++) {
    if (a[d].length != b[d].length) {
      return false;
    }
    for (int i = 0; i < a[d].length; i++) {
      if (a[d][i] != b[d][i]) {
        return false;
      }
    }
  }
  return true;
}

/// Every day holds the same ranges (the week can be shown as one line).
bool isUniform(WeekSchedule week) {
  for (int d = 1; d < 7; d++) {
    if (week[d].length != week[0].length) {
      return false;
    }
    for (int i = 0; i < week[0].length; i++) {
      if (week[d][i] != week[0][i]) {
        return false;
      }
    }
  }
  return true;
}

/// "HH:MM" -> minutes, or null when it is not a time. [allow24] accepts exactly "24:00" (only a same-day close).
int? parseHm(String text, {bool allow24 = false}) {
  final RegExpMatch? m = RegExp(r'^(\d\d):(\d\d)$').firstMatch(text);
  if (m == null) {
    return null;
  }
  final int h = int.parse(m.group(1)!);
  final int n = int.parse(m.group(2)!);
  if (allow24 && h == 24 && n == 0) {
    return 1440;
  }
  return h < 24 && n < 60 ? h * 60 + n : null;
}

String formatHm(int minutes) => '${(minutes ~/ 60).toString().padLeft(2, '0')}:${(minutes % 60).toString().padLeft(2, '0')}';

/// What a range says to the person.
String rangeText(HourRange r) {
  if (r.kind == RangeKind.h24) {
    return '${r.open} → ${r.open} hôm sau (24 giờ)';
  }
  if (r.kind == RangeKind.day && r.open == '00:00' && r.close == '24:00') {
    return 'Cả ngày (00:00–24:00)';
  }
  if (r.kind == RangeKind.night) {
    return '${r.open} → ${r.close} hôm sau';
  }
  return '${r.open} – ${r.close}';
}

List<String> dayLines(List<HourRange> ranges) => ranges.isEmpty ? const <String>[] : <String>[for (final HourRange r in ranges) rangeText(r)];

String dayText(List<HourRange> ranges) => ranges.isEmpty ? 'Đóng cửa' : ranges.map(rangeText).join(' · ');

class ScheduleCheck {
  const ScheduleCheck({required this.errors, required this.total});

  /// "day:index" -> message, beside the range it concerns.
  final Map<String, String> errors;
  final int total;
  bool get ok => errors.isEmpty;
  String? get totalError => errors['total'];
}

int _end(int day, HourRange r) {
  switch (r.kind) {
    case RangeKind.day:
      return day * 1440 + parseHm(r.close, allow24: true)!;
    case RangeKind.night:
      return (day + 1) * 1440 + parseHm(r.close)!;
    case RangeKind.h24:
      return day * 1440 + parseHm(r.open)! + 1440;
  }
}

const String _badTime = 'Nhập giờ dạng HH:MM, phút từ 00 đến 59 (giờ đóng 24:00 chỉ dùng cho khoảng trong ngày).';

/// Checks a whole week as the server will: formats, the span rule of each kind, no overlap on the week ring (also Sunday->Monday and
/// across midnight), at most 28 ranges. Nothing is adjusted.
ScheduleCheck checkSchedule(WeekSchedule week) {
  final Map<String, String> errors = <String, String>{};
  final List<({int d, int i, String key, int start, int end, HourRange r})> valid = <({int d, int i, String key, int start, int end, HourRange r})>[];
  int total = 0;
  for (int d = 0; d < week.length; d++) {
    for (int i = 0; i < week[d].length; i++) {
      total++;
      final HourRange r = week[d][i];
      final String key = '$d:$i';
      final int? open = parseHm(r.open);
      final int? close = r.kind == RangeKind.h24 ? open : parseHm(r.close, allow24: r.kind == RangeKind.day);
      if (open == null || close == null) {
        errors[key] = _badTime;
      } else if (r.kind == RangeKind.day && close <= open) {
        errors[key] = 'Giờ đóng phải sau giờ mở.';
      } else if (r.kind == RangeKind.night && close >= open) {
        errors[key] = 'Qua đêm: giờ đóng (hôm sau) phải sớm hơn giờ mở.';
      } else {
        valid.add((d: d, i: i, key: key, start: d * 1440 + open, end: _end(d, r), r: r));
      }
    }
  }
  for (int a = 0; a < valid.length; a++) {
    for (int b = a + 1; b < valid.length; b++) {
      final A = valid[a];
      final B = valid[b];
      for (final int shift in <int>[-10080, 0, 10080]) {
        if (A.start < B.end + shift && B.start + shift < A.end) {
          errors.putIfAbsent(A.key, () => 'Trùng với ${rangeText(B.r)} (${kDayNames[B.d]})');
          errors.putIfAbsent(B.key, () => 'Trùng với ${rangeText(A.r)} (${kDayNames[A.d]})');
          break;
        }
      }
    }
  }
  if (total > kMaxIntervalsPerWeek) {
    errors['total'] = 'Lịch tối đa $kMaxIntervalsPerWeek khoảng giờ cả tuần.';
  }
  return ScheduleCheck(errors: errors, total: total);
}

/// The server body intervals of a VALID week (call [checkSchedule] first).
List<Map<String, int>> scheduleToWire(WeekSchedule week) {
  final List<Map<String, int>> out = <Map<String, int>>[];
  for (int d = 0; d < 7; d++) {
    for (final HourRange r in week[d]) {
      final int open = parseHm(r.open)!;
      int end;
      int offset;
      switch (r.kind) {
        case RangeKind.day:
          end = parseHm(r.close, allow24: true)!;
          offset = 0;
        case RangeKind.night:
          end = parseHm(r.close)!;
          offset = 1;
        case RangeKind.h24:
          // 00:00 for 24 hours is the same as 00:00-24:00 on the same day; the server stores that form.
          end = open == 0 ? 1440 : open;
          offset = open == 0 ? 0 : 1;
      }
      out.add(<String, int>{'weekday': d + 1, 'start_minute': open, 'end_minute': end, 'end_day_offset': offset});
    }
  }
  return out;
}

/// The stored schedule as drafts. null when the answer is not a well-formed list of intervals.
WeekSchedule? scheduleFromWire(Object? raw) {
  if (raw is! List<Object?>) {
    return null;
  }
  final WeekSchedule week = emptyWeek();
  final List<({int day, int start, HourRange range})> items = <({int day, int start, HourRange range})>[];
  for (final Object? entry in raw) {
    if (entry is! Map<String, Object?>) {
      return null;
    }
    final Object? weekday = entry['weekday'];
    final Object? start = entry['start_minute'];
    final Object? end = entry['end_minute'];
    final Object? offset = entry['end_day_offset'];
    if (weekday is! int || start is! int || end is! int || offset is! int || weekday < 1 || weekday > 7 || start < 0 || start > 1439 || end < 0 || end > 1440 || (offset != 0 && offset != 1)) {
      return null;
    }
    final RangeKind kind = offset == 0 ? RangeKind.day : (end == start ? RangeKind.h24 : RangeKind.night);
    items.add((day: weekday - 1, start: start, range: HourRange(open: formatHm(start), close: end == 1440 ? '24:00' : formatHm(end), kind: kind)));
  }
  items.sort((a, b) => a.day != b.day ? a.day.compareTo(b.day) : a.start.compareTo(b.start));
  for (final item in items) {
    week[item.day].add(item.range);
  }
  return week;
}
