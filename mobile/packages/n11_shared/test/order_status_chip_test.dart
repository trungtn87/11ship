import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

void main() {
  Future<void> show(WidgetTester tester, Widget chip) => tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: chip))));

  testWidgets('issue #260: an Administrator cancellation (shop status, end actor ADMIN) is never labelled as the shop cancelling', (WidgetTester tester) async {
    await show(tester, const OrderStatusChip(DisplayStatus.cancelledByShop, endActor: 'ADMIN'));
    expect(find.text('Quản trị viên đã hủy'), findsOneWidget);
    expect(find.text('Đã hủy'), findsNothing);
  });

  testWidgets('a cancellation by the shop (or no actor known) keeps the plain label, and other statuses ignore the actor', (WidgetTester tester) async {
    await show(tester, const OrderStatusChip(DisplayStatus.cancelledByShop, endActor: 'SHOP'));
    expect(find.text('Đã hủy'), findsOneWidget);
    await show(tester, const OrderStatusChip(DisplayStatus.cancelledByShop));
    expect(find.text('Đã hủy'), findsOneWidget);
    await show(tester, const OrderStatusChip(DisplayStatus.preparing, endActor: 'ADMIN'));
    expect(find.text('Quán đang chuẩn bị'), findsOneWidget);
  });
}
