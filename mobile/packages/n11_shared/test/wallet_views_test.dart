import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// M04 UI phase tests: money formatting, the available = total - held rule, the not-wired state (no number, writes disabled), the sample
// label on every screen, topup/withdraw validation, cancel rules, filters, and the rule that no UI action adds money.

/// A sample wallet whose profile status is whatever the test says, as the server reports it with the wallet.
class _StatusWallet extends SampleWalletSource {
  _StatusWallet(this.status) : super(held: 0);

  final String status;

  @override
  Future<WalletLoad<Wallet>> wallet() async => WalletReady<Wallet>(Wallet(total: 150000, held: 0, driverStatus: status));
}

class _Failing extends NotWiredWalletSource {
  const _Failing();

  @override
  Future<WalletLoad<Wallet>> wallet() async => WalletFailed<Wallet>('Máy chủ không phản hồi.');

  @override
  Future<WalletLoad<List<WalletTxn>>> recentTxns() async => const WalletEmpty<List<WalletTxn>>();
}

class _Reconcile extends SampleWalletSource {
  @override
  Future<WalletLoad<WithdrawalRequest>> withdrawal(String code) async =>
      WalletReady<WithdrawalRequest>(WithdrawalRequest(code: code, amount: 50000, createdAt: DateTime(2026, 10, 14, 9, 0), status: WithdrawalStatus.needsReconcile, account: kSampleAccount));
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 5200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pump();
  await tester.pump();
}

Future<void> tapKey(WidgetTester tester, String key) async {
  // A horizontally scrolling chip row can have the target off screen; bring it into view so the tap really lands.
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> typeKey(WidgetTester tester, String key, String text) async {
  await tester.enterText(find.byKey(Key(key)), text);
  await tester.pump();
}

/// Any Text that looks like an amount ("148.000đ", "-1.000đ").
Finder money() => find.byWidgetPredicate((Widget w) => w is Text && RegExp(r'\d+(\.\d{3})*đ').hasMatch(w.data ?? ''));

bool isDisabled(WidgetTester tester, String key) => tester.widget<N11Button>(find.byKey(Key(key))).onPressed == null;

Future<Wallet> readWallet(WidgetTester tester, WalletSource source) async {
  final WalletLoad<Wallet> state = (await tester.runAsync(() => source.wallet()))!;
  return (state as WalletReady<Wallet>).value;
}

void main() {
  group('money', () {
    test('formatWalletVnd groups thousands with dots and keeps the sign', () {
      expect(formatWalletVnd(0), '0đ');
      expect(formatWalletVnd(999), '999đ');
      expect(formatWalletVnd(100000), '100.000đ');
      expect(formatWalletVnd(1250000), '1.250.000đ');
      expect(formatWalletVnd(-1000), '-1.000đ');
      expect(formatWalletVndSigned(150000), '+150.000đ');
      expect(formatWalletVndSigned(-1000), '-1.000đ');
      expect(formatWalletVndSigned(0), '0đ');
    });

    test('available is always total - held', () {
      expect(const Wallet(total: 150000, held: 2000).available, 148000);
      expect(const Wallet(total: 0, held: 0).available, 0);
    });

    test('parseVndInput keeps digits only', () {
      expect(parseVndInput('100.000'), 100000);
      expect(parseVndInput(''), isNull);
      expect(parseVndInput('abc'), isNull);
    });

    test('status labels are the approved Vietnamese words', () {
      expect(TopupStatus.values.map(topupStatusLabel), <String>['Chờ xác nhận', 'Thành công', 'Từ chối', 'Đã hủy']);
      expect(WithdrawalStatus.values.map(withdrawalStatusLabel), <String>['Chờ xử lý', 'Đang xử lý', 'Cần đối soát', 'Hoàn thành', 'Đã hủy']);
    });

    test('holds and releases are not ledger movements: no sign', () {
      final DateTime t = DateTime(2026, 10, 15);
      expect(WalletTxn(id: 'a', type: TxnType.release, amount: 1000, at: t, status: TxnStatus.success, title: 'x').amountText, '1.000đ');
      expect(WalletTxn(id: 'b', type: TxnType.topup, amount: 1000, at: t, status: TxnStatus.success, title: 'x').amountText, '+1.000đ');
    });
  });

  group('not wired (real build)', () {
    testWidgets('home shows the reason, no figure, and disabled actions', (WidgetTester tester) async {
      await mount(tester, const WalletHomeScreen(source: NotWiredWalletSource()));
      expect(find.byKey(const Key('wallet-not-wired')), findsWidgets);
      expect(find.text(kWalletNotWiredReason), findsWidgets);
      expect(find.byKey(const Key('wallet-available')), findsNothing);
      expect(find.byKey(const Key('wallet-sample-banner')), findsNothing);
      expect(money(), findsNothing);
      expect(isDisabled(tester, 'wallet-topup-button'), isTrue);
      expect(find.byKey(const Key('wallet-withdraw-button')), findsNothing);
    });

    testWidgets('history, topup and withdraw say not wired and cannot write', (WidgetTester tester) async {
      await mount(tester, const TxnHistoryScreen(source: NotWiredWalletSource()));
      expect(find.byKey(const Key('wallet-not-wired')), findsOneWidget);
      expect(money(), findsNothing);

      await mount(tester, const TopupAmountScreen(source: NotWiredWalletSource()));
      expect(find.byKey(const Key('wallet-not-wired')), findsOneWidget);
      expect(isDisabled(tester, 'topup-continue'), isTrue);
      expect(find.byKey(const Key('topup-qr-placeholder')), findsNothing, reason: 'no QR without bank data');

      await mount(tester, const WithdrawScreen(source: NotWiredWalletSource()));
      expect(find.byKey(const Key('withdraw-available')), findsNothing);
      expect(isDisabled(tester, 'withdraw-submit'), isTrue);
    });

    testWidgets('a failed read shows the error with Thử lại', (WidgetTester tester) async {
      await mount(tester, const WalletHomeScreen(source: _Failing()));
      expect(find.byKey(const Key('wallet-failed')), findsOneWidget);
      expect(find.text('Máy chủ không phản hồi.'), findsOneWidget);
      expect(find.byKey(const Key('wallet-retry')), findsOneWidget);
      expect(find.byKey(const Key('wallet-available')), findsNothing);
    });
  });

  group('sample data is always labelled', () {
    testWidgets('every one of the seven screens shows "Dữ liệu minh họa"', (WidgetTester tester) async {
      final SampleWalletSource source = SampleWalletSource();
      final List<Widget> screens = <Widget>[
        WalletHomeScreen(source: source),
        TopupAmountScreen(source: source),
        TopupConfirmScreen(source: source, amount: 100000, info: kSampleTransfer),
        TopupDetailScreen(source: source, code: 'NP202610150001'),
        WithdrawScreen(source: source),
        WithdrawDetailScreen(source: source, code: 'RT202610120001'),
        TxnHistoryScreen(source: source),
      ];
      for (final Widget screen in screens) {
        await mount(tester, screen);
        expect(find.byKey(const Key('wallet-sample-banner')), findsOneWidget, reason: '${screen.runtimeType}');
        expect(find.text(kSampleLabel), findsOneWidget, reason: '${screen.runtimeType}');
      }
    });

    testWidgets('home shows B, H and A = B - H', (WidgetTester tester) async {
      await mount(tester, WalletHomeScreen(source: SampleWalletSource()));
      expect(tester.widget<Text>(find.byKey(const Key('wallet-available'))).data, '148.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('wallet-total'))).data, '150.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('wallet-held'))).data, '2.000đ');
      expect(find.text('Giao dịch gần đây'), findsOneWidget);
    });
  });

  group('topup', () {
    testWidgets('below the minimum is refused, the minimum goes on to the confirmation', (WidgetTester tester) async {
      await mount(tester, TopupAmountScreen(source: SampleWalletSource()));
      expect(find.byKey(const Key('topup-request-first-note')), findsOneWidget);
      await typeKey(tester, 'topup-amount', '50000');
      await tapKey(tester, 'topup-continue');
      expect(find.text('Số tiền nạp tối thiểu 100.000đ.'), findsOneWidget);
      expect(find.byKey(const Key('topup-submit')), findsNothing);

      await typeKey(tester, 'topup-amount', '100000');
      await tapKey(tester, 'topup-continue');
      expect(find.byKey(const Key('topup-submit')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('confirm-amount'))).data, '100.000đ');
      expect(find.byKey(const Key('topup-confirm-notice')), findsOneWidget);
    });

    testWidgets('"Tôi đã chuyển tiền" and "Gửi yêu cầu" only create a pending request: the balance never changes', (WidgetTester tester) async {
      final SampleWalletSource source = SampleWalletSource();
      await mount(tester, WalletHomeScreen(source: source));
      await tapKey(tester, 'wallet-topup-button');
      await typeKey(tester, 'topup-amount', '150000');
      await tapKey(tester, 'topup-continue');
      await tapKey(tester, 'topup-submit');
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Chờ xác nhận');
      expect(find.byKey(const Key('topup-cancel')), findsOneWidget);
      // The transfer details belong to the created request.
      expect(find.byKey(const Key('topup-transfer-card')), findsOneWidget);
      expect(find.byKey(const Key('topup-qr-placeholder')), findsOneWidget);

      final Wallet after = await readWallet(tester, source);
      expect(after.total, 150000);
      expect(after.held, 2000);
      expect(after.available, 148000);
    });

    testWidgets('a confirmed topup has no cancel button; a pending one cancels', (WidgetTester tester) async {
      final SampleWalletSource source = SampleWalletSource();
      await mount(tester, TopupDetailScreen(source: source, code: 'NP202610150001'));
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Thành công');
      expect(find.byKey(const Key('topup-cancel')), findsNothing);

      final TopupRequest pending = (await tester.runAsync(() => source.createTopup(120000)))!;
      await mount(tester, TopupDetailScreen(source: source, code: pending.code));
      expect(find.byKey(const Key('topup-cancel')), findsOneWidget);
      await tapKey(tester, 'topup-cancel');
      await tapKey(tester, 'confirm-yes');
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Đã hủy');
      expect(find.byKey(const Key('topup-cancel')), findsNothing);
    });
  });

  group('withdraw', () {
    testWidgets('only the whole balance can be withdrawn, from the closing flow: no amount field, no minimum, a request holds it all and debits nothing', (WidgetTester tester) async {
      final SampleWalletSource source = SampleWalletSource(held: 0);
      await mount(tester, WithdrawScreen(source: source, closing: true));
      expect(tester.widget<Text>(find.byKey(const Key('withdraw-available'))).data, '150.000đ');
      expect(find.byKey(const Key('withdraw-amount')), findsNothing);
      expect(find.byKey(const Key('withdraw-verified-note')), findsOneWidget);
      expect(find.text('•••• 1098'), findsOneWidget, reason: 'only the masked number');
      expect(isDisabled(tester, 'withdraw-submit'), isFalse);
      await tapKey(tester, 'withdraw-submit');
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Chờ xử lý');
      expect(find.byKey(const Key('withdraw-cancel')), findsOneWidget);

      final Wallet reserved = await readWallet(tester, source);
      expect(reserved.total, 150000, reason: 'nothing is debited until paid');
      expect(reserved.held, 150000);
      expect(reserved.available, 0);
    });

    testWidgets('a small balance is still returned (no minimum), a zero balance asks for nothing, and money on hold waits', (WidgetTester tester) async {
      await mount(tester, WithdrawScreen(source: SampleWalletSource(total: 5000, held: 0), closing: true));
      expect(tester.widget<Text>(find.byKey(const Key('withdraw-available'))).data, '5.000đ');
      expect(isDisabled(tester, 'withdraw-submit'), isFalse);

      await mount(tester, WithdrawScreen(key: UniqueKey(), source: SampleWalletSource(total: 0, held: 0), closing: true));
      expect(find.byKey(const Key('withdraw-zero-note')), findsOneWidget);
      expect(isDisabled(tester, 'withdraw-submit'), isTrue);

      await mount(tester, WithdrawScreen(key: UniqueKey(), source: SampleWalletSource(), closing: true));
      expect(find.byKey(const Key('withdraw-held-note')), findsOneWidget);
    });

    testWidgets('outside the closing flow (a stale route or a direct open) there is no form at all, only why', (WidgetTester tester) async {
      await mount(tester, WithdrawScreen(source: SampleWalletSource()));
      expect(find.byKey(const Key('withdraw-blocked')), findsOneWidget);
      expect(find.byKey(const Key('withdraw-submit')), findsNothing);
      expect(find.byKey(const Key('withdraw-amount')), findsNothing);
    });

    testWidgets('the server status wins: a screen opened as closing still refuses when the profile is not CLOSING', (WidgetTester tester) async {
      await mount(tester, WithdrawScreen(source: _StatusWallet('ACTIVE'), closing: true));
      expect(find.byKey(const Key('withdraw-blocked')), findsOneWidget);
      expect(find.byKey(const Key('withdraw-submit')), findsNothing);
    });

    testWidgets('CLOSING hides new top-ups with the reason but keeps balance and history', (WidgetTester tester) async {
      await mount(tester, WalletHomeScreen(source: _StatusWallet('CLOSING')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('wallet-topup-closing-note')), findsOneWidget);
      expect(isDisabled(tester, 'wallet-topup-button'), isTrue);
      expect(find.byKey(const Key('wallet-card')), findsOneWidget);
      expect(find.byKey(const Key('wallet-withdraw-button')), findsNothing);
      await mount(tester, TopupAmountScreen(key: UniqueKey(), source: _StatusWallet('CLOSING')));
      expect(find.byKey(const Key('topup-closing-banner')), findsOneWidget);
      expect(isDisabled(tester, 'topup-continue'), isTrue);
    });

    testWidgets('cancel is offered only while pending and releases the hold', (WidgetTester tester) async {
      final SampleWalletSource source = SampleWalletSource();
      await mount(tester, WithdrawDetailScreen(source: source, code: 'RT202610120001'));
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Hoàn thành');
      expect(find.byKey(const Key('withdraw-cancel')), findsNothing);

      final WithdrawalRequest created = (await tester.runAsync(() => source.createWithdrawal(30000)))!;
      await mount(tester, WithdrawDetailScreen(source: source, code: created.code));
      await tapKey(tester, 'withdraw-cancel');
      await tapKey(tester, 'confirm-yes');
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Đã hủy');
      expect(find.byKey(const Key('withdraw-cancel')), findsNothing);
      expect((await readWallet(tester, source)).held, 2000);
    });

    testWidgets('needs-reconcile is shown as its own step, never hidden', (WidgetTester tester) async {
      await mount(tester, WithdrawDetailScreen(source: _Reconcile(), code: 'RT1'));
      expect(tester.widget<Text>(find.byKey(const Key('status-label'))).data, 'Cần đối soát');
      expect(find.text('Cần đối soát'), findsNWidgets(2), reason: 'status card and progress step');
      expect(find.text('Hoàn thành'), findsNothing);
      expect(find.byKey(const Key('withdraw-cancel')), findsNothing);
    });
  });

  group('history', () {
    testWidgets('filters narrow the list', (WidgetTester tester) async {
      await mount(tester, TxnHistoryScreen(source: SampleWalletSource()));
      for (final String id in <String>['t1', 't2', 't3', 't4', 't5', 't6']) {
        expect(find.byKey(Key('txn-$id')), findsOneWidget, reason: id);
      }
      await tapKey(tester, 'txn-filter-hold');
      expect(find.byKey(const Key('txn-t3')), findsOneWidget);
      expect(find.byKey(const Key('txn-t4')), findsOneWidget);
      expect(find.byKey(const Key('txn-t1')), findsNothing);
      await tapKey(tester, 'txn-filter-commission');
      expect(find.byKey(const Key('txn-t2')), findsOneWidget);
      expect(find.byKey(const Key('txn-t3')), findsNothing);
      await tapKey(tester, 'txn-filter-withdraw');
      expect(find.byKey(const Key('txn-t5')), findsOneWidget);
      expect(find.byKey(const Key('txn-t6')), findsNothing);
      await tapKey(tester, 'txn-filter-topup');
      expect(find.byKey(const Key('txn-t1')), findsOneWidget);
      expect(find.byKey(const Key('txn-t6')), findsOneWidget);
    });

    testWidgets('a released hold is neutral, not a deposit; a topup is +', (WidgetTester tester) async {
      await mount(tester, TxnHistoryScreen(source: SampleWalletSource()));
      expect(tester.widget<Text>(find.byKey(const Key('txn-amount-t4'))).data, '1.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('txn-amount-t3'))).data, '2.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('txn-amount-t1'))).data, '+150.000đ');
      expect(tester.widget<Text>(find.byKey(const Key('txn-amount-t2'))).data, '-1.000đ');
      expect(find.text('Giải phóng tạm giữ'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('txn-amount-t4'))).style?.color, N11Colors.black, reason: 'not green like a deposit');
    });

    testWidgets('tapping a row opens its detail sheet', (WidgetTester tester) async {
      await mount(tester, TxnHistoryScreen(source: SampleWalletSource()));
      await tapKey(tester, 'txn-t4');
      expect(find.byKey(const Key('txn-sheet')), findsOneWidget);
      expect(find.text('Tạm giữ là thông tin giữ chỗ, không phải khoản trừ trong sổ giao dịch.'), findsOneWidget);
    });
  });
}
