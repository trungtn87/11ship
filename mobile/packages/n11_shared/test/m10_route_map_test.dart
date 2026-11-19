import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// The order map draws the stored road (never a new one) and says in words when there is none. Three cases: a route-backed Order, an Order before
// route snapshots (legacy) and an Order the shop created directly. Nothing here is an error; a missing road is neutral text.

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

void main() {
  Future<List<List<double>>?> pump(WidgetTester tester, {OrderRoute? route, bool legacy = false}) async {
    List<List<double>>? seen;
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: OrderMapCard(
            framed: false,
            pickupLat: 22.66,
            pickupLng: 106.25,
            dropoffLat: 22.67,
            dropoffLng: 106.26,
            location: null,
            ended: false,
            who: 'shipper',
            route: route,
            legacyReferenceOnly: legacy,
            mapBuilder: (BuildContext context, List<M07MapPin> pins, [List<List<double>> road = const <List<double>>[]]) {
              seen = road;
              return const SizedBox(height: 10);
            },
          ),
        ),
      ),
    ));
    await tester.pump();
    return seen;
  }

  testWidgets('a route-backed Order draws its stored road and shows its distance and time', (WidgetTester tester) async {
    final List<List<double>>? road = await pump(tester, route: _route());
    expect(road, isNotNull);
    expect(road!.length, 3);
    expect(find.byKey(const Key('m10-route-summary')), findsOneWidget);
    expect(find.textContaining('3,2 km'), findsOneWidget);
    expect(find.textContaining('12 phút'), findsOneWidget);
    expect(find.byKey(const Key('m10-route-legacy')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an Order from before route snapshots draws no road and says so neutrally', (WidgetTester tester) async {
    final List<List<double>>? road = await pump(tester, legacy: true);
    expect(road, isEmpty);
    expect(find.byKey(const Key('m10-route-summary')), findsNothing);
    expect(find.byKey(const Key('m10-route-legacy')), findsOneWidget);
    expect(find.textContaining('không có đường để vẽ'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an Order created directly by the shop: no road, no note, no error', (WidgetTester tester) async {
    final List<List<double>>? road = await pump(tester);
    expect(road, isEmpty);
    expect(find.byKey(const Key('m10-route-summary')), findsNothing);
    expect(find.byKey(const Key('m10-route-legacy')), findsNothing);
    expect(find.byKey(const Key('m10-map')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('issue #393: pins without a stored road draw no line and say "Chưa có tuyến đường đi"', (WidgetTester tester) async {
    final List<List<double>>? road = await pump(tester);
    expect(road, isEmpty);
    expect(find.byKey(const Key('m10-route-missing')), findsOneWidget);
    expect(find.textContaining('Chưa có tuyến đường đi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('issue #393: a legacy Order keeps its own neutral note and no "chưa có tuyến" line', (WidgetTester tester) async {
    await pump(tester, legacy: true);
    expect(find.byKey(const Key('m10-route-legacy')), findsOneWidget);
    expect(find.byKey(const Key('m10-route-missing')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('issue #393: with a stored road the "chưa có tuyến" status is not shown', (WidgetTester tester) async {
    await pump(tester, route: _route());
    expect(find.byKey(const Key('m10-route-missing')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('while the Shipper shares a live position the stored road is still drawn, with the position marker', (WidgetTester tester) async {
    List<List<double>>? road;
    List<M07MapPin>? pins;
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: OrderMapCard(
            framed: false,
            pickupLat: 22.66,
            pickupLng: 106.25,
            dropoffLat: 22.67,
            dropoffLng: 106.26,
            location: LocationView(lat: 22.663, lng: 106.252, recordedAt: DateTime.utc(2026, 11, 15, 6), ageSeconds: 5, freshness: Freshness.live),
            ended: false,
            who: 'shipper',
            route: _route(),
            mapBuilder: (BuildContext context, List<M07MapPin> p, [List<List<double>> r = const <List<double>>[]]) {
              pins = p;
              road = r;
              return const SizedBox(height: 10);
            },
          ),
        ),
      ),
    ));
    await tester.pump();
    // The stored road is drawn (not an empty line) while the position card is shown.
    expect(find.byKey(const Key('m07-location-card')), findsOneWidget);
    expect(road, isNotNull);
    expect(road!.length, 3, reason: 'the stored road must reach the map on the live-position path');
    // The position marker (the Shipper) is among the pins, at the shared position.
    expect(pins!.any((M07MapPin p) => p.label == 'shipper' && (p.lat - 22.663).abs() < 1e-9 && (p.lng - 106.252).abs() < 1e-9), isTrue);
    expect(pins!.any((M07MapPin p) => p.label == 'Điểm giao'), isTrue);
    expect(tester.takeException(), isNull);
  });
}
