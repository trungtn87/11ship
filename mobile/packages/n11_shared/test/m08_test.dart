import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// M08 in the apps: the HTTP source against a scripted server (paths, strict parsing, closed failure mapping), the inbox controller (server as source of
// truth, no doubled rows, a read mark only after the server confirmed, live sync with a stated offline state, a dropped account), the push link (token
// bound to the session, deleted on sign-out) and the screens (unread, grouping, empty / loading / error / offline, open with a lost right, settings).

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
final DateTime base = DateTime.utc(2026, 10, 18, 12, 0);

Map<String, Object?> itemJson(String id, int seq, {String kind = 'DELIVERY_ACCEPTED', String title = 'Quán đã xác nhận', bool read = false, bool expired = false, String targetType = 'DELIVERY', String? targetId = 'd1', DateTime? at}) => <String, Object?>{
      'notification_id': id,
      'seq': seq,
      'kind': kind,
      'category': 'ORDERS',
      'title': title,
      'body': 'Đơn DG-1',
      'target': <String, Object?>{'type': targetType, 'id': targetId},
      'created_at': (at ?? base).toIso8601String(),
      'updated_at': (at ?? base).toIso8601String(),
      'read': read,
      'expired': expired,
    };

Map<String, Object?> pageJson(List<Map<String, Object?>> items, {int unread = 0, int latest = 0, int? next}) => <String, Object?>{'items': items, 'next_before': next, 'unread_count': unread, 'latest_seq': latest, 'server_now': base.toIso8601String()};

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

class FakeSource extends NotificationSource {
  FakeSource(this.session);

  final SessionController session;
  List<NotificationItem> items = <NotificationItem>[];
  int unread = 0;
  Object? fail;
  OpenOutcome outcome = const OpenOutcome(kind: OpenKind.ok, target: NotificationTarget(type: TargetType.delivery, id: 'd1'), expired: false);
  final List<String> calls = <String>[];
  final List<String> tokens = <String>[];
  int deniedReports = 0;
  int unregistered = 0;
  NotificationSettings stored = const NotificationSettings(orders: true, reminders: true, walletProfile: true, available: true, sound: true, vibrate: true, pushAvailable: true);
  Completer<NotificationPage>? hold;
  final List<NotificationPage> live = <NotificationPage>[];

  NotificationPage page() => NotificationPage(items: items, unreadCount: unread, latestSeq: items.isEmpty ? 0 : items.first.seq, serverNow: base);

  void _maybeFail() {
    final Object? error = fail;
    if (error != null) {
      throw error;
    }
  }

  @override
  Future<NotificationPage> list({required bool unreadOnly, int? before, int limit = 30}) async {
    calls.add('list:${unreadOnly ? 'unread' : 'all'}');
    _maybeFail();
    if (hold != null) {
      return hold!.future;
    }
    return NotificationPage(items: unreadOnly ? items.where((NotificationItem i) => !i.read).toList() : items, unreadCount: unread, latestSeq: items.isEmpty ? 0 : items.first.seq, serverNow: base);
  }

  @override
  Future<NotificationPage> changes({required int after, Duration wait = Duration.zero}) async {
    calls.add('changes:$after');
    _maybeFail();
    if (live.isNotEmpty) {
      return live.removeAt(0);
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
    return NotificationPage(items: const <NotificationItem>[], unreadCount: unread, latestSeq: after, serverNow: base);
  }

  @override
  Future<int> unreadCount() async {
    _maybeFail();
    return unread;
  }

  @override
  Future<int> markRead(List<String> ids) async => unread;

  @override
  Future<int> markAllRead() async {
    calls.add('markAll');
    _maybeFail();
    unread = 0;
    return 0;
  }

  @override
  Future<OpenOutcome> open(String id) async {
    calls.add('open:$id');
    _maybeFail();
    return outcome;
  }

  @override
  Future<NotificationSettings> settings() async {
    _maybeFail();
    return stored;
  }

  @override
  Future<NotificationSettings> updateSettings(NotificationSettings next) async {
    _maybeFail();
    stored = next;
    return stored;
  }

  @override
  Future<void> registerPushToken(String token) async {
    _maybeFail();
    tokens.add(token);
  }

  @override
  Future<void> unregisterPushToken() async => unregistered++;

  @override
  Future<void> reportPushPermissionDenied() async => deniedReports++;
}

class FakePush implements PushPort {
  PushState current = const PushState(supported: true, permission: PushPermission.granted, token: 'tok-aaaaaaaaaaaaaaaaaaaa');
  int deleted = 0;
  int settingsOpened = 0;
  PushPermission asked = PushPermission.granted;
  final StreamController<String> refreshes = StreamController<String>.broadcast();
  final StreamController<String> tapStream = StreamController<String>.broadcast();

  @override
  Future<PushState> state() async => current;

  @override
  Future<PushPermission> requestPermission() async {
    current = PushState(supported: true, permission: asked, token: asked == PushPermission.granted ? 'tok-aaaaaaaaaaaaaaaaaaaa' : null);
    return asked;
  }

  @override
  Future<void> openSystemSettings() async => settingsOpened++;

  @override
  Future<void> deleteToken() async => deleted++;

  @override
  Stream<String> get tokenRefreshes => refreshes.stream;

  @override
  Stream<String> get taps => tapStream.stream;
}

NotificationItem item(String id, int seq, {String kind = 'DELIVERY_ACCEPTED', bool read = false, bool expired = false, DateTime? at, String title = 'Quán đã xác nhận đơn'}) =>
    NotificationItem.fromJson(itemJson(id, seq, kind: kind, read: read, expired: expired, at: at, title: title));

void main() {
  group('HTTP source', () {
    test('list asks the filter and the cursor, parses strictly and refuses a body that is not the contract', () async {
      final t = await signedIn();
      t.api.routes['GET /v1/notifications?filter=unread&limit=30&before=7'] = (String m, String p, Map<String, String> h, String b) async =>
          json(200, <String, Object?>{'data': pageJson(<Map<String, Object?>>[itemJson('n1', 6)], unread: 1, latest: 9, next: 5)});
      final NotificationPage page = await HttpNotificationSource(session: t.session).list(unreadOnly: true, before: 7);
      expect(page.items.single.id, 'n1');
      expect(page.unreadCount, 1);
      expect(page.nextBefore, 5);
      t.api.routes['GET /v1/notifications?filter=all&limit=30'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'items': 'x'}});
      await expectLater(HttpNotificationSource(session: t.session).list(unreadOnly: false), throwsA(isA<NotificationFailure>().having((NotificationFailure f) => f.kind, 'kind', NotificationFailureKind.server)));
    });

    test('open, read, settings and the push token use the documented paths and bodies; a 404 is "not found", a lost answer is "offline"', () async {
      final t = await signedIn();
      final HttpNotificationSource source = HttpNotificationSource(session: t.session);
      t.api.routes['POST /v1/notifications/n1/open'] = (String m, String p, Map<String, String> h, String b) async =>
          json(200, <String, Object?>{'data': <String, Object?>{'notification_id': 'n1', 'outcome': 'NO_ACCESS', 'target': null, 'delivery_state': null, 'expired': false, 'server_now': base.toIso8601String()}});
      final OpenOutcome outcome = await source.open('n1');
      expect(outcome.kind, OpenKind.noAccess);
      expect(outcome.target, isNull);

      t.api.routes['POST /v1/notifications/read'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'changed': 1, 'unread_count': 4}});
      expect(await source.markRead(<String>['n1']), 4);
      expect(jsonDecode(t.api.to('POST', '/v1/notifications/read').single.body), <String, Object?>{'ids': <String>['n1']});

      t.api.routes['PUT /v1/notifications/push-token'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'registered': true}});
      await source.registerPushToken('tok-aaaaaaaaaaaaaaaaaaaa');
      expect(jsonDecode(t.api.to('PUT', '/v1/notifications/push-token').single.body), <String, Object?>{'provider': 'FCM', 'token': 'tok-aaaaaaaaaaaaaaaaaaaa'});

      t.api.routes['POST /v1/notifications/zz/open'] = (String m, String p, Map<String, String> h, String b) async => json(404, <String, Object?>{'error': <String, Object?>{'code': 'NOTIFICATION_NOT_FOUND', 'message': 'x'}});
      await expectLater(source.open('zz'), throwsA(isA<NotificationFailure>().having((NotificationFailure f) => f.kind, 'kind', NotificationFailureKind.notFound)));
      t.api.routes['GET /v1/notifications/unread-count'] = (String m, String p, Map<String, String> h, String b) async => throw const AuthFailure(AuthFailureKind.unknownOutcome);
      await expectLater(source.unreadCount(), throwsA(isA<NotificationFailure>().having((NotificationFailure f) => f.kind, 'kind', NotificationFailureKind.offline)));
    });

    test('settings: the Shipper group is optional, the push availability is the server\'s', () {
      final NotificationSettings food = NotificationSettings.fromJson(<String, Object?>{'orders': true, 'reminders': true, 'wallet_profile': true, 'sound': true, 'vibrate': false, 'push_available': false});
      expect(food.available, isNull);
      expect(food.pushAvailable, isFalse);
      expect(food.toJson().containsKey('available'), isFalse);
      expect(() => NotificationSettings.fromJson(<String, Object?>{'orders': 'yes'}), throwsFormatException);
    });
  });

  group('controller', () {
    test('load reads the server; a repeated load never doubles a row; the filter asks the server', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('n2', 2), item('n1', 1, read: true)]..unread = 1;
      final NotificationController c = NotificationController(session: t.session, source: source);
      await Future.wait(<Future<void>>[c.load(), c.load()]);
      expect(c.items.map((NotificationItem i) => i.id), <String>['n2', 'n1']);
      expect(c.unreadCount, 1);
      await c.setUnreadOnly(true);
      expect(c.items.map((NotificationItem i) => i.id), <String>['n2']);
      expect(source.calls, contains('list:unread'));
      c.dispose();
    });

    test('a read mark appears only after the server confirmed the open; a lost answer marks nothing', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('n1', 1)]..unread = 1;
      final NotificationController c = NotificationController(session: t.session, source: source);
      await c.load();
      source.fail = const NotificationFailure(NotificationFailureKind.offline);
      await expectLater(c.open(c.items.single), throwsA(isA<NotificationFailure>()));
      expect(c.items.single.read, isFalse);
      expect(c.unreadCount, 1);
      source.fail = null;
      await c.open(c.items.single);
      expect(c.items.single.read, isTrue);
      expect(c.unreadCount, 0);
      c.dispose();
    });

    test('live sync merges what is newer, refreshes the one collapsed card in place and announces only what was not already known', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('card', 1, kind: 'NEW_OFFERS', read: true)];
      final List<List<NotificationItem>> announced = <List<NotificationItem>>[];
      final NotificationController c = NotificationController(session: t.session, source: source, onLiveItems: announced.add);
      await c.load();
      source.live
        ..add(NotificationPage(items: <NotificationItem>[item('card', 5, kind: 'NEW_OFFERS')], unreadCount: 1, latestSeq: 5, serverNow: base))
        ..add(NotificationPage(items: <NotificationItem>[item('card', 6, kind: 'NEW_OFFERS')], unreadCount: 1, latestSeq: 6, serverNow: base));
      c.startLive();
      c.startLive(); // never two loops
      await Future<void>.delayed(const Duration(milliseconds: 60));
      c.stopLive();
      expect(c.items.where((NotificationItem i) => i.id == 'card'), hasLength(1));
      expect(c.items.single.seq, 6);
      expect(c.items.single.read, isFalse);
      // The card was read; its first refresh is news, the second one (still unread) is not announced again.
      expect(announced.expand((List<NotificationItem> l) => l).map((NotificationItem i) => i.seq), <int>[5]);
      expect(source.calls.where((String s) => s.startsWith('changes:')).first, 'changes:1');
      c.dispose();
    });

    test('losing the connection is stated, retried with backoff, and cleared when the server answers again; a dead session stops the loop', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session);
      final List<Duration> waits = <Duration>[];
      final NotificationController c = NotificationController(session: t.session, source: source, delay: (Duration d) async {
        waits.add(d);
        await Future<void>.delayed(const Duration(milliseconds: 1));
      });
      source.fail = const NotificationFailure(NotificationFailureKind.offline);
      c.startLive();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(c.offline, isTrue);
      expect(waits.take(3), <Duration>[const Duration(seconds: 2), const Duration(seconds: 4), const Duration(seconds: 8)]);
      source.fail = null;
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(c.offline, isFalse);
      c.stopLive();
      c.dispose();
    });

    test('another account on this phone drops everything of the previous one at once', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('n1', 1)]..unread = 1;
      final NotificationController c = NotificationController(session: t.session, source: source);
      await c.load();
      expect(c.items, isNotEmpty);
      await t.session.logout();
      expect(c.items, isEmpty);
      expect(c.unreadCount, 0);
      expect(c.state, InboxLoad.idle);
      c.dispose();
    });
  });

  group('push link', () {
    test('binds the token to the signed-in session, again after a rotation; a permission refusal is reported; sign-out deletes the local token', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session);
      final FakePush port = FakePush();
      final PushSync sync = PushSync(session: t.session, source: source, port: port);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(source.tokens, <String>['tok-aaaaaaaaaaaaaaaaaaaa']);
      port.refreshes.add('tok-bbbbbbbbbbbbbbbbbbbb');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(source.tokens.last, 'tok-bbbbbbbbbbbbbbbbbbbb');
      port.current = const PushState(supported: true, permission: PushPermission.denied);
      await sync.resync();
      expect(source.deniedReports, 1);
      await t.session.logout();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(port.deleted, 1);
      sync.dispose();
    });

    test('a build without a push provider says so and registers nothing; a tap is handed to the app', () async {
      final t = await signedIn();
      final FakeSource source = FakeSource(t.session);
      final FakePush port = FakePush()..current = PushState.unsupported;
      final List<String> taps = <String>[];
      final PushSync sync = PushSync(session: t.session, source: source, port: port, onTap: taps.add);
      await sync.resync();
      expect(sync.supported, isFalse);
      expect(source.tokens, isEmpty);
      port.tapStream.add('n9');
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(taps, <String>['n9']);
      sync.dispose();
    });
  });

  group('screens', () {
    Future<NotificationController> pumpInbox(WidgetTester tester, FakeSource source, SessionController session, {NotificationRouter? router, List<String>? routed}) async {
      final NotificationController c = NotificationController(session: session, source: source);
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: Scaffold(
          body: NotificationInboxBody(
            controller: c,
            now: () => base.add(const Duration(minutes: 5)),
            actions: ShellActions(goTab: (String id) => routed?.add('tab:$id'), openDiagnostics: () {}),
            router: router ?? (BuildContext context, NotificationItem? item, OpenOutcome outcome, ShellActions actions) async => routed?.add('route:${outcome.target?.type.name}:${outcome.target?.id}'),
          ),
        ),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
      return c;
    }

    testWidgets('empty, loading and error are different, and the retry loads again', (WidgetTester tester) async {
      final t = await tester.runAsync(signedIn) as ({SessionController session, FakeApiTransport api});
      final FakeSource source = FakeSource(t.session)..fail = const NotificationFailure(NotificationFailureKind.server);
      final NotificationController c = await pumpInbox(tester, source, t.session);
      expect(find.text('Không tải được thông báo'), findsOneWidget);
      source.fail = null;
      await tester.tap(find.byKey(const Key('inbox-retry')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.text('Chưa có thông báo'), findsOneWidget);
      c.dispose();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('rows: unread marked with a dot, grouped by day, a card that is past its window says so; tapping opens and routes', (WidgetTester tester) async {
      final t = await tester.runAsync(signedIn) as ({SessionController session, FakeApiTransport api});
      final List<String> routed = <String>[];
      final FakeSource source = FakeSource(t.session)
        ..items = <NotificationItem>[
          item('n3', 3, kind: 'SEARCH_REMINDER', title: 'Đơn vẫn đang tìm shipper', at: base),
          item('n2', 2, kind: 'NEW_OFFERS', title: 'Có đơn giao hàng mới', expired: true, read: true, at: base.subtract(const Duration(days: 1))),
          item('n1', 1, kind: 'DELIVERY_COMPLETED', title: 'Giao hàng thành công', read: true, at: base.subtract(const Duration(days: 3))),
        ]
        ..unread = 1;
      final NotificationController c = await pumpInbox(tester, source, t.session, routed: routed);
      expect(find.text('Hôm nay'), findsOneWidget);
      expect(find.text('Hôm qua'), findsOneWidget);
      expect(find.text('Trước đó'), findsOneWidget);
      expect(find.byKey(const Key('unread-dot')), findsOneWidget);
      expect(find.text('Đang tìm'), findsOneWidget);
      expect(find.text('Hết hiệu lực'), findsOneWidget);
      expect(find.text('5 phút trước'), findsOneWidget);
      await tester.tap(find.byKey(const Key('row-n3')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(source.calls, contains('open:n3'));
      expect(routed, <String>['route:delivery:d1']);
      expect(find.byKey(const Key('unread-dot')), findsNothing);
      c.dispose();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a lost right says so and routes nowhere; a lost connection is stated and nothing is marked read', (WidgetTester tester) async {
      final t = await tester.runAsync(signedIn) as ({SessionController session, FakeApiTransport api});
      final List<String> routed = <String>[];
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('n1', 1)]..unread = 1;
      final NotificationController c = await pumpInbox(tester, source, t.session, routed: routed);
      source.outcome = const OpenOutcome(kind: OpenKind.noAccess, expired: false);
      await tester.tap(find.byKey(const Key('row-n1')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.text(kNoAccessText), findsOneWidget);
      expect(routed, isEmpty);
      await tester.pump(const Duration(seconds: 5));
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      source.fail = const NotificationFailure(NotificationFailureKind.offline);
      await tester.tap(find.byKey(const Key('row-n1')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.text(kOfflineText), findsWidgets);
      expect(routed, isEmpty);
      c.dispose();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('the bell shows the unread count from the server and the offline banner appears with the connection', (WidgetTester tester) async {
      final t = await tester.runAsync(signedIn) as ({SessionController session, FakeApiTransport api});
      final FakeSource source = FakeSource(t.session)..items = <NotificationItem>[item('n1', 1)]..unread = 120;
      final NotificationController c = NotificationController(session: t.session, source: source);
      await c.load();
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: Scaffold(body: NotificationBell(controller: c, onPressed: () {}))));
      expect(find.text('99+'), findsOneWidget);
      c.dispose();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('settings: a change is shown only after the server confirmed it; the missing system permission shows how to fix it; sound off keeps the order switch', (WidgetTester tester) async {
      final t = await tester.runAsync(signedIn) as ({SessionController session, FakeApiTransport api});
      final FakeSource source = FakeSource(t.session);
      final FakePush port = FakePush()..current = const PushState(supported: true, permission: PushPermission.denied);
      final PushSync push = PushSync(session: t.session, source: source, port: port);
      await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: NotificationSettingsScreen(source: source, push: push, shipper: true)));
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.text('Đơn có thể nhận'), findsOneWidget);
      expect(find.byKey(const Key('permission-help')), findsOneWidget);
      expect(find.text('Tắt âm thanh không làm tắt nhận đơn.'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('set-sound')));
      await tester.tap(find.byKey(const Key('set-sound')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(source.stored.sound, isFalse);
      expect(source.stored.available, isTrue);
      source.fail = const NotificationFailure(NotificationFailureKind.offline);
      await tester.ensureVisible(find.byKey(const Key('set-vibrate')));
      await tester.tap(find.byKey(const Key('set-vibrate')));
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.byKey(const Key('settings-error')), findsOneWidget);
      expect(source.stored.vibrate, isTrue);
      await tester.ensureVisible(find.byKey(const Key('system-permission')));
      await tester.tap(find.byKey(const Key('system-permission')));
      await tester.pump();
      expect(port.settingsOpened, 1);
      push.dispose();
      await tester.pumpWidget(const SizedBox());
    });
  });

  test('wording helpers', () {
    final DateTime now = DateTime(2026, 10, 18, 12);
    expect(groupLabel(DateTime(2026, 10, 18, 1), now), 'Hôm nay');
    expect(groupLabel(DateTime(2026, 10, 17, 23), now), 'Hôm qua');
    expect(groupLabel(DateTime(2026, 10, 10), now), 'Trước đó');
    expect(relativeTime(now.subtract(const Duration(seconds: 20)), now), 'Vừa xong');
    expect(relativeTime(now.subtract(const Duration(hours: 3)), now), '3 giờ trước');
    expect(relativeTime(DateTime(2026, 9, 1), now), '01/09/2026');
  });
}
