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

CheckoutPreview _quote(Map<String, Object?> fee, {int tip = 0}) => CheckoutPreview.fromJson(<String, Object?>{
      'ok': true,
      'blockers': <Object?>[],
      'lines': <Object?>[],
      'tip_vnd': tip,
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

  /// The code of that refusal: ORDER_QUOTE_CHANGED, or ORDER_CART_CHANGED (the screen then reloads the cart).
  String refusal = 'ORDER_QUOTE_CHANGED';

  /// While [holdCart] is on, cart reads (cart.load) wait in [cartPending] until the test answers them.
  bool holdCart = false;
  final List<Completer<CartView?>> cartPending = <Completer<CartView?>>[];

  /// The preview the last place call was sent with.
  CheckoutPreview? placedWith;

  /// The saved cart as the store holds it now (not held).
  Future<CartView?> currentCart() => super.cart();

  /// While [failCart] is on, every cart read fails as offline (the GET of the saved cart is refused).
  bool failCart = false;

  @override
  Future<CartView?> cart() {
    if (failCart) return Future<CartView?>.error(M07Failure(M07FailureKind.offline));
    if (!holdCart) return super.cart();
    final Completer<CartView?> waiting = Completer<CartView?>();
    cartPending.add(waiting);
    return waiting.future;
  }

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
    placedWith = preview;
    if (refuseFirstPlace) {
      refuseFirstPlace = false;
      hold = true;
      return Future<OrderView>.error(M07Failure(M07FailureKind.refused, code: refusal));
    }
    return super.place(draft, preview: preview, clientRef: clientRef, key: key);
  }
}

/// The runtime of the last mounted checkout (the tests drive its cart directly, e.g. a read that is pending before a refusal).
OrderRuntime? _mountedRuntime;

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Finder key(String value) => find.byKey(Key(value));

/// Tip is two steps: "Tip" opens the level dropdown, then 5.000đ is picked from its menu.
Future<void> pickTip5000(WidgetTester tester) async {
  await tester.ensureVisible(key('checkout-tip-on'));
  await tester.tap(key('checkout-tip-on'));
  await settle(tester);
  await tester.ensureVisible(key('checkout-tip-level'));
  await tester.tap(key('checkout-tip-level'));
  await settle(tester);
  await tester.tap(find.text('5.000đ').last);
}

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
    _mountedRuntime = runtime;
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
    await pickTip5000(tester);
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

  // Codex (PR #367, HIGH): after ORDER_CART_CHANGED the cart reload is still pending when the person changes the tip. The preview A of the OLD cart
  // is then in flight; the new cart lands first and A returns afterwards. A must never show, send must stay locked until the preview of the NEW
  // cart (B) lands, and place must receive B with B's route_snapshot_id.
  testWidgets('ORDER_CART_CHANGED: a preview of the old cart that returns after the reload never shows; send waits for the new cart\'s quote B', (WidgetTester tester) async {
    final CheckoutPreview p0 = _quote(_feeWithRoute(snapshotId: 'route-0', geometry: _roadAGeometry));
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry, distance: 4100));
    final CheckoutPreview b = _quote(_feeWithRoute(snapshotId: 'route-b', geometry: _roadBGeometry, distance: 900, duration: 300), tip: 5000);
    final (_QuoteSource source, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[p0, a, b]);
    expect(drawn.last.length, 3);

    // The send is refused as a changed cart; the screen starts reloading the cart and the reload stays pending.
    source.refusal = 'ORDER_CART_CHANGED';
    source.refuseFirstPlace = true;
    source.holdCart = true;
    final CartView newCart = (await source.currentCart())!;
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1);
    expect(source.cartPending, hasLength(1), reason: 'the cart reload has started and is still pending');
    expect(key('checkout-changed'), findsOneWidget);

    // While the reload is pending the tip changes: preview A (of the old cart) is now in flight.
    final int drawnBeforeTip = drawn.length;
    await pickTip5000(tester);
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);
    expect(source.pending, hasLength(1), reason: 'preview A of the old cart is in flight');

    // The new cart completes first.
    source.cartPending.single.complete(newCart);
    await settle(tester);
    expect(source.places, 1);

    // Preview A returns late: it must not show, and send must stay locked until the new cart is priced.
    source.pending[0].complete(a);
    await settle(tester);
    expect(find.textContaining('4,1 km'), findsNothing, reason: 'the distance of the old cart\'s quote must never show');
    expect(drawn.skip(drawnBeforeTip).where((List<List<double>> road) => road.length == 3), isEmpty, reason: 'the road of the old cart\'s quote must never be drawn');
    expect(source.pending, hasLength(2), reason: 'the new cart is priced by a new preview B');
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1, reason: 'send is locked while only the old quote exists');

    // The preview of the new cart lands: its road and its numbers show, and send places exactly B.
    source.pending[1].complete(b);
    await settle(tester);
    expect(key('checkout-route'), findsOneWidget);
    expect(find.textContaining('0,9 km'), findsOneWidget);
    expect(find.textContaining('4,1 km'), findsNothing);
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 2);
    expect(source.placedWith?.routeSnapshotId, 'route-b', reason: 'place receives the preview of the new cart, never the old one');
    expect(source.placedWith?.feeDistanceM, 900);
  });

  // Codex (PR #367, HIGH, re-review): a cart read that was ALREADY pending when the refusal came may be answered before the server changed the cart.
  // Recovery must not trust it nor return early on it: it waits for that read, reads the cart once more, and only then prices the NEW cart. The
  // preview A of the old cart returns BEFORE the new cart is applied: it must not show, and send must stay locked until B (of the new cart) lands.
  testWidgets('ORDER_CART_CHANGED with a cart read already pending: the old quote never shows, and send waits for B of the new cart', (WidgetTester tester) async {
    final CheckoutPreview p0 = _quote(_feeWithRoute(snapshotId: 'route-0', geometry: _roadAGeometry));
    final CheckoutPreview a = _quote(_feeWithRoute(snapshotId: 'route-a', geometry: _roadAGeometry, distance: 4100));
    final CheckoutPreview b = _quote(_feeWithRoute(snapshotId: 'route-b', geometry: _roadBGeometry, distance: 900, duration: 300), tip: 5000);
    final (_QuoteSource source, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[p0, a, b]);
    final CartView newCart = (await source.currentCart())!;

    // A cart read starts BEFORE the refusal and stays pending.
    source.holdCart = true;
    unawaited(_mountedRuntime!.cart.load());
    await settle(tester);
    expect(source.cartPending, hasLength(1));

    // The place is refused: recovery waits for the pending read and does not start its own read yet.
    source.refusal = 'ORDER_CART_CHANGED';
    source.refuseFirstPlace = true;
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1);
    expect(source.pending, isEmpty, reason: 'no preview of the old cart may start while recovery waits for the pending read');
    expect(source.cartPending, hasLength(1), reason: 'recovery waits for the pending read; it neither returns early nor starts a read it does not own yet');
    expect(key('checkout-changed'), findsOneWidget);

    // While recovery waits, the tip changes: preview A (of the old cart) is in flight.
    final int drawnBeforeTip = drawn.length;
    await pickTip5000(tester);
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);
    expect(source.pending, hasLength(1), reason: 'preview A of the old cart is in flight');

    // Preview A returns BEFORE the new cart is applied: it must not publish, and send stays locked.
    source.pending[0].complete(a);
    await settle(tester);
    expect(find.textContaining('4,1 km'), findsNothing, reason: 'the old cart\'s quote must never show, even before the new cart is applied');
    expect(drawn.skip(drawnBeforeTip).where((List<List<double>> road) => road.length == 3), isEmpty, reason: 'the old cart\'s road must never be drawn');
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1, reason: 'send is locked: no quote of the new cart exists yet');

    // The pending read completes with the NEW cart; recovery then reads once more and that read is answered with the new cart.
    source.cartPending[0].complete(newCart);
    await settle(tester);
    expect(source.cartPending, hasLength(2), reason: 'after the pending read, recovery reads the cart once more');
    expect(source.pending, hasLength(1), reason: 'no preview starts until the fresh read is applied');
    source.cartPending[1].complete(newCart);
    await settle(tester);
    expect(source.pending, hasLength(2), reason: 'the new cart is priced by a new preview B');
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1, reason: 'send stays locked until B lands');

    // B lands: its road and numbers show, and send places exactly B.
    source.pending[1].complete(b);
    await settle(tester);
    expect(key('checkout-route'), findsOneWidget);
    expect(find.textContaining('0,9 km'), findsOneWidget);
    expect(find.textContaining('4,1 km'), findsNothing);
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 2);
    expect(source.placedWith?.routeSnapshotId, 'route-b', reason: 'place receives the preview of the new cart, never the old one');
    expect(source.placedWith?.feeDistanceM, 900);
    expect(tester.takeException(), isNull);
  });

  // Codex (PR #367, HIGH, re-review): when the reload itself fails (the cart GET is refused), nothing of the unconfirmed cart may publish or open
  // send. The person gets a retry of the reload; a successful retry prices the new cart and only then sends.
  testWidgets('ORDER_CART_CHANGED and the cart GET fails: nothing publishes, send stays locked, a retry reloads and prices the new cart', (WidgetTester tester) async {
    final CheckoutPreview p0 = _quote(_feeWithRoute(snapshotId: 'route-0', geometry: _roadAGeometry));
    final CheckoutPreview b = _quote(_feeWithRoute(snapshotId: 'route-b', geometry: _roadBGeometry, distance: 900, duration: 300));
    final (_QuoteSource source, List<List<List<double>>> drawn) = await mountCheckout(tester, <CheckoutPreview>[p0, b]);
    expect(source.previews, 1);

    source.refusal = 'ORDER_CART_CHANGED';
    source.refuseFirstPlace = true;
    source.failCart = true;
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1);
    expect(source.previews, 1, reason: 'no preview of the unconfirmed cart is started');
    expect(key('checkout-cart-failed'), findsOneWidget);
    expect(key('checkout-cart-retry'), findsOneWidget);
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 1, reason: 'send stays locked after a failed reload');

    // Retry: the cart reads again and the new cart is priced (B), then send places B.
    source.failCart = false;
    source.hold = false;
    await tester.ensureVisible(key('checkout-cart-retry'));
    await tester.tap(key('checkout-cart-retry'));
    await settle(tester);
    expect(key('checkout-cart-retry'), findsNothing);
    expect(key('checkout-cart-failed'), findsNothing);
    expect(source.previews, 2, reason: 'the retry prices the new cart');
    expect(find.textContaining('0,9 km'), findsOneWidget);
    expect(drawn.last.length, 2);
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.places, 2);
    expect(source.placedWith?.routeSnapshotId, 'route-b');
    expect(tester.takeException(), isNull);
  });

  // LOW (Codex): disposing the checkout while the reload is pending must not call setState after dispose.
  testWidgets('leaving the checkout while the reload is pending: no setState after dispose', (WidgetTester tester) async {
    final CheckoutPreview p0 = _quote(_feeWithRoute(snapshotId: 'route-0', geometry: _roadAGeometry));
    final (_QuoteSource source, _) = await mountCheckout(tester, <CheckoutPreview>[p0, p0]);
    source.refusal = 'ORDER_CART_CHANGED';
    source.refuseFirstPlace = true;
    source.holdCart = true;
    await tester.ensureVisible(key('checkout-send'));
    await tester.tap(key('checkout-send'));
    await settle(tester);
    expect(source.cartPending, hasLength(1));

    // The person leaves the screen; the reload then completes.
    await tester.pumpWidget(const SizedBox.shrink());
    source.cartPending[0].complete((await source.currentCart())!);
    await settle(tester);
    expect(tester.takeException(), isNull);
  });
}
