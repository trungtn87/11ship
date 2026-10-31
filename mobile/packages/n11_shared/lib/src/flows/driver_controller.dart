import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

// Ship: the Shipper profile (M03) over GET /v1/driver/me, POST /v1/onboarding/driver (M01, the profile is created once) and the M03
// commands PUT /v1/driver/me/profile, PUT /v1/driver/me/bank, POST /v1/driver/me/submit, /accepting, /closure-request and
// /closure-cancel. Reading grants nothing, submitting grants no right to take deliveries: the server keeps the state and decides every
// condition (the app only shows it). The name is typed by the person (never copied from the customer profile). Nothing about the
// internal classification exists here: the server never sends it.

@immutable
class DriverBank {
  const DriverBank({required this.bankCode, required this.bankName, required this.accountNumber, required this.accountHolder, required this.verificationState, this.rejectionReason});

  final String bankCode;
  final String bankName;
  final String accountNumber;
  final String accountHolder;

  /// UNVERIFIED / VERIFIED / REJECTED, as the server says it.
  final String verificationState;
  final String? rejectionReason;

  bool get verified => verificationState == 'VERIFIED';

  static DriverBank? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? code = data['bank_code'];
    final Object? name = data['bank_name'];
    final Object? number = data['account_number'];
    final Object? holder = data['account_holder'];
    final Object? state = data['verification_state'];
    if (code is! String || name is! String || number is! String || holder is! String || state is! String) {
      return null;
    }
    return DriverBank(bankCode: code, bankName: name, accountNumber: number, accountHolder: holder, verificationState: state, rejectionReason: data['rejection_reason'] as String?);
  }
}

/// What the server says about taking orders: the app shows it, never decides it.
@immutable
class DriverReadiness {
  const DriverReadiness({required this.profileApproved, required this.bankVerified, required this.walletReady, required this.blocks, required this.canAccept});

  final bool profileApproved;
  final bool bankVerified;
  final bool walletReady;

  /// Stable codes of what is missing (PROFILE_NOT_APPROVED, BANK_NOT_VERIFIED, WALLET_NOT_AVAILABLE, ...).
  final List<String> blocks;
  final bool canAccept;

  static DriverReadiness? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? approved = data['profile_approved'];
    final Object? bank = data['bank_verified'];
    final Object? wallet = data['wallet_ready'];
    final Object? blocks = data['blocks'];
    final Object? can = data['can_accept'];
    if (approved is! bool || bank is! bool || wallet is! bool || can is! bool || blocks is! List<Object?>) {
      return null;
    }
    return DriverReadiness(profileApproved: approved, bankVerified: bank, walletReady: wallet, blocks: blocks.whereType<String>().toList(growable: false), canAccept: can);
  }
}

/// How the switch and the position stand together, as the server says it (the app never decides it). `intentOnline` is the Shipper's own switch;
/// `canReceiveOrders` is true only while that switch is on, every condition holds AND the latest position is still fresh. `pausedReason` is
/// LOCATION_MISSING / LOCATION_STALE while the switch is on but the position is not (receiving is paused, nothing is cancelled).
/// `shouldShareLocation` is true while the Shipper wants orders or still has work to finish: the app keeps its location service for exactly that.
@immutable
class DriverPresence {
  const DriverPresence({required this.intentOnline, required this.locationReady, required this.canReceiveOrders, required this.hasActiveWork, required this.shouldShareLocation, this.pausedReason});

  final bool intentOnline;
  final bool locationReady;
  final bool canReceiveOrders;
  final bool hasActiveWork;
  final bool shouldShareLocation;
  final String? pausedReason;

  static DriverPresence? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? intent = data['intent_online'];
    final Object? location = data['location_ready'];
    final Object? can = data['can_receive_orders'];
    final Object? work = data['has_active_work'];
    final Object? share = data['should_share_location'];
    if (intent is! bool || location is! bool || can is! bool || work is! bool || share is! bool) {
      return null;
    }
    return DriverPresence(intentOnline: intent, locationReady: location, canReceiveOrders: can, hasActiveWork: work, shouldShareLocation: share, pausedReason: data['paused_reason'] as String?);
  }
}

@immutable
class DriverClosure {
  const DriverClosure({this.requestedAt, this.note, required this.canCancel, this.fromStatus});

  final String? requestedAt;
  final String? note;
  final bool canCancel;

  /// The status the closure was asked from (ACTIVE or SUSPENDED). From SUSPENDED the account stays locked: closing only returns the balance.
  final String? fromStatus;

  bool get fromSuspended => fromStatus == 'SUSPENDED';

  static DriverClosure? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    return DriverClosure(requestedAt: data['requested_at'] as String?, note: data['note'] as String?, canCancel: data['can_cancel'] == true, fromStatus: data['from_status'] as String?);
  }
}

@immutable
class DriverProfile {
  const DriverProfile({
    required this.driverId,
    required this.shipperCode,
    required this.fullName,
    required this.phone,
    required this.plateNumber,
    required this.status,
    required this.reviewState,
    required this.rejectionReason,
    required this.suspensionReason,
    required this.acceptingDeliveries,
    required this.version,
    required this.canEditProfile,
    required this.canSubmit,
    required this.bank,
    required this.readiness,
    required this.closure,
    this.presence,
  });

  final String driverId;
  final String shipperCode;
  final String fullName;
  final String? phone;
  final String? plateNumber;

  /// PENDING / ACTIVE / SUSPENDED / CLOSING / CLOSED, exactly as stored.
  final String status;

  /// DRAFT / SUBMITTED / REJECTED while PENDING; APPROVED afterwards.
  final String reviewState;
  final String? rejectionReason;
  final String? suspensionReason;
  final bool acceptingDeliveries;
  final int version;
  final bool canEditProfile;
  final bool canSubmit;

  /// A closure can be asked from ACTIVE and from SUSPENDED (the balance comes back without an unlock); the server decides again on the command.
  bool get canRequestClosure => status == 'ACTIVE' || status == 'SUSPENDED';
  final DriverBank? bank;
  final DriverReadiness readiness;
  final DriverClosure? closure;

  /// Null from a server that does not send it yet; then the app falls back to the switch alone.
  final DriverPresence? presence;

  bool get rejected => status == 'PENDING' && reviewState == 'REJECTED';
  bool get submitted => status == 'PENDING' && reviewState == 'SUBMITTED';
  bool get draft => status == 'PENDING' && reviewState == 'DRAFT';

  static DriverProfile? tryParse(Object? data) {
    if (data is! Map<String, Object?>) {
      return null;
    }
    final Object? id = data['driver_id'];
    final Object? code = data['shipper_code'];
    final Object? name = data['full_name'];
    final Object? status = data['status'];
    final Object? review = data['review_state'];
    final Object? accepting = data['accepting_deliveries'];
    final Object? version = data['version'];
    final DriverReadiness? readiness = DriverReadiness.tryParse(data['readiness']);
    if (id is! String || code is! String || name is! String || status is! String || review is! String || accepting is! bool || version is! int || readiness == null) {
      return null;
    }
    final Object? rawBank = data['bank'];
    final DriverBank? bank = DriverBank.tryParse(rawBank);
    if (rawBank != null && bank == null) {
      return null;
    }
    return DriverProfile(
      driverId: id,
      shipperCode: code,
      fullName: name,
      phone: data['phone'] as String?,
      plateNumber: data['plate_number'] as String?,
      status: status,
      reviewState: review,
      rejectionReason: data['rejection_reason'] as String?,
      suspensionReason: data['suspension_reason'] as String?,
      acceptingDeliveries: accepting,
      version: version,
      canEditProfile: data['can_edit_profile'] == true,
      canSubmit: data['can_submit'] == true,
      bank: bank,
      readiness: readiness,
      closure: DriverClosure.tryParse(data['closure']),
      presence: DriverPresence.tryParse(data['presence']),
    );
  }
}

/// One choice of the bank list (GET /v1/driver/banks).
@immutable
class BankOption {
  const BankOption(this.code, this.name);

  final String code;
  final String name;
}

/// The one label of the profile's standing (what the Shipper sees as the status).
String driverStandingLabel(DriverProfile profile) {
  switch (profile.status) {
    case 'PENDING':
      if (profile.submitted) {
        return 'Chờ xét duyệt';
      }
      return profile.rejected ? 'Bị từ chối' : 'Chưa gửi hồ sơ';
    case 'ACTIVE':
      return 'Đã kích hoạt';
    case 'SUSPENDED':
      return 'Tạm khóa';
    case 'CLOSING':
      return profile.closure?.fromSuspended == true ? 'Đang đóng để hoàn tiền (vẫn bị khóa)' : 'Đang xin ngừng hoạt động';
    case 'CLOSED':
      return 'Đã ngừng hoạt động';
    default:
      return 'Không rõ';
  }
}

/// The one wording of whether orders are coming: the switch AND (from the server) a position that is still fresh.
String driverReceivingLabel(DriverProfile profile) {
  if (!profile.acceptingDeliveries) {
    return 'Chưa nhận đơn';
  }
  final DriverPresence? presence = profile.presence;
  return presence != null && !presence.canReceiveOrders ? 'Tạm dừng nhận đơn' : 'Đang nhận đơn';
}

String driverStatusLabel(String status) {
  switch (status) {
    case 'PENDING':
      return 'Chờ duyệt';
    case 'ACTIVE':
      return 'Đang hoạt động';
    case 'SUSPENDED':
      return 'Tạm ngưng';
    case 'CLOSING':
      return 'Đang đóng hồ sơ';
    case 'CLOSED':
      return 'Đã đóng';
    default:
      return 'Không rõ';
  }
}

String bankStateLabel(String state) {
  switch (state) {
    case 'VERIFIED':
      return 'Đã xác minh';
    case 'REJECTED':
      return 'Bị từ chối';
    default:
      return 'Chờ xác minh';
  }
}

/// The words for what keeps a Shipper from taking orders (the server sends the code; the sentence is fixed here).
String driverBlockLabel(String block) {
  switch (block) {
    case 'PROFILE_NOT_APPROVED':
      return 'Hồ sơ chưa được duyệt';
    case 'ACCOUNT_SUSPENDED':
      return 'Tài khoản đang bị tạm khóa';
    case 'CLOSURE_REQUESTED':
      return 'Đang xin ngừng hoạt động';
    case 'ACCOUNT_CLOSED':
      return 'Đã ngừng hoạt động';
    case 'BANK_MISSING':
      return 'Chưa có tài khoản ngân hàng';
    case 'BANK_NOT_VERIFIED':
      return 'Ngân hàng chưa được xác minh';
    case 'WALLET_NOT_AVAILABLE':
      return 'Ví chưa sẵn sàng (chờ module Ví)';
    case 'BALANCE_TOO_LOW':
      return 'Số dư khả dụng chưa đủ để nhận đơn';
    case 'FUNDING_TOO_LOW':
      return 'Tổng tiền nạp đã xác nhận chưa đạt mức yêu cầu';
    default:
      return 'Chưa đủ điều kiện';
  }
}

/// A refusal of an M03 command in words. Falls back to the common wording for anything else.
String? driverRefusalMessage(AuthFailure failure) {
  switch (failure.code) {
    case 'BANK_HOLDER_MISMATCH':
      return 'Tên chủ tài khoản phải khớp với họ tên Shipper (không phân biệt chữ hoa và dấu).';
    case 'DRIVER_PROFILE_INCOMPLETE':
      return 'Hồ sơ chưa đủ thông tin: hãy khai báo tài khoản ngân hàng đúng tên Shipper.';
    case 'DRIVER_PROFILE_LOCKED':
      return 'Họ tên không sửa được khi hồ sơ đang chờ duyệt hoặc đã duyệt.';
    case 'DRIVER_STATE_CONFLICT':
      return 'Trạng thái hồ sơ đã thay đổi. Đã tải lại; kiểm tra rồi thử lại.';
    case 'DRIVER_NOT_ACTIVE':
      return 'Hồ sơ chưa ở trạng thái hoạt động nên chưa bật nhận đơn được.';
    case 'DRIVER_BANK_NOT_VERIFIED':
      return 'Ngân hàng chưa được xác minh nên chưa bật nhận đơn được.';
    case 'DRIVER_WALLET_NOT_READY':
      return 'Ví chưa đủ điều kiện nên chưa bật nhận đơn được.';
    case 'DRIVER_LOCATION_NOT_READY':
      return 'Chưa có vị trí hiện tại của bạn nên chưa bật online được. Hãy bật GPS và thử lại.';
    default:
      return null;
  }
}

enum DriverLoad { idle, loading, ready, failed }

class DriverController extends ChangeNotifier {
  DriverController({required this.session}) {
    _sessionEpoch = session.sessionEpoch;
    session.addListener(_onSession);
  }

  final SessionController session;

  DriverLoad _load = DriverLoad.idle;
  DriverProfile? _profile;
  AuthFailure? _failure;
  bool _busy = false;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;
  String? _pendingKey;
  String? _pendingBody;
  String? _pendingMethod;
  String? _pendingPath;
  bool _pendingCreate = false;
  List<BankOption> _banks = const <BankOption>[];
  bool _banksLoading = false;

  String fullName = '';
  String plateNumber = '';

  DriverLoad get loadState => _load;
  DriverProfile? get profile => _profile;
  AuthFailure? get failure => _failure;
  bool get busy => _busy;
  bool get hasPendingWrite => _pendingKey != null;
  List<BankOption> get banks => _banks;

  void _onSession() {
    if (session.sessionEpoch != _sessionEpoch || session.status != SessionStatus.signedIn) {
      _sessionEpoch = session.sessionEpoch;
      clear();
    }
  }

  void clear() {
    _epoch++;
    _load = DriverLoad.idle;
    _profile = null;
    _failure = null;
    _busy = false;
    _clearPending();
    _banks = const <BankOption>[];
    _banksLoading = false;
    fullName = '';
    plateNumber = '';
    _notify();
  }

  void _clearPending() {
    _pendingKey = null;
    _pendingBody = null;
    _pendingMethod = null;
    _pendingPath = null;
    _pendingCreate = false;
  }

  @override
  void dispose() {
    _disposed = true;
    session.removeListener(_onSession);
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  /// Forgets the last refusal (a screen shows a fresh form).
  void clearFailure() {
    if (_failure != null) {
      _failure = null;
      _notify();
    }
  }

  /// Reads the profile from the server every time (opening the screen again reads fresh; "Tải lại" calls this too).
  Future<void> load() async {
    if (_busy) {
      return;
    }
    final int epoch = _epoch;
    _load = DriverLoad.loading;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/driver/me');
      if (epoch != _epoch) {
        return;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final Object? data = response.data;
      final DriverProfile? parsed = DriverProfile.tryParse(data);
      if (data != null && parsed == null) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      _profile = parsed;
      _load = DriverLoad.ready;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      _failure = failure;
      _load = DriverLoad.failed;
    }
    _notify();
  }

  /// The banks a Shipper may choose (GET /v1/driver/banks). Read once per screen; a failure leaves the list empty and says why.
  Future<void> loadBanks() async {
    if (_banksLoading || _banks.isNotEmpty) {
      return;
    }
    _banksLoading = true;
    final int epoch = _epoch;
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/driver/banks');
      if (epoch != _epoch) {
        return;
      }
      if (response.status != 200) {
        throw failureOf(response);
      }
      final Object? data = response.data;
      final Object? list = data is Map<String, Object?> ? data['banks'] : null;
      if (list is! List<Object?>) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      final List<BankOption> parsed = <BankOption>[];
      for (final Object? entry in list) {
        if (entry is Map<String, Object?> && entry['code'] is String && entry['name'] is String) {
          parsed.add(BankOption(entry['code']! as String, entry['name']! as String));
        }
      }
      _banks = parsed;
    } on AuthFailure catch (failure) {
      if (epoch == _epoch) {
        _failure = failure;
      }
    } finally {
      _banksLoading = false;
    }
    _notify();
  }

  // ---- M01: the profile is created once ---------------------------------------------------------------------------------------

  /// POST the profile. Only when the server holds none; a second submit is refused here and by the server. The same key and body
  /// are reused when the person retries after a lost answer.
  Future<bool> submit() async {
    if (_busy || _profile != null) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{
      'full_name': fullName.trim(),
      if (plateNumber.trim().isNotEmpty) 'plate_number': plateNumber.trim(),
    });
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    return _send('POST', '/v1/onboarding/driver', body, key, create: true);
  }

  // ---- M03 commands -----------------------------------------------------------------------------------------------------------

  /// PUT the name and plate (allowed while the profile is a draft or was rejected).
  Future<bool> saveProfile({required String fullName, required String plateNumber}) {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    return _command('PUT', '/v1/driver/me/profile', <String, Object?>{
      'expected_version': current.version,
      'full_name': fullName.trim(),
      'plate_number': plateNumber.trim().isEmpty ? null : plateNumber.trim(),
    });
  }

  /// PUT the bank account. Any change makes the server require a new verification; the holder must be the Shipper's name.
  Future<bool> saveBank({required String bankCode, required String accountNumber, required String accountHolder}) {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    return _command('PUT', '/v1/driver/me/bank', <String, Object?>{
      'expected_version': current.version,
      'bank_code': bankCode,
      'account_number': accountNumber.replaceAll(RegExp(r'[\s-]'), ''),
      'account_holder': accountHolder.trim(),
    });
  }

  /// Sends the profile for review (draft or rejected only; the server refuses a second send).
  Future<bool> submitForReview() {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    return _command('POST', '/v1/driver/me/submit', <String, Object?>{'expected_version': current.version});
  }

  /// Set by 11Ship: turning on first shares the position (one switch for both), turning off stops the position when nothing needs it. Every
  /// screen that has the switch calls [setAccepting], so they all behave alike; only the handler itself calls [sendAccepting].
  Future<bool> Function(bool accepting)? acceptingHandler;

  /// Turns receiving orders on or off. Every condition is decided by the server; turning off is always accepted and never touches
  /// orders already taken.
  Future<bool> setAccepting(bool accepting) {
    final Future<bool> Function(bool accepting)? handler = acceptingHandler;
    return handler == null ? sendAccepting(accepting) : handler(accepting);
  }

  /// The bare command POST /v1/driver/me/accepting.
  Future<bool> sendAccepting(bool accepting) {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    return _command('POST', '/v1/driver/me/accepting', <String, Object?>{'expected_version': current.version, 'accepting': accepting});
  }

  /// Asks to stop working. New orders stop at once; deliveries in progress are finished; the wallet balance is untouched.
  Future<bool> requestClosure(String? note) {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    final String trimmed = (note ?? '').trim();
    return _command('POST', '/v1/driver/me/closure-request', <String, Object?>{'expected_version': current.version, 'note': trimmed.isEmpty ? null : trimmed});
  }

  Future<bool> cancelClosure() {
    final DriverProfile? current = _profile;
    if (_busy || current == null) {
      return Future<bool>.value(false);
    }
    return _command('POST', '/v1/driver/me/closure-cancel', <String, Object?>{'expected_version': current.version});
  }

  Future<bool> _command(String method, String path, Map<String, Object?> payload) {
    final String body = jsonEncode(payload);
    final String key = _pendingBody == body && _pendingPath == path && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    return _send(method, path, body, key);
  }

  /// Sends the unanswered write again with its own key and body (after "outcome unknown").
  Future<bool> retryPending() async {
    final String? body = _pendingBody;
    final String? key = _pendingKey;
    final String? method = _pendingMethod;
    final String? path = _pendingPath;
    if (_busy || body == null || key == null || method == null || path == null) {
      return false;
    }
    return _send(method, path, body, key, create: _pendingCreate);
  }

  Future<bool> _send(String method, String path, String body, String key, {bool create = false}) async {
    final int epoch = _epoch;
    _busy = true;
    _failure = null;
    _pendingBody = body;
    _pendingKey = key;
    _pendingMethod = method;
    _pendingPath = path;
    _pendingCreate = create;
    _notify();
    try {
      final ApiResponse response = await session.protectedCall(method, path, body: body, idempotencyKey: key);
      if (epoch != _epoch) {
        return false;
      }
      if (response.status != 200 && response.status != 201) {
        throw failureOf(response);
      }
      _clearPending();
      if (create) {
        _busy = false;
        // Read both back from the server: the profile and what `me` now says. The context is NOT changed here.
        await load();
        await session.refreshIdentity();
        return epoch == _epoch;
      }
      // Every M03 command answers with the profile as the server now holds it.
      final DriverProfile? parsed = DriverProfile.tryParse(response.data);
      if (parsed == null) {
        throw const AuthFailure(AuthFailureKind.badResponse);
      }
      _profile = parsed;
      _load = DriverLoad.ready;
      _busy = false;
      _notify();
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      final bool unknown = failure.outcomeUnknown;
      if (!unknown) {
        _clearPending();
      }
      _failure = failure;
      _busy = false;
      _notify();
      final String? code = failure.code;
      if (failure.kind == AuthFailureKind.stateConflict || failure.kind == AuthFailureKind.versionConflict || code == 'DRIVER_STATE_CONFLICT') {
        // The profile moved on the server (another device, an administrator): show it, change nothing more.
        await load();
        _failure = failure;
        _notify();
      }
      return false;
    }
  }
}
