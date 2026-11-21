import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #393: the customer's delivery map draws the STORED road the server gave the customer (its geometry is sent to the customer), and when there is no
// road it keeps the pins and says in words that there is no road yet. It never draws a straight line between the two points.

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
      deliveryId: 'cd-r1',
      code: 'GC-R1',
      source: 'CUSTOMER',
      state: DeliveryState.delivering,
      version: 1,
      pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.66, lng: 106.25),
      recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu', lat: 22.67, lng: 106.26),
      goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
      fee: const FeeView(mode: 'STANDARD', payer: 'CUSTOMER', status: 'FINAL', amountVnd: 15000),
      search: SearchView(startedAt: DateTime.utc(2026, 11, 15, 6), expiresAt: DateTime.utc(2026, 11, 15, 6, 30), serverNow: DateTime.utc(2026, 11, 15, 6, 5)),
      can: const <String>{},
      route: route,
    );

class _Customer extends SampleCustomerDeliverySource {
  _Customer(this._view);

  final DeliveryView _view;

  @override
  Future<DeliveryView> get(String id) async => _view;
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

/// Opens the customer's delivery detail and returns what its map was given (null when no map was built).
Future<({List<M07MapPin>? pins, List<List<double>>? road})> _mapOf(WidgetTester tester, DeliveryView view) async {
  List<M07MapPin>? pins;
  List<List<double>>? road;
  await mount(
    tester,
    CustomerDeliveryDetailScreen(
      source: _Customer(view),
      deliveryId: view.deliveryId,
      mapBuilder: (BuildContext context, List<M07MapPin> p, [List<List<double>> r = const <List<double>>[]]) {
        pins = p;
        road = r;
        return const SizedBox(key: Key('spy-map'), height: 10);
      },
    ),
  );
  return (pins: pins, road: road);
}

void main() {
  testWidgets('the stored road reaches the customer map with every point, and the pins stay', (WidgetTester tester) async {
    final ({List<M07MapPin>? pins, List<List<double>>? road}) map = await _mapOf(tester, _view(route: _route()));
    expect(map.road, isNotNull, reason: 'the customer map must be built for an active delivery with both points');
    expect(map.road!.length, 3, reason: 'a road that loses points is a wrong road');
    expect(map.road!.first, <double>[22.66, 106.25]);
    expect(map.road!.last, <double>[22.67, 106.26]);
    expect(map.pins!.length, 2);
    expect(find.byKey(const Key('m07-c-route-missing')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no stored road: the pins stay, no line is drawn, and the screen says there is no road yet', (WidgetTester tester) async {
    final ({List<M07MapPin>? pins, List<List<double>>? road}) map = await _mapOf(tester, _view());
    expect(map.road, isEmpty);
    expect(map.pins!.length, 2);
    expect(find.byKey(const Key('m07-c-route-missing')), findsOneWidget);
    expect(find.textContaining('Chưa có tuyến đường đi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
