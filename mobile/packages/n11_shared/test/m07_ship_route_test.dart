import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// The Shipper's delivery detail draws the STORED road (P6-3/P6-5a) only while this Shipper holds the delivery, and says its distance only together with
// that road. A DIRECT call, an old record (legacy) and a delivery the Shipper no longer holds draw no line and attach no distance. Nothing is an error.

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

OrderRoute _route({bool geometry = true}) => OrderRoute.fromJson(<String, Object?>{
      'status': 'ROUTE',
      'distance_m': 3200,
      'duration_s': 720,
      'route_version': 'm14-1',
      if (geometry)
        'geometry': _encode6(<List<double>>[
          <double>[22.66, 106.25],
          <double>[22.665, 106.255],
          <double>[22.67, 106.26],
        ]),
    })!;

DeliveryView _view({DeliveryState state = DeliveryState.delivering, OrderRoute? route, bool legacy = false, List<List<double>> reference = const <List<double>>[]}) => DeliveryView(
      deliveryId: 'r-1',
      code: 'G-R1',
      source: 'ORDER',
      state: state,
      version: 1,
      pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.66, lng: 106.25),
      recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu', lat: 22.67, lng: 106.26),
      goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
      fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'),
      search: SearchView(startedAt: DateTime.utc(2026, 11, 15, 6), expiresAt: DateTime.utc(2026, 11, 15, 6, 30), serverNow: DateTime.utc(2026, 11, 15, 6, 5)),
      can: const <String>{'complete'},
      route: route,
      legacyReferenceOnly: legacy,
      referencePoints: reference,
    );

class _Holding extends SampleShipperSource {
  _Holding(this._view);

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

/// Opens the map section (its content is built only when it is open) and returns what the map builder was given.
Future<({int calls, List<List<double>>? road})> _openMap(WidgetTester tester, DeliveryView view) async {
  int calls = 0;
  List<List<double>>? road;
  await mount(
    tester,
    ShipperDeliveryDetailScreen(
      source: _Holding(view),
      deliveryId: view.deliveryId,
      mapBuilder: (BuildContext context, List<M07MapPin> pins, [List<List<double>> r = const <List<double>>[]]) {
        calls++;
        road = r;
        return const SizedBox(key: Key('spy-map'), height: 10);
      },
    ),
  );
  await tester.ensureVisible(find.text('Bản đồ giao hàng'));
  await tester.tap(find.text('Bản đồ giao hàng'));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
  return (calls: calls, road: road);
}

void main() {
  testWidgets('a holding Shipper gets the stored road (all points) and its distance and time', (WidgetTester tester) async {
    final ({int calls, List<List<double>>? road}) map = await _openMap(tester, _view(route: _route()));
    expect(map.calls, greaterThan(0));
    expect(map.road, isNotNull);
    expect(map.road!.length, 3, reason: 'every stored point reaches the map');
    expect(find.byKey(const Key('m07-ship-route')), findsOneWidget);
    expect(find.textContaining('3,2 km'), findsOneWidget);
    expect(find.textContaining('khoảng 12 phút'), findsOneWidget);
    expect(find.byKey(const Key('m07-ship-route-legacy')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an old record with no reference road draws no line, no distance, and says so honestly', (WidgetTester tester) async {
    final ({int calls, List<List<double>>? road}) map = await _openMap(tester, _view(legacy: true));
    expect(map.road, isEmpty);
    expect(find.byKey(const Key('m07-ship-route')), findsNothing);
    expect(find.byKey(const Key('m07-ship-route-legacy')), findsOneWidget);
    expect(find.textContaining('Chưa có tuyến để tham khảo'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an old record gets the CURRENT road as reference only: labelled, drawn, and no distance or time', (WidgetTester tester) async {
    final List<List<double>> reference = <List<double>>[
      <double>[22.66, 106.25],
      <double>[22.67, 106.26],
    ];
    final ({int calls, List<List<double>>? road}) map = await _openMap(tester, _view(legacy: true, reference: reference));
    expect(map.road, hasLength(2));
    expect(find.byKey(const Key('m07-ship-route-reference')), findsOneWidget);
    expect(find.textContaining('chỉ tham khảo, có thể khác phí đã chốt'), findsOneWidget);
    expect(find.byKey(const Key('m07-ship-route')), findsNothing);
    expect(find.textContaining(' km'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a DIRECT call (no route, not legacy): no line, no distance, no note, no error', (WidgetTester tester) async {
    final ({int calls, List<List<double>>? road}) map = await _openMap(tester, _view());
    expect(map.road, isEmpty);
    expect(find.byKey(const Key('m07-ship-route')), findsNothing);
    expect(find.byKey(const Key('m07-ship-route-legacy')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a Shipper who no longer holds the delivery draws no road, even if a road was stored', (WidgetTester tester) async {
    // Searching again: the server sends the route summary without geometry, and the screen must not draw or show a distance from it.
    await mount(tester, ShipperDeliveryDetailScreen(source: _Holding(_view(state: DeliveryState.waitingDriver, route: _route(geometry: false))), deliveryId: 'r-1'));
    expect(find.byKey(const Key('m07-ship-map')), findsNothing);
    expect(find.byKey(const Key('m07-ship-route')), findsNothing);
    expect(find.textContaining('3,2 km'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a finished delivery with a stored geometry is not drawn: the road belongs to the holding only', (WidgetTester tester) async {
    await mount(tester, ShipperDeliveryDetailScreen(source: _Holding(_view(state: DeliveryState.completed, route: _route())), deliveryId: 'r-1'));
    expect(find.byKey(const Key('m07-ship-map')), findsNothing);
    expect(find.byKey(const Key('m07-ship-route')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
