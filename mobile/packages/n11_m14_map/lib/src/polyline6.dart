/// Decodes an encoded polyline (the M14 / route snapshot `geometry`, precision 6, [lat, lng] pairs) into points. Pure Dart: it only reads a road that was
/// already stored. It never routes, never calls the network and never recomputes anything.
///
/// Returns null for anything that is not a complete line of at least two points inside the valid coordinate range, so the caller draws nothing
/// instead of a wrong or straight line.
library;

/// The backend's bounds (`MAX_SHAPE_CHARS`, `MAX_SHAPE_POINTS`): a longer or bigger shape is refused, the same as on the server.
const int kPolylineMaxChars = 60000;
const int kPolylineMaxPoints = 5000;

class _Cursor {
  int index = 0;
}

/// One signed value of the encoding, or null when the text ends early or holds a character outside the alphabet.
int? _readValue(String encoded, _Cursor cursor) {
  int result = 0;
  int shift = 0;
  while (true) {
    if (cursor.index >= encoded.length) return null;
    final int chunk = encoded.codeUnitAt(cursor.index++) - 63;
    if (chunk < 0 || chunk > 63) return null;
    result |= (chunk & 0x1f) << shift;
    shift += 5;
    if (chunk < 0x20) break;
    // A coordinate delta of this size is impossible: refuse instead of overflowing.
    if (shift > 30) return null;
  }
  return (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
}

/// Points `[latitude, longitude]` of [encoded], or null when it is absent, malformed, out of range, too large or shorter than two points.
List<List<double>>? decodePolyline6(String? encoded, {int precision = 6}) {
  if (encoded == null || encoded.isEmpty || encoded.length > kPolylineMaxChars) return null;
  final double factor = precision == 5 ? 1e5 : 1e6;
  final List<List<double>> points = <List<double>>[];
  final _Cursor cursor = _Cursor();
  int lat = 0;
  int lng = 0;
  while (cursor.index < encoded.length) {
    final int? dLat = _readValue(encoded, cursor);
    final int? dLng = _readValue(encoded, cursor);
    if (dLat == null || dLng == null) return null;
    lat += dLat;
    lng += dLng;
    final double la = lat / factor;
    final double lo = lng / factor;
    if (!la.isFinite || !lo.isFinite || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    points.add(<double>[la, lo]);
    if (points.length > kPolylineMaxPoints) return null;
  }
  return points.length < 2 ? null : points;
}
