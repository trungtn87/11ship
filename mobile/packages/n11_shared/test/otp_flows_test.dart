import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #102: the OTP steps of the registration (REQUIRED mode) and of the password reset (SMS_OTP mode). The server doubles are in
// testing.dart; the real server is covered by the backend integration tests.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 30));

void main() {
  group('registration OTP (REQUIRED)', () {
    PhoneVerificationController build(FakeApiTransport api, {int maxPolls = 5}) => PhoneVerificationController(transport: api, pollInterval: const Duration(milliseconds: 1), maxPolls: maxPolls);

    test('a queued code is NOT usable until the server says SENT, then it verifies and yields the one-use proof', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api);
      final PhoneVerificationController otp = build(api);
      expect(otp.canEnterCode, isFalse);
      expect(await otp.request(' 0901234567 '), isTrue);
      expect(otp.step, OtpStep.waiting);
      expect(otp.canEnterCode, isFalse, reason: 'the SMS has not been sent yet');
      expect(await otp.verify('123456'), isFalse, reason: 'not offered before SENT');
      expect(api.to('POST', '/v1/auth/phone-verifications/55555555-5555-4555-8555-555555555555/verify'), isEmpty);

      await settle();
      expect(otp.step, OtpStep.sent);
      expect(otp.delivery, OtpDelivery.sent);
      expect(jsonDecode(api.to('POST', '/v1/auth/phone-verifications').single.body), <String, Object?>{'phone': '0901234567', 'purpose': 'REGISTER'});

      expect(await otp.verify('000000'), isFalse);
      expect(otp.failure?.kind, AuthFailureKind.otpInvalid);
      expect(otp.step, OtpStep.sent, reason: 'a wrong code can be retried on the same challenge');
      expect(otp.token, isNull);
      expect(await otp.verify('123456'), isTrue);
      expect(otp.step, OtpStep.verified);
      expect(otp.token, 'REGISTER-PROOF-TOKEN-0123456789');
      expect(otp.verifiedPhone, '0901234567');
    });

    test('a synchronous provider (no delivery_status) offers the code at once', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, queued: false);
      final PhoneVerificationController otp = build(api);
      expect(await otp.request('0901234567'), isTrue);
      expect(otp.step, OtpStep.sent);
      expect(api.to('GET', '/v1/auth/phone-verifications/55555555-5555-4555-8555-555555555555'), isEmpty);
    });

    test('a failed or expired delivery closes the step and asks for a new code; an uncertain one still lets the person try', () async {
      for (final (String status, OtpDelivery delivery, OtpStep step) in <(String, OtpDelivery, OtpStep)>[
        ('FAILED', OtpDelivery.failed, OtpStep.idle),
        ('EXPIRED', OtpDelivery.expired, OtpStep.idle),
        ('UNCERTAIN', OtpDelivery.uncertain, OtpStep.sent),
      ]) {
        final FakeApiTransport api = FakeApiTransport();
        installOtpRoutes(api, deliveries: <String>[status]);
        final PhoneVerificationController otp = build(api);
        await otp.request('0901234567');
        await settle();
        expect(otp.delivery, delivery, reason: status);
        expect(otp.step, step, reason: status);
      }
    });

    test('a code that never gets sent stops waiting instead of hanging', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, deliveries: <String>['PENDING_DELIVERY']);
      final PhoneVerificationController otp = build(api, maxPolls: 3);
      await otp.request('0901234567');
      await settle();
      expect(otp.step, OtpStep.idle);
      expect(otp.delivery, OtpDelivery.expired);
      expect(otp.canEnterCode, isFalse);
    });

    test('the proof belongs to one number: editing the phone drops the challenge and the proof', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, queued: false);
      final PhoneVerificationController otp = build(api);
      await otp.request('0901234567');
      await otp.verify('123456');
      expect(otp.token, isNotNull);
      otp.reset();
      expect(otp.token, isNull);
      expect(otp.step, OtpStep.idle);
      expect(otp.phone, isNull);
    });

    test('resend is locked for the server cooldown and a rate limit is reported', () async {
      final FakeApiTransport api = FakeApiTransport();
      installOtpRoutes(api, queued: false);
      DateTime now = DateTime(2026, 10, 14, 10);
      final PhoneVerificationController otp = PhoneVerificationController(transport: api, clock: () => now);
      await otp.request('0901234567');
      expect(otp.canResend, isFalse);
      expect(await otp.request('0901234567'), isFalse);
      now = now.add(const Duration(seconds: 61));
      expect(otp.canResend, isTrue);
      api.routes['POST /v1/auth/phone-verifications'] = (String m, String p, Map<String, String> h, String b) async => apiError(429, 'OTP_RATE_LIMITED');
      expect(await otp.request('0901234567'), isFalse);
      expect(otp.failure?.kind, AuthFailureKind.rateLimited);
    });

    test('REQUIRED register sends the proof in the signed body and refuses to send without it', () async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api, registration: 'REQUIRED');
      final FakeDeviceBridge bridge = FakeDeviceBridge();
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: bridge);
      await session.start();
      await session.loadRegistrationMode();
      expect(session.registrationMode, RegistrationMode.required);

      expect(await session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An'), isFalse);
      expect(api.to('POST', '/v1/client-auth/register'), isEmpty, reason: 'no proof: nothing is sent, nothing is faked');

      expect(await session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'REGISTER-PROOF-TOKEN-0123456789'), isTrue);
      final RecordedRequest register = api.to('POST', '/v1/client-auth/register').single;
      final Map<String, Object?> body = jsonDecode(register.body) as Map<String, Object?>;
      expect(body['verification_token'], 'REGISTER-PROOF-TOKEN-0123456789');
      expect(body.keys.toSet(), <String>{'phone', 'password', 'verification_token', 'device', 'full_name', 'consent'});
      expect(register.headers['x-device-registration'], isNotEmpty, reason: 'the OTP proof does not replace the native device proof');
    });

    test('DISABLED_TEST register keeps its exact body: no verification_token', () async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      await session.loadRegistrationMode();
      expect(await session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'ignored'), isTrue);
      final Map<String, Object?> body = jsonDecode(api.to('POST', '/v1/client-auth/register').single.body) as Map<String, Object?>;
      expect(body.containsKey('verification_token'), isFalse);
    });
  });

  group('password reset OTP (SMS_OTP)', () {
    Future<({ResetController reset, FakeApiTransport api})> open({String mode = 'SMS_OTP'}) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api, mode: mode);
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController reset = ResetController(transport: api, session: session);
      await reset.loadConfig();
      return (reset: reset, api: api);
    }

    test('request -> verify -> reset: the generic answer, a one-use proof, the reset body, and never a login', () async {
      final t = await open();
      expect(t.reset.mode, ResetMode.smsOtp);
      expect(await t.reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse, reason: 'no proof yet');
      expect(await t.reset.verifyOtp('123456'), isFalse, reason: 'no challenge yet');

      expect(await t.reset.requestOtp(' 0901234567 '), isTrue);
      expect(t.reset.otpStep, ResetOtpStep.requested);
      expect(t.reset.canResend, isFalse);
      expect(jsonDecode(t.api.to('POST', '/v1/account-recovery/otp').single.body), <String, Object?>{'phone': '0901234567'});

      expect(await t.reset.verifyOtp('000000'), isFalse);
      expect(t.reset.failure?.kind, AuthFailureKind.otpInvalid);
      expect(t.reset.otpStep, ResetOtpStep.requested);
      expect(await t.reset.verifyOtp('123456'), isTrue);
      expect(t.reset.otpVerified, isTrue);

      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await t.reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(t.reset.hasPendingWrite, isTrue);
      expect(await t.reset.retryPending(), isTrue);
      final List<RecordedRequest> posts = t.api.to('POST', '/v1/account-recovery/reset');
      expect(posts.length, 2);
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, jsonEncode(<String, Object?>{'verification_token': 'RESET-PROOF-TOKEN-0123456789', 'password': 'New-Pass-123'}));
      expect(t.api.to('POST', '/v1/account-recovery/reset-test'), isEmpty, reason: 'the no-OTP route is never used in SMS_OTP mode');
      expect(t.reset.done, isTrue);
      expect(t.reset.otpVerified, isFalse, reason: 'the spent proof is forgotten');
    });

    test('editing the phone after the code was asked drops the challenge and the proof', () async {
      final t = await open();
      await t.reset.requestOtp('0901234567');
      await t.reset.verifyOtp('123456');
      expect(t.reset.otpVerified, isTrue);
      t.reset.phoneEdited('0901234567 ');
      expect(t.reset.otpVerified, isTrue, reason: 'only a different number counts as an edit');
      t.reset.phoneEdited('0909999999');
      expect(t.reset.otpVerified, isFalse);
      expect(t.reset.otpStep, ResetOtpStep.idle);
      expect(await t.reset.submit(phone: '0909999999', password: 'New-Pass-123'), isFalse);
      expect(t.api.to('POST', '/v1/account-recovery/reset'), isEmpty);
    });

    test('a proof the server refuses is dropped: the person must ask for a new code', () async {
      final t = await open();
      await t.reset.requestOtp('0901234567');
      await t.reset.verifyOtp('123456');
      t.api.routes['POST /v1/account-recovery/reset'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'VERIFICATION_PROOF_USED');
      expect(await t.reset.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(t.reset.failure?.kind, AuthFailureKind.proofInvalid);
      expect(t.reset.otpVerified, isFalse);
      expect(t.reset.hasPendingWrite, isFalse);
    });

    test('the other modes do not offer the OTP routes', () async {
      final t = await open(mode: 'DISABLED_TEST');
      expect(await t.reset.requestOtp('0901234567'), isFalse);
      expect(t.api.to('POST', '/v1/account-recovery/otp'), isEmpty);
      final c = await open(mode: 'UNAVAILABLE');
      expect(await c.reset.requestOtp('0901234567'), isFalse);
      expect(c.reset.mode, ResetMode.closed);
    });
  });

  testWidgets('ResetScreen in SMS_OTP mode: no password until the code is verified; generic note after the request; submit uses the proof', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    installResetRoutes(api, mode: 'SMS_OTP');
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    final ResetController reset = ResetController(transport: api, session: session);
    await tester.pumpWidget(MaterialApp(home: ResetScreen(controller: reset, brand: foodBrand)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('reset-password')), findsNothing, reason: 'the password is asked only after the code is verified');
    expect(find.byKey(const Key('reset-submit')), findsNothing);
    expect(find.byKey(const Key('reset-note')), findsNothing, reason: 'the "no OTP" test note is for DISABLED_TEST only');
    await tester.enterText(find.byKey(const Key('reset-phone')), '0901234567');
    await tester.pump();
    await tester.tap(find.byKey(const Key('reset-otp-request')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('reset-otp-sent')), findsOneWidget);
    expect(find.text(kResetOtpSentText), findsOneWidget);

    await tester.enterText(find.byKey(const Key('reset-otp-code')), '123456');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('reset-otp-verify')));
    await tester.tap(find.byKey(const Key('reset-otp-verify')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('reset-otp-verified')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('reset-password')), 'New-Pass-123');
    await tester.enterText(find.byKey(const Key('reset-confirm')), 'New-Pass-123');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('reset-submit')));
    await tester.tap(find.byKey(const Key('reset-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('reset-done')), findsOneWidget);
    expect(api.to('POST', '/v1/account-recovery/reset').single.body, contains('RESET-PROOF-TOKEN-0123456789'));
    expect(api.to('POST', '/v1/account-recovery/reset-test'), isEmpty);
  });
}
