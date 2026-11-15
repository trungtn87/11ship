import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

// The standard encoding (Google polyline algorithm) written here only to build inputs for the decoder; the decoder under test is the one in the package.
String _encode(List<List<double>> points, {int factor = 1000000}) {
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
    final int lat = (p[0] * factor).round();
    final int lng = (p[1] * factor).round();
    value(lat - prevLat);
    value(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out.toString();
}

void main() {
  test('decodes the standard reference line (precision 5, the same algorithm)', () {
    final List<List<double>>? points = decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@', precision: 5);
    expect(points, isNotNull);
    expect(points!.length, 3);
    expect(points[0][0], closeTo(38.5, 1e-9));
    expect(points[0][1], closeTo(-120.2, 1e-9));
    expect(points[1][0], closeTo(40.7, 1e-9));
    expect(points[1][1], closeTo(-120.95, 1e-9));
    expect(points[2][0], closeTo(43.252, 1e-9));
    expect(points[2][1], closeTo(-126.453, 1e-9));
  });

  test('round-trips a precision-6 road of Cao Bang coordinates', () {
    final List<List<double>> road = <List<double>>[
      <double>[22.66612, 106.25734],
      <double>[22.66701, 106.25810],
      <double>[22.67255, 106.26012],
      <double>[22.66480, 106.24990],
    ];
    final List<List<double>>? decoded = decodePolyline6(_encode(road));
    expect(decoded, isNotNull);
    expect(decoded!.length, road.length);
    for (int i = 0; i < road.length; i++) {
      expect(decoded[i][0], closeTo(road[i][0], 1e-6));
      expect(decoded[i][1], closeTo(road[i][1], 1e-6));
    }
  });

  test('absent, empty or one-point geometry draws nothing (null, never a line)', () {
    expect(decodePolyline6(null), isNull);
    expect(decodePolyline6(''), isNull);
    expect(decodePolyline6(_encode(<List<double>>[<double>[22.66, 106.25]])), isNull);
  });

  test('a character outside the alphabet, a cut-off value or a missing pair is refused', () {
    final String good = _encode(<List<double>>[<double>[22.66612, 106.25734], <double>[22.67255, 106.26012]]);
    expect(decodePolyline6('${good.substring(0, 4)} ${good.substring(5)}'), isNull);
    expect(decodePolyline6(good.substring(0, good.length - 1)), isNull);
    expect(decodePolyline6(good.substring(0, good.length - 2)), isNull);
  });

  test('a coordinate outside the world is refused', () {
    expect(decodePolyline6(_encode(<List<double>>[<double>[91.0, 106.25], <double>[22.67, 106.26]])), isNull);
    expect(decodePolyline6(_encode(<List<double>>[<double>[22.66, 181.0], <double>[22.67, 106.26]])), isNull);
  });

  test('a shape over the backend bounds is refused (characters and points)', () {
    expect(decodePolyline6(List<String>.filled(kPolylineMaxChars + 1, '_').join()), isNull);
    final List<List<double>> many = <List<double>>[for (int i = 0; i <= kPolylineMaxPoints; i++) <double>[22.6 + i * 0.000001, 106.2]];
    expect(decodePolyline6(_encode(many)), isNull);
  });
}
