import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/src/account/vn_mobile_prefixes.g.dart';
import 'package:n11_shared/testing.dart';

// Issue #117 on the phone: the Vietnamese mobile rule shared with the backend, the tries left, the closed challenge going back to the
// first step with the cooldown kept, and the server's cooldown shown as the wait. The server counts and decides; these tests only
// check what the apps do with its answers.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
const String registerId = '55555555-5555-4555-8555-555555555555';

ApiResponse otpError(int status, String code, Map<String, Object?> details) =>
    json(status, <String, Object?>{'error': <String, Object?>{'code': code, 'message': 'x', 'request_id': 'r', 'details': details}});

void main() {
  group('Vietnamese mobile rule (same vectors as the backend)', () {
    test('every shared vector gives the same answer as the backend', () {
      final Map<String, Object?> file = jsonDecode(File('../../../config/vn-mobile-phone-cases.json').readAsStringSync()) as Map<String, Object?>;
      final List<Object?> cases = file['cases']! as List<Object?>;
      expect(cases.length, greaterThan(30));
      for (final Object? entry in cases) {
        final Map<String, Object?> item = entry! as Map<String, Object?>;
        expect(normalizeVnMobile(item['input']! as String), item['expected'], reason: 'input ${item['input']}');
      }
    });

    test('the generated prefix table is exactly config/vn-mobile-prefixes.json', () {
      final Map<String, Object?> file = jsonDecode(File('../../../config/vn-mobile-prefixes.json').readAsStringSync()) as Map<String, Object?>;
      final List<String> expected = (file['prefixes']! as List<Object?>).map((Object? e) => (e! as Map<String, Object?>)['prefix']! as String).toList()..sort();
      expect(vnMobilePrefixes, expected);
    });

    test('the field error is the approved text, and a longer-than-3-digit allocation is honoured', () {
      expect(otpPhoneError('0301234567'), 'Số điện thoại không hợp lệ. Hãy nhập số di động Việt Nam.');
      expect(otpPhoneError(''), 'Nhập số điện thoại.');
      expect(otpPhoneError('0901234567'), isNull);
      expect(normalizeVnMobile('0299123456', prefixes: <String>['0299']), '+84299123456');
      expect(normalizeVnMobile('0298123456', prefixes: <String>['0299']), isNull);
    });
  });

  group('registration OTP limits', () {
    PhoneVerificationController build(FakeApiTransport api, {DateTime Function()? clock}) => PhoneVerificationController(transport: api, pollInterval: const Duration(milliseconds: 1), clock: clock);

    test('a number that is not an allocated mobile number sends nothing', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, queued: false);
      final PhoneVerificationController otp = build(api);
      expect(await otp.request('0301234567'), isFalse);
      expect(otp.failure?.kind, AuthFailureKind.invalidPhone);
      expect(failureMessage(otp.failure!), 'Số điện thoại không hợp lệ. Hãy nhập số di động Việt Nam.');
      expect(api.to('POST', '/v1/auth/phone-verifications'), isEmpty);
    });

    test('a wrong code says how many tries are left (2, then 1); the third closes the challenge and goes back to the first step, keeping the cooldown', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, queued: false);
      int wrong = 0;
      api.routes['POST /v1/auth/phone-verifications/$registerId/verify'] = (String m, String p, Map<String, String> h, String b) async {
        wrong++;
        return wrong < 3 ? otpError(400, 'OTP_INVALID', <String, Object?>{'attempts_remaining': 3 - wrong}) : otpError(429, 'OTP_LOCKED', <String, Object?>{'attempts_remaining': 0});
      };
      DateTime now = DateTime(2026, 10, 24, 10);
      final PhoneVerificationController otp = build(api, clock: () => now);
      expect(await otp.request('0901234567'), isTrue);
      expect(otp.canEnterCode, isTrue);

      expect(await otp.verify('000000'), isFalse);
      expect(otp.attemptsRemaining, 2);
      expect(failureMessage(otp.failure!), contains('còn 2 lượt'));
      expect(otp.step, OtpStep.sent, reason: 'the same challenge can be tried again');
      expect(await otp.verify('000001'), isFalse);
      expect(otp.attemptsRemaining, 1);
      expect(failureMessage(otp.failure!), contains('còn 1 lượt'));

      expect(await otp.verify('000002'), isFalse);
      expect(otp.failure?.kind, AuthFailureKind.otpLocked, reason: 'a closed challenge is not the send quota');
      expect(otp.lockedOut, isTrue);
      expect(otp.step, OtpStep.idle);
      expect(otp.phone, isNull, reason: 'back to the first step: nothing of the flow is kept');
      expect(otp.token, isNull);
      expect(otp.canEnterCode, isFalse);
      expect(otp.canResend, isFalse, reason: 'the cooldown set when the code was asked is still running');
      expect(await otp.request('0901234567'), isFalse);
      expect(api.to('POST', '/v1/auth/phone-verifications').length, 1, reason: 'no second request while the cooldown runs');
      now = now.add(const Duration(seconds: 61));
      expect(otp.canResend, isTrue);
    });

    test('the server cooldown or quota becomes the wait on the button, in words', () async {
      final FakeApiTransport api = FakeApiTransport();
      api.routes['POST /v1/auth/phone-verifications'] = (String m, String p, Map<String, String> h, String b) async =>
          otpError(429, 'OTP_RATE_LIMITED', <String, Object?>{'reason': 'COOLDOWN', 'retry_after_seconds': 41});
      final DateTime now = DateTime(2026, 10, 24, 10);
      final PhoneVerificationController otp = build(api, clock: () => now);
      expect(await otp.request('0901234567'), isFalse);
      expect(otp.failure?.kind, AuthFailureKind.rateLimited);
      expect(otp.failure?.reason, 'COOLDOWN');
      expect(otp.resendSeconds, 41);
      expect(otp.canResend, isFalse);
      expect(failureMessage(otp.failure!), contains('41 giây'));

      expect(formatWait(30), '30 giây');
      expect(formatWait(600), '10 phút');
      expect(formatWait(7200), '2 giờ');
      final AuthFailure hour = failureOf(otpError(429, 'OTP_RATE_LIMITED', <String, Object?>{'reason': 'PHONE_HOUR', 'retry_after_seconds': 3000}));
      expect(failureMessage(hour), contains('50 phút'));
      final AuthFailure global = failureOf(otpError(429, 'OTP_RATE_LIMITED', <String, Object?>{'reason': 'GLOBAL_DAY'}));
      expect(failureMessage(global), contains('tạm hết lượt gửi SMS'));
    });

    test('only bounded OTP facts are read from the details; server text and odd values are ignored', () {
      final AuthFailure odd = failureOf(otpError(400, 'OTP_INVALID', <String, Object?>{'attempts_remaining': -1, 'retry_after_seconds': 'x', 'reason': 'drop table', 'message': 'hello'}));
      expect(odd.attemptsRemaining, isNull);
      expect(odd.retryAfterSeconds, isNull);
      expect(odd.reason, isNull);
    });
  });

  group('forgotten password OTP limits', () {
    Future<(ResetController, FakeApiTransport)> open() async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api, mode: 'SMS_OTP');
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController reset = ResetController(transport: api, session: session);
      reset.begin();
      await reset.loadConfig();
      return (reset, api);
    }

    test('an unallocated number sends nothing', () async {
      final (ResetController reset, FakeApiTransport api) = await open();
      expect(await reset.requestOtp('0301234567'), isFalse);
      expect(reset.failure?.kind, AuthFailureKind.invalidPhone);
      expect(api.to('POST', '/v1/account-recovery/otp'), isEmpty);
    });

    test('three wrong codes close the challenge: first step, id/proof/number dropped, the cooldown kept, no account touched', () async {
      final (ResetController reset, FakeApiTransport api) = await open();
      int wrong = 0;
      api.routes['POST /v1/account-recovery/otp/44444444-4444-4444-8444-444444444444/verify'] = (String m, String p, Map<String, String> h, String b) async {
        wrong++;
        return wrong < 3 ? otpError(400, 'OTP_INVALID', <String, Object?>{'attempts_remaining': 3 - wrong}) : otpError(429, 'OTP_LOCKED', <String, Object?>{'attempts_remaining': 0});
      };
      expect(await reset.requestOtp('0901234567'), isTrue);
      expect(await reset.verifyOtp('000000'), isFalse);
      expect(reset.attemptsRemaining, 2);
      expect(await reset.verifyOtp('000001'), isFalse);
      expect(reset.attemptsRemaining, 1);
      expect(await reset.verifyOtp('000002'), isFalse);
      expect(reset.lockedOut, isTrue);
      expect(reset.failure?.kind, AuthFailureKind.otpLocked);
      expect(reset.otpStep, ResetOtpStep.idle);
      expect(reset.otpPhone, isNull);
      expect(reset.otpVerified, isFalse);
      expect(reset.canResend, isFalse, reason: 'the cooldown is kept');
      expect(await reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(api.to('POST', '/v1/account-recovery/reset'), isEmpty, reason: 'nothing reaches the account');
    });

    test('the server cooldown becomes the wait', () async {
      final (ResetController reset, FakeApiTransport api) = await open();
      api.routes['POST /v1/account-recovery/otp'] = (String m, String p, Map<String, String> h, String b) async =>
          otpError(429, 'OTP_RATE_LIMITED', <String, Object?>{'reason': 'COOLDOWN', 'retry_after_seconds': 40});
      expect(await reset.requestOtp('0901234567'), isFalse);
      expect(reset.canResend, isFalse);
      expect(reset.resendSeconds, inInclusiveRange(39, 40));
    });
  });
}
