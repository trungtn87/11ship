import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #393: the shop's delivery panel of an Order draws the STORED road (the server sends its geometry to the shop) on the shipper map, and draws no line
// when there is none. Nothing is drawn between two points by the app itself.

// Standard polyline encoding at precision 6, only to build the stored geometry for the test.
String _encode6(List<List<double>> points) {
  final StringBuffer out = StringBuffer();
  int prevLat = 0;
  int prevLng = 0;
  void value(int v) {
    int x = v < 0 ? ~(v << 1) : (v << 1);
    while (x >= 0x20) {
      out.writeCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out.writeCharCode(x + 63);
  }

  for (final List<double> p in points) {
    final int lat = (p[0] * 1000000).round();
    final int lng = (p[1] * 1000000).round();
    value(lat - prevLat);
    value(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out.toString();
}

OrderRoute _route() => OrderRoute.fromJson(<String, Object?>{
      'status': 'ROUTE',
      'distance_m': 3200,
      'duration_s': 720,
      'route_version': 'm14-1',
      'geometry': _encode6(<List<double>>[
        <double>[22.66, 106.25],
        <double>[22.665, 106.255],
        <double>[22.67, 106.26],
      ]),
    })!;

DeliveryView _view({OrderRoute? route}) => DeliveryView(
      deliveryId: 'sd-r1',
      code: 'G-SR1',
      source: 'ORDER',
      state: DeliveryState.delivering,
      version: 1,
      pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.66, lng: 106.25),
      recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu', lat: 22.67, lng: 106.26),
      goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
      fee: const FeeView(mode: 'STANDARD', payer: 'SHOP', status: 'FINAL', amountVnd: 15000),
      search: SearchView(startedAt: DateTime.utc(2026, 11, 15, 6), expiresAt: DateTime.utc(2026, 11, 15, 6, 30), serverNow: DateTime.utc(2026, 11, 15, 6, 5)),
      can: const <String>{},
      location: LocationView(lat: 22.663, lng: 106.252, recordedAt: DateTime.utc(2026, 11, 15, 6), ageSeconds: 5, freshness: Freshness.live),
      route: route,
    );

Future<List<List<double>>?> _pumpPanel(WidgetTester tester, DeliveryView view) async {
  List<List<double>>? road;
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(
      body: SingleChildScrollView(
        child: ShopDeliveryPanel(
          source: SampleShopSource(),
          delivery: view,
          onChanged: () async {},
          mapBuilder: (BuildContext context, List<M07MapPin> pins, [List<List<double>> r = const <List<double>>[]]) {
            road = r;
            return const SizedBox(key: Key('spy-map'), height: 10);
          },
        ),
      ),
    ),
  ));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
  return road;
}

void main() {
  testWidgets('the shop map of an Order delivery draws the stored road with every point', (WidgetTester tester) async {
    final List<List<double>>? road = await _pumpPanel(tester, _view(route: _route()));
    expect(road, isNotNull, reason: 'the shipper position map is shown for a live Order delivery');
    expect(road!.length, 3, reason: 'a road that loses points is a wrong road');
    expect(tester.takeException(), isNull);
  });

  testWidgets('issue #393: without a stored road the shop map draws no line and no error', (WidgetTester tester) async {
    final List<List<double>>? road = await _pumpPanel(tester, _view());
    expect(road, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
