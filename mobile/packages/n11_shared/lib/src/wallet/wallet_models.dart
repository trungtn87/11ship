// M04 (Ví shipper) — UI-phase models. Presentation only: nothing here reads or writes a balance. A real source (a later backend
// package) fills these from the server; the UI never derives a figure from animation, local cache or a sample.

/// Default display values ("mặc định tham khảo"). The real values are configured in Admin Web (Cài đặt → Tham số hệ thống → Ví Shipper);
/// the phone has no configuration UI. Screens take the minimums as constructor parameters.
const int kMinTopup = 100000;
const int kMinWithdraw = 10000;

String _group(int absolute) {
  final String digits = absolute.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) {
      out.write('.');
    }
    out.write(digits[i]);
  }
  return out.toString();
}

/// Whole VND with Vietnamese grouping: `100000` -> `100.000đ`, `-1000` -> `-1.000đ`.
String formatWalletVnd(int value) => '${value < 0 ? '-' : ''}${_group(value.abs())}đ';

/// Like [formatWalletVnd] with an explicit `+` for positive values: `150000` -> `+150.000đ`.
String formatWalletVndSigned(int value) => value > 0 ? '+${formatWalletVnd(value)}' : formatWalletVnd(value);

/// `dd/MM/yyyy HH:mm` (local time of the value).
String formatWalletTime(DateTime at) {
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(at.day)}/${two(at.month)}/${at.year} ${two(at.hour)}:${two(at.minute)}';
}

/// Digits of a typed amount ("100.000" -> 100000); null when empty or not a number.
int? parseVndInput(String text) {
  final String digits = text.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty || digits.length > 12) {
    return null;
  }
  return int.parse(digits);
}

/// A readable short form of a request identifier: the first eight characters, upper-case, for a server UUID; any other code unchanged.
String walletShortCode(String code) => RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-').hasMatch(code) ? code.substring(0, 8).toUpperCase() : code;

/// B = total, H = held, A = B - H. The available figure is ALWAYS computed here, never taken from a separate field.
class Wallet {
  const Wallet({required this.total, required this.held});

  final int total;
  final int held;

  int get available => total - held;
}

enum TopupStatus { pending, confirmed, rejected, cancelled }

String topupStatusLabel(TopupStatus status) => switch (status) {
      TopupStatus.pending => 'Chờ xác nhận',
      TopupStatus.confirmed => 'Thành công',
      TopupStatus.rejected => 'Từ chối',
      TopupStatus.cancelled => 'Đã hủy',
    };

enum WithdrawalStatus { pending, processing, needsReconcile, completed, cancelled }

String withdrawalStatusLabel(WithdrawalStatus status) => switch (status) {
      WithdrawalStatus.pending => 'Chờ xử lý',
      WithdrawalStatus.processing => 'Đang xử lý',
      WithdrawalStatus.needsReconcile => 'Cần đối soát',
      WithdrawalStatus.completed => 'Hoàn thành',
      WithdrawalStatus.cancelled => 'Đã hủy',
    };

/// Where the shipper sends money when topping up (the system account) and the content to type.
class BankTransferInfo {
  const BankTransferInfo({required this.bankName, required this.accountNumber, required this.holder, this.content});

  final String bankName;
  final String accountNumber;
  final String holder;

  /// The transfer content to type, ONLY when the server defines one. A real server defines none today (the Admin matches the transfer by
  /// the bank statement), so a real build shows no content row rather than an invented code.
  final String? content;
}

/// The shipper's verified receiving account (owned by M03; read-only here). Only the masked number is ever shown.
class ReceivingAccount {
  const ReceivingAccount({required this.bankName, required this.maskedNumber, required this.holder});

  final String bankName;
  final String maskedNumber;
  final String holder;
}

class TopupRequest {
  const TopupRequest({required this.code, required this.amount, required this.createdAt, required this.status, this.transfer, this.proofName, this.displayCode, this.version, this.reportedAt});

  /// The identifier the app opens the request by (the server's request id for a real source).
  final String code;
  final int amount;
  final DateTime createdAt;
  final TopupStatus status;
  final BankTransferInfo? transfer;
  final String? proofName;

  /// A short code a person can read out ("MÃ A1B2C3D4"); [code] when the source has none.
  final String? displayCode;

  /// The record version the server answered (a cancel carries it).
  final int? version;

  /// #199: when the Shipper pressed "Tôi đã chuyển khoản". A notice for the administration only: the request stays pending and the wallet is untouched.
  final DateTime? reportedAt;

  String get shownCode => displayCode ?? code;

  /// A topup can be cancelled only while nobody has decided it.
  bool get canCancel => status == TopupStatus.pending;

  /// "Tôi đã chuyển khoản" is offered once, while the request is open.
  bool get canReport => status == TopupStatus.pending && reportedAt == null;
}

class WithdrawalRequest {
  const WithdrawalRequest({required this.code, required this.amount, required this.createdAt, required this.status, required this.account, this.displayCode, this.version});

  final String code;
  final String? displayCode;
  final int? version;

  String get shownCode => displayCode ?? code;
  final int amount;
  final DateTime createdAt;
  final WithdrawalStatus status;

  /// Snapshot taken when the request was created; a later bank change never rewrites it.
  final ReceivingAccount account;

  bool get canCancel => status == WithdrawalStatus.pending;
}

enum TxnType { topup, withdraw, commission, hold, release }

enum TxnStatus { success, pending, processing, cancelled }

String txnStatusLabel(TxnStatus status) => switch (status) {
      TxnStatus.success => 'Thành công',
      TxnStatus.pending => 'Chờ xử lý',
      TxnStatus.processing => 'Đang xử lý',
      TxnStatus.cancelled => 'Đã hủy',
    };

enum TxnFilter { all, topup, withdraw, commission, hold }

String txnFilterLabel(TxnFilter filter) => switch (filter) {
      TxnFilter.all => 'Tất cả',
      TxnFilter.topup => 'Nạp tiền',
      TxnFilter.withdraw => 'Rút tiền',
      TxnFilter.commission => 'Hoa hồng',
      TxnFilter.hold => 'Tạm giữ',
    };

/// Whether a row of [type] belongs to [filter]. "Tạm giữ" holds both the hold and its release.
bool txnMatches(TxnFilter filter, TxnType type) => switch (filter) {
      TxnFilter.all => true,
      TxnFilter.topup => type == TxnType.topup,
      TxnFilter.withdraw => type == TxnType.withdraw,
      TxnFilter.commission => type == TxnType.commission,
      TxnFilter.hold => type == TxnType.hold || type == TxnType.release,
    };

class WalletTxn {
  const WalletTxn({required this.id, required this.type, required this.amount, required this.at, required this.status, required this.title, this.orderRef, this.requestCode});

  final String id;
  final TxnType type;

  /// Signed for ledger movements (topup +, commission -, withdraw -). For [TxnType.hold] and [TxnType.release] this is the
  /// (positive) amount of the hold, which is information, not a ledger movement.
  final int amount;
  final DateTime at;
  final TxnStatus status;
  final String title;

  /// Text of the order this row belongs to, when there is one.
  final String? orderRef;

  /// Code of the topup / withdrawal request this row came from (opens its detail).
  final String? requestCode;

  /// Holds and their release are not ledger entries: no sign, no green "+".
  bool get isLedgerMovement => type != TxnType.hold && type != TxnType.release;

  String get amountText => isLedgerMovement ? formatWalletVndSigned(amount) : formatWalletVnd(amount.abs());
}
