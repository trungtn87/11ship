import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_tabs.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'https://api.example.test',
  deviceEnvironment: 'fixture-env',
);

HealthTransport _healthy() =>
    (Uri uri, Duration timeout) async => RawHealthResponse(
          status: 200,
          body: uri.path == kLivePath
              ? '{"data":{"status":"ok"}}'
              : '{"data":{"status":"ready"}}',
        );

Map<String, Object?> _identity(String role, {String user = 'user-a'}) =>
    <String, Object?>{
      ...identityJson(active: role),
      'user_id': user,
      'available_roles': <String>['CUSTOMER', 'SHOP_OWNER'],
      'active_role': role,
      'capabilities': <String, Object?>{
        'customer_access': true,
        'shop_profile_read': true,
        'shop_manage': true,
        'driver_profile_read': false,
      },
    };

class _Source extends NotificationSource {
  _Source(this.session);

  final SessionController session;
  final List<NotificationItem> items = <NotificationItem>[];
  final List<OpenOutcome> outcomes = <OpenOutcome>[];
  Object? failure;
  bool expireOnce = false;
  int opens = 0;

  @override
  Future<NotificationPage> list({
    required bool unreadOnly,
    int? before,
    int limit = 30,
  }) async =>
      NotificationPage(
        items: items,
        unreadCount: items.where((NotificationItem item) => !item.read).length,
        latestSeq: items.isEmpty ? 0 : items.first.seq,
        serverNow: DateTime.utc(2026, 10, 27),
      );

  @override
  Future<NotificationPage> changes({
    required int after,
    Duration wait = Duration.zero,
  }) =>
      Completer<NotificationPage>().future;

  @override
  Future<OpenOutcome> open(String id) async {
    opens++;
    if (expireOnce) {
      expireOnce = false;
      await session.logout();
      throw const NotificationFailure(NotificationFailureKind.sessionEnded);
    }
    if (failure case final Object error) throw error;
    return outcomes.length > 1 ? outcomes.removeAt(0) : outcomes.single;
  }

  @override
  Future<int> unreadCount() async => 0;
  @override
  Future<int> markRead(List<String> ids) async => 0;
  @override
  Future<int> markAllRead() async => 0;
  @override
  Future<NotificationSettings> settings() async => const NotificationSettings(
        orders: true,
        reminders: true,
        walletProfile: true,
        sound: true,
        vibrate: true,
        pushAvailable: true,
      );
  @override
  Future<NotificationSettings> updateSettings(
          NotificationSettings next) async =>
      next;
  @override
  Future<void> registerPushToken(String token) async {}
  @override
  Future<void> unregisterPushToken() async {}
  @override
  Future<void> reportPushPermissionDenied() async {}
}

class _Push implements PushPort {
  final StreamController<String> tapController =
      StreamController<String>.broadcast();
  @override
  Future<PushState> state() async => const PushState(
        supported: true,
        permission: PushPermission.granted,
        token: 'token-aaaaaaaaaaaaaaaaaaaa',
      );
  @override
  Future<PushPermission> requestPermission() async => PushPermission.granted;
  @override
  Future<void> openSystemSettings() async {}
  @override
  Future<void> deleteToken() async {}
  @override
  Stream<String> get tokenRefreshes => const Stream<String>.empty();
  @override
  Stream<String> get taps => tapController.stream;
}

class _Fixture {
  _Fixture(
      this.api, this.session, this.source, this.push, this.flows, this.orderId);
  final FakeApiTransport api;
  final SessionController session;
  final _Source source;
  final _Push push;
  final AppFlows flows;
  final String orderId;

  void dispose() {
    flows.push?.dispose();
    flows.notifications?.dispose();
    flows.reset.dispose();
    flows.orders?.cart.dispose();
    push.tapController.close();
    session.dispose();
  }
}

Future<_Fixture> _fixture(String role) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  var currentRole = role;
  var currentUser = 'user-a';
  api.routes['GET /v1/client-auth/me'] = (_, __, ___, ____) async => json(200,
      <String, Object?>{'data': _identity(currentRole, user: currentUser)});
  api.routes['POST /v1/client-auth/login'] = (_, __, ___, ____) async => json(
        200,
        <String, Object?>{
          'data': <String, Object?>{
            ..._identity(currentRole, user: currentUser),
            'access_token': 'fake-access-token-0123456789',
          },
        },
        headers: <String, String>{
          'x-device-binding-id': '33333333-3333-4333-8333-333333333333',
          'x-device-binding-generation': '1',
        },
      );
  api.routes['POST /v1/client-auth/context'] = (_, __, ___, String body) async {
    currentRole = body.contains('SHOP_OWNER') ? 'SHOP_OWNER' : 'CUSTOMER';
    return json(200,
        <String, Object?>{'data': _identity(currentRole, user: currentUser)});
  };
  final SessionController session = createSessionController(
    ClientApp.food,
    _config,
    transport: api,
    bridge: FakeDeviceBridge(),
  );
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final SampleOrderStore store = SampleOrderStore();
  final String orderId = store.seed(status: 'COMPLETED');
  final OrderRuntime orders = OrderRuntime(
    customer: SampleCustomerOrders(store),
    shop: SampleShopOrders(store),
    cart: CartController(source: SampleCustomerOrders(store)),
  );
  final _Source source = _Source(session);
  final _Push push = _Push();
  final AppFlows flows = createFlows(
    ClientApp.food,
    session,
    _config,
    transport: api,
    notificationSource: source,
    pushPort: push,
    orderRuntime: orders,
  );
  return _Fixture(api, session, source, push, flows, orderId);
}

Future<void> _pump(WidgetTester tester, _Fixture f) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ListenableBuilder(
    listenable: f.session,
    builder: (_, __) => N11App(
      navigationIdentity: f.session.identity?.userId,
      brand: foodBrand,
      tabs: buildFoodTabs(f.session, flows: f.flows),
      config: _config,
      transport: _healthy(),
      pollInterval: Duration.zero,
      notifications: NotificationShell(
        controller: f.flows.notifications!,
        router: foodNotificationRouter(f.flows),
        push: f.flows.push,
      ),
      keepBottomNavOnChildRoutes: true,
    ),
  ));
  await tester.pumpAndSettle();
}

OpenOutcome _order(String id) => OpenOutcome(
      kind: OpenKind.ok,
      target: NotificationTarget(type: TargetType.order, id: id),
      expired: false,
    );

Future<void> _crossRole(
  WidgetTester tester, {
  required String from,
  required Type detail,
  required Type root,
}) async {
  final _Fixture f = await _fixture(from);
  addTearDown(f.dispose);
  f.source.outcomes.addAll(<OpenOutcome>[
    const OpenOutcome(kind: OpenKind.noAccess, expired: false),
    _order(f.orderId),
    _order(f.orderId),
  ]);
  await _pump(tester, f);
  f.flows.notifications!.requestOpen('role-order');
  await tester.pumpAndSettle();
  expect(find.byType(detail), findsOneWidget);
  expect(find.byType(N11BottomNav), findsOneWidget);
  expect(f.source.opens, 2);
  await tester.binding.handlePopRoute();
  await tester.pumpAndSettle();
  expect(find.byType(root), findsOneWidget);
  f.flows.notifications!.requestOpen('role-order');
  await tester.pumpAndSettle();
  expect(find.byType(detail), findsOneWidget);
  await tester.tap(find.byKey(const Key('tab-home')));
  await tester.pumpAndSettle();
  expect(find.byType(detail), findsNothing);
  await tester.tap(find.byKey(const Key('tab-orders')));
  await tester.pumpAndSettle();
  expect(find.byType(detail), findsNothing);
  expect(find.byType(root), findsOneWidget);
}

void main() {
  testWidgets(
      'A: CUSTOMER notification switches to SHOP_OWNER inside Food shell',
      (WidgetTester tester) => _crossRole(
            tester,
            from: 'CUSTOMER',
            detail: ShopOrderDetailScreen,
            root: ShopOrdersTab,
          ));

  testWidgets(
      'B: SHOP_OWNER notification switches to CUSTOMER inside Food shell',
      (WidgetTester tester) => _crossRole(
            tester,
            from: 'SHOP_OWNER',
            detail: CustomerOrderDetailScreen,
            root: CustomerOrdersView,
          ));

  testWidgets('C: Android push and resume open one nested target only',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source.outcomes.add(_order(f.orderId));
    await _pump(tester, f);
    f.push.tapController.add('push-order');
    await tester.pumpAndSettle();
    expect(find.byType(CustomerOrderDetailScreen), findsOneWidget);
    expect(f.source.opens, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.byType(CustomerOrderDetailScreen), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
    expect(f.source.opens, 1);
  });

  testWidgets('C: cold-start pending target is consumed once',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('SHOP_OWNER');
    addTearDown(f.dispose);
    f.source.outcomes.add(_order(f.orderId));
    f.flows.notifications!.requestOpen('cold-order');
    await _pump(tester, f);
    expect(find.byType(ShopOrderDetailScreen), findsOneWidget);
    expect(f.source.opens, 1);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    await _pump(tester, f);
    expect(f.source.opens, 1);
  });

  testWidgets('C: Inbox tap routes through the same Food shell navigator',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source.items.add(NotificationItem.fromJson(<String, Object?>{
      'notification_id': 'inbox-order',
      'seq': 1,
      'kind': 'ORDER_CREATED',
      'category': 'ORDERS',
      'title': 'ÄÆ¡n má»›i',
      'body': 'Má»Ÿ Ä‘Æ¡n',
      'target': <String, Object?>{'type': 'ORDER', 'id': f.orderId},
      'created_at': DateTime.utc(2026, 10, 27).toIso8601String(),
      'updated_at': DateTime.utc(2026, 10, 27).toIso8601String(),
      'read': false,
      'expired': false,
    }));
    f.source.outcomes.add(_order(f.orderId));
    await f.flows.notifications!.load();
    await _pump(tester, f);
    await tester.tap(find.byKey(const Key('bell')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ÄÆ¡n má»›i'));
    await tester.pumpAndSettle();
    expect(find.byType(CustomerOrderDetailScreen), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
    expect(f.source.opens, 1);
  });

  testWidgets('D: expired target resumes once after the same account logs in',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source
      ..expireOnce = true
      ..outcomes.add(_order(f.orderId));
    await _pump(tester, f);
    f.flows.notifications!.requestOpen('owned-by-a');
    await tester.pumpAndSettle();
    expect(f.session.status, SessionStatus.guest);
    expect(f.flows.notifications!.hasPendingOpen, isTrue);
    await f.session.login(phone: '0901234567', password: 'Correct-Horse-9');
    await tester.pumpAndSettle();
    expect(find.byType(CustomerOrderDetailScreen), findsOneWidget);
    expect(f.source.opens, 2);
    expect(f.flows.notifications!.hasPendingOpen, isFalse);
  });

  testWidgets('E: another account never inherits an expired target',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source
      ..expireOnce = true
      ..outcomes.add(_order(f.orderId));
    await _pump(tester, f);
    f.flows.notifications!.requestOpen('owned-by-a');
    await tester.pumpAndSettle();
    expect(f.session.status, SessionStatus.guest);
    expect(f.flows.notifications!.hasPendingOpen, isTrue);

    f.api.routes['POST /v1/client-auth/login'] =
        (_, __, ___, ____) async => json(200, <String, Object?>{
              'data': <String, Object?>{
                ..._identity('CUSTOMER', user: 'user-b'),
                'access_token': 'token-for-user-b-0123456789',
              },
            });
    await f.session.login(phone: '0900000002', password: 'Correct-Horse-9');
    await tester.pumpAndSettle();
    expect(find.byType(CustomerOrderDetailScreen), findsNothing);
    expect(f.source.opens, 1);
  });

  testWidgets('F: denied, revoked and missing targets stay safe and visible',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source.outcomes.addAll(const <OpenOutcome>[
      OpenOutcome(kind: OpenKind.noAccess, expired: false),
      OpenOutcome(kind: OpenKind.noAccess, expired: false),
    ]);
    f.api.routes['POST /v1/client-auth/context'] =
        (_, __, ___, ____) async => apiError(403, 'ROLE_NOT_ALLOWED');
    await _pump(tester, f);
    f.flows.notifications!.requestOpen('revoked-role');
    await tester.pumpAndSettle();
    expect(find.text(kNoAccessText), findsOneWidget);
    expect(f.session.identity?.activeRole, 'CUSTOMER');
    expect(find.byType(ShopOrderDetailScreen), findsNothing);
    expect(f.source.opens, 1);

    ScaffoldMessenger.of(
      tester.element(find.byType(N11Shell)),
    ).clearSnackBars();
    await tester.pumpAndSettle();
    f.source.failure =
        const NotificationFailure(NotificationFailureKind.notFound);
    f.flows.notifications!.requestOpen('missing-order');
    await tester.pumpAndSettle();
    expect(f.source.opens, 2);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
  });

  testWidgets('financial notification still opens the shop finance profile',
      (WidgetTester tester) async {
    final _Fixture f = await _fixture('CUSTOMER');
    addTearDown(f.dispose);
    f.source.outcomes.add(const OpenOutcome(
      kind: OpenKind.ok,
      target: NotificationTarget(
        type: TargetType.financeRequest,
        id: 'finance-request-1',
      ),
      expired: false,
    ));
    await _pump(tester, f);
    f.flows.notifications!.requestOpen('finance');
    await tester.pumpAndSettle();
    expect(f.session.identity?.activeRole, 'SHOP_OWNER');
    expect(find.byType(FinanceRequestsScreen), findsOneWidget);
    expect(find.byType(N11BottomNav), findsOneWidget);
  });
}
