import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Owner decision 2026-10-14: registration while SYSTEM turned the registration OTP off, the closed password reset, the recovery of an
// account locked at its owner's request (always an OTP), and a locked driver that keeps the wallet only.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

({SessionController session, FakeApiTransport api, FakeDeviceBridge bridge}) build({String registration = 'REQUIRED', ClientApp app = ClientApp.food}) {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api, registration: registration);
  final FakeDeviceBridge bridge = FakeDeviceBridge();
  return (session: createSessionController(app, config, transport: api, bridge: bridge), api: api, bridge: bridge);
}

void main() {
  group('registration without OTP (SYSTEM turned the registration OTP off)', () {
    test('NOT_REQUIRED opens the registration with no proof: the body has no verification_token', () async {
      final t = build(registration: 'NOT_REQUIRED');
      await t.session.loadRegistrationMode();
      expect(t.session.registrationMode, RegistrationMode.notRequired);
      expect(await t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An'), isTrue);
      final RecordedRequest register = t.api.to('POST', '/v1/client-auth/register').single;
      final Map<String, Object?> body = jsonDecode(register.body) as Map<String, Object?>;
      expect(body.keys.toSet(), <String>{'phone', 'password', 'device', 'full_name', 'consent'});
      expect(register.headers['x-device-registration'], isNotEmpty, reason: 'the device proof still applies');
      expect(t.session.status, SessionStatus.signedIn);
    });

    test('a token is never sent when the server did not ask for one, and REQUIRED still needs it', () async {
      final off = build(registration: 'NOT_REQUIRED');
      await off.session.loadRegistrationMode();
      expect(await off.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An', verificationToken: 'STALE-PROOF-0123456789'), isTrue);
      expect(off.api.to('POST', '/v1/client-auth/register').single.body, isNot(contains('verification_token')));
      final on = build();
      await on.session.loadRegistrationMode();
      expect(on.session.registrationMode, RegistrationMode.required);
      expect(await on.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An'), isFalse);
      expect(on.api.to('POST', '/v1/client-auth/register'), isEmpty);
    });

    test('an unreadable configuration still opens nothing (the app never guesses a mode)', () async {
      final t = build(registration: 'NOT_REQUIRED');
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await t.session.loadRegistrationMode();
      expect(t.session.registrationMode, RegistrationMode.unknown);
      expect(await t.session.register(phone: '0901234567', password: 'Correct-Horse-9', fullName: 'Nguyễn Văn An'), isFalse);
    });

    testWidgets('RegisterScreen: no OTP section, an info note, and the submit needs no code', (WidgetTester tester) async {
      final t = build(registration: 'NOT_REQUIRED');
      await t.session.start();
      await tester.pumpWidget(MaterialApp(home: RegisterScreen(session: t.session, brand: foodBrand)));
      await tester.pumpAndSettle();
      // 11Food registers in three steps: account details, purpose, phone (+ OTP only while it is required).
      await tester.enterText(find.byKey(const Key('register-name')), 'Nguyễn Văn An');
      await tester.enterText(find.byKey(const Key('register-password')), 'Correct-Horse-9');
      await tester.enterText(find.byKey(const Key('register-confirm')), 'Correct-Horse-9');
      await tester.ensureVisible(find.byKey(const Key('register-consent')));
      await tester.tap(find.byKey(const Key('register-consent')));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('register-next')));
      await tester.tap(find.byKey(const Key('register-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('purpose-customer')));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('purpose-next')));
      await tester.tap(find.byKey(const Key('purpose-next')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('not-required-note')), findsOneWidget);
      expect(find.byKey(const Key('otp-request')), findsNothing);
      await tester.enterText(find.byKey(const Key('register-phone')), '0901234567');
      await tester.pump();
      await tester.ensureVisible(find.byKey(const Key('register-submit')));
      final N11Button submit = tester.widget<N11Button>(find.byKey(const Key('register-submit')));
      expect(submit.onPressed, isNotNull);
    });
  });

  group('error codes of the new rules', () {
    AuthFailure failure(String code, int status) => failureOf(ApiResponse(status: status, headers: const <String, String>{}, body: jsonEncode(<String, Object?>{'error': <String, Object?>{'code': code}})));

    test('each code has its own closed kind and a fixed Vietnamese message', () {
      expect(failure('ACCOUNT_RECOVERY_AVAILABLE', 409).kind, AuthFailureKind.accountRecoverable);
      expect(failure('PASSWORD_RESET_DISABLED', 403).kind, AuthFailureKind.passwordResetDisabled);
      expect(failure('PHONE_VERIFICATION_REQUIRED', 409).kind, AuthFailureKind.verificationModeChanged);
      expect(failure('PHONE_VERIFICATION_NOT_REQUIRED', 409).kind, AuthFailureKind.verificationModeChanged);
      expect(failureMessage(failure('ACCOUNT_RECOVERY_AVAILABLE', 409)), contains('khôi phục'));
      expect(failureMessage(failure('PASSWORD_RESET_DISABLED', 403)), contains('liên hệ hỗ trợ'));
      expect(failureMessage(failure('ACCOUNT_DISABLED', 403)), contains('khóa'));
    });
  });

  group('recovery of a locked account (always OTP)', () {
    Future<({ResetController recover, FakeApiTransport api})> open({String mode = 'SMS_OTP'}) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installRecoverRoutes(api, mode: mode);
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController recover = ResetController(transport: api, session: session, endpoints: ResetEndpoints.recover);
      await recover.loadConfig();
      return (recover: recover, api: api);
    }

    test('uses its own routes: otp -> verify -> recover with the proof and the new password; never the reset routes', () async {
      final t = await open();
      expect(t.recover.mode, ResetMode.smsOtp);
      expect(await t.recover.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse, reason: 'no proof yet: the OTP cannot be skipped');
      expect(await t.recover.requestOtp('0901234567'), isTrue);
      expect(await t.recover.verifyOtp('123456'), isTrue);
      expect(await t.recover.submit(phone: '0901234567', password: 'New-Pass-123'), isTrue);
      expect(t.api.to('POST', '/v1/account-recovery/locked/recover').single.body, jsonEncode(<String, Object?>{'verification_token': 'RECOVER-PROOF-TOKEN-0123456789', 'password': 'New-Pass-123'}));
      expect(t.api.to('POST', '/v1/account-recovery/reset'), isEmpty);
      expect(t.api.to('POST', '/v1/account-recovery/otp'), isEmpty);
      expect(t.recover.done, isTrue);
    });

    test('with the SMS gateway not ready the server answers closed or 503 and nothing is skipped', () async {
      final closed = await open(mode: 'UNAVAILABLE');
      expect(closed.recover.mode, ResetMode.closed);
      expect(await closed.recover.requestOtp('0901234567'), isFalse);
      final t = await open();
      t.api.routes['POST /v1/account-recovery/locked/otp'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
      expect(await t.recover.requestOtp('0901234567'), isFalse);
      expect(t.recover.failure?.kind, AuthFailureKind.serverUnavailable);
      expect(await t.recover.submit(phone: '0901234567', password: 'New-Pass-123'), isFalse);
      expect(t.api.to('POST', '/v1/account-recovery/locked/recover'), isEmpty);
    });

    testWidgets('RecoveryScreen has its own wording and a done state that sends the person to login', (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installRecoverRoutes(api);
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController recover = ResetController(transport: api, session: session, endpoints: ResetEndpoints.recover);
      await tester.pumpWidget(MaterialApp(home: ResetScreen(controller: recover, brand: foodBrand, recovery: true)));
      await tester.pumpAndSettle();
      expect(find.text('Khôi phục tài khoản đã khóa'), findsOneWidget);
      expect(find.byKey(const Key('reset-otp-request')), findsOneWidget);
      expect(find.byKey(const Key('reset-password')), findsNothing, reason: 'no new password until the code is verified');
    });
  });

  group('password reset switched off by SYSTEM', () {
    test('config UNAVAILABLE closes the form with the "contact support" wording and sends nothing', () async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api, mode: 'UNAVAILABLE');
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController reset = ResetController(transport: api, session: session);
      await reset.loadConfig();
      expect(reset.mode, ResetMode.closed);
      expect(await reset.requestOtp('0901234567'), isFalse);
      expect(api.to('POST', '/v1/account-recovery/otp'), isEmpty);
    });

    testWidgets('ResetScreen shows the locked banner', (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api, mode: 'UNAVAILABLE');
      final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
      await session.start();
      final ResetController reset = ResetController(transport: api, session: session);
      await tester.pumpWidget(MaterialApp(home: ResetScreen(controller: reset, brand: foodBrand)));
      await tester.pumpAndSettle();
      expect(find.text('Tự đặt lại mật khẩu đang tạm khóa'), findsOneWidget);
    });
  });

  group('a locked driver keeps the wallet only', () {
    test('the limited identity is parsed; an ordinary one is not limited', () {
      final Map<String, Object?> base = identityJson();
      expect(Identity.tryParse(base)?.lockedWalletOnly, isFalse);
      final Identity? locked = Identity.tryParse(<String, Object?>{...base, 'account_status': 'LOCKED', 'limited_access': 'WALLET_ONLY'});
      expect(locked?.lockedWalletOnly, isTrue);
      expect(Identity.tryParse(<String, Object?>{...base, 'account_status': 'LOCKED'})?.lockedWalletOnly, isFalse, reason: 'both fields are required');
    });
  });
}
