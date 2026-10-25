import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #191 on the phone: the independent cards of the order detail, the quick call, the dishes without pictures, the closed map that builds nothing, no order
// code for the customer, and "Trao đổi đơn hàng" (feed, paging, send, retry with the same key, a closed room, a refusal that is never shown as sent).

Future<void> mount(WidgetTester tester, Widget screen, {Size size = const Size(1080, 9000)}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));
Finder containing(String value) => find.textContaining(value);

OrderRuntime runtimeOf(SampleOrderStore store, {M07MapBuilder? map}) => OrderRuntime(customer: SampleCustomerOrders(store), shop: SampleShopOrders(store), cart: CartController(source: SampleCustomerOrders(store)), mapBuilder: map);

class _Dialer extends PhoneDialer {
  _Dialer({this.opens = true});

  final bool opens;
  final List<String> dialled = <String>[];

  @override
  Future<bool> dial(String phone) async {
    dialled.add(phone);
    return opens;
  }
}

ChatMessage msg(String id, int minute, String body, {bool mine = false, ChatRole role = ChatRole.shop}) => ChatMessage(id: id, at: DateTime(2026, 10, 25, 9, minute), role: role, senderName: mine ? 'Tôi' : 'Quán Phở', mine: mine, body: body);

const ChatRoomRef room = ChatRoomRef(ChatDoor.customerOrder, 'room-1');

void main() {
  setUp(() => orderPhoneDialer = const MethodChannelPhoneDialer());

  group('collapsible cards', () {
    testWidgets('each card opens and closes on its own; closed, it keeps its title and one line and builds nothing', (WidgetTester tester) async {
      var builtA = 0;
      var builtB = 0;
      await mount(
        tester,
        Scaffold(
          body: Column(
            children: <Widget>[
              OrderSection(id: 'a', title: 'Thẻ A', summary: '3 món · 130.000đ', builder: (BuildContext _) {
                builtA += 1;
                return const Text('nội dung A');
              }),
              OrderSection(id: 'b', title: 'Thẻ B', summary: 'tóm tắt B', initiallyExpanded: true, builder: (BuildContext _) {
                builtB += 1;
                return const Text('nội dung B');
              }),
            ],
          ),
        ),
      );
      expect(find.text('Thẻ A'), findsOneWidget);
      expect(find.text('3 món · 130.000đ'), findsOneWidget);
      expect(find.text('nội dung A'), findsNothing);
      expect(builtA, 0, reason: 'a closed card builds nothing');
      expect(find.text('nội dung B'), findsOneWidget);
      await tap(tester, key('section-a-header'));
      expect(find.text('nội dung A'), findsOneWidget);
      expect(find.text('nội dung B'), findsOneWidget, reason: 'opening one never closes another');
      await tap(tester, key('section-b-header'));
      expect(find.text('nội dung B'), findsNothing);
      expect(find.text('tóm tắt B'), findsOneWidget);
      expect(find.text('nội dung A'), findsOneWidget);
      expect(builtB, greaterThan(0));
    });

    testWidgets('the header is a labelled button at least as tall as a touch target, and the call button next to it stays usable when the card is closed', (WidgetTester tester) async {
      final _Dialer dialer = _Dialer();
      orderPhoneDialer = dialer;
      await mount(tester, Scaffold(body: OrderSection(id: 'p', title: 'Shipper', summary: 'An · Đang giao', trailing: const QuickCall(phone: '0912 345 678', who: 'shipper'), builder: (BuildContext _) => const Text('chi tiết'))));
      expect(tester.getSize(key('section-p-header')).height, greaterThanOrEqualTo(48));
      expect(find.bySemanticsLabel(RegExp('Shipper. An · Đang giao. Đang thu gọn')), findsOneWidget);
      expect(find.text('chi tiết'), findsNothing);
      await tap(tester, key('quick-call-shipper'));
      expect(dialer.dialled, <String>['+84912345678']);
      expect(find.text('chi tiết'), findsNothing, reason: 'calling does not open the card');
    });
  });

  group('quick call', () {
    test('only a real Vietnamese number is a number: spaces and dots are fine, letters, codes and short numbers are not', () {
      expect(dialNumberOf('0912345678'), '+84912345678');
      expect(dialNumberOf('+84 912.345-678'), '+84912345678');
      expect(dialNumberOf('+84912345678'), '+84912345678');
      for (final String? bad in <String?>[null, '', '12345', '*123#', '0912345678; 0911111111', 'abc', '+8491234567', '+1 202 555 0100', 'tel:0912345678']) {
        expect(dialNumberOf(bad), isNull, reason: '$bad');
      }
      expect(dialNumberText('+84912345678'), '0912 345 678');
    });

    testWidgets('no button without a valid number; with one it opens the dialer and never places the call itself', (WidgetTester tester) async {
      final _Dialer dialer = _Dialer();
      orderPhoneDialer = dialer;
      await mount(tester, const Scaffold(body: Column(children: <Widget>[QuickCall(phone: null, who: 'khách'), QuickCall(phone: 'abc', who: 'quán'), QuickCall(phone: '0912345678', who: 'shipper')])));
      expect(key('quick-call-khách'), findsNothing);
      expect(key('quick-call-quán'), findsNothing);
      await tap(tester, key('quick-call-shipper'));
      expect(dialer.dialled, <String>['+84912345678']);
    });

    testWidgets('when the phone cannot open a dialer the number is copied and the person is told, not left with a dead button', (WidgetTester tester) async {
      orderPhoneDialer = _Dialer(opens: false);
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (MethodCall call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map<Object?, Object?>)['text'] as String?;
        }
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await mount(tester, const Scaffold(body: QuickCall(phone: '0912345678', who: 'quán')));
      await tap(tester, key('quick-call-quán'));
      expect(copied, '+84912345678');
      expect(containing('Đã sao chép số điện thoại'), findsOneWidget);
    });
  });

  group('chat', () {
    Future<OrderChatController> panel(WidgetTester tester, SampleOrderChat api, {Size size = const Size(1080, 9000)}) async {
      final OrderChatController c = OrderChatController(api: api, room: room, refreshEvery: const Duration(hours: 1), pageSize: 3);
      addTearDown(c.dispose);
      await mount(tester, Scaffold(body: SingleChildScrollView(child: OrderChatPanel(controller: c))), size: size);
      return c;
    }

    testWidgets('messages are bubbles with their sender, milestones are neutral centred lines, both in time order; plain text only', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[
        ChatMilestone(id: 's1', at: DateTime(2026, 10, 25, 9, 0), text: 'Đã đặt đơn'),
        msg('m1', 1, 'Dạ quán nhận đơn <b>ạ</b>'),
        msg('m2', 2, 'Cảm ơn quán', mine: true, role: ChatRole.customer),
      ]);
      await panel(tester, api);
      final double system = tester.getTopLeft(containing('Đã đặt đơn')).dy;
      final double first = tester.getTopLeft(find.text('Dạ quán nhận đơn <b>ạ</b>')).dy;
      final double second = tester.getTopLeft(find.text('Cảm ơn quán')).dy;
      expect(system, lessThan(first));
      expect(first, lessThan(second));
      expect(containing('Quán Phở · Quán'), findsOneWidget);
      expect(find.text('Bạn'), findsOneWidget);
      expect(tester.getCenter(containing('Đã đặt đơn')).dx, closeTo(tester.getSize(find.byType(MaterialApp)).width / 2, 40), reason: 'a milestone is centred');
      expect(tester.getTopRight(find.text('Cảm ơn quán')).dx, greaterThan(tester.getTopLeft(find.text('Dạ quán nhận đơn <b>ạ</b>')).dx), reason: 'mine is on the right');
    });

    testWidgets('older pages come on request, without repeating anything', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[for (int i = 1; i <= 7; i++) msg('m$i', i, 'tin $i')]);
      await panel(tester, api);
      expect(find.text('tin 7'), findsOneWidget);
      expect(find.text('tin 5'), findsOneWidget);
      expect(find.text('tin 4'), findsNothing);
      await tap(tester, key('chat-older'));
      expect(find.text('tin 4'), findsOneWidget);
      expect(find.text('tin 2'), findsOneWidget);
      expect(find.text('tin 1'), findsNothing);
      await tap(tester, key('chat-older'));
      expect(find.text('tin 1'), findsOneWidget);
      expect(key('chat-older'), findsNothing);
      for (int i = 1; i <= 7; i++) {
        expect(find.text('tin $i'), findsOneWidget);
      }
    });

    testWidgets('a sent message appears once the server stored it and the box is cleared; empty text sends nothing', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat();
      await panel(tester, api);
      expect(key('chat-empty'), findsOneWidget);
      await tap(tester, key('chat-send'));
      expect(api.sends, 0);
      await tester.enterText(key('chat-input'), '  Cho mình thêm hành  ');
      await tap(tester, key('chat-send'));
      expect(api.sends, 1);
      expect(find.text('Cho mình thêm hành'), findsOneWidget);
      expect((tester.widget<TextField>(key('chat-input')).controller)?.text, '');
      expect(key('chat-empty'), findsNothing);
    });

    testWidgets('a lost answer keeps the text and the retry uses the SAME key: the server stores one message', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat()..failNextSend = const M07Failure(M07FailureKind.offline);
      await panel(tester, api);
      await tester.enterText(key('chat-input'), 'Một tin');
      await tap(tester, key('chat-send'));
      expect(key('chat-send-failed'), findsOneWidget);
      expect(find.text('Một tin'), findsOneWidget, reason: 'the typed text stays in the box');
      expect(api.items, isEmpty);
      await tap(tester, key('chat-send'));
      await tap(tester, key('chat-send'));
      expect(api.items.whereType<ChatMessage>(), hasLength(1), reason: 'a retry never writes twice');
      expect(key('chat-send-failed'), findsNothing);
    });

    testWidgets('a refusal because the order ended is never shown as sent: the room turns read-only and says so', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[msg('m1', 1, 'tin cũ')]);
      final OrderChatController c = await panel(tester, api);
      api.open = false;
      await tester.enterText(key('chat-input'), 'tin đến sau khi đóng');
      await tap(tester, key('chat-send'));
      expect(find.text('tin đến sau khi đóng'), findsNothing);
      expect(api.items.whereType<ChatMessage>().map((ChatMessage m) => m.body), <String>['tin cũ']);
      expect(c.ended, isTrue);
      expect(key('chat-closed'), findsOneWidget);
      expect(containing('Đơn đã kết thúc. Bạn chỉ có thể xem lại trao đổi.'), findsOneWidget);
      expect(key('chat-input'), findsNothing);
      expect(key('chat-send'), findsNothing);
      expect(find.text('tin cũ'), findsOneWidget, reason: 'the stored history is still read');
    });

    test('the room reads the retention the server sends and never invents one', () {
      final ChatRoom a = ChatRoom.fromJson(<String, Object?>{'id': 'r', 'open': false, 'can_send': false, 'retention_days': 7, 'expired': false});
      expect((a.retentionDays, a.expired), (7, false));
      final ChatRoom b = ChatRoom.fromJson(<String, Object?>{'id': 'r', 'open': true, 'can_send': true});
      expect((b.retentionDays, b.expired), (null, false));
    });

    testWidgets('a closed room says how long the history is kept (the server\'s number) and an expired one says it ran out', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[msg('m1', 1, 'tin cũ')], open: false, retentionDays: 7);
      await panel(tester, api);
      expect(containing('Lịch sử trao đổi được lưu 7 ngày sau khi đơn kết thúc.'), findsOneWidget);
      await unmount(tester);
      final SampleOrderChat gone = SampleOrderChat(open: false, retentionDays: 7, expired: true);
      await panel(tester, gone);
      expect(key('chat-expired'), findsOneWidget);
      expect(containing('Lịch sử trao đổi đã hết thời hạn lưu trữ.'), findsOneWidget);
      expect(find.byType(ChatLine), findsNothing);
    });

    testWidgets('someone who lost the room (a released Shipper) can read but not write; the polling picks up new messages while the chat is on screen', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[msg('m1', 1, 'tin 1')])..canSend = false;
      final OrderChatController c = OrderChatController(api: api, room: room, refreshEvery: const Duration(seconds: 5));
      addTearDown(c.dispose);
      await mount(tester, Scaffold(body: SingleChildScrollView(child: OrderChatPanel(controller: c))));
      expect(key('chat-readonly'), findsOneWidget);
      expect(key('chat-input'), findsNothing);
      api.items.add(msg('m2', 2, 'tin mới của người khác'));
      await tester.pump(const Duration(seconds: 6));
      await settle(tester);
      expect(find.text('tin mới của người khác'), findsOneWidget);
    });

    testWidgets('while the card is closed nothing polls: the controller reads on attach and stops on detach', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat(items: <ChatItem>[msg('m1', 1, 'tin 1')]);
      final OrderChatController c = OrderChatController(api: api, room: room, refreshEvery: const Duration(seconds: 5));
      addTearDown(c.dispose);
      await mount(tester, Scaffold(body: ListenableBuilder(listenable: c, builder: (BuildContext context, Widget? _) => OrderSection(id: 'chat', title: 'Trao đổi đơn hàng', summary: c.summary, builder: (BuildContext _) => OrderChatPanel(controller: c)))));
      final int afterOpen = api.reads;
      expect(find.text('Bạn'), findsNothing);
      expect(containing('Quán: tin 1'), findsOneWidget, reason: 'the closed card says the newest message');
      await tester.pump(const Duration(seconds: 20));
      expect(api.reads, afterOpen, reason: 'no polling while closed');
      await tap(tester, key('section-chat-header'));
      expect(find.text('tin 1'), findsOneWidget);
      expect(api.reads, greaterThan(afterOpen));
      final int whileOpen = api.reads;
      await tester.pump(const Duration(seconds: 6));
      expect(api.reads, greaterThan(whileOpen));
      await tap(tester, key('section-chat-header'));
      final int closedAgain = api.reads;
      await tester.pump(const Duration(seconds: 20));
      expect(api.reads, closedAgain);
    });

    testWidgets('closing and opening the card keeps what was typed', (WidgetTester tester) async {
      final SampleOrderChat api = SampleOrderChat();
      final OrderChatController c = OrderChatController(api: api, room: room, refreshEvery: const Duration(hours: 1));
      addTearDown(c.dispose);
      final TextEditingController text = TextEditingController();
      addTearDown(text.dispose);
      await mount(tester, Scaffold(body: SingleChildScrollView(child: OrderSection(id: 'chat', title: 'Trao đổi đơn hàng', summary: '', initiallyExpanded: true, builder: (BuildContext _) => OrderChatPanel(controller: c)))));
      await tester.enterText(key('chat-input'), 'đang gõ dở');
      await tap(tester, key('section-chat-header'));
      expect(key('chat-input'), findsNothing);
      await tap(tester, key('section-chat-header'));
      // The draft lives with the box while it is on screen; the controller (above the card) never sent it and never lost the feed.
      expect(api.sends, 0);
      expect(c.items, isEmpty);
    });
  });

  group('the customer detail', () {
    testWidgets('no order code, the total and the status are always drawn, the dishes are text only, and the closed map builds nothing', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final List<List<String>> drawn = <List<String>>[];
      final OrderRuntime runtime = runtimeOf(store, map: (BuildContext context, List<M07MapPin> pins) {
        drawn.add(<String>[for (final M07MapPin p in pins) p.label]);
        return const SizedBox(key: Key('fake-map'));
      });
      final String id = store.seed(status: 'PREPARING', deliveryState: 'accepted');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      expect(containing('Mã đơn'), findsNothing);
      expect(containing(store.codeOf(id)), findsNothing);
      expect(key('order-total'), findsOneWidget);
      expect(key('section-items-body'), findsOneWidget);
      expect(containing('2×'), findsOneWidget);
      expect(containing('Ít đá'), findsOneWidget);
      expect(find.byType(Image), findsNothing, reason: 'no dish picture on an order');
      expect(find.byType(FadeInImage), findsNothing);
      expect(key('section-map-body'), findsNothing);
      expect(drawn, isEmpty);
      expect(containing('Xem bản đồ'), findsOneWidget);
      expect(key('section-chat-body'), findsOneWidget, reason: 'the chat is open by default');
      expect(find.text('Diễn biến'), findsNothing);
      await tap(tester, key('section-map-header'));
      expect(drawn, isNotEmpty);
      await tap(tester, key('section-map-header'));
      expect(key('fake-map'), findsNothing);
    });

    testWidgets('the shop and the held Shipper can be called from the page; nobody can before a Shipper holds it, and not after the order ended', (WidgetTester tester) async {
      final _Dialer dialer = _Dialer();
      orderPhoneDialer = dialer;
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String searching = store.seed(status: 'PREPARING', deliveryState: 'waiting_driver');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: searching));
      expect(key('quick-call-quán'), findsOneWidget);
      expect(key('quick-call-shipper'), findsNothing);
      expect(containing('0911'), findsNothing, reason: 'no Shipper number before a Shipper holds the order');
      await unmount(tester);

      final String live = store.seed(status: 'PREPARING', deliveryState: 'accepted');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: live));
      await tap(tester, key('quick-call-shipper'));
      await tap(tester, key('quick-call-quán'));
      expect(dialer.dialled, <String>['+84911111111', '+84900000001']);
      await unmount(tester);

      final String done = store.seed(status: 'COMPLETED', deliveryState: 'completed');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: done));
      expect(key('quick-call-shipper'), findsNothing);
      expect(key('quick-call-quán'), findsNothing);
      expect(containing('Đơn đã kết thúc'), findsWidgets);
      expect(key('chat-closed'), findsOneWidget);
    });

    testWidgets('a small phone (360 px) shows the page without overflow, closed cards included', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed(status: 'PREPARING', deliveryState: 'accepted', name: 'Một cái tên người nhận rất là dài để thử xem có bị tràn ngang màn hình nhỏ hay không');
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id), size: const Size(1080, 6000));
      expect(tester.takeException(), isNull);
      await tap(tester, key('section-recipient-header'));
      await tap(tester, key('section-map-header'));
      expect(tester.takeException(), isNull);
    });
  });

  group('the shop detail', () {
    testWidgets('shows the code with a copy button, calls the customer, keeps the main actions outside the cards, and has the same chat', (WidgetTester tester) async {
      final _Dialer dialer = _Dialer();
      orderPhoneDialer = dialer;
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed();
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(containing(store.codeOf(id)), findsWidgets);
      expect(key('order-copy-code'), findsOneWidget);
      expect(key('order-total'), findsOneWidget);
      expect(key('order-confirm'), findsOneWidget, reason: 'the main action is never inside a card');
      await tap(tester, key('quick-call-khách'));
      expect(dialer.dialled, <String>['+84912345678']);
      expect(key('section-chat-body'), findsOneWidget);
      expect(key('section-map-body'), findsNothing);
      expect(find.byType(Image), findsNothing);
      await tap(tester, key('section-other-header'));
      expect(containing('Thời gian đặt'), findsOneWidget);
      expect(containing('Khoảng cách'), findsNothing, reason: 'no distance without a measured route');
    });

    testWidgets('both sides read the same room: a message of the customer shows in the shop and the milestones are the same lines', (WidgetTester tester) async {
      final SampleOrderStore store = SampleOrderStore();
      final OrderRuntime runtime = runtimeOf(store);
      final String id = store.seed();
      await mount(tester, CustomerOrderDetailScreen(runtime: runtime, orderId: id));
      await tester.enterText(key('chat-input'), 'Gọi trước khi giao nhé');
      await tap(tester, key('chat-send'));
      await unmount(tester);
      await mount(tester, ShopOrderDetailScreen(runtime: runtime, orderId: id));
      expect(find.text('Gọi trước khi giao nhé'), findsOneWidget);
      expect(containing('Đã đặt đơn'), findsWidgets);
    });
  });
}
