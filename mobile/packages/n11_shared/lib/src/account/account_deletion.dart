import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';
import 'session_controller.dart';

// The owner's own account deletion, started inside the app (Apple 5.1.1(v) and Google Play require it in-app). Owner order 2026-11-23, the
// signed-in app only:
//   1. GET  /v1/account/deletion/precheck   -> READY (balance, forfeit, minimum) or BLOCKED (what must be done first). Nothing is sent.
//   2. POST /v1/account/deletion/code       {accept_forfeit, forfeit_vnd} -> a one-time code by SMS to the account's phone. Refused while BLOCKED, or while a
//                                            balance below the minimum withdrawal is not agreed (it is then forfeited).
//   3. POST /v1/account/deletion/confirm    {verification_id, otp, accept_forfeit, forfeit_vnd} -> ERASURE_SCHEDULED: the account is locked, every session
//                                            is revoked and the erasure follows within about a minute. The device forgets its token at once.
// No password is asked again. The web page /delete-account keeps its own password route and only locks the account.

/// One reason the pre-check gives for refusing the deletion. [items] is set for ACTIVE_WORK (the names of the work still in progress).
class ErasureBlocker {
  const ErasureBlocker(this.code, this.items);
  final String code;
  final List<String> items;
}

/// The pre-check answer: READY (with the amounts) or BLOCKED (with the reasons).
class ErasurePrecheck {
  const ErasurePrecheck({
    required this.ready,
    required this.balanceVnd,
    required this.forfeitVnd,
    required this.withdrawMinVnd,
    required this.blockers,
  });

  final bool ready;
  final int balanceVnd;
  final int forfeitVnd;
  final int withdrawMinVnd;
  final List<ErasureBlocker> blockers;

  bool get hasForfeit => forfeitVnd > 0;

  factory ErasurePrecheck.fromData(Map<String, Object?> data) {
    final List<ErasureBlocker> blockers = <ErasureBlocker>[];
    final Object? raw = data['blockers'];
    if (raw is List<Object?>) {
      for (final Object? item in raw) {
        if (item is Map<String, Object?> && item['code'] is String) {
          final Object? items = item['items'];
          blockers.add(ErasureBlocker(item['code']! as String, items is List<Object?> ? items.whereType<String>().toList() : const <String>[]));
        }
      }
    }
    final bool ready = data['status'] == 'READY';
    return ErasurePrecheck(
      ready: ready,
      balanceVnd: _int(data['balance_vnd']),
      forfeitVnd: _int(data['forfeit_vnd']),
      withdrawMinVnd: _int(data['withdraw_min_vnd']),
      blockers: blockers,
    );
  }

  static int _int(Object? value) => value is String ? (int.tryParse(value) ?? 0) : 0;
}

enum AccountErasureOutcome { scheduled }

class AccountDeletionController extends ChangeNotifier {
  AccountDeletionController({required this.session});

  static const String precheckPath = '/v1/account/deletion/precheck';
  static const String codePath = '/v1/account/deletion/code';
  static const String confirmPath = '/v1/account/deletion/confirm';

  final SessionController session;

  bool _busy = false;
  bool _disposed = false;
  AuthFailure? _failure;
  AccountErasureOutcome? _outcome;
  ErasurePrecheck? _precheck;
  String? _verificationId;

  bool get busy => _busy;
  AuthFailure? get failure => _failure;
  AccountErasureOutcome? get outcome => _outcome;
  ErasurePrecheck? get precheck => _precheck;

  /// True once a one-time code was sent and not yet used.
  bool get codeSent => _verificationId != null;

  /// Reads the pre-check. No code is sent and nothing changes.
  Future<void> loadPrecheck() async {
    if (_busy || _outcome != null) {
      return;
    }
    await _run(() async {
      _verificationId = null;
      _precheck = null;
      final ApiResponse response = await session.protectedCall('GET', precheckPath);
      final Object? data = response.data;
      _precheck = ErasurePrecheck.fromData(data is Map<String, Object?> ? data : <String, Object?>{});
    });
  }

  /// Asks for the one-time code. [acceptForfeit] must be true when the pre-check shows a balance that will be forfeited.
  Future<bool> sendCode({required bool acceptForfeit, required int forfeitVnd}) async {
    if (_busy || _outcome != null) {
      return false;
    }
    return _run(() async {
      final ApiResponse response = await session.protectedCall('POST', codePath, body: jsonEncode(<String, Object?>{'accept_forfeit': acceptForfeit, 'forfeit_vnd': forfeitVnd.toString()}));
      final Object? data = response.data;
      final Object? id = data is Map<String, Object?> ? data['verification_id'] : null;
      if (id is! String) {
        throw AuthFailure(AuthFailureKind.serverUnavailable, endpoint: codePath);
      }
      _verificationId = id;
    });
  }

  /// Confirms the code. On success the account is locked and this device signs out at once.
  Future<bool> confirm({required String otp, required bool acceptForfeit, required int forfeitVnd}) async {
    final String? verificationId = _verificationId;
    if (_busy || _outcome != null || verificationId == null) {
      return false;
    }
    final bool done = await _run(() async {
      final ApiResponse response = await session.protectedCall(
        'POST',
        confirmPath,
        body: jsonEncode(<String, Object?>{'verification_id': verificationId, 'otp': otp, 'accept_forfeit': acceptForfeit, 'forfeit_vnd': forfeitVnd.toString()}),
      );
      final Object? data = response.data;
      final Object? result = data is Map<String, Object?> ? data['result'] : null;
      if (result != 'ERASURE_SCHEDULED') {
        throw AuthFailure(AuthFailureKind.serverUnavailable, endpoint: confirmPath);
      }
      _outcome = AccountErasureOutcome.scheduled;
    });
    if (done) {
      _verificationId = null;
      await session.endAfterAccountDeletion(walletOnly: false);
    }
    return done;
  }

  Future<bool> _run(Future<void> Function() step) async {
    _busy = true;
    _failure = null;
    _notify();
    try {
      await step();
      _busy = false;
      _notify();
      return true;
    } on AuthFailure catch (failure) {
      _failure = failure;
      _busy = false;
      _notify();
      return false;
    }
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
