// "Thanh toán quán" (issue #198): the payment requests of ONE shop, as the 11Food app draws them. Wire contract: apps/backend/src/shop-payment. Every field is
// parsed strictly; a body that is not what the contract says is a FormatException (a server failure for the screen), never a half-filled request. There is no
// subscription here: no period, no renewal, no expiry and no shop wallet. A request asks for money moved OUTSIDE the app; the shop only says "Tôi đã chuyển
// khoản"; only the administration records the money received and opens any right.

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw const FormatException('object');
List<Object?> _list(Object? v) => v is List<Object?> ? v : throw const FormatException('list');
String _str(Object? v) => v is String ? v : throw const FormatException('string');
bool _bool(Object? v) => v is bool ? v : throw const FormatException('bool');
int _int(Object? v) => v is int ? v : throw const FormatException('int');
DateTime? _time(Object? v) => v == null ? null : DateTime.parse(_str(v));

enum ShopPaymentPurpose { accountOpening, menuExpansion, other }

extension ShopPaymentPurposeText on ShopPaymentPurpose {
  String get wire => switch (this) {
        ShopPaymentPurpose.accountOpening => 'ACCOUNT_OPENING',
        ShopPaymentPurpose.menuExpansion => 'MENU_EXPANSION',
        ShopPaymentPurpose.other => 'OTHER',
      };

  String get label => switch (this) {
        ShopPaymentPurpose.accountOpening => 'Mở tài khoản quán',
        ShopPaymentPurpose.menuExpansion => 'Mở rộng số món',
        ShopPaymentPurpose.other => 'Khoản khác',
      };
}

ShopPaymentPurpose _purpose(Object? v) => switch (_str(v)) {
      'ACCOUNT_OPENING' => ShopPaymentPurpose.accountOpening,
      'MENU_EXPANSION' => ShopPaymentPurpose.menuExpansion,
      'OTHER' => ShopPaymentPurpose.other,
      _ => throw const FormatException('purpose'),
    };

enum ShopPaymentState { pending, confirmed, rejected, cancelled }

ShopPaymentState _state(Object? v) => switch (_str(v)) {
      'PENDING' => ShopPaymentState.pending,
      'CONFIRMED' => ShopPaymentState.confirmed,
      'REJECTED' => ShopPaymentState.rejected,
      'CANCELLED' => ShopPaymentState.cancelled,
      _ => throw const FormatException('state'),
    };

class ShopPayment {
  const ShopPayment({
    required this.requestId,
    required this.purpose,
    required this.amount,
    required this.state,
    required this.version,
    required this.createdAt,
    required this.reportedAt,
    required this.resolvedAt,
    required this.canReport,
    required this.canCancel,
    this.receivedAmount,
    this.receivedAt,
    this.entitlementGranted = false,
    this.menuExpanded = false,
  });

  factory ShopPayment.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final int amount = _int(m['amount_requested_vnd']);
    final int version = _int(m['version']);
    if (amount < 1 || version < 1) {
      throw const FormatException('amount');
    }
    final Object? received = m['received_amount_vnd'];
    final Object? entitlement = m['entitlement'];
    return ShopPayment(
      requestId: _str(m['request_id']),
      purpose: _purpose(m['purpose']),
      amount: amount,
      state: _state(m['state']),
      version: version,
      createdAt: DateTime.parse(_str(m['created_at'])),
      reportedAt: _time(m['reported_at']),
      resolvedAt: _time(m['resolved_at']),
      canReport: _bool(m['can_report']),
      canCancel: _bool(m['can_cancel']),
      receivedAmount: received == null ? null : _int(received),
      receivedAt: _time(m['received_at']),
      entitlementGranted: entitlement != null,
      menuExpanded: m['menu_expanded'] == true,
    );
  }

  final String requestId;
  final ShopPaymentPurpose purpose;

  /// The amount the shop asked to pay (typed by the shop; the app has no price list).
  final int amount;
  final ShopPaymentState state;

  /// The record version a cancel carries.
  final int version;
  final DateTime createdAt;

  /// When the shop pressed "Tôi đã chuyển khoản": a notice, not a confirmation.
  final DateTime? reportedAt;
  final DateTime? resolvedAt;

  /// The server's decision: only before the report, while the request is open.
  final bool canReport;
  final bool canCancel;

  /// What the administration recorded as received (CONFIRMED only). Never the bank reference.
  final int? receivedAmount;
  final DateTime? receivedAt;

  /// A manual right followed THIS payment (the administration's separate act).
  final bool entitlementGranted;

  /// The shop holds the manual dish right now.
  final bool menuExpanded;

  /// Reported and not decided yet.
  bool get awaitingCheck => state == ShopPaymentState.pending && reportedAt != null;

  /// The words of the state in this app: a report is "Chờ kiểm tra", never "Đã nhận tiền".
  String get stateLabel => switch (state) {
        ShopPaymentState.pending => reportedAt != null ? 'Chờ kiểm tra' : 'Chưa báo chuyển khoản',
        ShopPaymentState.confirmed => 'Đã nhận tiền',
        ShopPaymentState.rejected => 'Chưa nhận được',
        ShopPaymentState.cancelled => 'Đã hủy',
      };
}

class ShopPaymentPage {
  const ShopPaymentPage({required this.items, required this.nextCursor});

  factory ShopPaymentPage.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Object? next = m['next_cursor'];
    return ShopPaymentPage(items: <ShopPayment>[for (final Object? i in _list(m['items'])) ShopPayment.fromJson(i)], nextCursor: next == null ? null : _str(next));
  }

  final List<ShopPayment> items;
  final String? nextCursor;
}

/// The real account of the system the shop pays to (SYSTEM configures it). Never invented by the app.
class PaymentAccount {
  const PaymentAccount({required this.bankId, required this.accountNumber, required this.accountHolder});

  factory PaymentAccount.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    return PaymentAccount(bankId: _str(m['bank_id']), accountNumber: _str(m['account_number']), accountHolder: _str(m['account_holder']));
  }

  final String bankId;
  final String accountNumber;
  final String accountHolder;
}

List<PaymentAccount> parsePaymentAccounts(Object? raw) => <PaymentAccount>[for (final Object? a in _list(_obj(raw)['accounts'])) PaymentAccount.fromJson(a)];
