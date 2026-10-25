import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issues #198 and #199 on the phone: "Thanh toán quán" (create, list, detail), "Tôi đã chuyển khoản" as ONE notice that confirms nothing, the cancel that exists
// only before the report, the words of the states, the payment conversation (open, read-only when closed) and the keys of the writes (a lost answer is retried
// with the SAME key). The phone decides nothing: every right and state below comes from the (fake) server.

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 9000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  // A fresh tree every time: a second mount in one test must not keep the first screen's state.
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));
Finder containing(String value) => find.textContaining(value);

ShopPayment payment({
  String id = 'req-1',
  ShopPaymentPurpose purpose = ShopPaymentPurpose.menuExpansion,
  int amount = 200000,
  ShopPaymentState state = ShopPaymentState.pending,
  int version = 1,
  DateTime? reportedAt,
  int? received,
  bool entitlement = false,
}) =>
    ShopPayment(
      requestId: id,
      purpose: purpose,
      amount: amount,
      state: state,
      version: version,
      createdAt: DateTime.utc(2026, 10, 25, 3),
      reportedAt: reportedAt,
      resolvedAt: state == ShopPaymentState.pending ? null : DateTime.utc(2026, 10, 25, 5),
      canReport: state == ShopPaymentState.pending && reportedAt == null,
      canCancel: state == ShopPaymentState.pending && reportedAt == null,
      receivedAmount: received,
      entitlementGranted: entitlement,
    );

class FakePayments extends ShopPaymentSource {
  FakePayments({List<ShopPayment>? items, this.accounts_ = const <PaymentAccount>[PaymentAccount(bankId: 'VCB', accountNumber: '0123456789', accountHolder: 'CONG TY 11SHIP')], this.chatApi}) : items = items ?? <ShopPayment>[];

  final List<ShopPayment> items;
  final List<PaymentAccount> accounts_;
  final OrderChatApi? chatApi;
  final List<String> reportKeys = <String>[];
  final List<String> createKeys = <String>[];
  final List<String> cancelKeys = <String>[];
  M07Failure? failNext;

  @override
  bool get isSample => true;

  @override
  OrderChatApi? get chat => chatApi;

  @override
  Future<List<PaymentAccount>> accounts() async => accounts_;

  @override
  Future<ShopPaymentPage> list({String? cursor}) async => ShopPaymentPage(items: List<ShopPayment>.of(items), nextCursor: null);

  @override
  Future<ShopPayment> detail(String requestId) async => items.firstWhere((ShopPayment p) => p.requestId == requestId);

  void _maybeFail() {
    final M07Failure? failure = failNext;
    if (failure != null) {
      failNext = null;
      throw failure;
    }
  }

  @override
  Future<ShopPayment> create({required ShopPaymentPurpose purpose, required int amount, required String key}) async {
    createKeys.add(key);
    _maybeFail();
    final ShopPayment made = payment(id: 'req-${items.length + 1}', purpose: purpose, amount: amount);
    items.add(made);
    return made;
  }

  @override
  Future<ShopPayment> report(String requestId, {required String key}) async {
    reportKeys.add(key);
    _maybeFail();
    final int at = items.indexWhere((ShopPayment p) => p.requestId == requestId);
    final ShopPayment old = items[at];
    items[at] = payment(id: old.requestId, purpose: old.purpose, amount: old.amount, version: old.version + 1, reportedAt: DateTime.utc(2026, 10, 25, 4));
    return items[at];
  }

  @override
  Future<ShopPayment> cancel(String requestId, {required int version, required String key}) async {
    cancelKeys.add(key);
    _maybeFail();
    final int at = items.indexWhere((ShopPayment p) => p.requestId == requestId);
    final ShopPayment old = items[at];
    items[at] = payment(id: old.requestId, purpose: old.purpose, amount: old.amount, state: ShopPaymentState.cancelled, version: old.version + 1);
    return items[at];
  }
}

void main() {
  group('the words', () {
    test('a report is "Chờ kiểm tra", never "Đã nhận tiền"; only a recorded settlement is "Đã nhận tiền"', () {
      expect(payment().stateLabel, 'Chưa báo chuyển khoản');
      expect(payment(reportedAt: DateTime.utc(2026, 10, 25, 4)).stateLabel, 'Chờ kiểm tra');
      expect(payment(state: ShopPaymentState.confirmed, received: 200000).stateLabel, 'Đã nhận tiền');
      expect(payment(state: ShopPaymentState.rejected).stateLabel, 'Chưa nhận được');
      expect(payment(state: ShopPaymentState.cancelled).stateLabel, 'Đã hủy');
    });

    test('the wire is strict: a body that is not the contract is a FormatException, never a half-filled request', () {
      final Map<String, Object?> ok = <String, Object?>{
        'request_id': 'a', 'purpose': 'OTHER', 'amount_requested_vnd': 5000, 'state': 'PENDING', 'version': 1, 'created_at': '2026-10-25T03:00:00.000Z',
        'reported_at': null, 'resolved_at': null, 'can_report': true, 'can_cancel': true, 'received_amount_vnd': null, 'entitlement': null, 'menu_expanded': false,
      };
      expect(ShopPayment.fromJson(ok).amount, 5000);
      expect(ShopPayment.fromJson(<String, Object?>{...ok, 'entitlement': <String, Object?>{'kind': 'MENU_EXPANDED'}}).entitlementGranted, isTrue);
      for (final Map<String, Object?> bad in <Map<String, Object?>>[
        <String, Object?>{...ok, 'state': 'DONE'},
        <String, Object?>{...ok, 'purpose': 'SUBSCRIPTION'},
        <String, Object?>{...ok, 'amount_requested_vnd': 0},
        <String, Object?>{...ok, 'amount_requested_vnd': '5000'},
        <String, Object?>{...ok, 'can_report': 'yes'},
      ]) {
        expect(() => ShopPayment.fromJson(bad), throwsFormatException);
      }
    });
  });

  group('list and create', () {
    testWidgets('lists the requests with their state; an empty list says so; no word of a monthly plan anywhere', (WidgetTester tester) async {
      final FakePayments empty = FakePayments();
      await mount(tester, ShopPaymentListScreen(source: empty));
      expect(containing('Chưa có yêu cầu thanh toán'), findsOneWidget);
      final FakePayments source = FakePayments(items: <ShopPayment>[payment(), payment(id: 'req-2', purpose: ShopPaymentPurpose.accountOpening, state: ShopPaymentState.confirmed, received: 150000)]);
      await mount(tester, ShopPaymentListScreen(source: source));
      expect(containing('Mở rộng số món · 200.000đ'), findsOneWidget);
      expect(containing('Chưa báo chuyển khoản'), findsOneWidget);
      expect(containing('Đã nhận tiền'), findsOneWidget);
      final String all = tester.widgetList<Text>(find.byType(Text)).map((Text t) => t.data ?? '').join(' ').toLowerCase();
      for (final String word in <String>['thuê bao', 'gia hạn', 'pro tới', 'hết hạn']) {
        expect(all.contains(word), isFalse, reason: word);
      }
    });

    testWidgets('create sends the purpose and the typed amount with ONE key; a lost answer retried sends the SAME key; a refusal spends it', (WidgetTester tester) async {
      final FakePayments source = FakePayments();
      source.failNext = const M07Failure(M07FailureKind.offline);
      await mount(tester, ShopPaymentCreateScreen(source: source));
      await tester.enterText(key('payment-amount'), '200000');
      await tap(tester, key('purpose-MENU_EXPANSION'));
      await tap(tester, key('payment-submit'));
      expect(source.createKeys, hasLength(1));
      expect(source.items, isEmpty, reason: 'nothing exists until the server said so');
      expect(containing('Mất kết nối'), findsNothing);
      await tap(tester, key('payment-submit'));
      expect(source.createKeys, hasLength(2));
      expect(source.createKeys[1], source.createKeys[0], reason: 'a lost answer is retried with the same key');
      expect(source.items.single.purpose, ShopPaymentPurpose.menuExpansion);
      expect(source.items.single.amount, 200000);
      // The detail opens at once, still a plain request: nothing was paid and nothing was opened.
      expect(key('payment-status'), findsOneWidget);
      expect(containing('Chưa báo chuyển khoản'), findsWidgets);
    });

    testWidgets('an amount that is not a number is refused on the phone before anything is sent; the app has no price list', (WidgetTester tester) async {
      final FakePayments source = FakePayments();
      await mount(tester, ShopPaymentCreateScreen(source: source));
      await tap(tester, key('payment-submit'));
      expect(source.createKeys, isEmpty);
      expect(key('payment-create-error'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller?.text, '', reason: 'no default amount');
    });
  });

  group('one request', () {
    testWidgets('open and not reported: the real account is shown, "Tôi đã chuyển khoản" and cancel are offered', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      expect(key('payment-account-number'), findsOneWidget);
      expect(find.text('0123456789'), findsOneWidget);
      expect(containing('CONG TY 11SHIP'), findsOneWidget);
      expect(key('payment-report'), findsOneWidget);
      expect(key('payment-cancel'), findsOneWidget);
    });

    testWidgets('no receiving account configured: it says so and invents none', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()], accounts_: const <PaymentAccount>[]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      expect(key('payment-no-account'), findsOneWidget);
      expect(key('payment-account-number'), findsNothing);
    });

    testWidgets('the report asks first, sends ONE command with one key, and then says "Chờ kiểm tra": the money is not confirmed, the cancel is gone', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      await tap(tester, key('payment-report'));
      expect(source.reportKeys, isEmpty, reason: 'the question comes first');
      await tap(tester, key('dialog-no'));
      expect(source.reportKeys, isEmpty);
      await tap(tester, key('payment-report'));
      await tap(tester, key('dialog-yes'));
      expect(source.reportKeys, hasLength(1));
      expect(containing('Chờ kiểm tra'), findsWidgets);
      expect(containing('chưa phải là đã nhận tiền'), findsOneWidget);
      expect(find.text('Đã nhận tiền'), findsNothing);
      expect(key('payment-report'), findsNothing);
      expect(key('payment-cancel'), findsNothing, reason: 'after a report the money may be on its way: only the administration resolves it');
      expect(key('payment-reported-at'), findsOneWidget);
    });

    testWidgets('a lost answer to the report is retried with the SAME key; a definite refusal spends the key', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      source.failNext = const M07Failure(M07FailureKind.offline);
      await tap(tester, key('payment-report'));
      await tap(tester, key('dialog-yes'));
      expect(source.reportKeys, hasLength(1));
      expect(key('payment-action-failed'), findsOneWidget);
      expect(key('payment-report'), findsOneWidget, reason: 'still possible: nothing is known to have happened');
      await tap(tester, key('payment-report'));
      await tap(tester, key('dialog-yes'));
      expect(source.reportKeys, hasLength(2));
      expect(source.reportKeys[1], source.reportKeys[0]);
    });

    testWidgets('cancel works only before the report and closes the request', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      await tap(tester, key('payment-cancel'));
      await tap(tester, key('dialog-yes'));
      expect(source.cancelKeys, hasLength(1));
      expect(containing('Đã hủy'), findsWidgets);
      expect(key('payment-report'), findsNothing);
      expect(key('payment-account'), findsNothing);
    });

    testWidgets('after the administration recorded the money: the amount received is shown, nothing more is offered, and a granted right is shown only because the server says so', (WidgetTester tester) async {
      final FakePayments source = FakePayments(items: <ShopPayment>[payment(state: ShopPaymentState.confirmed, reportedAt: DateTime.utc(2026, 10, 25, 4), received: 180000, entitlement: true, version: 3)]);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      expect(key('payment-received'), findsOneWidget);
      expect(find.text('180.000đ'), findsOneWidget);
      expect(key('payment-entitlement'), findsOneWidget);
      expect(key('payment-report'), findsNothing);
      expect(key('payment-cancel'), findsNothing);
      expect(key('payment-account'), findsNothing);
      // The same request without a grant does not claim one: recording money opens nothing by itself.
      final FakePayments plain = FakePayments(items: <ShopPayment>[payment(state: ShopPaymentState.confirmed, reportedAt: DateTime.utc(2026, 10, 25, 4), received: 200000, version: 3)]);
      await mount(tester, ShopPaymentDetailScreen(source: plain, requestId: 'req-1'));
      expect(key('payment-entitlement'), findsNothing);
      expect(containing('thực hiện riêng'), findsOneWidget);
    });

    testWidgets('"Trao đổi thanh toán": the conversation is a card of the request; the owner writes while it is open; a closed request is read-only; a message says nothing about money', (WidgetTester tester) async {
      final SampleOrderChat chat = SampleOrderChat(role: ChatRole.shop);
      final FakePayments source = FakePayments(items: <ShopPayment>[payment()], chatApi: chat);
      await mount(tester, ShopPaymentDetailScreen(source: source, requestId: 'req-1'));
      expect(find.text('Trao đổi thanh toán'), findsOneWidget);
      expect(containing('Tin nhắn không xác nhận tiền'), findsOneWidget);
      await tester.enterText(key('chat-input'), 'Em đã chuyển khoản rồi ạ');
      await tap(tester, key('chat-send'));
      expect(chat.sends, 1);
      expect(find.text('Em đã chuyển khoản rồi ạ'), findsOneWidget);
      expect(source.items.single.stateLabel, 'Chưa báo chuyển khoản', reason: 'a message is not a report');
      // Closed: read-only with the payment wording (not the order's), and no retention line (the period is not decided).
      chat.open = false;
      await mount(tester, ShopPaymentDetailScreen(source: FakePayments(items: <ShopPayment>[payment(state: ShopPaymentState.rejected)], chatApi: chat), requestId: 'req-1'));
      expect(key('chat-closed'), findsOneWidget);
      expect(containing('Yêu cầu đã đóng'), findsOneWidget);
      expect(key('chat-retention'), findsNothing);
      expect(key('chat-input'), findsNothing);
    });
  });
}
