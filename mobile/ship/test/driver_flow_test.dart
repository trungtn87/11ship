import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

void main() {
  testWidgets('M03: bank and review are absent during normal activity; stopping opens the bank form for refund', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeDriverServer server = FakeDriverServer(api)
      ..profile = <String, Object?>{
        'driver_id': '55555555-5555-4555-8555-555555555555',
        'user_id': '11111111-1111-4111-8111-111111111111',
        'shipper_code': 'SH000001',
        'full_name': 'Trần Văn Shipper',
        'phone': '+84901234567',
        'plate_number': null,
        'status': 'ACTIVE',
        'review_state': 'DRAFT',
        'accepting_deliveries': false,
        'version': 1,
      };
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    final DriverController driver = DriverController(session: session);
    await tester.pumpWidget(MaterialApp(home: DriverProfileScreen(controller: driver)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('driver-bank-entry')), findsNothing);
    expect(find.byKey(const Key('driver-send-review')), findsNothing);
    expect(find.text('Đã kích hoạt'), findsWidgets);
    await tester.ensureVisible(find.byKey(const Key('driver-activity-entry')));
    await tester.tap(find.byKey(const Key('driver-activity-entry')));
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byKey(const Key('driver-accepting-switch'))).onChanged, isNull);
    server.walletReady = true;
    await driver.load();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('driver-accepting-switch')));
    await tester.pumpAndSettle();
    expect(driver.profile!.acceptingDeliveries, isTrue, reason: 'bank is not required for orders');
    await tester.ensureVisible(find.byKey(const Key('driver-closure-request')));
    await tester.tap(find.byKey(const Key('driver-closure-request')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('driver-closure-confirm')));
    await tester.pumpAndSettle();
    expect(driver.profile!.status, 'CLOSING');
    expect(driver.profile!.acceptingDeliveries, isFalse);
    await tester.ensureVisible(find.byKey(const Key('closure-bank')));
    await tester.tap(find.byKey(const Key('closure-bank')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('driver-bank-number')), findsOneWidget);
    expect(api.to('POST', '/v1/driver/me/submit'), isEmpty);
  });

  testWidgets('M03: a locked (SUSPENDED) Shipper still sees the way to close and get the balance back, stays locked, and the old review wording is gone', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    FakeDriverServer(api).profile = <String, Object?>{
        'driver_id': '55555555-5555-4555-8555-555555555555',
        'user_id': '11111111-1111-4111-8111-111111111111',
        'shipper_code': 'SH000002',
        'full_name': 'Trần Văn Khóa',
        'phone': '+84901234567',
        'plate_number': null,
        'status': 'SUSPENDED',
        'review_state': 'APPROVED',
        'suspension_reason': 'Khiếu nại giao hàng',
        'accepting_deliveries': false,
        'version': 1,
      };
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    final DriverController driver = DriverController(session: session);
    await tester.pumpWidget(MaterialApp(home: DriverProfileScreen(controller: driver)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('driver-suspended')), findsOneWidget);
    expect(find.textContaining('không cần mở khóa'), findsWidgets);
    await tester.ensureVisible(find.byKey(const Key('driver-activity-entry')));
    await tester.tap(find.byKey(const Key('driver-activity-entry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('driver-closure-suspended-note')), findsOneWidget);
    expect(tester.widget<Switch>(find.byKey(const Key('driver-accepting-switch'))).onChanged, isNull, reason: 'a locked Shipper cannot receive orders');
    await tester.ensureVisible(find.byKey(const Key('driver-closure-request')));
    await tester.tap(find.byKey(const Key('driver-closure-request')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('driver-closure-confirm')));
    await tester.pumpAndSettle();
    expect(driver.profile!.status, 'CLOSING');
    expect(driver.profile!.closure!.fromSuspended, isTrue);
    expect(find.byKey(const Key('driver-closure-pending')), findsOneWidget);
    expect(find.textContaining('quay lại trạng thái khóa'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('driver-closure-undo')));
    await tester.tap(find.byKey(const Key('driver-closure-undo')));
    await tester.pumpAndSettle();
    expect(driver.profile!.status, 'SUSPENDED');
    expect(driver.profile!.suspensionReason, 'Khiếu nại giao hàng');
    expect(driver.profile!.acceptingDeliveries, isFalse);
  });
}
