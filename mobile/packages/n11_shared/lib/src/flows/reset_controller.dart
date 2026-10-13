import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

// Forgotten password, test build (M01-RESET, F13/S15): GET /v1/account-recovery/config, POST /v1/account-recovery/reset-test with
// exactly {phone, password}. The route is PUBLIC: no Bearer, no device proof, no key, no login first. The server mode decides; the
// app only opens the form when the server says DISABLED_TEST. The answer is one generic acknowledgement that says nothing about
// the account, and it never signs anybody in.

enum ResetMode { unknown, available, closed }

class ResetController extends ChangeNotifier {
  ResetController({required this.transport, required this.session});

  final ApiTransport transport;

  /// Used only to re-check an existing session after a reset (the server revokes it; a 401 then clears this phone).
  final SessionController session;

  ResetMode _mode = ResetMode.unknown;
  bool _busy = false;
  bool _done = false;
  AuthFailure? _failure;
  String? _pendingKey;
  String? _pendingBody;
  int _epoch = 0;
  bool _disposed = false;

  ResetMode get mode => _mode;
  bool get busy => _busy;
  bool get done => _done;
  AuthFailure? get failure => _failure;
  bool get hasPendingWrite => _pendingKey != null;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  Future<void> loadConfig() async {
    final int epoch = ++_epoch;
    try {
      final ApiResponse response = await transport.send('GET', '/v1/account-recovery/config');
      if (epoch != _epoch) {
        return;
      }
      final Object? data = response.status == 200 ? response.data : null;
      final Object? mode = data is Map<String, Object?> ? data['mode'] : null;
      _mode = mode == 'DISABLED_TEST'
          ? ResetMode.available
          : mode == 'UNAVAILABLE'
              ? ResetMode.closed
              : ResetMode.unknown;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      _mode = ResetMode.unknown;
      _failure = failure;
    }
    _notify();
  }

  /// The person left the screen: a late answer is dropped.
  void abandon() {
    _epoch++;
    _busy = false;
  }

  Future<bool> submit({required String phone, required String password}) async {
    if (_busy || _mode != ResetMode.available) {
      return false;
    }
    final String body = jsonEncode(<String, Object?>{'phone': phone.trim(), 'password': password});
    // Same intent -> same key (a retry after a lost answer); a changed phone or password is a new intent and a new key.
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    return _send(body, key);
  }

  Future<bool> retryPending() async {
    final String? body = _pendingBody;
    final String? key = _pendingKey;
    if (_busy || body == null || key == null) {
      return false;
    }
    return _send(body, key);
  }

  Future<bool> _send(String body, String key) async {
    final int epoch = ++_epoch;
    _busy = true;
    _failure = null;
    _pendingBody = body;
    _pendingKey = key;
    _notify();
    try {
      // Only the Idempotency-Key is sent besides the JSON: no authorization, no cookie, no device header.
      final ApiResponse response = await transport.send('POST', '/v1/account-recovery/reset-test', headers: <String, String>{'idempotency-key': key}, body: utf8.encode(body));
      if (epoch != _epoch) {
        return false;
      }
      final Object? data = response.status == 200 ? response.data : null;
      if (data is! Map<String, Object?> || data['next'] != 'LOGIN') {
        throw failureOf(response);
      }
      _pendingBody = null;
      _pendingKey = null;
      _done = true;
      _busy = false;
      _notify();
      // A session of this phone may just have been revoked by the server: the ordinary 401 path clears it if so.
      if (session.status == SessionStatus.signedIn) {
        await session.revalidate();
      }
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      final bool unknown = failure.kind == AuthFailureKind.unknownOutcome ||
          (failure.kind == AuthFailureKind.serverUnavailable && failure.code == 'TRANSACTION_OUTCOME_UNKNOWN');
      if (!unknown) {
        _pendingBody = null;
        _pendingKey = null;
      }
      _failure = failure;
      _busy = false;
      _notify();
      return false;
    }
  }
}
