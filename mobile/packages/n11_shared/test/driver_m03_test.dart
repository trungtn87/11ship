import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> baseProfile({String status = 'PENDING', String review = 'DRAFT'}) => <String, Object?>{
      'driver_id': '55555555-5555-4555-8555-555555555555',
      'user_id': '11111111-1111-4111-8111-111111111111',
      'shipper_code': 'SH000007',
      'full_name': 'Nguyễn Văn Tài',
      'phone': '+84901234567',
      'plate_number': null,
      'status': status,
      'review_state': review,
      'accepting_deliveries': false,
      'version': 1,
    };

Future<({DriverController driver, FakeDriverServer server, FakeApiTransport api})> start({Map<String, Object?>? profile, bool walletReady = false}) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  expect(await session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
  final FakeDriverServer server = FakeDriverServer(api)
    ..profile = profile
    ..walletReady = walletReady;
  final DriverController driver = DriverController(session: session);
  await driver.load();
  return (driver: driver, server: server, api: api);
}

void main() {
  group('M03 Shipper profile, bank and review (Android controller)', () {
    test('reads the full profile and never carries a classification', () async {
      final t = await start(profile: baseProfile());
      final DriverProfile p = t.driver.profile!;
      expect(p.shipperCode, 'SH000007');
      expect(p.phone, '+84901234567');
      expect(p.draft, isTrue);
      expect(p.canSubmit, isTrue);
      expect(p.bank, isNull);
      expect(p.readiness.canAccept, isFalse);
      expect(driverStandingLabel(p), 'Chưa gửi hồ sơ');
      expect(jsonEncode(t.server.profile), isNot(contains('driver_type')));
    });

    test('bank save sends the exact body, goes back to UNVERIFIED and each write bumps the version', () async {
      final t = await start(profile: baseProfile());
      await t.driver.loadBanks();
      expect(t.driver.banks.map((BankOption o) => o.code), <String>['VCB', 'TCB']);
      expect(await t.driver.saveBank(bankCode: 'VCB', accountNumber: '0123 4567-89', accountHolder: ' Nguyễn Văn Tài '), isTrue);
      expect(t.server.commands.single.$2, <String, Object?>{'expected_version': 1, 'bank_code': 'VCB', 'account_number': '0123456789', 'account_holder': 'Nguyễn Văn Tài'});
      expect(t.driver.profile!.bank!.verificationState, 'UNVERIFIED');
      expect(t.driver.profile!.version, 2);
      expect(await t.driver.submitForReview(), isTrue);
      expect(t.driver.profile!.submitted, isTrue);
      expect(t.driver.profile!.canSubmit, isFalse);
      // A second send is refused by the server and the profile is read again.
      expect(await t.driver.submitForReview(), isFalse);
      expect(t.driver.failure!.code, 'DRIVER_STATE_CONFLICT');
      expect(driverRefusalMessage(t.driver.failure!), isNotNull);
    });

    test('a rejected profile shows the reason and can be sent again', () async {
      final t = await start(profile: <String, Object?>{...baseProfile(review: 'REJECTED'), 'rejection_reason': 'Tên chủ tài khoản chưa rõ'});
      expect(t.driver.profile!.rejected, isTrue);
      expect(t.driver.profile!.rejectionReason, 'Tên chủ tài khoản chưa rõ');
      expect(t.driver.profile!.canSubmit, isTrue);
      expect(driverStandingLabel(t.driver.profile!), 'Bị từ chối');
    });

    test('receiving orders: blocked until the server says every condition holds; off is always possible and cancels nothing', () async {
      final t = await start(profile: baseProfile(status: 'ACTIVE', review: 'APPROVED'));
      t.server.bank = <String, Object?>{'bank_code': 'VCB', 'bank_name': 'Vietcombank', 'account_number': '0123456789', 'account_holder': 'Nguyễn Văn Tài', 'verification_state': 'VERIFIED', 'rejection_reason': null};
      await t.driver.load();
      expect(t.driver.profile!.readiness.canAccept, isFalse);
      expect(t.driver.profile!.readiness.blocks, <String>['WALLET_NOT_AVAILABLE']);
      expect(driverBlockLabel('WALLET_NOT_AVAILABLE'), contains('Ví'));
      expect(await t.driver.setAccepting(true), isFalse);
      expect(t.driver.failure!.code, 'DRIVER_WALLET_NOT_READY');
      expect(t.driver.profile!.acceptingDeliveries, isFalse);

      t.server.walletReady = true;
      await t.driver.load();
      expect(t.driver.profile!.readiness.canAccept, isTrue);
      expect(await t.driver.setAccepting(true), isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isTrue);
      expect(await t.driver.setAccepting(false), isTrue);
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
    });

    test('a SUSPENDED Shipper can ask to close for the refund without being unlocked, and a cancel returns to SUSPENDED with the reason', () async {
      final t = await start(profile: <String, Object?>{...baseProfile(status: 'SUSPENDED', review: 'APPROVED'), 'suspension_reason': 'Khiếu nại giao hàng'});
      expect(t.driver.profile!.canRequestClosure, isTrue);
      expect(await t.driver.requestClosure('Nhận lại tiền'), isTrue);
      final DriverProfile closing = t.driver.profile!;
      expect(closing.status, 'CLOSING');
      expect(closing.closure!.fromSuspended, isTrue);
      expect(closing.suspensionReason, 'Khiếu nại giao hàng');
      expect(driverStandingLabel(closing), contains('vẫn bị khóa'));
      expect(closing.acceptingDeliveries, isFalse);
      expect(await t.driver.cancelClosure(), isTrue);
      expect(t.driver.profile!.status, 'SUSPENDED');
      expect(t.driver.profile!.suspensionReason, 'Khiếu nại giao hàng');
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
    });

    test('closure request stops receiving at once, can be cancelled, and a lost answer retries the same key and body', () async {
      final t = await start(profile: <String, Object?>{...baseProfile(status: 'ACTIVE', review: 'APPROVED'), 'accepting_deliveries': true});
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await t.driver.requestClosure(' Nghỉ việc '), isFalse);
      expect(t.driver.hasPendingWrite, isTrue);
      expect(await t.driver.retryPending(), isTrue);
      final List<RecordedRequest> posts = t.api.to('POST', '/v1/driver/me/closure-request');
      expect(posts.length, 2);
      expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
      expect(posts[0].body, posts[1].body);
      expect(t.driver.profile!.status, 'CLOSING');
      expect(t.driver.profile!.acceptingDeliveries, isFalse);
      expect(t.driver.profile!.closure!.note, 'Nghỉ việc');
      expect(await t.driver.cancelClosure(), isTrue);
      expect(t.driver.profile!.status, 'ACTIVE');
      expect(t.driver.profile!.closure, isNull);
    });

    test('logout clears the profile and the banks', () async {
      final t = await start(profile: baseProfile());
      await t.driver.loadBanks();
      t.driver.clear();
      expect(t.driver.profile, isNull);
      expect(t.driver.banks, isEmpty);
    });
  });
}
