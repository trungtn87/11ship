import 'dart:convert';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'wallet_models.dart';
import 'wallet_source.dart';

// M04 (11Ship): the REAL wallet source, over the signed session (Bearer + device proof) of the Shipper. Every answer is parsed strictly: a body that is
// not what the contract says is a failed read, never a half-filled screen, and no number is ever invented (a balance the server did not give is not shown).
//
// Money safety of the phone side:
//  * a topup REQUEST never adds money ("Tôi đã chuyển tiền" only asks the Admin to check the bank statement); a withdrawal request only sets money aside;
//  * every write carries an Idempotency-Key made ONCE per intent (same kind, same body): a lost answer leaves the key in place, so the person's next tap resends the
//    SAME command and the server answers with the same record instead of creating a second one. A definite answer (done or refused) forgets the key;
//  * a cancel reads the record's version first and sends that version, so a request that moved on is refused (conflict), never cancelled by guess;
//  * the screens disable the button while a write runs, so one tap is one request.

const Map<String, String> _bankNames = <String, String>{
  'VCB': 'Vietcombank',
  'TCB': 'Techcombank',
  'BIDV': 'BIDV',
  'CTG': 'VietinBank',
  'VIETINBANK': 'VietinBank',
  'ACB': 'ACB',
  'MB': 'MB Bank',
  'MBB': 'MB Bank',
  'VPB': 'VPBank',
  'TPB': 'TPBank',
  'STB': 'Sacombank',
  'AGR': 'Agribank',
  'AGRIBANK': 'Agribank',
  'SHB': 'SHB',
  'HDB': 'HDBank',
  'OCB': 'OCB',
  'VIB': 'VIB',
  'MSB': 'MSB',
  'SCB': 'SCB',
  'EIB': 'Eximbank',
};

String _bankName(String code) => _bankNames[code.toUpperCase()] ?? code;

/// "****1234" (the server's masking) as the app draws it: "•••• 1234".
String _maskedNumber(String masked) => masked.startsWith('****') ? '•••• ${masked.substring(4)}' : masked;

const String _unknownText = 'Chưa nhận được phản hồi rõ ràng từ máy chủ. Yêu cầu có thể đã được ghi nhận: bấm lại để gửi lại ĐÚNG yêu cầu đó, hệ thống không tạo thêm yêu cầu mới.';

String _refusalText(String? code) {
  switch (code) {
    case 'TOPUP_AMOUNT_BELOW_MINIMUM':
      return 'Số tiền nạp thấp hơn mức tối thiểu hiện tại.';
    case 'TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED':
      return 'Hệ thống chưa có tài khoản nhận tiền nên chưa nạp được. Vui lòng thử lại sau.';
    case 'TOPUP_REQUEST_STATE_CONFLICT':
      return 'Yêu cầu nạp đã được xử lý nên không hủy được nữa.';
    case 'TOPUP_REQUEST_NOT_FOUND' || 'WITHDRAWAL_NOT_FOUND':
      return 'Không tìm thấy yêu cầu này.';
    case 'WITHDRAWAL_AMOUNT_BELOW_MINIMUM':
      return 'Số tiền rút thấp hơn mức tối thiểu hiện tại.';
    case 'WITHDRAWAL_INSUFFICIENT_AVAILABLE':
      return 'Số dư khả dụng không đủ để rút số tiền này.';
    case 'WITHDRAWAL_BANK_NOT_VERIFIED':
      return 'Tài khoản ngân hàng của bạn chưa được Admin xác minh nên chưa rút tiền được.';
    case 'WITHDRAWAL_STATE_CONFLICT':
      return 'Yêu cầu rút đã được Admin nhận xử lý nên không hủy được nữa.';
    case 'VERSION_CONFLICT':
      return 'Yêu cầu vừa thay đổi. Đã tải lại, hãy kiểm tra rồi thử lại.';
    case 'DRIVER_STATE_CONFLICT':
      return 'Hồ sơ shipper đã đóng nên không thực hiện được thao tác này.';
    case 'ROLE_NOT_AVAILABLE':
      return 'Hãy đăng nhập bằng tài khoản shipper để dùng ví.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Yêu cầu trước đó chưa hoàn tất. Hãy mở lại màn hình rồi thử lại.';
    default:
      return 'Máy chủ từ chối yêu cầu. Không có khoản tiền nào bị thay đổi.';
  }
}

/// What a failed READ says. No server text is ever copied into it.
String _readText(Object error) {
  if (error is AuthFailure) {
    switch (error.kind) {
      case AuthFailureKind.sessionEnded || AuthFailureKind.deviceProofRefused:
        return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
      case AuthFailureKind.unknownOutcome || AuthFailureKind.tls:
        return 'Không có kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.';
      default:
        if (error.code == 'ROLE_NOT_AVAILABLE') {
          return 'Hãy đăng nhập bằng tài khoản shipper để xem ví.';
        }
        return 'Máy chủ chưa trả được dữ liệu. Vui lòng thử lại.';
    }
  }
  return 'Dữ liệu từ máy chủ không đúng định dạng. Vui lòng thử lại.';
}

int _whole(Object? value) {
  if (value is int && value >= 0) {
    return value;
  }
  throw const FormatException('amount');
}

int _signed(Object? value) {
  if (value is int) {
    return value;
  }
  throw const FormatException('amount');
}

String _text(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw const FormatException('text');
}

DateTime _time(Object? value) {
  if (value is String) {
    final DateTime? parsed = DateTime.tryParse(value);
    if (parsed != null) {
      return parsed.toLocal();
    }
  }
  throw const FormatException('time');
}

Map<String, Object?> _map(Object? value) {
  if (value is Map<String, Object?>) {
    return value;
  }
  throw const FormatException('object');
}

TopupStatus _topupStatus(Object? value) => switch (value) {
      'PENDING' => TopupStatus.pending,
      'CONFIRMED' => TopupStatus.confirmed,
      'REJECTED' => TopupStatus.rejected,
      'CANCELLED' => TopupStatus.cancelled,
      _ => throw const FormatException('state'),
    };

WithdrawalStatus _withdrawalStatus(Object? value) => switch (value) {
      'PENDING' => WithdrawalStatus.pending,
      'PROCESSING' => WithdrawalStatus.processing,
      'RECONCILIATION' => WithdrawalStatus.needsReconcile,
      'PAID' => WithdrawalStatus.completed,
      'CANCELLED' => WithdrawalStatus.cancelled,
      _ => throw const FormatException('state'),
    };

TopupRequest _parseTopup(Object? data) {
  final Map<String, Object?> raw = _map(data);
  final String id = _text(raw['request_id']);
  final int amount = _whole(raw['amount_requested_vnd']);
  final int version = _whole(raw['version']);
  if (amount < 1 || version < 1) {
    throw const FormatException('amount');
  }
  return TopupRequest(code: id, displayCode: walletShortCode(id), amount: amount, createdAt: _time(raw['created_at']), status: _topupStatus(raw['state']), version: version);
}

WithdrawalRequest _parseWithdrawal(Object? data) {
  final Map<String, Object?> raw = _map(data);
  final String id = _text(raw['withdrawal_id']);
  final Map<String, Object?> account = _map(raw['account']);
  final int amount = _whole(raw['amount_vnd']);
  final int version = _whole(raw['version']);
  if (amount < 1 || version < 1) {
    throw const FormatException('amount');
  }
  return WithdrawalRequest(
    code: id,
    displayCode: _text(raw['request_code']),
    amount: amount,
    createdAt: _time(raw['created_at']),
    status: _withdrawalStatus(raw['state']),
    version: version,
    account: ReceivingAccount(bankName: _bankName(_text(account['bank_code'])), maskedNumber: _maskedNumber(_text(account['account_number_masked'])), holder: _text(account['account_holder'])),
  );
}

WalletTxn _parseTxn(Object? data) {
  final Map<String, Object?> raw = _map(data);
  final String id = _text(raw['id']);
  final int amount = _signed(raw['amount_vnd']);
  final DateTime at = _time(raw['at']);
  final Object? ref = raw['order_ref'];
  final String? orderRef = ref is String && ref.isNotEmpty ? 'Đơn $ref' : null;
  final Object? requestId = raw['request_id'];
  final String? requestCode = requestId is String && requestId.isNotEmpty ? requestId : null;
  final TxnStatus status = switch (raw['status']) {
    'success' => TxnStatus.success,
    'pending' => TxnStatus.pending,
    'processing' => TxnStatus.processing,
    'cancelled' => TxnStatus.cancelled,
    _ => throw const FormatException('status'),
  };
  final String type = _text(raw['type']);
  switch (type) {
    case 'topup':
      return WalletTxn(
        id: id,
        type: TxnType.topup,
        amount: amount,
        at: at,
        status: status,
        title: status == TxnStatus.success ? 'Nạp tiền thành công' : (status == TxnStatus.cancelled ? 'Yêu cầu nạp (không thành công)' : 'Yêu cầu nạp (chờ xác nhận)'),
        requestCode: requestCode,
      );
    case 'withdraw':
      return WalletTxn(
        id: id,
        type: TxnType.withdraw,
        amount: amount,
        at: at,
        status: status,
        title: status == TxnStatus.success ? 'Rút tiền thành công' : (status == TxnStatus.cancelled ? 'Yêu cầu rút đã hủy' : 'Yêu cầu rút (đang xử lý)'),
        requestCode: requestCode,
      );
    case 'commission':
      return WalletTxn(id: id, type: TxnType.commission, amount: amount, at: at, status: status, title: 'Hoa hồng đơn hàng', orderRef: orderRef);
    case 'hold':
      return WalletTxn(id: id, type: TxnType.hold, amount: amount.abs(), at: at, status: status, title: 'Tạm giữ hoa hồng', orderRef: orderRef);
    case 'release':
      return WalletTxn(id: id, type: TxnType.release, amount: amount.abs(), at: at, status: status, title: 'Giải phóng tạm giữ', orderRef: orderRef);
    default:
      throw const FormatException('type');
  }
}

String _filterName(TxnFilter filter) => switch (filter) {
      TxnFilter.all => 'all',
      TxnFilter.topup => 'topup',
      TxnFilter.withdraw => 'withdraw',
      TxnFilter.commission => 'commission',
      TxnFilter.hold => 'hold',
    };

/// The wallet of the signed-in Shipper, from the server. Reads never write; writes only create or cancel REQUESTS.
class HttpWalletSource extends WalletSource implements WalletWrites {
  HttpWalletSource({required this.session});

  final SessionController session;

  int _minTopup = kMinTopup;
  int _minWithdraw = kMinWithdraw;

  // The pending intents: the Idempotency-Key of a write whose answer was lost (or not yet seen), keyed by the exact command.
  final Map<String, String> _keys = <String, String>{};

  @override
  bool get isSample => false;

  @override
  WalletWrites? get writes => session.status == SessionStatus.signedIn ? this : null;

  @override
  String get notWiredReason => 'Hãy đăng nhập bằng tài khoản shipper để dùng ví.';

  @override
  int get minTopup => _minTopup;

  @override
  int get minWithdraw => _minWithdraw;

  // ---- plumbing -------------------------------------------------------------------------------------------------------

  Future<Object?> _get(String path) async {
    final ApiResponse response = await session.protectedCall('GET', '/v1/driver/wallet$path');
    if (response.status != 200) {
      throw failureOf(response);
    }
    return response.data;
  }

  Future<WalletLoad<T>> _read<T>(Future<T> Function() work) async {
    if (session.status != SessionStatus.signedIn) {
      return WalletNotWired<T>(notWiredReason);
    }
    try {
      return WalletReady<T>(await work());
    } on Object catch (error) {
      return WalletFailed<T>(_readText(error));
    }
  }

  /// One write. The key of an intent is made once and kept until the server gave a DEFINITE answer, so a retry after a lost answer is the same command.
  Future<Object?> _write(String intent, String method, String path, Map<String, Object?> body, {required Set<int> ok}) async {
    final String key = _keys[intent] ?? newIdempotencyKey();
    _keys[intent] = key;
    final ApiResponse response;
    try {
      response = await session.protectedCall(method, '/v1/driver/wallet$path', body: jsonEncode(body), idempotencyKey: key);
    } on AuthFailure catch (failure) {
      if (failure.outcomeUnknown) {
        throw const WalletFailure(_unknownText, outcomeUnknown: true);
      }
      _keys.remove(intent);
      throw WalletFailure(_readText(failure));
    }
    final AuthFailure? refusal = ok.contains(response.status) ? null : failureOf(response);
    if (refusal != null && refusal.outcomeUnknown) {
      throw const WalletFailure(_unknownText, outcomeUnknown: true);
    }
    _keys.remove(intent);
    if (refusal != null) {
      // M13 #155: safe server-generated correlation ID for SYSTEM error log lookup.
      // Never show an exception message, stack, bank record or untrusted response body.
      final String safeMessage = refusal.kind == AuthFailureKind.sessionEnded ? _readText(refusal) : _refusalText(refusal.code);
      final String trace = refusal.requestId == null ? '' : '\nMã tra cứu: ${refusal.requestId}';
      throw WalletFailure(safeMessage + trace);
    }
    return response.data;
  }

  // ---- reads ----------------------------------------------------------------------------------------------------------

  @override
  Future<WalletLoad<Wallet>> wallet() => _read<Wallet>(() async {
        final Map<String, Object?> data = _map(await _get(''));
        final Map<String, Object?> wallet = _map(data['wallet']);
        final Map<String, Object?> limits = _map(data['limits']);
        final int balance = _whole(wallet['balance_vnd']);
        final int held = _whole(wallet['held_vnd']);
        if (held > balance) {
          throw const FormatException('held');
        }
        final int topup = _whole(limits['topup_min_vnd']);
        final int withdraw = _whole(limits['withdraw_min_vnd']);
        if (topup > 0) {
          _minTopup = topup;
        }
        if (withdraw > 0) {
          _minWithdraw = withdraw;
        }
        return Wallet(total: balance, held: held);
      });

  /// The next older page of the cursor each filter is at: the server pages (50 a page), so the whole history is reachable without a cap.
  final Map<TxnFilter, String?> _txnCursor = <TxnFilter, String?>{};

  Future<List<WalletTxn>> _history(TxnFilter filter, {required int limit, String? cursor, bool remember = false}) async {
    final String query = 'type=${_filterName(filter)}&limit=$limit${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}';
    final Map<String, Object?> data = _map(await _get('/transactions?$query'));
    final Object? items = data['items'];
    if (items is! List<Object?>) {
      throw const FormatException('items');
    }
    final List<WalletTxn> rows = items.map(_parseTxn).toList();
    if (remember) {
      final Object? next = data['next_cursor'];
      _txnCursor[filter] = next is String ? next : null;
    }
    return rows;
  }

  @override
  Future<WalletLoad<List<WalletTxn>>> recentTxns() async {
    final WalletLoad<List<WalletTxn>> result = await _read<List<WalletTxn>>(() => _history(TxnFilter.all, limit: 3));
    return result is WalletReady<List<WalletTxn>> && result.value.isEmpty ? const WalletEmpty<List<WalletTxn>>() : result;
  }

  @override
  Future<WalletLoad<List<WalletTxn>>> txns(TxnFilter filter) async {
    _txnCursor[filter] = null;
    final WalletLoad<List<WalletTxn>> result = await _read<List<WalletTxn>>(() => _history(filter, limit: 50, remember: true));
    return result is WalletReady<List<WalletTxn>> && result.value.isEmpty ? const WalletEmpty<List<WalletTxn>>() : result;
  }

  @override
  bool hasMoreTxns(TxnFilter filter) => _txnCursor[filter] != null;

  @override
  Future<WalletLoad<List<WalletTxn>>> moreTxns(TxnFilter filter) async {
    final String? cursor = _txnCursor[filter];
    if (cursor == null) {
      return const WalletReady<List<WalletTxn>>(<WalletTxn>[]);
    }
    return _read<List<WalletTxn>>(() => _history(filter, limit: 50, cursor: cursor, remember: true));
  }

  @override
  Future<WalletLoad<TopupRequest>> topup(String code) => _read<TopupRequest>(() async => _parseTopup(await _get('/topup-requests/${Uri.encodeComponent(code)}')));

  @override
  Future<WalletLoad<WithdrawalRequest>> withdrawal(String code) => _read<WithdrawalRequest>(() async => _parseWithdrawal(await _get('/withdrawals/${Uri.encodeComponent(code)}')));

  @override
  Future<WalletLoad<ReceivingAccount>> bankAccount() async {
    if (session.status != SessionStatus.signedIn) {
      return WalletNotWired<ReceivingAccount>(notWiredReason);
    }
    try {
      final Map<String, Object?> data = _map(await _get('/withdrawal-account'));
      final Object? raw = data['account'];
      if (raw == null) {
        return const WalletEmpty<ReceivingAccount>();
      }
      final Map<String, Object?> account = _map(raw);
      if (account['can_withdraw'] != true) {
        return const WalletFailed<ReceivingAccount>('Tài khoản ngân hàng của bạn chưa được Admin xác minh nên chưa rút tiền được. Hãy kiểm tra ở Hồ sơ shipper.');
      }
      return WalletReady<ReceivingAccount>(ReceivingAccount(bankName: _bankName(_text(account['bank_code'])), maskedNumber: _maskedNumber(_text(account['account_number_masked'])), holder: _text(account['account_holder'])));
    } on Object catch (error) {
      return WalletFailed<ReceivingAccount>(_readText(error));
    }
  }

  @override
  Future<WalletLoad<BankTransferInfo>> transferInfo() async {
    if (session.status != SessionStatus.signedIn) {
      return WalletNotWired<BankTransferInfo>(notWiredReason);
    }
    try {
      final Map<String, Object?> data = _map(await _get('/topup-receiving-accounts'));
      final Object? accounts = data['accounts'];
      if (accounts is! List<Object?>) {
        throw const FormatException('accounts');
      }
      if (accounts.isEmpty) {
        return const WalletFailed<BankTransferInfo>('Hệ thống chưa có tài khoản nhận tiền nên chưa nạp được. Vui lòng thử lại sau.');
      }
      // The first account the system accepts money on; the Admin matches the transfer on the bank statement, so no content to type is invented.
      final Map<String, Object?> first = _map(accounts.first);
      return WalletReady<BankTransferInfo>(BankTransferInfo(bankName: _bankName(_text(first['bank_id'])), accountNumber: _text(first['account_number']), holder: _text(first['account_holder'])));
    } on Object catch (error) {
      return WalletFailed<BankTransferInfo>(_readText(error));
    }
  }

  // ---- writes ---------------------------------------------------------------------------------------------------------

  @override
  Future<TopupRequest> createTopup(int amount, {String? proofName}) async {
    // A picture is not supported (no private storage yet) and is never treated as proof of money: it is simply not sent.
    final Object? data = await _write('topup:$amount', 'POST', '/topup-requests', <String, Object?>{'amount_vnd': amount}, ok: const <int>{201});
    try {
      return _parseTopup(data);
    } on FormatException {
      throw const WalletFailure('Máy chủ đã nhận yêu cầu nhưng phản hồi không đúng định dạng. Hãy mở lại ví để xem yêu cầu.', outcomeUnknown: true);
    }
  }

  @override
  Future<WithdrawalRequest> createWithdrawal(int amount) async {
    final Object? data = await _write('withdraw:$amount', 'POST', '/withdrawals', <String, Object?>{'amount_vnd': amount}, ok: const <int>{201});
    try {
      return _parseWithdrawal(data);
    } on FormatException {
      throw const WalletFailure('Máy chủ đã nhận yêu cầu rút nhưng phản hồi không đúng định dạng. Hãy mở lại ví để xem yêu cầu.', outcomeUnknown: true);
    }
  }

  @override
  Future<void> cancelTopup(String code) async {
    final TopupRequest current;
    try {
      current = _parseTopup(await _get('/topup-requests/${Uri.encodeComponent(code)}'));
    } on Object catch (error) {
      throw WalletFailure(_readText(error));
    }
    final int version = current.version ?? 0;
    await _write('cancel-topup:$code:$version', 'POST', '/topup-requests/${Uri.encodeComponent(code)}/cancel', <String, Object?>{'expected_version': version}, ok: const <int>{200});
  }

  @override
  Future<void> cancelWithdrawal(String code) async {
    final WithdrawalRequest current;
    try {
      current = _parseWithdrawal(await _get('/withdrawals/${Uri.encodeComponent(code)}'));
    } on Object catch (error) {
      throw WalletFailure(_readText(error));
    }
    final int version = current.version ?? 0;
    await _write('cancel-withdraw:$code:$version', 'POST', '/withdrawals/${Uri.encodeComponent(code)}/cancel', <String, Object?>{'expected_version': version}, ok: const <int>{200});
  }
}
