import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// P6-8b (#294): the reference road of a legacy record is read only. Only a well-formed REFERENCE geometry gives points; anything else is empty, so
// nothing is drawn and the screen says so honestly.

// Standard polyline encoding at precision 6, only to build the geometry for the test.
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

void main() {
  test('a REFERENCE geometry gives its points', () {
    final String geometry = _encode6(<List<double>>[
      <double>[22.66, 106.25],
      <double>[22.67, 106.26],
    ]);
    final List<List<double>> points = referencePointsOf(
        <String, Object?>{'status': 'REFERENCE', 'geometry': geometry});
    expect(points, hasLength(2));
    expect(points.first[0], closeTo(22.66, 1e-6));
  });

  test(
      'a missing, wrong-status, non-map or malformed reference gives no points (never an error)',
      () {
    expect(referencePointsOf(null), isEmpty);
    expect(referencePointsOf('REFERENCE'), isEmpty);
    expect(
        referencePointsOf(<String, Object?>{
          'status': 'ROUTE',
          'geometry': _encode6(<List<double>>[
            <double>[22.66, 106.25],
            <double>[22.67, 106.26]
          ])
        }),
        isEmpty);
    expect(
        referencePointsOf(<String, Object?>{'status': 'REFERENCE'}), isEmpty);
    expect(
        referencePointsOf(<String, Object?>{
          'status': 'REFERENCE',
          'geometry': '\u0001 not a polyline'
        }),
        isEmpty);
  });

  test(
      'a reference road carries no distance or time: the parsed object has no route figure',
      () {
    final List<List<double>> points = referencePointsOf(<String, Object?>{
      'status': 'REFERENCE',
      'geometry': _encode6(<List<double>>[
        <double>[22.66, 106.25],
        <double>[22.67, 106.26]
      ])
    });
    expect(points, isNotEmpty);
    expect(
        OrderRoute.fromJson(
            <String, Object?>{'status': 'REFERENCE', 'geometry': 'x'}),
        isNull);
  });
}
