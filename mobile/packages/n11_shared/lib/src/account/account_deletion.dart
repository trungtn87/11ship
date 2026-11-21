import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';
import 'session_controller.dart';

// The owner's own account deletion, started inside the app (OD-26; Apple 5.1.1 and Google Play require it in-app). It calls the SAME public
// route the web page /delete-account uses: POST /v1/account-deletion/confirm {phone, password} with an Idempotency-Key. No session token,
// no OTP, no administrator step, no cancel. The phone is the one the signed-in identity already holds (normalized by the server).
//
// Server answers: DELETED / LOCKED = the account is locked and the server revoked its sessions, so this device forgets its token at once
// (no revoke call: the server already did it); PENDING = work in progress is finished first, the session stays and new work is refused.
// A wrong password, the rate limit and a lost answer are failures; a wrong password never locks anything.

enum AccountDeletionOutcome { deleted, locked, pending }

class AccountDeletionController extends ChangeNotifier {
  AccountDeletionController({required this.transport, required this.session});

  static const String endpoint = '/v1/account-deletion/confirm';

  final ApiTransport transport;
  final SessionController session;

  bool _busy = false;
  bool _disposed = false;
  AuthFailure? _failure;
  AccountDeletionOutcome? _outcome;
  String? _pendingKey;
  String? _pendingBody;

  bool get busy => _busy;
  AuthFailure? get failure => _failure;
  AccountDeletionOutcome? get outcome => _outcome;

  /// True while an unconfirmed write (no answer arrived) can be sent again with the same key.
  bool get hasPendingWrite => _pendingKey != null;

  /// Sends the request for the signed-in phone and [password]. Returns true once the server answered DELETED, LOCKED or PENDING.
  /// The same phone + password reuse the pending Idempotency-Key ("Thử lại" after a lost answer); anything else is a new request.
  Future<bool> submit(String password) async {
    final String? phone = session.identity?.phoneNormalized;
    if (_busy || _outcome != null || phone == null || password.isEmpty) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{'phone': phone, 'password': password});
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    _busy = true;
    _failure = null;
    _pendingBody = body;
    _pendingKey = key;
    _notify();
    try {
      // Only the JSON and the Idempotency-Key are sent: no authorization, no cookie, no device header (the same as the public web page).
      final ApiResponse response = await transport.send('POST', endpoint, headers: <String, String>{'idempotency-key': key}, body: utf8.encode(body));
      final Object? data = response.status == 200 ? response.data : null;
      final Object? result = data is Map<String, Object?> ? data['result'] : null;
      final AccountDeletionOutcome outcome;
      if (result == 'DELETED') {
        outcome = AccountDeletionOutcome.deleted;
      } else if (result == 'LOCKED') {
        outcome = AccountDeletionOutcome.locked;
      } else if (result == 'PENDING') {
        outcome = AccountDeletionOutcome.pending;
      } else {
        throw failureOf(response, endpoint: endpoint);
      }
      _pendingBody = null;
      _pendingKey = null;
      _busy = false;
      _outcome = outcome;
      _notify();
      if (outcome != AccountDeletionOutcome.pending) {
        // A driver whose account is only LOCKED (records kept) can still sign in to 11Ship for the wallet; an erased account cannot.
        final bool walletOnly = outcome == AccountDeletionOutcome.locked && (session.identity?.availableRoles.contains('DRIVER') ?? false);
        await session.endAfterAccountDeletion(walletOnly: walletOnly);
      }
      return true;
    } on AuthFailure catch (failure) {
      if (!failure.outcomeUnknown) {
        _pendingBody = null;
        _pendingKey = null;
      }
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
