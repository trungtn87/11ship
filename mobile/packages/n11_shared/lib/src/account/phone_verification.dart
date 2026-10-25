import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';
import 'vn_mobile.dart';

// REGISTER phone verification (issue #102): POST /v1/auth/phone-verifications {phone, purpose: REGISTER}, GET
// /v1/auth/phone-verifications/{id} (delivery state), POST /v1/auth/phone-verifications/{id}/verify {otp}. Public routes: no
// Bearer, no device proof. The OTP proof (verification_token) does NOT replace the native device proof: it is sent in the
// register body, which the session controller still signs with the device key.
//
// The SMS is sent by a paired phone, so the code is NOT usable until the server says SENT. This controller never pretends otherwise:
// it polls the delivery state and only offers the code field once the SMS was sent (or may have been: UNCERTAIN).

enum OtpStep { idle, requesting, waiting, sent, verifying, verified }

enum OtpDelivery { pending, sent, uncertain, failed, expired, closed }

class PhoneVerificationController extends ChangeNotifier {
  PhoneVerificationController({
    required this.transport,
    this.pollInterval = const Duration(seconds: 3),
    this.maxPolls = 30,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final ApiTransport transport;
  final Duration pollInterval;
  final int maxPolls;
  final DateTime Function() _clock;

  OtpStep _step = OtpStep.idle;
  OtpDelivery _delivery = OtpDelivery.pending;
  AuthFailure? _failure;
  String? _verificationId;
  String? _phone;
  String? _token;
  DateTime? _resendAt;
  int _epoch = 0;
  bool _disposed = false;
  bool _lockedOut = false;

  OtpStep get step => _step;
  OtpDelivery get delivery => _delivery;
  AuthFailure? get failure => _failure;
  String? get verifiedPhone => _step == OtpStep.verified ? _phone : null;

  /// True after the server closed the challenge for too many wrong codes (OTP_LOCKED): the flow is back at its first step, its
  /// temporary data is gone and the server still holds the cooldown. Cleared by the next request or by [reset].
  bool get lockedOut => _lockedOut;

  /// Tries left on the current challenge after a wrong code, as the SERVER counted them; null until a wrong code was answered.
  int? get attemptsRemaining => _failure?.kind == AuthFailureKind.otpInvalid ? _failure?.attemptsRemaining : null;

  /// The number the current challenge was requested for (trimmed), if any.
  String? get phone => _phone;

  /// The one-use proof for the register body; null until the code was verified.
  String? get token => _step == OtpStep.verified ? _token : null;
  bool get busy => _step == OtpStep.requesting || _step == OtpStep.verifying;

  /// The code field is offered only once the SMS left (or may have left) the sending phone.
  bool get canEnterCode => _step == OtpStep.sent || _step == OtpStep.verifying;

  /// Remaining server-defined cooldown, rounded up for the UI; no new resend rule.
  int get resendSeconds {
    final DateTime? at = _resendAt;
    if (at == null) return 0;
    final int millis = at.difference(_clock()).inMilliseconds;
    return millis <= 0 ? 0 : (millis + 999) ~/ 1000;
  }

  bool get canResend {
    if (_step == OtpStep.requesting || _step == OtpStep.verifying || _step == OtpStep.verified) {
      return false;
    }
    final DateTime? at = _resendAt;
    return at == null || !_clock().isBefore(at);
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  /// The phone field was edited: whatever was asked or proven for another number is gone.
  void reset() {
    _epoch++;
    _step = OtpStep.idle;
    _delivery = OtpDelivery.pending;
    _failure = null;
    _verificationId = null;
    _phone = null;
    _token = null;
    _resendAt = null;
    _lockedOut = false;
    _notify();
  }

  Future<bool> request(String phone) async {
    if (busy || !canResend) {
      return false;
    }
    // Not an allocated Vietnamese mobile number: refused here, before any request (the backend refuses it too, creating nothing).
    if (otpPhoneError(phone) != null) {
      _failure = const AuthFailure(AuthFailureKind.invalidPhone);
      _notify();
      return false;
    }
    final int epoch = ++_epoch;
    _lockedOut = false;
    _step = OtpStep.requesting;
    _failure = null;
    _token = null;
    _notify();
    try {
      final ApiResponse response = await transport.send(
        'POST',
        '/v1/auth/phone-verifications',
        body: utf8.encode(jsonEncode(<String, Object?>{'phone': phone.trim(), 'purpose': 'REGISTER'})),
      );
      if (epoch != _epoch) {
        return false;
      }
      final Object? raw = response.status == 201 ? response.data : null;
      final Map<String, Object?>? data = raw is Map<String, Object?> ? raw : null;
      final Object? id = data?['verification_id'];
      if (data == null || id is! String) {
        throw failureOf(response);
      }
      final Object? resend = data['resend_after_seconds'];
      _verificationId = id;
      _phone = phone.trim();
      _resendAt = _clock().add(Duration(seconds: resend is int ? resend : 60));
      // A synchronous provider omits delivery_status: the code is already out. The SMS queue says PENDING_DELIVERY.
      if (data['delivery_status'] == 'PENDING_DELIVERY') {
        _step = OtpStep.waiting;
        _delivery = OtpDelivery.pending;
        _notify();
        unawaited(_poll(epoch, id));
      } else {
        _step = OtpStep.sent;
        _delivery = OtpDelivery.sent;
        _notify();
      }
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _step = OtpStep.idle;
      _failure = failure;
      // The cooldown / quota is the SERVER's: its remaining time becomes the wait shown and enforced on the button.
      final int? wait = failure.kind == AuthFailureKind.rateLimited ? failure.retryAfterSeconds : null;
      if (wait != null) {
        _resendAt = _clock().add(Duration(seconds: wait));
      }
      _notify();
      return false;
    }
  }

  Future<void> _poll(int epoch, String id) async {
    for (int i = 0; i < maxPolls; i++) {
      await Future<void>.delayed(pollInterval);
      if (epoch != _epoch) {
        return;
      }
      try {
        final ApiResponse response = await transport.send('GET', '/v1/auth/phone-verifications/$id');
        if (epoch != _epoch) {
          return;
        }
        final Object? data = response.status == 200 ? response.data : null;
        final Object? status = data is Map<String, Object?> ? data['delivery_status'] : null;
        switch (status) {
          case 'SENT':
            _delivery = OtpDelivery.sent;
            _step = OtpStep.sent;
          case 'UNCERTAIN':
            _delivery = OtpDelivery.uncertain;
            _step = OtpStep.sent;
          case 'FAILED':
            _delivery = OtpDelivery.failed;
            _step = OtpStep.idle;
            _resendAt = null;
          case 'EXPIRED':
            _delivery = OtpDelivery.expired;
            _step = OtpStep.idle;
            _resendAt = null;
          case 'CLOSED':
            _delivery = OtpDelivery.closed;
            _step = OtpStep.idle;
          default:
            continue;
        }
        _notify();
        return;
      } on AuthFailure {
        // A lost poll is simply tried again; the code stays unusable until the server says SENT.
        continue;
      }
    }
    if (epoch == _epoch && _step == OtpStep.waiting) {
      _delivery = OtpDelivery.expired;
      _step = OtpStep.idle;
      _resendAt = null;
      _notify();
    }
  }

  Future<bool> verify(String otp) async {
    final String? id = _verificationId;
    if (id == null || _step != OtpStep.sent) {
      return false;
    }
    final int epoch = ++_epoch;
    _step = OtpStep.verifying;
    _failure = null;
    _notify();
    try {
      final ApiResponse response = await transport.send(
        'POST',
        '/v1/auth/phone-verifications/$id/verify',
        body: utf8.encode(jsonEncode(<String, Object?>{'otp': otp.trim()})),
      );
      if (epoch != _epoch) {
        return false;
      }
      final Object? data = response.status == 200 ? response.data : null;
      final Object? token = data is Map<String, Object?> ? data['verification_token'] : null;
      if (token is! String) {
        throw failureOf(response);
      }
      _token = token;
      _step = OtpStep.verified;
      _notify();
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      if (failure.kind == AuthFailureKind.otpLocked) {
        // The challenge is closed: back to the first step with nothing of this flow kept (no id, no number, no proof). The cooldown
        // stays (`_resendAt` is the one set when the code was requested): going back is no way around it, and the server enforces it.
        _epoch++;
        _step = OtpStep.idle;
        _delivery = OtpDelivery.pending;
        _verificationId = null;
        _phone = null;
        _token = null;
        _lockedOut = true;
        _failure = failure;
        _notify();
        return false;
      }
      // A wrong code can be retried on the same challenge (the server counts attempts and locks); an unknown outcome as well.
      _step = failure.kind == AuthFailureKind.otpInvalid || failure.outcomeUnknown ? OtpStep.sent : OtpStep.idle;
      if (_step == OtpStep.idle) {
        _resendAt = null;
      }
      _failure = failure;
      _notify();
      return false;
    }
  }
}
