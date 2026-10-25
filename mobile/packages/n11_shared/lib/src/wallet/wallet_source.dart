import '../m10/order_chat_models.dart';
import 'wallet_models.dart';

// The data seam of the wallet screens. A screen asks a [WalletSource] and draws whatever state comes back; it never invents a value.
// Real builds use [NotWiredWalletSource] (every read says "not wired", no number exists). The preview and the tests use
// SampleWalletSource (wallet_sample.dart). When the M04 backend exists, a real source implements this interface and the screens
// stay as they are.

const String kWalletNotWiredReason = 'Ví chưa được nối với máy chủ.';

/// What one read answered.
sealed class WalletLoad<T> {
  const WalletLoad();
}

class WalletNotWired<T> extends WalletLoad<T> {
  const WalletNotWired(this.reason);
  final String reason;
}

class WalletLoading<T> extends WalletLoad<T> {
  const WalletLoading();
}

class WalletFailed<T> extends WalletLoad<T> {
  const WalletFailed(this.message);
  final String message;
}

/// A read that worked and has nothing to show (no transactions yet).
class WalletEmpty<T> extends WalletLoad<T> {
  const WalletEmpty();
}

class WalletReady<T> extends WalletLoad<T> {
  const WalletReady(this.value);
  final T value;
}

/// A write that did not complete, with the sentence to show. [outcomeUnknown] means the server may have done it: the person's next tap
/// sends the SAME command again (the source keeps its Idempotency-Key), never a new one.
class WalletFailure implements Exception {
  const WalletFailure(this.message, {this.outcomeUnknown = false});

  final String message;
  final bool outcomeUnknown;

  @override
  String toString() => 'WalletFailure($message, unknown: $outcomeUnknown)';
}

/// Writes. Only a source that really can write has one; the UI disables every "create / cancel" control when [WalletSource.writes] is null.
abstract class WalletWrites {
  /// Creates a topup REQUEST in state "Chờ xác nhận". It never adds money: only an Admin confirms a topup.
  Future<TopupRequest> createTopup(int amount, {String? proofName});

  /// Creates a withdrawal REQUEST in state "Chờ xử lý".
  Future<WithdrawalRequest> createWithdrawal(int amount);

  Future<void> cancelTopup(String code);

  /// "Tôi đã chuyển khoản" (#199): ONE mark and a notice for the administration. The balance, the ledger and the request are untouched; only an Admin's
  /// confirmation adds money.
  Future<void> reportTransfer(String code);

  Future<void> cancelWithdrawal(String code);
}

abstract class WalletSource {
  const WalletSource();

  /// True only for illustrative data: every screen then shows "Dữ liệu minh họa · không phải số dư thật".
  bool get isSample;

  /// Null = nothing can be created or cancelled (buttons are disabled with [notWiredReason]).
  WalletWrites? get writes;

  /// The payment conversation of a top-up request (#199); null when the source has none (the preview and the not-wired source).
  OrderChatApi? get chat => null;

  bool get canWrite => writes != null;

  String get notWiredReason => kWalletNotWiredReason;

  /// The minimum amounts the server currently asks for (a real source learns them from the wallet summary; others use the defaults).
  int get minTopup => kMinTopup;
  int get minWithdraw => kMinWithdraw;

  Future<WalletLoad<Wallet>> wallet();
  Future<WalletLoad<List<WalletTxn>>> recentTxns();
  Future<WalletLoad<List<WalletTxn>>> txns(TxnFilter filter);

  /// True while the server still has older rows of [filter] after what [txns] and [moreTxns] returned (the history screen then offers "Tải thêm").
  bool hasMoreTxns(TxnFilter filter) => false;

  /// The next older page of [filter], continuing where [txns] / the last call stopped. Empty when nothing is left.
  Future<WalletLoad<List<WalletTxn>>> moreTxns(TxnFilter filter) async => const WalletReady<List<WalletTxn>>(<WalletTxn>[]);

  Future<WalletLoad<TopupRequest>> topup(String code);
  Future<WalletLoad<WithdrawalRequest>> withdrawal(String code);

  /// The verified receiving account (M03 owns it).
  Future<WalletLoad<ReceivingAccount>> bankAccount();

  /// The system account to transfer to, with the content to type, for a topup.
  Future<WalletLoad<BankTransferInfo>> transferInfo();
}

/// The source of every real build until the M04 backend exists: all reads answer "not wired", nothing is written, no number exists.
class NotWiredWalletSource extends WalletSource {
  const NotWiredWalletSource();

  @override
  bool get isSample => false;

  @override
  WalletWrites? get writes => null;

  @override
  Future<WalletLoad<Wallet>> wallet() async => WalletNotWired<Wallet>(notWiredReason);

  @override
  Future<WalletLoad<List<WalletTxn>>> recentTxns() async => WalletNotWired<List<WalletTxn>>(notWiredReason);

  @override
  Future<WalletLoad<List<WalletTxn>>> txns(TxnFilter filter) async => WalletNotWired<List<WalletTxn>>(notWiredReason);

  @override
  Future<WalletLoad<TopupRequest>> topup(String code) async => WalletNotWired<TopupRequest>(notWiredReason);

  @override
  Future<WalletLoad<WithdrawalRequest>> withdrawal(String code) async => WalletNotWired<WithdrawalRequest>(notWiredReason);

  @override
  Future<WalletLoad<ReceivingAccount>> bankAccount() async => WalletNotWired<ReceivingAccount>(notWiredReason);

  @override
  Future<WalletLoad<BankTransferInfo>> transferInfo() async => WalletNotWired<BankTransferInfo>(notWiredReason);
}
