import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// #394 Orders tab (Shipper): the three filters sit on ONE row, and a single delivery card is stretched across the content width (left aligned),
// never centred or shrunk to its text. Layout only; data, polling and actions are unchanged.

DeliveryView _mine(String id) {
  final DateTime now = DateTime.utc(2026, 11, 18, 9);
  return DeliveryView(
    deliveryId: id,
    code: 'G-$id',
    source: 'DIRECT',
    state: DeliveryState.accepted,
    version: 1,
    pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.665, lng: 106.257),
    recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu'),
    goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
    fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'),
    search: SearchView(startedAt: now.subtract(const Duration(minutes: 3)), expiresAt: now.add(const Duration(minutes: 27)), serverNow: now),
    can: const <String>{},
  );
}

class _OneMine extends SampleShipperSource {
  _OneMine(this._items);
  final List<DeliveryView> _items;

  @override
  Future<List<DeliveryView>> mine({required bool history}) async => _items;
}

Future<void> _mount(WidgetTester tester, Widget body, {double textScale = 1.0}) async {
  // A 360 x 800 dp phone, the narrow Android width the Owner checks.
  tester.view.physicalSize = const Size(360 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    builder: (BuildContext context, Widget? child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    // The app's 16 dp content gutter on each side, as on the real shell.
    home: Scaffold(body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: body))),
  ));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

void main() {
  for (final double scale in <double>[1.0, 1.3]) {
    testWidgets('the three Orders filters share one row at text scale $scale', (WidgetTester tester) async {
      await _mount(tester, ShipperDeliveryHub(source: SampleShipperSource()), textScale: scale);
      final double top = tester.getTopLeft(find.byKey(const Key('m07-ship-tab-mine'))).dy;
      expect(tester.getTopLeft(find.byKey(const Key('m07-ship-tab-offers'))).dy, top);
      expect(tester.getTopLeft(find.byKey(const Key('m07-ship-tab-history'))).dy, top);
      // Whether the labels fit one row without scrolling depends on the real font; the test font (Ahem) is square, so that is checked on the device.
      expect(tester.takeException(), isNull);
      await _unmount(tester);
    });
  }

  testWidgets('the filters still switch the list at a large text scale', (WidgetTester tester) async {
    await _mount(tester, ShipperDeliveryHub(source: SampleShipperSource()), textScale: 1.3);
    await tester.ensureVisible(find.byKey(const Key('m07-ship-tab-history')));
    await tester.tap(find.byKey(const Key('m07-ship-tab-history')));
    for (int i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
    expect(find.text('Chưa có lịch sử giao hàng'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _unmount(tester);
  });

  testWidgets('one delivery is stretched across the content width, aligned to the left edge', (WidgetTester tester) async {
    await _mount(tester, ShipperDeliveryHub(source: _OneMine(<DeliveryView>[_mine('d1')])));
    final Rect card = tester.getRect(find.byKey(const Key('m07-mine-d1')));
    // Content gutter of the 360 dp test screen: 16 dp each side, so the content spans x 16..344.
    expect(card.left, closeTo(16, 0.5), reason: 'card must start at the left content edge, not be centred');
    expect(card.right, closeTo(344, 0.5), reason: 'card must span the full content width');
    expect(tester.takeException(), isNull);
    await _unmount(tester);
  });
}
