import 'package:n11_shared/n11_shared.dart';

// Thu nhập (issue #395): the period, the strict reader of GET /v1/driver/income/summary, and the source the screen reads through.
// Every money figure is an integer VND that the server computed. A figure the server did not give is never shown as 0: the screen says "Chưa xác định".
// Periods are Vietnam calendar days (UTC+7), both ends inclusive, at most [kIncomeMaxDays] days.

const int kIncomeMaxDays = 92;
const Duration kVietnamOffset = Duration(hours: 7);

enum IncomePreset { today, last7, last30, custom }

/// The Vietnam calendar day of [nowUtc] as a plain date (no time of day, no device time zone involved).
DateTime vietnamDayOf(DateTime nowUtc) {
  final DateTime vn = nowUtc.toUtc().add(kVietnamOffset);
  return DateTime(vn.year, vn.month, vn.day);
}

String isoDay(DateTime day) => '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

/// "18/11/2026" for the period caption.
String viewDay(DateTime day) => '${day.day.toString().padLeft(2, '0')}/${day.month.toString().padLeft(2, '0')}/${day.year.toString().padLeft(4, '0')}';

/// "18/11" for chart labels.
String shortDay(DateTime day) => '${day.day.toString().padLeft(2, '0')}/${day.month.toString().padLeft(2, '0')}';

class IncomePeriod {
  const IncomePeriod({required this.from, required this.to});

  /// Vietnam calendar days, inclusive (plain dates).
  final DateTime from;
  final DateTime to;

  int get days => DateTime.utc(to.year, to.month, to.day).difference(DateTime.utc(from.year, from.month, from.day)).inDays + 1;

  bool get isValid => days >= 1 && days <= kIncomeMaxDays;

  String get query => 'from=${isoDay(from)}&to=${isoDay(to)}';

  /// Today = the Vietnam day; 7 and 30 days include today (7 ngày = 6 days before today + today).
  static IncomePeriod forPreset(IncomePreset preset, DateTime nowUtc) {
    final DateTime today = vietnamDayOf(nowUtc);
    return switch (preset) {
      IncomePreset.today => IncomePeriod(from: today, to: today),
      IncomePreset.last7 => IncomePeriod(from: today.subtract(const Duration(days: 6)), to: today),
      IncomePreset.last30 => IncomePeriod(from: today.subtract(const Duration(days: 29)), to: today),
      IncomePreset.custom => IncomePeriod(from: today, to: today),
    };
  }
}

class IncomeDay {
  const IncomeDay({required this.date, required this.completed, required this.feeVnd, required this.commissionVnd, required this.netVnd, required this.provisional});

  /// Vietnam calendar day, YYYY-MM-DD.
  final String date;
  final int completed;
  final int feeVnd;

  /// Negative (a deduction) or 0.
  final int commissionVnd;
  final int netVnd;
  final bool provisional;
}

class IncomeSummary {
  const IncomeSummary({
    required this.from,
    required this.to,
    required this.days,
    required this.completed,
    required this.feeVnd,
    required this.commissionVnd,
    required this.netVnd,
    required this.netProvisional,
    required this.averageVnd,
    required this.daily,
  });

  final String from;
  final String to;
  final int days;
  final int completed;

  /// "Tổng thu nhập": the final fee of the completed deliveries (an estimate, received outside the app).
  final int feeVnd;

  /// Negative platform commission (the real debits), or 0.
  final int commissionVnd;

  /// "Thu nhập ước tính sau hoa hồng" = fee + commission.
  final int netVnd;

  /// True while some completed delivery has no commission debit yet, or a debit differs from its snapshot: the screen says "tạm tính".
  final bool netProvisional;

  /// Bình quân/đơn; null when there is no completed delivery (never shown as 0).
  final int? averageVnd;
  final List<IncomeDay> daily;
}

sealed class IncomeLoad {
  const IncomeLoad();
}

class IncomeLoading extends IncomeLoad {
  const IncomeLoading();
}

class IncomeReady extends IncomeLoad {
  const IncomeReady(this.summary);
  final IncomeSummary summary;
}

class IncomeFailed extends IncomeLoad {
  const IncomeFailed(this.message);
  final String message;
}

abstract class IncomeSource {
  Future<IncomeLoad> load(IncomePeriod period);
}

// ---- strict reading of the server's answer ---------------------------------------------------------------------------------

int _nonNegative(Object? value) {
  if (value is int && value >= 0) {
    return value;
  }
  throw const FormatException('amount');
}

int _signed(Object? value, {required bool allowPositive}) {
  if (value is int && (allowPositive || value <= 0)) {
    return value;
  }
  throw const FormatException('amount');
}

bool _flag(Object? value) => value is bool ? value : throw const FormatException('flag');

Map<String, Object?> _object(Object? value) => value is Map<String, Object?> ? value : throw const FormatException('object');

String _day(Object? value) {
  if (value is String && RegExp(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$').hasMatch(value)) {
    return value;
  }
  throw const FormatException('day');
}

/// Reads the body of GET /v1/driver/income/summary. Any mismatch with the contract (a missing key, a float, a negative count, a period that is not the one
/// asked for, a daily list of the wrong length) makes the whole read a failure: no half-filled screen.
IncomeSummary parseIncomeSummary(Object? data, IncomePeriod asked) {
  final Map<String, Object?> body = _object(data);
  final Map<String, Object?> period = _object(body['period']);
  final String from = _day(period['from']);
  final String to = _day(period['to']);
  final int days = _nonNegative(period['days']);
  if (from != isoDay(asked.from) || to != isoDay(asked.to) || days != asked.days) {
    throw const FormatException('period');
  }
  final Map<String, Object?> summary = _object(body['summary']);
  final int completed = _nonNegative(summary['completed_count']);
  final int fee = _nonNegative(summary['fee_vnd']);
  final int commission = _signed(summary['platform_commission_vnd'], allowPositive: false);
  final int net = _signed(summary['net_estimated_vnd'], allowPositive: true);
  if (net != fee + commission) {
    throw const FormatException('net');
  }
  final Object? averageRaw = summary['average_fee_vnd'];
  final int? average = averageRaw == null ? null : _nonNegative(averageRaw);
  if ((completed == 0) != (average == null)) {
    throw const FormatException('average');
  }
  final Object? dailyRaw = body['daily'];
  if (dailyRaw is! List<Object?> || dailyRaw.length != days) {
    throw const FormatException('daily');
  }
  final List<IncomeDay> daily = <IncomeDay>[];
  for (final Object? item in dailyRaw) {
    final Map<String, Object?> row = _object(item);
    daily.add(IncomeDay(
      date: _day(row['date']),
      completed: _nonNegative(row['completed_count']),
      feeVnd: _nonNegative(row['fee_vnd']),
      commissionVnd: _signed(row['platform_commission_vnd'], allowPositive: false),
      netVnd: _signed(row['net_estimated_vnd'], allowPositive: true),
      provisional: _flag(row['net_is_provisional']),
    ));
  }
  return IncomeSummary(
    from: from,
    to: to,
    days: days,
    completed: completed,
    feeVnd: fee,
    commissionVnd: commission,
    netVnd: net,
    netProvisional: _flag(summary['net_is_provisional']),
    averageVnd: average,
    daily: List<IncomeDay>.unmodifiable(daily),
  );
}

// ---- the HTTP source --------------------------------------------------------------------------------------------------------

/// The real source: GET /v1/driver/income/summary over the signed session (Bearer + device proof). Read only; nothing is sent but the period.
class HttpIncomeSource implements IncomeSource {
  const HttpIncomeSource({required this.session});

  final SessionController session;

  @override
  Future<IncomeLoad> load(IncomePeriod period) async {
    if (session.status != SessionStatus.signedIn) {
      return const IncomeFailed('Hãy đăng nhập bằng tài khoản shipper để xem thu nhập.');
    }
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/driver/income/summary?${period.query}');
      if (response.status != 200) {
        return IncomeFailed(_refusalText(response.errorCode, response.status));
      }
      return IncomeReady(parseIncomeSummary(response.data, period));
    } on FormatException {
      return const IncomeFailed('Dữ liệu từ máy chủ không đúng định dạng. Vui lòng thử lại.');
    } on Object {
      return const IncomeFailed('Chưa tải được thu nhập. Kiểm tra mạng rồi thử lại.');
    }
  }
}

String _refusalText(String? code, int status) {
  if (code == 'ROLE_NOT_AVAILABLE') {
    return 'Hãy đăng nhập bằng tài khoản shipper để xem thu nhập.';
  }
  if (status == 401 || status == 403) {
    return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  }
  return 'Chưa tải được thu nhập. Kiểm tra mạng rồi thử lại.';
}
