import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #199 on the Shipper's phone: "Tôi đã chuyển khoản" on a top-up request is ONE notice (the request stays pending, the wallet is untouched, only an Admin's
// confirmation adds money) and "Trao đổi thanh toán" is a card of the request's detail.

class ChatWallet extends SampleWalletSource {
  ChatWallet(this.api);

  final SampleOrderChat api;
  int reports = 0;

  @override
  OrderChatApi? get chat => api;

  @override
  Future<void> reportTransfer(String code) async {
    reports += 1;
    await super.reportTransfer(code);
  }
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 9000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Finder key(String value) => find.byKey(Key(value));

void main() {
  testWidgets('the report is asked first, sent once, shown as a notice; the balance, the request and the status stay as they were; the cancel is still allowed', (WidgetTester tester) async {
    final ChatWallet source = ChatWallet(SampleOrderChat(role: ChatRole.shipper));
    final WalletLoad<Wallet> before = await source.wallet();
    final TopupRequest created = await source.writes!.createTopup(100000);
    await mount(tester, TopupDetailScreen(source: source, code: created.code));
    expect(key('topup-reported-at'), findsNothing);
    await tap(tester, key('topup-report'));
    expect(source.reports, 0, reason: 'the question comes first');
    await tap(tester, key('confirm-no'));
    expect(source.reports, 0);
    await tap(tester, key('topup-report'));
    expect(find.widgetWithText(TextButton, 'Tôi đã chuyển khoản'), findsOneWidget, reason: 'the confirm button says what it does');
    await tap(tester, key('confirm-yes'));
    expect(source.reports, 1);
    expect(key('topup-reported-at'), findsOneWidget);
    expect(find.textContaining('Báo chuyển khoản chưa cộng tiền'), findsOneWidget);
    expect(key('topup-report'), findsNothing, reason: 'one mark per request');
    expect((await source.topup(created.code) as WalletReady<TopupRequest>).value.status, TopupStatus.pending);
    expect(((await source.wallet()) as WalletReady<Wallet>).value.total, (before as WalletReady<Wallet>).value.total, reason: 'a report never adds money');
  });

  testWidgets('"Trao đổi thanh toán" is a card of the request: the Shipper writes while it is open; the words are the payment ones', (WidgetTester tester) async {
    final SampleOrderChat chat = SampleOrderChat(role: ChatRole.shipper);
    final ChatWallet source = ChatWallet(chat);
    final TopupRequest created = await source.writes!.createTopup(100000);
    await mount(tester, TopupDetailScreen(source: source, code: created.code));
    expect(find.text('Trao đổi thanh toán'), findsOneWidget);
    expect(find.textContaining('Tin nhắn không xác nhận tiền'), findsOneWidget);
    await tester.enterText(key('chat-input'), 'Em đã chuyển khoản rồi');
    await tap(tester, key('chat-send'));
    expect(chat.sends, 1);
    expect(find.text('Em đã chuyển khoản rồi'), findsOneWidget);
    expect(source.reports, 0, reason: 'a message is not a report');
    expect((await source.topup(created.code) as WalletReady<TopupRequest>).value.reportedAt, isNull);
  });

  testWidgets('a source without a conversation (the not-wired one) shows no chat card', (WidgetTester tester) async {
    final SampleWalletSource source = SampleWalletSource();
    final TopupRequest created = await source.writes!.createTopup(100000);
    await mount(tester, TopupDetailScreen(source: source, code: created.code));
    expect(find.text('Trao đổi thanh toán'), findsNothing);
    expect(key('topup-report'), findsOneWidget);
  });
}
