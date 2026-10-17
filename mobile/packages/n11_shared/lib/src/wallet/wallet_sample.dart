import 'wallet_models.dart';
import 'wallet_source.dart';

// ILLUSTRATIVE data for the preview build (--dart-define=M04_UI_PREVIEW=true) and for tests. Every name, number and code here is
// invented from the approved M04 mockup. It is never reachable from a real build (the ship app picks it only behind the preview flag)
// and every screen fed by it says "Dữ liệu minh họa · không phải số dư thật".

const String kSampleLabel = 'Dữ liệu minh họa · không phải số dư thật';

const BankTransferInfo kSampleTransfer = BankTransferInfo(bankName: 'Vietcombank', accountNumber: '1234 5678 9012', holder: 'CÔNG TY TNHH 11SHIP', content: 'NAP 0987654321');

const ReceivingAccount kSampleAccount = ReceivingAccount(bankName: 'Vietcombank', maskedNumber: '•••• 1098', holder: 'NGUYEN VAN A');

class SampleWalletSource extends WalletSource implements WalletWrites {
  SampleWalletSource({DateTime? now, int total = 150000, int held = 2000})
      : _now = now ?? DateTime(2026, 10, 15, 10, 30),
        _total = total,
        _held = held {
    final DateTime t = _now;
    _txns.addAll(<WalletTxn>[
      WalletTxn(id: 't1', type: TxnType.topup, amount: 150000, at: DateTime(t.year, t.month, t.day, 9, 30), status: TxnStatus.success, title: 'Nạp tiền thành công', requestCode: 'NP202610150001'),
      WalletTxn(id: 't2', type: TxnType.commission, amount: -1000, at: DateTime(t.year, t.month, t.day, 10, 25), status: TxnStatus.success, title: 'Hoa hồng đơn hàng', orderRef: 'Đơn #DH250915001'),
      WalletTxn(id: 't3', type: TxnType.hold, amount: 2000, at: DateTime(t.year, t.month, t.day, 10, 20), status: TxnStatus.processing, title: 'Tạm giữ hoa hồng (2 đơn)', orderRef: 'Đang giao hàng'),
      WalletTxn(id: 't4', type: TxnType.release, amount: 1000, at: DateTime(t.year, t.month, t.day - 1, 15, 20), status: TxnStatus.success, title: 'Giải phóng tạm giữ', orderRef: 'Đơn đã hủy'),
      WalletTxn(id: 't5', type: TxnType.withdraw, amount: -100000, at: DateTime(t.year, t.month, t.day - 3, 14, 20), status: TxnStatus.success, title: 'Rút tiền thành công', requestCode: 'RT202610120001'),
      WalletTxn(id: 't6', type: TxnType.topup, amount: 200000, at: DateTime(t.year, t.month, t.day - 5, 9, 10), status: TxnStatus.success, title: 'Nạp tiền thành công', requestCode: 'NP202610100001'),
    ]);
    _topups['NP202610150001'] = TopupRequest(code: 'NP202610150001', amount: 150000, createdAt: DateTime(t.year, t.month, t.day, 9, 30), status: TopupStatus.confirmed, transfer: kSampleTransfer);
    _topups['NP202610100001'] = TopupRequest(code: 'NP202610100001', amount: 200000, createdAt: DateTime(t.year, t.month, t.day - 5, 9, 10), status: TopupStatus.confirmed, transfer: kSampleTransfer);
    _withdrawals['RT202610120001'] = WithdrawalRequest(code: 'RT202610120001', amount: 100000, createdAt: DateTime(t.year, t.month, t.day - 3, 14, 20), status: WithdrawalStatus.completed, account: kSampleAccount);
  }

  final DateTime _now;
  final int _total;
  int _held;
  int _serial = 1;
  final List<WalletTxn> _txns = <WalletTxn>[];
  final Map<String, TopupRequest> _topups = <String, TopupRequest>{};
  final Map<String, WithdrawalRequest> _withdrawals = <String, WithdrawalRequest>{};

  @override
  bool get isSample => true;

  @override
  WalletWrites? get writes => this;

  @override
  Future<WalletLoad<Wallet>> wallet() async => WalletReady<Wallet>(Wallet(total: _total, held: _held));

  List<WalletTxn> _sorted() => (List<WalletTxn>.of(_txns)..sort((WalletTxn a, WalletTxn b) => b.at.compareTo(a.at)));

  @override
  Future<WalletLoad<List<WalletTxn>>> recentTxns() async {
    final List<WalletTxn> all = _sorted();
    return all.isEmpty ? const WalletEmpty<List<WalletTxn>>() : WalletReady<List<WalletTxn>>(all.take(3).toList());
  }

  @override
  Future<WalletLoad<List<WalletTxn>>> txns(TxnFilter filter) async {
    final List<WalletTxn> rows = _sorted().where((WalletTxn t) => txnMatches(filter, t.type)).toList();
    return rows.isEmpty ? const WalletEmpty<List<WalletTxn>>() : WalletReady<List<WalletTxn>>(rows);
  }

  @override
  Future<WalletLoad<TopupRequest>> topup(String code) async {
    final TopupRequest? found = _topups[code];
    return found == null ? const WalletFailed<TopupRequest>('Không tìm thấy yêu cầu nạp.') : WalletReady<TopupRequest>(found);
  }

  @override
  Future<WalletLoad<WithdrawalRequest>> withdrawal(String code) async {
    final WithdrawalRequest? found = _withdrawals[code];
    return found == null ? const WalletFailed<WithdrawalRequest>('Không tìm thấy yêu cầu rút.') : WalletReady<WithdrawalRequest>(found);
  }

  @override
  Future<WalletLoad<ReceivingAccount>> bankAccount() async => const WalletReady<ReceivingAccount>(kSampleAccount);

  @override
  Future<WalletLoad<BankTransferInfo>> transferInfo() async => const WalletReady<BankTransferInfo>(kSampleTransfer);

  String _code(String prefix) => '$prefix${_now.year}${_now.month.toString().padLeft(2, '0')}${_now.day.toString().padLeft(2, '0')}${(9000 + _serial++).toString()}';

  /// A topup REQUEST only: the balance is not touched (only an Admin confirmation could add money, and there is none here).
  @override
  Future<TopupRequest> createTopup(int amount, {String? proofName}) async {
    final TopupRequest request = TopupRequest(code: _code('NP'), amount: amount, createdAt: _now, status: TopupStatus.pending, transfer: kSampleTransfer, proofName: proofName);
    _topups[request.code] = request;
    return request;
  }

  /// A withdrawal request reserves its amount at once (held grows, available shrinks); only "paid" would ever debit.
  @override
  Future<WithdrawalRequest> createWithdrawal(int amount) async {
    final WithdrawalRequest request = WithdrawalRequest(code: _code('RT'), amount: amount, createdAt: _now, status: WithdrawalStatus.pending, account: kSampleAccount);
    _withdrawals[request.code] = request;
    _held += amount;
    _txns.add(WalletTxn(id: 'w${request.code}', type: TxnType.withdraw, amount: -amount, at: _now, status: TxnStatus.pending, title: 'Rút tiền (chờ xử lý)', requestCode: request.code));
    return request;
  }

  @override
  Future<void> cancelTopup(String code) async {
    final TopupRequest? found = _topups[code];
    if (found == null || !found.canCancel) {
      return;
    }
    _topups[code] = TopupRequest(code: found.code, amount: found.amount, createdAt: found.createdAt, status: TopupStatus.cancelled, transfer: found.transfer, proofName: found.proofName);
  }

  @override
  Future<void> cancelWithdrawal(String code) async {
    final WithdrawalRequest? found = _withdrawals[code];
    if (found == null || !found.canCancel) {
      return;
    }
    _withdrawals[code] = WithdrawalRequest(code: found.code, amount: found.amount, createdAt: found.createdAt, status: WithdrawalStatus.cancelled, account: found.account);
    _held -= found.amount;
    _txns.removeWhere((WalletTxn t) => t.requestCode == code);
  }
}
