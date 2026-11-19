import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #191 (18/11 update): the shipper's order detail is three cards in this order — "Người gửi & nhận" (one name, one number and one Gọi per
// party), "Thông tin đơn" (goods, money, map, stored road) and "Trao đổi đơn hàng" — with "Xử lý sự cố" last and closed by default. The incident help
// carries no second "Gọi Khách": the recipient's Gọi sits in the first card.

DeliveryView _view({DeliveryState state = DeliveryState.delivering}) => DeliveryView(
      deliveryId: 'r-191',
      code: 'G-TP6ZDS',
      source: 'ORDER',
      state: state,
      version: 1,
      pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.66, lng: 106.25),
      recipient: const RecipientView(name: 'Người nhận Mẫu', phone: '0900000002', addressText: 'Số 9 Phố Mẫu', lat: 22.67, lng: 106.26),
      goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
      fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'),
      search: SearchView(startedAt: DateTime.utc(2026, 11, 15, 6), expiresAt: DateTime.utc(2026, 11, 15, 6, 30), serverNow: DateTime.utc(2026, 11, 15, 6, 5)),
      can: const <String>{'complete'},
    );

class _Holding extends SampleShipperSource {
  _Holding(this._view);

  final DeliveryView _view;

  @override
  Future<DeliveryView> get(String id) async => _view;
}

Future<void> mount(WidgetTester tester, Widget screen, {double width = 360, double textScale = 1.0}) async {
  tester.view.physicalSize = Size(width * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    builder: (BuildContext context, Widget? child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: screen,
  ));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

double _top(WidgetTester tester, Finder f) => tester.getTopLeft(f).dy;

void main() {
  testWidgets('three cards in order, then the incident help last and closed by default', (WidgetTester tester) async {
    await mount(tester, ShipperDeliveryDetailScreen(source: _Holding(_view()), deliveryId: 'r-191'));

    final Finder parties = find.byKey(const Key('section-ship-parties'));
    final Finder info = find.byKey(const Key('section-ship-order-info'));
    final Finder incident = find.text('Hướng dẫn xử lý sự cố');
    expect(parties, findsOneWidget);
    expect(info, findsOneWidget);
    expect(incident, findsOneWidget);
    expect(_top(tester, parties) < _top(tester, info), isTrue, reason: 'parties card above the order card');
    expect(_top(tester, info) < _top(tester, incident), isTrue, reason: 'incident help below the order card');
    expect(find.text('Không liên lạc được đối tác/khách'), findsNothing, reason: 'incident help is closed by default');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the incident help opens on tap and closes again; the recipient call is the only customer call', (WidgetTester tester) async {
    await mount(tester, ShipperDeliveryDetailScreen(source: _Holding(_view()), deliveryId: 'r-191'));

    await tester.ensureVisible(find.text('Hướng dẫn xử lý sự cố'));
    await tester.tap(find.text('Hướng dẫn xử lý sự cố'));
    await tester.pump();
    expect(find.text('Không liên lạc được đối tác/khách'), findsOneWidget);
    expect(find.text('Gọi Khách'), findsNothing, reason: 'no duplicate customer call in the incident help');

    await tester.tap(find.text('Hướng dẫn xử lý sự cố'));
    await tester.pump();
    expect(find.text('Không liên lạc được đối tác/khách'), findsNothing);

    expect(find.byKey(const Key('quick-call-người nhận')), findsOneWidget, reason: 'one customer call, on the recipient');
    expect(find.text('Người nhận Mẫu'), findsOneWidget, reason: 'the recipient name appears once');
    expect(find.byKey(const Key('party-người nhận-phone')), findsOneWidget, reason: 'the recipient number appears once');
    expect(tester.takeException(), isNull);
  });

  for (final double scale in <double>[1.0, 1.3]) {
    testWidgets('360dp, font scale $scale: no overflow, cards and incident help render', (WidgetTester tester) async {
      await mount(tester, ShipperDeliveryDetailScreen(source: _Holding(_view()), deliveryId: 'r-191'), width: 360, textScale: scale);
      expect(find.byKey(const Key('section-ship-parties')), findsOneWidget);
      expect(find.byKey(const Key('section-ship-order-info')), findsOneWidget);
      await tester.ensureVisible(find.text('Hướng dẫn xử lý sự cố'));
      await tester.tap(find.text('Hướng dẫn xử lý sự cố'));
      await tester.pump();
      expect(find.text('Không liên lạc được đối tác/khách'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
