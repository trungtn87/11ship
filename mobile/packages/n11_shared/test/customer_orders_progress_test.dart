import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// #433/#434: the customer's order list (Figma F03A mẫu 3). Covers the status → progress mapper, the single-row filters with the real counts,
// navigation back to the list, 0/1/many and long data, loading/error/retry, and layout at 360/390/430dp with a 1.3x font scale.

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> mountList(WidgetTester tester, OrderRuntime runtime, {double width = 390, double textScale = 1}) async {
  tester.view.physicalSize = Size(width * 3, 2600);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    builder: (BuildContext context, Widget? child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child!),
    home: Scaffold(body: SingleChildScrollView(child: CustomerOrdersView(runtime: runtime))),
  ));
  await settle(tester);
}

Future<void> tapKey(WidgetTester tester, Key k) async {
  await tester.tap(find.byKey(k));
  await settle(tester);
}

OrderRuntime runtimeWith(CustomerOrderSource customer) => OrderRuntime(customer: customer, shop: SampleShopOrders(SampleOrderStore()), cart: CartController(source: customer));

/// A customer source whose list is given by the test (synthetic data, long text, failures), counting each request.
class _ListSource extends SampleCustomerOrders {
  _ListSource(this.rows, {this.failFirst = false}) : super(SampleOrderStore());

  final Map<CustomerScope, List<OrderSummary>> rows;
  final bool failFirst;
  int calls = 0;

  @override
  Future<List<OrderSummary>> list(CustomerScope scope) async {
    calls++;
    if (failFirst && calls == 1) throw const M07Failure(M07FailureKind.offline);
    return rows[scope] ?? const <OrderSummary>[];
  }
}

OrderSummary order(String id, {DisplayStatus status = DisplayStatus.awaitingShop, String code = 'K02-0006', String shop = 'bv tỉnh', int lines = 2, int items = 150000, DateTime? scheduledFor}) => OrderSummary(
      orderId: id,
      code: code,
      display: status,
      version: 1,
      shopName: shop,
      recipientName: 'Khách',
      lineCount: lines,
      itemsVnd: items,
      scheduledFor: scheduledFor,
      edited: false,
      needsAttention: false,
      createdAt: DateTime(2026, 11, 21, 12, 27),
    );

Finder progressOf(String id) => find.byKey(Key('order-progress-$id'));

void main() {
  group('status → progress mapper', () {
    test('every server status has a defined mapping; ended-without-completion has none', () {
      expect(customerProgressOf(DisplayStatus.awaitingShop)!.steps, <OrderStepState>[OrderStepState.waiting, OrderStepState.pending, OrderStepState.pending]);
      expect(customerProgressOf(DisplayStatus.preparing)!.steps, <OrderStepState>[OrderStepState.done, OrderStepState.current, OrderStepState.pending]);
      for (final DisplayStatus s in <DisplayStatus>[DisplayStatus.searchingShipper, DisplayStatus.shipperComing, DisplayStatus.delivering]) {
        expect(customerProgressOf(s)!.steps, <OrderStepState>[OrderStepState.done, OrderStepState.done, OrderStepState.current], reason: s.name);
      }
      for (final DisplayStatus s in <DisplayStatus>[DisplayStatus.searchStopped, DisplayStatus.deliveryFailed]) {
        expect(customerProgressOf(s)!.steps.last, OrderStepState.stalled, reason: s.name);
      }
      expect(customerProgressOf(DisplayStatus.completed)!.steps, everyElement(OrderStepState.done));
      for (final DisplayStatus s in <DisplayStatus>[DisplayStatus.cancelledByCustomer, DisplayStatus.cancelledByShop, DisplayStatus.cancelledBySystem, DisplayStatus.rejected, DisplayStatus.notCompleted]) {
        expect(customerProgressOf(s), isNull, reason: '${s.name} must not draw progress');
      }
    });

    test('waiting for the shop never shows a finished step; a cancelled order never reads as delivered', () {
      final CustomerOrderProgress waiting = customerProgressOf(DisplayStatus.awaitingShop)!;
      expect(waiting.steps.contains(OrderStepState.done), isFalse);
      expect(customerProgressOf(DisplayStatus.cancelledByShop), isNull);
      expect(customerProgressOf(DisplayStatus.cancelledBySystem), isNull);
      expect(customerProgressOf(DisplayStatus.rejected), isNot(customerProgressOf(DisplayStatus.completed)));
    });

    test('an older READY reads as PREPARING (no fourth step exists)', () {
      expect(displayStatusOf('READY'), DisplayStatus.preparing);
    });
  });

  group('list', () {
    testWidgets('filters stay on one row; the selected one is marked; the section title shows the real count', (WidgetTester tester) async {
      final _ListSource source = _ListSource(<CustomerScope, List<OrderSummary>>{
        CustomerScope.processing: <OrderSummary>[order('a'), order('b', status: DisplayStatus.preparing)],
        CustomerScope.scheduled: <OrderSummary>[order('c', scheduledFor: DateTime(2026, 11, 22, 9))],
      });
      await mountList(tester, runtimeWith(source));
      final double y = tester.getTopLeft(find.byKey(const Key('orders-tab-processing'))).dy;
      expect(tester.getTopLeft(find.byKey(const Key('orders-tab-scheduled'))).dy, y);
      expect(tester.getTopLeft(find.byKey(const Key('orders-tab-history'))).dy, y);
      expect(find.text('Đang xử lý (2)'), findsOneWidget);
      expect(find.byIcon(Icons.check), findsWidgets);
      await tapKey(tester, const Key('orders-tab-scheduled'));
      expect(find.text('Đơn hẹn (1)'), findsOneWidget);
      expect(find.byKey(const Key('order-card-c')), findsOneWidget);
      expect(find.byKey(const Key('order-card-a')), findsNothing);
    });

    testWidgets('0 orders: the empty state, no count; 1 order: "(1)"', (WidgetTester tester) async {
      await mountList(tester, runtimeWith(_ListSource(<CustomerScope, List<OrderSummary>>{CustomerScope.processing: <OrderSummary>[]})));
      expect(find.text('Chưa có đơn đang xử lý'), findsOneWidget);
      expect(find.byType(OrderSummaryCard), findsNothing);
      await mountList(tester, runtimeWith(_ListSource(<CustomerScope, List<OrderSummary>>{CustomerScope.processing: <OrderSummary>[order('a')]})));
      expect(find.text('Đang xử lý (1)'), findsOneWidget);
    });

    testWidgets('waiting order: the first step is a ring, no check mark inside its progress', (WidgetTester tester) async {
      await mountList(tester, runtimeWith(_ListSource(<CustomerScope, List<OrderSummary>>{CustomerScope.processing: <OrderSummary>[order('a')]})));
      expect(find.descendant(of: progressOf('a'), matching: find.byIcon(Icons.check)), findsNothing);
      expect(find.text('Chờ quán xác nhận'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('Xác nhận: đang chờ')), findsWidgets);
    });

    testWidgets('a completed order shows all three checks; a cancelled one shows no progress at all', (WidgetTester tester) async {
      final _ListSource source = _ListSource(<CustomerScope, List<OrderSummary>>{
        CustomerScope.processing: <OrderSummary>[order('done', status: DisplayStatus.completed), order('gone', status: DisplayStatus.cancelledByShop)],
      });
      await mountList(tester, runtimeWith(source));
      expect(find.descendant(of: progressOf('done'), matching: find.byIcon(Icons.check)), findsNWidgets(3));
      expect(progressOf('gone'), findsNothing);
      expect(find.text('Đã hủy'), findsOneWidget);
    });

    testWidgets('long shop name and code do not overflow at 360dp with a 1.3x font', (WidgetTester tester) async {
      final String longShop = 'Quán Cơm Gà Cao Bằng và trà sữa siêu dài ' * 4;
      await mountList(tester, runtimeWith(_ListSource(<CustomerScope, List<OrderSummary>>{CustomerScope.processing: <OrderSummary>[order('a', code: 'K19-0006-LONG-CODE-VALUE', shop: longShop, items: 12345678)]})), width: 360, textScale: 1.3);
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('order-card-a')), findsOneWidget);
    });

    for (final double width in <double>[360, 390, 430]) {
      testWidgets('layout at ${width.toInt()}dp with 1.3x font: three filters, cards and tab bar lay out without overflow', (WidgetTester tester) async {
        await mountList(
          tester,
          runtimeWith(_ListSource(<CustomerScope, List<OrderSummary>>{
            CustomerScope.processing: <OrderSummary>[order('a'), order('b', status: DisplayStatus.delivering, lines: 1, items: 45000)],
          })),
          width: width,
          textScale: 1.3,
        );
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('order-card-a')), findsOneWidget);
        expect(find.byKey(const Key('order-card-b')), findsOneWidget);
      });
    }

    testWidgets('a failed load shows the error and "Thử lại" makes ONE new request; the screen then shows the list', (WidgetTester tester) async {
      final _ListSource source = _ListSource(<CustomerScope, List<OrderSummary>>{CustomerScope.processing: <OrderSummary>[order('a')]}, failFirst: true);
      await mountList(tester, runtimeWith(source));
      expect(source.calls, 1);
      expect(find.byKey(const Key('m07-retry')), findsOneWidget);
      await tapKey(tester, const Key('m07-retry'));
      expect(source.calls, 2);
      expect(find.byKey(const Key('order-card-a')), findsOneWidget);
    });

    testWidgets('back from the order detail keeps the chosen filter and reloads the list once', (WidgetTester tester) async {
      final _ListSource source = _ListSource(<CustomerScope, List<OrderSummary>>{
        CustomerScope.scheduled: <OrderSummary>[order('c', scheduledFor: DateTime(2026, 11, 22, 9))],
      });
      final OrderRuntime runtime = runtimeWith(source);
      await mountList(tester, runtime);
      await tapKey(tester, const Key('orders-tab-scheduled'));
      final int before = source.calls;
      await tester.tap(find.byKey(const Key('order-card-c')));
      await settle(tester);
      Navigator.of(tester.element(find.byType(CustomerOrderDetailScreen))).pop();
      await settle(tester);
      expect(find.text('Đơn hẹn (1)'), findsOneWidget);
      expect(source.calls, before + 1);
    });
  });
}
