import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_tabs.dart';

// M08 in the 11Ship app: the existing "Thông báo" tab is the inbox of the signed-in Shipper (no new tab), the bell carries the unread count, a tap on a push
// is opened from the server and routed, the settings entry has the Shipper group, and a guest sees no notification of anyone.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HealthTransport healthy() => (Uri uri, Duration t) async => RawHealthResponse(status: 200, body: uri.path == kLivePath ? '{"data":{"status":"ok"}}' : '{"data":{"status":"ready"}}');

NotificationItem row(String id, int seq, {String kind = 'NEW_OFFERS', String title = 'Có đơn giao hàng mới', bool read = false, TargetType type = TargetType.deliveryList, String? targetId, TargetList? list = TargetList.offers}) => NotificationItem(
      id: id,
      seq: seq,
      kind: kind,
      category: NotificationCategory.available,
      title: title,
      body: 'Xem danh sách đơn có thể nhận.',
      target: NotificationTarget(type: type, id: targetId, list: list),
      createdAt: DateTime.now().subtract(const Duration(minutes: 2)),
      read: read,
      expired: false,
    );

class Source extends NotificationSource {
  List<NotificationItem> items = <NotificationItem>[];
  int unread = 0;
  final List<String> opened = <String>[];
  OpenOutcome outcome = const OpenOutcome(kind: OpenKind.ok, target: NotificationTarget(type: TargetType.deliveryList, list: TargetList.offers), expired: false);

  @override
  Future<NotificationPage> list({required bool unreadOnly, int? before, int limit = 30}) async => NotificationPage(items: items, unreadCount: unread, latestSeq: 9, serverNow: DateTime.now());

  // The live sync waits at the server: nothing arrives in this test.
  @override
  Future<NotificationPage> changes({required int after, Duration wait = Duration.zero}) => Completer<NotificationPage>().future;

  @override
  Future<int> unreadCount() async => unread;

  @override
  Future<int> markRead(List<String> ids) async => unread;

  @override
  Future<int> markAllRead() async => 0;

  @override
  Future<OpenOutcome> open(String id) async {
    opened.add(id);
    return outcome;
  }

  @override
  Future<NotificationSettings> settings() async => const NotificationSettings(orders: true, reminders: true, walletProfile: true, available: true, sound: true, vibrate: true, pushAvailable: false);

  @override
  Future<NotificationSettings> updateSettings(NotificationSettings next) async => next;

  @override
  Future<void> registerPushToken(String token) async {}

  @override
  Future<void> unregisterPushToken() async {}

  @override
  Future<void> reportPushPermissionDenied() async {}
}

Future<({SessionController session, AppFlows flows, Source source})> boot(WidgetTester tester, {bool signedIn = true}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final Source source = Source();
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  final AppFlows flows = createFlows(ClientApp.ship, session, config, transport: api, notificationSource: source);
  await session.start();
  if (signedIn) {
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  }
  return (session: session, flows: flows, source: source);
}

Widget app(SessionController session, AppFlows flows) => N11App(
      brand: shipBrand,
      tabs: buildShipTabs(session, flows: flows),
      config: config,
      transport: healthy(),
      pollInterval: Duration.zero,
      notifications: NotificationShell(controller: flows.notifications!, router: shipNotificationRouter(session, flows), push: flows.push),
    );

void main() {
  testWidgets('the Thông báo tab is the Shipper\'s inbox: the collapsed card, unread, and the bell count; the nav keeps its five tabs', (WidgetTester tester) async {
    final t = await boot(tester);
    t.source
      ..items = <NotificationItem>[row('card', 5), row('rem', 4, kind: 'PICKUP_REMINDER', title: 'Bạn còn 2 đơn chưa lấy hàng', read: true, list: TargetList.active)]
      ..unread = 1;
    await tester.pumpWidget(app(t.session, t.flows));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const Key('bell-count')), findsOneWidget);
    await tester.tap(find.byKey(const Key('tab-notifications')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Có đơn giao hàng mới'), findsOneWidget);
    expect(find.text('Bạn còn 2 đơn chưa lấy hàng'), findsOneWidget);
    expect(find.byKey(const Key('unread-dot')), findsOneWidget);
    expect(find.descendant(of: find.byType(N11BottomNav), matching: find.byType(Icon)), findsNWidgets(5));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a tap on a push is opened from the server (right and state re-checked) and routed to the offers; a lost right shows the message', (WidgetTester tester) async {
    final t = await boot(tester);
    await tester.pumpWidget(app(t.session, t.flows));
    await tester.pump();
    t.flows.notifications!.requestOpen('n-push');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(t.source.opened, <String>['n-push']);
    expect(find.byKey(const Key('page-orders')), findsOneWidget);

    t.source.outcome = const OpenOutcome(kind: OpenKind.noAccess, expired: false);
    t.flows.notifications!.requestOpen('n-gone');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(t.source.opened.last, 'n-gone');
    expect(find.text(kNoAccessText), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a guest has no inbox, no bell count and no settings entry', (WidgetTester tester) async {
    final t = await boot(tester, signedIn: false);
    t.source.items = <NotificationItem>[row('card', 5)];
    t.source.unread = 3;
    await tester.pumpWidget(app(t.session, t.flows));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const Key('bell-count')), findsNothing);
    await tester.tap(find.byKey(const Key('tab-notifications')));
    await tester.pump();
    expect(find.text('Đăng nhập để xem thông báo của bạn.'), findsOneWidget);
    expect(find.text('Có đơn giao hàng mới'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Tài khoản › Cài đặt thông báo opens the settings with the Shipper group and the honest push status', (WidgetTester tester) async {
    final t = await boot(tester);
    await tester.pumpWidget(app(t.session, t.flows));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tab-account')));
    await tester.pump();
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('open-notification-settings')));
    await tester.tap(find.byKey(const Key('open-notification-settings')));
    await tester.pumpAndSettle();
    expect(find.text('Đơn có thể nhận'), findsOneWidget);
    expect(find.byKey(const Key('push-unavailable')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
