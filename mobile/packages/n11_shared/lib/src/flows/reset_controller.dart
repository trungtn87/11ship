import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

// Forgotten password (M01-RESET, F13/S15; issue #102). The SERVER mode decides, the app never guesses:
//   DISABLED_TEST  the test build: POST /v1/account-recovery/reset-test with exactly {phone, password}, no OTP;
//   SMS_OTP        POST /v1/account-recovery/otp {phone} -> POST .../otp/{id}/verify {otp} -> POST .../reset
//                  {verification_token, password}. The request answer is the SAME for every number (the app says "if the number is
//                  registered you will receive an SMS"); the proof is one-use and belongs to the number that received the code.
// Forgotten password, test build (M01-RESET, F13/S15): GET /v1/account-recovery/config, POST /v1/account-recovery/reset-test with
// exactly {phone, password}. The route is PUBLIC: no Bearer, no device proof, no key, no login first. The server mode decides; the
// app only opens the form when the server says DISABLED_TEST. The answer is one generic acknowledgement that says nothing about
// the account, and it never signs anybody in.

enum ResetMode { unknown, available, smsOtp, closed }

enum ResetOtpStep { idle, requesting, requested, verifying, verified }

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
  String? _pendingPath;
  int _epoch = 0;
  bool _disposed = false;

  // SMS_OTP state (issue #102).
  ResetOtpStep _otpStep = ResetOtpStep.idle;
  String? _verificationId;
  String? _otpPhone;
  String? _proof;
  DateTime? _resendAt;

  ResetMode get mode => _mode;
  bool get busy => _busy;
  bool get done => _done;
  AuthFailure? get failure => _failure;
  bool get hasPendingWrite => _pendingKey != null;
  ResetOtpStep get otpStep => _otpStep;
  bool get otpVerified => _otpStep == ResetOtpStep.verified;

  /// The number the code was requested for (trimmed), if any.
  String? get otpPhone => _otpPhone;
  DateTime get _now => DateTime.now();
  bool get canResend => _otpStep != ResetOtpStep.requesting && _otpStep != ResetOtpStep.verifying && _otpStep != ResetOtpStep.verified && (_resendAt == null || !_now.isBefore(_resendAt!));

  String _bodyFor(String phone, String password) => _mode == ResetMode.smsOtp
      ? jsonEncode(<String, Object?>{'verification_token': _proof, 'password': password})
      : jsonEncode(<String, Object?>{'phone': phone.trim(), 'password': password});

  /// The unconfirmed write is retryable only while the form still shows exactly its intent: an edited phone or password is a
  /// different intent and must go through [submit] (new key), never through a retry of the hidden old one.
  bool pendingMatches({required String phone, required String password}) => _pendingKey != null && _pendingBody == _bodyFor(phone, password);

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
          : mode == 'SMS_OTP'
              ? ResetMode.smsOtp
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

  /// A form is opened: one open is one life of the intent. Whatever the previous open left (a success, a failure, an unconfirmed
  /// write with its phone and password) is gone, so the form is empty AND nothing hidden can be retried. No notification: this runs
  /// before the first build.
  void begin() {
    _discardIntent();
  }

  /// The person left the screen: a late answer is dropped and so is the intent, including the password it carried.
  void abandon() {
    _discardIntent();
  }

  void _discardIntent() {
    _epoch++;
    _busy = false;
    _done = false;
    _failure = null;
    _pendingKey = null;
    _pendingBody = null;
    _pendingPath = null;
    _clearOtp();
  }

  void _clearOtp() {
    _otpStep = ResetOtpStep.idle;
    _verificationId = null;
    _otpPhone = null;
    _proof = null;
    _resendAt = null;
  }

  /// The phone field was edited: the code and the proof belong to the number they were issued for.
  void phoneEdited(String phone) {
    if (_otpPhone != null && _otpPhone != phone.trim()) {
      _epoch++;
      _clearOtp();
      _failure = null;
      _busy = false;
      _notify();
    }
  }

  /// SMS_OTP step 1. The answer never depends on the account, so the screen says "if the number is registered you will receive a
  /// code" and nothing else.
  Future<bool> requestOtp(String phone) async {
    if (_busy || _mode != ResetMode.smsOtp || !canResend) {
      return false;
    }
    final int epoch = ++_epoch;
    _busy = true;
    _otpStep = ResetOtpStep.requesting;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await transport.send('POST', '/v1/account-recovery/otp', body: utf8.encode(jsonEncode(<String, Object?>{'phone': phone.trim()})));
      if (epoch != _epoch) {
        return false;
      }
      final Object? raw = response.status == 200 ? response.data : null;
      final Map<String, Object?>? data = raw is Map<String, Object?> ? raw : null;
      final Object? id = data?['verification_id'];
      if (data == null || id is! String) {
        throw failureOf(response);
      }
      final Object? resend = data['resend_after_seconds'];
      _verificationId = id;
      _otpPhone = phone.trim();
      _resendAt = _now.add(Duration(seconds: resend is int ? resend : 60));
      _otpStep = ResetOtpStep.requested;
      _busy = false;
      _notify();
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _otpStep = ResetOtpStep.idle;
      _failure = failure;
      _busy = false;
      _notify();
      return false;
    }
  }

  /// SMS_OTP step 2: a wrong code can be tried again on the same challenge (the server counts and locks).
  Future<bool> verifyOtp(String otp) async {
    final String? id = _verificationId;
    if (_busy || id == null || _otpStep != ResetOtpStep.requested) {
      return false;
    }
    final int epoch = ++_epoch;
    _busy = true;
    _otpStep = ResetOtpStep.verifying;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await transport.send('POST', '/v1/account-recovery/otp/$id/verify', body: utf8.encode(jsonEncode(<String, Object?>{'otp': otp.trim()})));
      if (epoch != _epoch) {
        return false;
      }
      final Object? data = response.status == 200 ? response.data : null;
      final Object? token = data is Map<String, Object?> ? data['verification_token'] : null;
      if (token is! String) {
        throw failureOf(response);
      }
      _proof = token;
      _otpStep = ResetOtpStep.verified;
      _busy = false;
      _notify();
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _otpStep = failure.kind == AuthFailureKind.otpInvalid || failure.outcomeUnknown ? ResetOtpStep.requested : ResetOtpStep.idle;
      if (_otpStep == ResetOtpStep.idle) {
        _resendAt = null;
        _verificationId = null;
      }
      _failure = failure;
      _busy = false;
      _notify();
      return false;
    }
  }

  Future<bool> submit({required String phone, required String password}) async {
    final bool smsReady = _mode == ResetMode.smsOtp && _proof != null && _otpStep == ResetOtpStep.verified;
    if (_busy || !(_mode == ResetMode.available || smsReady)) {
      return false;
    }
    final String body = _bodyFor(phone, password);
    // Same intent -> same key (a retry after a lost answer); a changed phone or password is a new intent and a new key.
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : newIdempotencyKey();
    return _send(body, key, _mode == ResetMode.smsOtp ? '/v1/account-recovery/reset' : '/v1/account-recovery/reset-test');
  }

  Future<bool> retryPending() async {
    final String? body = _pendingBody;
    final String? key = _pendingKey;
    final String? path = _pendingPath;
    if (_busy || body == null || key == null || path == null) {
      return false;
    }
    return _send(body, key, path);
  }

  Future<bool> _send(String body, String key, String path) async {
    final int epoch = ++_epoch;
    _busy = true;
    _failure = null;
    _pendingBody = body;
    _pendingKey = key;
    _pendingPath = path;
    _notify();
    try {
      // Only the Idempotency-Key is sent besides the JSON: no authorization, no cookie, no device header.
      final ApiResponse response = await transport.send('POST', path, headers: <String, String>{'idempotency-key': key}, body: utf8.encode(body));
      if (epoch != _epoch) {
        return false;
      }
      final Object? data = response.status == 200 ? response.data : null;
      if (data is! Map<String, Object?> || data['next'] != 'LOGIN') {
        throw failureOf(response);
      }
      _pendingBody = null;
      _pendingKey = null;
      _pendingPath = null;
      _clearOtp();
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
      final bool unknown = failure.outcomeUnknown;
      if (!unknown) {
        _pendingBody = null;
        _pendingKey = null;
        _pendingPath = null;
        // A proof the server refused is spent or expired: the person must ask for a new code.
        if (failure.kind == AuthFailureKind.proofInvalid || failure.kind == AuthFailureKind.otpAlreadyUsed) {
          _clearOtp();
        }
      }
      _failure = failure;
      _busy = false;
      _notify();
      return false;
    }
  }
}
