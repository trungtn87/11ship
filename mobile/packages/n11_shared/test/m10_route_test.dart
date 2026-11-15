import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// P6-5a (#294): the route an Order carries is read as the server stored it. A usable route is drawn; anything missing or malformed is "no route" and never
// an error. An Order before route snapshots keeps its old distance and fee and gets no road.

// Standard polyline encoding, written here only to build a precision-6 input for the parser.
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

final String _road = _encode6(<List<double>>[
  <double>[22.66612, 106.25734],
  <double>[22.67255, 106.26012],
  <double>[22.67000, 106.26500],
]);

Map<String, Object?> _route({Object? distance = 3200, Object? duration = 720, Object? version = 'm14-1', Object? geometry = 'GEO', String status = 'ROUTE'}) => <String, Object?>{
      'status': status,
      'distance_m': distance,
      'duration_s': duration,
      'route_version': version,
      'geometry': geometry,
    };

/// A minimal Order detail as the customer sees it (same shape as the server's detail view).
Map<String, Object?> _orderJson({Object? route, bool? legacy}) => <String, Object?>{
      'order_id': '00000000-0000-4000-8000-000000000001',
      'code': 'DH-ABC234',
      'status': 'PREPARING',
      'display_status': 'PREPARING',
      'version': 4,
      'shop': <String, Object?>{'shop_id': 's', 'name': 'Quán', 'phone': '+84900000001', 'address_text': 'x'},
      'recipient': <String, Object?>{'name': 'An', 'phone': '+84912345678', 'address_text': 'y', 'lat': 22.66612, 'lng': 106.25734},
      'note': null,
      'scheduled_for': null,
      'items': <Object?>[],
      'money': <String, Object?>{
        'items_original_total_vnd': 100,
        'items_total_vnd': 100,
        'paid_vnd': 0,
        'items_remaining_vnd': 100,
        'fee': <String, Object?>{'payer': 'CUSTOMER', 'amount_vnd': 15000, 'estimate_vnd': null, 'status': 'FINAL', 'distance_m': 3200},
        'expected_total_vnd': 15100,
      },
      'edited': false,
      'change_reason': null,
      'confirmed_at': '2026-10-18T09:00:00.000Z',
      'ended_at': null,
      'end_actor': null,
      'end_reason': null,
      'created_at': '2026-10-18T08:00:00.000Z',
      'server_now': '2026-10-18T09:30:00.000Z',
      'delivery': null,
      'can': <String, Object?>{'cancel': false, 'reorder': true},
      if (route != null) 'route': route,
      if (legacy != null) 'legacy_reference_only': legacy,
    };

void main() {
  group('OrderRoute.fromJson', () {
    test('a stored route is read as it was saved, and its road is decoded', () {
      final OrderRoute? r = OrderRoute.fromJson(_route(geometry: _road));
      expect(r, isNotNull);
      expect(r!.distanceM, 3200);
      expect(r.durationS, 720);
      expect(r.routeVersion, 'm14-1');
      expect(r.points.length, 3);
      expect(r.points.first[0], closeTo(22.66612, 1e-6));
    });

    test('absent, not-a-map or not-a-ROUTE is no route', () {
      expect(OrderRoute.fromJson(null), isNull);
      expect(OrderRoute.fromJson('route'), isNull);
      expect(OrderRoute.fromJson(_route(status: 'NONE')), isNull);
    });

    test('a missing, negative or non-integer distance is no route (no distance is invented)', () {
      expect(OrderRoute.fromJson(<String, Object?>{'status': 'ROUTE', 'route_version': 'm14-1', 'geometry': _road}), isNull);
      expect(OrderRoute.fromJson(_route(distance: -5)), isNull);
      expect(OrderRoute.fromJson(_route(distance: '3200')), isNull);
      expect(OrderRoute.fromJson(_route(distance: 12.5)), isNull);
    });

    test('a route_version that is missing, not text or not a plausible identifier is no route', () {
      expect(OrderRoute.fromJson(_route(version: null)), isNull);
      expect(OrderRoute.fromJson(_route(version: 7)), isNull);
      expect(OrderRoute.fromJson(_route(version: 'bad version!')), isNull);
    });

    test('an unknown but well-formed route_version is still shown (the road format is the same)', () {
      final OrderRoute? r = OrderRoute.fromJson(_route(version: 'valhalla-3.5.1:x', geometry: _road));
      expect(r, isNotNull);
      expect(r!.routeVersion, 'valhalla-3.5.1:x');
      expect(r.points.length, 3);
    });

    test('missing or malformed geometry keeps the stored numbers and draws no line', () {
      final OrderRoute? missing = OrderRoute.fromJson(_route(geometry: null));
      expect(missing, isNotNull);
      expect(missing!.geometry, isNull);
      expect(missing.points, isEmpty);
      expect(missing.distanceM, 3200);

      final OrderRoute? corrupt = OrderRoute.fromJson(_route(geometry: '!!not a polyline!!'));
      expect(corrupt, isNotNull);
      expect(corrupt!.points, isEmpty);

      final OrderRoute? wrongType = OrderRoute.fromJson(_route(geometry: 12345));
      expect(wrongType, isNotNull);
      expect(wrongType!.geometry, isNull);
      expect(wrongType.points, isEmpty);
    });

    test('a missing or negative duration is shown as unknown, not zero', () {
      expect(OrderRoute.fromJson(_route(duration: null))!.durationS, isNull);
      expect(OrderRoute.fromJson(_route(duration: -1))!.durationS, isNull);
    });
  });

  group('OrderView carries the route of the Order', () {
    test('a route-backed Order exposes the road and is not legacy', () {
      final OrderView o = OrderView.fromJson(_orderJson(route: _route(geometry: _road), legacy: false));
      expect(o.route, isNotNull);
      expect(o.route!.points.length, 3);
      expect(o.legacyReferenceOnly, isFalse);
    });

    test('an Order created before route snapshots: no route, flagged legacy', () {
      final OrderView o = OrderView.fromJson(_orderJson(route: null, legacy: true));
      expect(o.route, isNull);
      expect(o.legacyReferenceOnly, isTrue);
      expect(o.money.fee.distanceM, 3200, reason: 'the old distance stays as it was stored');
    });

    test('an Order the shop created directly: no route and not flagged legacy', () {
      final OrderView o = OrderView.fromJson(_orderJson());
      expect(o.route, isNull);
      expect(o.legacyReferenceOnly, isFalse);
    });

    test('a broken route in an answer does not stop the Order from opening', () {
      final OrderView o = OrderView.fromJson(_orderJson(route: <String, Object?>{'status': 'ROUTE', 'distance_m': 'x'}, legacy: false));
      expect(o.route, isNull);
      expect(o.code, 'DH-ABC234');
    });
  });

  group('the checkout quote keeps the route it owns', () {
    CheckoutPreview preview(Map<String, Object?> fee) => CheckoutPreview.fromJson(<String, Object?>{
          'ok': true,
          'blockers': <Object?>[],
          'lines': <Object?>[],
          'items_total_vnd': 45000,
          'expected_total_vnd': null,
          'fee': fee,
        });

    test('the snapshot id the customer saw goes back with the place call', () {
      final CheckoutPreview p = preview(<String, Object?>{
        'status': 'PRICED',
        'distance_m': 3200,
        'fee_vnd': 15000,
        'policy_version': 7,
        'snapshot': 'pickup>dropoff',
        'route_snapshot_id': '11111111-2222-4333-8444-555555555555',
      });
      expect(p.routeSnapshotId, '11111111-2222-4333-8444-555555555555');
      expect(p.expectedQuoteJson['route_snapshot_id'], '11111111-2222-4333-8444-555555555555');
      expect(p.expectedQuoteJson['distance_m'], 3200);
    });

    test('a quote without a route sends the same body as before (no key added)', () {
      final CheckoutPreview p = preview(<String, Object?>{'status': 'UNAVAILABLE', 'distance_m': null, 'fee_vnd': null, 'reason': 'DROPOFF_PIN_MISSING', 'snapshot': 's'});
      expect(p.routeSnapshotId, isNull);
      expect(p.expectedQuoteJson.containsKey('route_snapshot_id'), isFalse);
    });
  });
}
