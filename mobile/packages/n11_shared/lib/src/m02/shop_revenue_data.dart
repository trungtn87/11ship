import '../account/api_client.dart';
import '../account/session_controller.dart';

// Doanh thu quán (issue #391): the period, the strict reader of GET /v1/shop/revenue/summary and /orders, and the source the screen reads through.
// Every money figure is an integer VND computed by the server. A figure the server did not give is never shown as 0: the screen says "Chưa xác định".
// Periods are Vietnam calendar days (UTC+7), both ends inclusive, at most [kRevenueMaxDays] days.

const int kRevenueMaxDays = 92;
const Duration kRevenueVnOffset = Duration(hours: 7);

enum RevenuePreset { today, last7, last30, custom }

/// The Vietnam calendar day of [nowUtc] as a plain date (no device time zone involved).
DateTime revenueVnDay(DateTime nowUtc) {
  final DateTime vn = nowUtc.toUtc().add(kRevenueVnOffset);
  return DateTime(vn.year, vn.month, vn.day);
}

String revenueIsoDay(DateTime day) => '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

String revenueViewDay(DateTime day) => '${day.day.toString().padLeft(2, '0')}/${day.month.toString().padLeft(2, '0')}/${day.year.toString().padLeft(4, '0')}';

String revenueShortDay(DateTime day) => '${day.day.toString().padLeft(2, '0')}/${day.month.toString().padLeft(2, '0')}';

class RevenuePeriod {
  const RevenuePeriod({required this.from, required this.to});

  /// Vietnam calendar days, inclusive.
  final DateTime from;
  final DateTime to;

  int get days => DateTime.utc(to.year, to.month, to.day).difference(DateTime.utc(from.year, from.month, from.day)).inDays + 1;

  bool get isValid => days >= 1 && days <= kRevenueMaxDays;

  String get query => 'from=${revenueIsoDay(from)}&to=${revenueIsoDay(to)}';

  /// Hôm nay, 7 ngày and 30 ngày all end today (Vietnam day) and include it.
  static RevenuePeriod forPreset(RevenuePreset preset, DateTime nowUtc) {
    final DateTime today = revenueVnDay(nowUtc);
    return switch (preset) {
      RevenuePreset.today => RevenuePeriod(from: today, to: today),
      RevenuePreset.last7 => RevenuePeriod(from: today.subtract(const Duration(days: 6)), to: today),
      RevenuePreset.last30 => RevenuePeriod(from: today.subtract(const Duration(days: 29)), to: today),
      RevenuePreset.custom => RevenuePeriod(from: today, to: today),
    };
  }
}

class RevenueDay {
  const RevenueDay({required this.date, required this.completed, required this.itemsVnd});

  /// Vietnam calendar day, YYYY-MM-DD.
  final String date;
  final int completed;
  final int itemsVnd;
}

class RevenueSummary {
  const RevenueSummary({required this.from, required this.to, required this.days, required this.completed, required this.itemsVnd, required this.averageVnd, required this.daily});

  final String from;
  final String to;
  final int days;

  /// COMPLETED orders in the period, one per order.
  final int completed;

  /// "Giá trị món từ đơn hoàn tất": the dishes' value of those orders. Not money received, and never a fee, tip or COD.
  final int itemsVnd;

  /// Bình quân/đơn; null when there is no completed order (never shown as 0).
  final int? averageVnd;
  final List<RevenueDay> daily;
}

class RevenueOrder {
  const RevenueOrder({required this.orderId, required this.code, required this.endedAt, required this.itemsVnd});

  final String orderId;
  final String code;

  /// The instant the order ended, UTC ISO 8601 (as the server gave it).
  final String endedAt;
  final int itemsVnd;
}

class RevenueOrdersPage {
  const RevenueOrdersPage({required this.items, required this.nextCursor});

  final List<RevenueOrder> items;

  /// Opaque cursor of the next page; null when this is the last page.
  final String? nextCursor;
}

sealed class RevenueLoad<T> {
  const RevenueLoad();
}

class RevenueLoading<T> extends RevenueLoad<T> {
  const RevenueLoading();
}

class RevenueReady<T> extends RevenueLoad<T> {
  const RevenueReady(this.value);
  final T value;
}

class RevenueFailed<T> extends RevenueLoad<T> {
  const RevenueFailed(this.message);
  final String message;
}

abstract class RevenueSource {
  Future<RevenueLoad<RevenueSummary>> summary(RevenuePeriod period);

  /// One page of the period's orders, newest first. [cursor] is the previous page's nextCursor (null for the first page).
  Future<RevenueLoad<RevenueOrdersPage>> orders(RevenuePeriod period, {String? cursor});
}

// ---- strict reading of the server's answer ------------------------------------------------------------------------------------

int _nonNegative(Object? value) {
  if (value is int && value >= 0) {
    return value;
  }
  throw const FormatException('amount');
}

String _day(Object? value) {
  if (value is String && RegExp(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$').hasMatch(value)) {
    return value;
  }
  throw const FormatException('day');
}

String _text(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw const FormatException('text');
}

Map<String, Object?> _object(Object? value) => value is Map<String, Object?> ? value : throw const FormatException('object');

/// Reads the body of GET /v1/shop/revenue/summary. Any mismatch with the contract (a missing key, a float, a negative, a period other than the one asked for,
/// a daily list of the wrong length, an average that does not match the count) makes the whole read a failure: no half-filled screen.
RevenueSummary parseRevenueSummary(Object? data, RevenuePeriod asked) {
  final Map<String, Object?> body = _object(data);
  final Map<String, Object?> period = _object(body['period']);
  final String from = _day(period['from']);
  final String to = _day(period['to']);
  if (from != revenueIsoDay(asked.from) || to != revenueIsoDay(asked.to)) {
    throw const FormatException('period');
  }
  final Map<String, Object?> summary = _object(body['summary']);
  final int completed = _nonNegative(summary['completed_count']);
  final int items = _nonNegative(summary['items_total_vnd']);
  final Object? averageRaw = summary['average_items_vnd'];
  final int? average = averageRaw == null ? null : _nonNegative(averageRaw);
  if ((completed == 0) != (average == null)) {
    throw const FormatException('average');
  }
  final Object? dailyRaw = body['daily'];
  if (dailyRaw is! List<Object?> || dailyRaw.length != asked.days) {
    throw const FormatException('daily');
  }
  final List<RevenueDay> daily = <RevenueDay>[];
  for (final Object? item in dailyRaw) {
    final Map<String, Object?> row = _object(item);
    daily.add(RevenueDay(date: _day(row['date']), completed: _nonNegative(row['completed_count']), itemsVnd: _nonNegative(row['items_total_vnd'])));
  }
  return RevenueSummary(
    from: from,
    to: to,
    days: asked.days,
    completed: completed,
    itemsVnd: items,
    averageVnd: average,
    daily: List<RevenueDay>.unmodifiable(daily),
  );
}

RevenueOrdersPage parseRevenueOrders(Object? data) {
  final Map<String, Object?> body = _object(data);
  final Object? itemsRaw = body['items'];
  if (itemsRaw is! List<Object?>) {
    throw const FormatException('items');
  }
  final List<RevenueOrder> items = <RevenueOrder>[];
  for (final Object? item in itemsRaw) {
    final Map<String, Object?> row = _object(item);
    items.add(RevenueOrder(
      orderId: _text(row['order_id']),
      code: _text(row['code']),
      endedAt: _text(row['ended_at']),
      itemsVnd: _nonNegative(row['items_total_vnd']),
    ));
  }
  final Object? next = body['next_cursor'];
  if (next != null && (next is! String || next.isEmpty)) {
    throw const FormatException('cursor');
  }
  return RevenueOrdersPage(items: List<RevenueOrder>.unmodifiable(items), nextCursor: next as String?);
}

// ---- the HTTP source ----------------------------------------------------------------------------------------------------------

/// The real source: the owner's own shop revenue over the signed session. Read only; the period and the cursor are the only things sent.
class HttpShopRevenueSource implements RevenueSource {
  const HttpShopRevenueSource({required this.session});

  final SessionController session;

  @override
  Future<RevenueLoad<RevenueSummary>> summary(RevenuePeriod period) async {
    if (session.status != SessionStatus.signedIn) {
      return const RevenueFailed<RevenueSummary>('Hãy đăng nhập để xem doanh thu quán.');
    }
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/shop/revenue/summary?${period.query}');
      if (response.status != 200) {
        return RevenueFailed<RevenueSummary>(_refusalText(response.errorCode, response.status));
      }
      return RevenueReady<RevenueSummary>(parseRevenueSummary(response.data, period));
    } on FormatException {
      return const RevenueFailed<RevenueSummary>('Dữ liệu từ máy chủ không đúng định dạng. Vui lòng thử lại.');
    } on Object {
      return const RevenueFailed<RevenueSummary>('Chưa tải được doanh thu. Kiểm tra mạng rồi thử lại.');
    }
  }

  @override
  Future<RevenueLoad<RevenueOrdersPage>> orders(RevenuePeriod period, {String? cursor}) async {
    if (session.status != SessionStatus.signedIn) {
      return const RevenueFailed<RevenueOrdersPage>('Hãy đăng nhập để xem doanh thu quán.');
    }
    try {
      final String cursorPart = cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}';
      final ApiResponse response = await session.protectedCall('GET', '/v1/shop/revenue/orders?${period.query}$cursorPart');
      if (response.status != 200) {
        return RevenueFailed<RevenueOrdersPage>(_refusalText(response.errorCode, response.status));
      }
      return RevenueReady<RevenueOrdersPage>(parseRevenueOrders(response.data));
    } on FormatException {
      return const RevenueFailed<RevenueOrdersPage>('Dữ liệu từ máy chủ không đúng định dạng. Vui lòng thử lại.');
    } on Object {
      return const RevenueFailed<RevenueOrdersPage>('Chưa tải được đơn. Kiểm tra mạng rồi thử lại.');
    }
  }
}

String _refusalText(String? code, int status) {
  if (code == 'SHOP_ROLE_REQUIRED') {
    return 'Hãy vào chế độ quản lý quán để xem doanh thu.';
  }
  if (code == 'SHOP_NOT_FOUND') {
    return 'Quán của bạn chưa có hồ sơ nên chưa có doanh thu.';
  }
  if (status == 401 || status == 403) {
    return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  }
  return 'Chưa tải được doanh thu. Kiểm tra mạng rồi thử lại.';
}
