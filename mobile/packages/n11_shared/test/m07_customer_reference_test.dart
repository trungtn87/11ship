import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// P6-8b review fix (#294): the CUSTOMER's delivery detail follows the same rule as the Shipper's. A new delivery draws its stored road; a legacy
// delivery (before route snapshots) draws only its CURRENT road as reference, with the label; with no reference road it says so honestly.

DeliveryView _view({DeliveryState state = DeliveryState.waitingDriver, bool legacy = false, List<List<double>> reference = const <List<double>>[], OrderRoute? route}) =>
    DeliveryView(
      deliveryId: 'cd-ref',
      code: 'C-REF',
      source: 'CUSTOMER',
      state: state,
      version: 1,
      pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.66, lng: 106.25),
      recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu', lat: 22.67, lng: 106.26),
      goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 0),
      fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'),
      search: SearchView(startedAt: DateTime.utc(2026, 11, 15, 6), expiresAt: DateTime.utc(2026, 11, 15, 6, 30), serverNow: DateTime.utc(2026, 11, 15, 6, 5)),
      can: const <String>{'cancel'},
      route: route,
      legacyReferenceOnly: legacy,
      referencePoints: reference,
    );

class _Fixed extends SampleCustomerDeliverySource {
  _Fixed(this._view);

  final DeliveryView _view;

  @override
  Future<DeliveryView> get(String id) async => _view;
}

Future<void> _mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

/// Mounts the customer detail and returns the road the map was given (null when no map was built).
Future<List<List<double>>?> _roadOf(WidgetTester tester, DeliveryView view) async {
  List<List<double>>? road;
  await _mount(
    tester,
    CustomerDeliveryDetailScreen(
      source: _Fixed(view),
      deliveryId: view.deliveryId,
      mapBuilder: (BuildContext context, List<M07MapPin> pins, [List<List<double>> r = const <List<double>>[]]) {
        road = r;
        return const SizedBox(key: Key('spy-map'), height: 10);
      },
    ),
  );
  return road;
}

void main() {
  testWidgets('a legacy delivery with a reference road draws it and says it is for reference only, with no distance', (WidgetTester tester) async {
    final List<List<double>> reference = <List<double>>[
      <double>[22.66, 106.25],
      <double>[22.67, 106.26],
    ];
    final List<List<double>>? road = await _roadOf(tester, _view(legacy: true, reference: reference));
    expect(road, hasLength(2));
    expect(find.byKey(const Key('m07-c-route-reference')), findsOneWidget);
    expect(find.textContaining('chỉ tham khảo, có thể khác phí đã chốt'), findsOneWidget);
    expect(find.byKey(const Key('m07-c-route-legacy')), findsNothing);
    expect(find.textContaining(' km'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a legacy delivery with no reference road says so honestly and draws no line', (WidgetTester tester) async {
    final List<List<double>>? road = await _roadOf(tester, _view(legacy: true));
    expect(road, isEmpty);
    expect(find.byKey(const Key('m07-c-route-legacy')), findsOneWidget);
    expect(find.textContaining('Chưa có tuyến để tham khảo'), findsOneWidget);
    expect(find.byKey(const Key('m07-c-route-reference')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a NEW delivery draws its stored road first, and never the reference label', (WidgetTester tester) async {
    final List<List<double>> reference = <List<double>>[
      <double>[22.1, 106.1],
      <double>[22.2, 106.2],
    ];
    // A stored route comes with its geometry; the reference is sent too and must be ignored for a new record.
    final OrderRoute route = OrderRoute.fromJson(<String, Object?>{
      'status': 'ROUTE',
      'distance_m': 3200,
      'duration_s': 720,
      'route_version': 'm14-1',
      'geometry': '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    })!;
    final List<List<double>>? road = await _roadOf(tester, _view(route: route, reference: reference));
    expect(road, hasLength(greaterThan(0)));
    expect(road, isNot(equals(reference)));
    expect(find.byKey(const Key('m07-c-route-reference')), findsNothing);
    expect(find.byKey(const Key('m07-c-route-legacy')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
