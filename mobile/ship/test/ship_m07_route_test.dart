import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14/n11_m14.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_m07.dart';

// The 11Ship delivery map hands the stored road to the M14 map (P6-5b): every point reaches M14OfflineMap, the pins stay, and no road means no line.
// The map is a native view on Android, so the test runs the widget as a non-Android map (the same route value is what the native side receives).

final List<M07MapPin> _pins = <M07MapPin>[
  const M07MapPin(lat: 22.66, lng: 106.25, label: 'Quán'),
  const M07MapPin(lat: 22.67, lng: 106.26, label: 'Giao', color: 0xFFC0392B),
];

final List<List<double>> _road = <List<double>>[
  <double>[22.66, 106.25],
  <double>[22.665, 106.255],
  <double>[22.67, 106.26],
];

Future<M14OfflineMap> _pumpShipMap(WidgetTester tester, {List<List<double>>? road}) async {
  // The override is restored before the test ends (the framework checks it after the body).
  debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
  try {
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => road == null ? shipM14MapBuilder(context, _pins) : shipM14MapBuilder(context, _pins, road),
        ),
      ),
    ));
    await tester.pump();
    return tester.widget<M14OfflineMap>(find.byType(M14OfflineMap));
  } finally {
    debugDefaultTargetPlatformOverride = null;
  }
}

void main() {
  test('the 11Ship map builder exists only in a build with the offline map', () {
    // The build flag is compile-time: a test run without it has no map, so the screens say so instead of opening one.
    expect(shipMapBuilder() == null, !kM14Map);
  });

  testWidgets('the stored road reaches the M14 map with every point, and the pins stay', (WidgetTester tester) async {
    final M14OfflineMap map = await _pumpShipMap(tester, road: _road);
    expect(map.route.length, 3, reason: 'a road that loses points is a wrong road');
    expect(map.route.first, <double>[22.66, 106.25]);
    expect(map.route.last, <double>[22.67, 106.26]);
    expect(map.pins.length, 2);
    expect(map.pins.map((Map<String, dynamic> p) => p['label']), <String>['Quán', 'Giao']);
  });

  testWidgets('no stored road (a DIRECT call, an old record or a released delivery): the map draws no line', (WidgetTester tester) async {
    final M14OfflineMap map = await _pumpShipMap(tester);
    expect(map.route, isEmpty);
    expect(map.pins.length, 2);
    expect(tester.takeException(), isNull);
  });
}
