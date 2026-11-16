import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// P6-5c (#294): the checkout draws the road of its CURRENT quote (fee.route) through the map builder the app already has, fits the camera to it, and
// shows the quote's own distance and time. No road = nothing drawn, no error. A new quote (an address or tip change, or ORDER_QUOTE_CHANGED) draws the
// new quote's road; while it is being priced the old road is not kept.

// Standard polyline encoding at precision 6, only to build the stored geometry the server would send.
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

final String _roadAGeometry = _encode6(<List<double>>[
  <double>[22.66, 106.25],
  <double>[22.665, 106.255],
  <double>[22.67, 106.26],
]);
final String _roadBGeometry = _encode6(<List<double>>[
  <double>[22.7, 106.3],
  <double>[22.71, 106.31],
]);

Map<String, Object?> _feeWithRoute({required String snapshotId, required String? geometry, int distance = 3200, int duration = 720, bool withRoute = true}) => <String, Object?>{
      'status': 'PRICED',
      'distance_m': distance,
      'fee_vnd': 15000,
      'estimate_vnd': 15000,
      'policy_version': 1,
      'snapshot': 'snap-$snapshotId',
      'route_snapshot_id': snapshotId,
      if (withRoute)
        'route': <String, Object?>{'status': 'ROUTE', 'distance_m': distance, 'duration_s': duration, 'route_version': 'm14-1', 'geometry': geometry},
    };

CheckoutPreview _quote(Map<String, Object?> fee) => CheckoutPreview.fromJson(<String, Object?>{
      'ok': true,
      'blockers': <Object?>[],
      'lines': <Object?>[],
      'items_total_vnd': 45000,
      'expected_total_vnd': 60000,
      'fee': fee,
    });

/// Answers each preview from [quotes] in order (the last one repeats). While [hold] is on, a preview waits in [pending] until the test answers it.
class _QuoteSource extends SampleCustomerOrders {
  _QuoteSource(super.store, this.quotes);

  final List<CheckoutPreview> quotes;
  final List<Completer<CheckoutPreview>> pending = <Completer<CheckoutPreview>>[];
  bool hold = false;
  int previews = 0;
  int places = 0;

  /// The first place call is refused as a changed quote (the server has a newer one); the screen then re-quotes.
  bool refuseFirstPlace = false;

  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) {
    final CheckoutPreview answer = quotes[previews < quotes.length ? previews : quotes.length - 1];
    previews++;
    if (!hold) return Future<CheckoutPreview>.value(answer);
    final Completer<CheckoutPreview> waiting = Completer<CheckoutPreview>();
    pending.add(waiting);
    return waiting.future;
  }

  @override
  Future<OrderView> place(CheckoutDraft draft, {required CheckoutPreview preview, required String clientRef, required String key}) {
    places++;
    if (refuseFirstPlace) {
      refuseFirstPlace = false;
      hold = true;
      return Future<OrderView>.error(const M07Failure(M07FailureKind.refused, code: 'ORDER_QUOTE_CHANGED'));
    }
    return super.place(draft, preview: preview, clientRef: clientRef, key: key);
  }
}

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Finder key(String value) => find.byKey(Key(value));

const DeliveryAddress _pinned = DeliveryAddress(
  id: 'route-address',
  label: AddressLabel.home,
  recipientName: 'Nguyễn An',
  contactPhone: '+84912345678',
  addressText: '12 Phố Huế',
  deliveryNote: null,
  latitude: 22.67,
  longitude: 106.26,
  isDeliveryDefault: true,
  version: 1,
);

class _StaticAddressApi implements AddressApi {
  const _StaticAddressApi(this.rows);
  final List<DeliveryAddress> rows;

  @override
  Future<List<DeliveryAddress>> list() async => rows;
  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key}) => throw UnsupportedError('read only');
  @override
  Future<String?> delete(String id, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<void> setDefault(String id, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<void> setDefaultKind(String id, AddressDefaultKind kind, bool enabled, {required String key}) => throw UnsupportedError('read only');
}

void main() {
  final SampleDish pho = kSampleDishes[0];

  /// Mounts the checkout with a pinned address and one dish. [road] records the points each map build receives (null list = no map built).
  Future<(_QuoteSource, List<List<List<double>>>)> mountCheckout(WidgetTester tester, List<CheckoutPreview> quotes, {bool withMap = true}) async {
    tester.view.physicalSize = const Size(1080, 9000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final SampleOrderStore store = SampleOrderStore();
    final _QuoteSource source = _QuoteSource(store, quotes);
    final List<List<List<double>>> drawn = <List<List<double>>>[];
    final OrderRuntime runtime = OrderRuntime(
      customer: source,
      shop: SampleShopOrders(store),
      cart: CartController(source: source),
      mapBuilder: withMap
          ? (BuildContext context, List<M07MapPin> pins, [List<List<double>> route = const <List<double>>[]]) {
              drawn.add(route);
              return SizedBox(key: const Key('fake-route-map'), height: 200, child: Text('road:${route.length}'));
            }
          : null,
    );
    await runtime.cart.add(shopId: kSampleShopId, shopName: 'Quán Phở Minh họa', itemId: pho.id, name: pho.name, priceVnd: 45000);
    final AddressBookController book = AddressBookController(api: _StaticAddressApi(const <DeliveryAddress>[_pinned]));
    addTearDown(book.dispose);
    await book.load();
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: CheckoutScreen(runtime: runtime, addresses: book)));
    await settle(tester);
    return (source, drawn);
  }

  testWidgets('a quote with a road draws its points, fits the checkout map and shows the quote\'s distance and time', (WidgetTester tester) async {
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry));
    final (_, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[a]);

    expect(key('checkout-route'), findsOneWidget);
    expect(drawn.last.length, 3, reason: 'every stored point of the quote reaches the map');
    expect(drawn.last.first[0], closeTo(22.66, 1e-6));
    expect(drawn.last.last[1], closeTo(106.26, 1e-6));
    expect(find.text('Thời gian đi dự kiến'), findsOneWidget);
    expect(find.text('≈ 12 phút'), findsOneWidget);
    expect(find.textContaining('3,2 km'), findsOneWidget, reason: 'the distance is the quote\'s own');
    expect(find.text('15.000đ'), findsWidgets, reason: 'the fee shown is the quote\'s fee');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a quote without a road draws nothing, keeps the distance it has and raises no error', (WidgetTester tester) async {
    final CheckoutPreview none = _quote(_feeWithRoute(snapshotId: 'route-none', geometry: null, withRoute: false));
    final (_, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[none]);

    expect(key('checkout-route'), findsNothing);
    expect(drawn.every((List<List<double>> road) => road.isEmpty), isTrue);
    expect(find.textContaining('3,2 km'), findsOneWidget);
    expect(find.text('Thời gian đi dự kiến'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a broken road (geometry that does not decode) draws nothing and keeps the screen', (WidgetTester tester) async {
    final CheckoutPreview broken = _quote(_feeWithRoute(snapshotId: 'route-bad', geometry: '!!not a road!!'));
    final (_, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[broken]);

    expect(key('checkout-route'), findsNothing);
    expect(drawn.every((List<List<double>> road) => road.isEmpty), isTrue);
    expect(find.text('15.000đ'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no map in this build: the route is not drawn and the quote still shows its distance', (WidgetTester tester) async {
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry));
    await mountCheckout(tester, <CheckoutPreview>[a], withMap: false);

    expect(key('checkout-route'), findsNothing);
    expect(find.textContaining('3,2 km'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a new quote (tip changed) draws the NEW road; while it is being priced the old road is not kept', (WidgetTester tester) async {
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry));
    final CheckoutPreview b = _quote(_feeWithRoute(snapshotId: 'route-b', geometry: _roadBGeometry, distance: 900, duration: 300));
    final (_QuoteSource source, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[a, b]);
    expect(drawn.last.length, 3);

    source.hold = true;
    await tester.ensureVisible(key('checkout-tip-5000'));
    await tester.tap(key('checkout-tip-5000'));
    await settle(tester);

    expect(key('checkout-route'), findsNothing, reason: 'the road of the previous quote must not stay on screen while the new quote is priced');
    expect(find.textContaining('3,2 km'), findsNothing);

    source.pending.last.complete(b);
    await settle(tester);

    expect(key('checkout-route'), findsOneWidget);
    expect(drawn.last.length, 2, reason: 'the map is drawn from the new quote\'s road');
    expect(drawn.last.first[0], closeTo(22.7, 1e-6));
    expect(find.textContaining('0,9 km'), findsOneWidget);
    expect(find.text('≈ 5 phút'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ORDER_QUOTE_CHANGED: the refused road goes away and the re-quoted road is drawn', (WidgetTester tester) async {
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry));
    final CheckoutPreview b = _quote(_feeWithRoute(snapshotId: 'route-b', geometry: _roadBGeometry, distance: 900, duration: 300));
    final (_QuoteSource source, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[a, b]);
    expect(drawn.last.length, 3);

    source.refuseFirstPlace = true;
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);

    expect(source.places, 1);
    expect(key('checkout-changed'), findsOneWidget);
    expect(key('checkout-route'), findsNothing, reason: 'a refused quote is not kept on the map while the screen re-quotes');

    source.pending.last.complete(b);
    await settle(tester);

    expect(key('checkout-route'), findsOneWidget);
    expect(drawn.last.length, 2);
    expect(drawn.last.first[0], closeTo(22.7, 1e-6));
    expect(tester.takeException(), isNull);
  });
}
