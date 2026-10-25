import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

void main() {
  testWidgets('typing and moving the pin returns one address; GPS is opt-in', (
    WidgetTester tester,
  ) async {
    final FakeLocationProvider gps = FakeLocationProvider();
    AddressLocation? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await Navigator.of(context).push<AddressLocation>(
                  MaterialPageRoute<AddressLocation>(
                    builder: (_) => AddressLocationPicker(
                      initial: const AddressLocation(''),
                      location: gps,
                      mapBuilder:
                          (
                            BuildContext context,
                            double? lat,
                            double? lng,
                            void Function(double, double) onPick,
                          ) => TextButton(
                            key: const Key('map-pick'),
                            onPressed: () => onPick(22.67, 106.26),
                            child: Text('$lat,$lng'),
                          ),
                    ),
                  ),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(gps.calls, 0);
    // #194: the screen says the pinned point is fixed and that opening it shares nothing.
    expect(find.byKey(const Key('location-picker-fixed-note'), skipOffstage: false), findsOneWidget);
    expect(find.textContaining('Điểm giao đã chọn là vị trí cố định; di chuyển của bạn không tự đổi điểm này.', skipOffstage: false), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('location-address-text')),
      'Tổ 16, Cao Bằng',
    );
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.byKey(const Key('location-picker-error')), findsOneWidget);
    await tester.tap(find.byKey(const Key('map-pick')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(result?.text, 'Tổ 16, Cao Bằng');
    expect(result?.latitude, 22.67);
    expect(result?.longitude, 106.26);
    expect(gps.calls, 0);
  });

  testWidgets(
    'GPS refusal keeps the saved point and still allows map selection',
    (WidgetTester tester) async {
      final FakeLocationProvider gps = FakeLocationProvider()
        ..failure = LocationFailure.denied;
      await tester.pumpWidget(
        MaterialApp(
          home: AddressLocationPicker(
            initial: const AddressLocation(
              'Ốc 11',
              latitude: 22.66,
              longitude: 106.25,
            ),
            location: gps,
            mapBuilder:
                (
                  BuildContext context,
                  double? lat,
                  double? lng,
                  void Function(double, double) onPick,
                ) => TextButton(
                  key: const Key('map-pick'),
                  onPressed: () => onPick(22.67, 106.26),
                  child: Text('$lat,$lng'),
                ),
          ),
        ),
      );
      expect(gps.calls, 0);
      await tester.tap(find.byKey(const Key('location-current')));
      await tester.pumpAndSettle();
      expect(gps.calls, 1);
      expect(find.text('22.66,106.25'), findsOneWidget);
      expect(find.byKey(const Key('location-picker-error')), findsOneWidget);
      await tester.tap(find.byKey(const Key('map-pick')));
      await tester.pumpAndSettle();
      expect(find.text('22.67,106.26'), findsOneWidget);
      expect(find.byKey(const Key('location-picker-error')), findsNothing);
    },
  );

  testWidgets(
    'leaving without Save does not return edited text or coordinates',
    (WidgetTester tester) async {
      AddressLocation? result;
      bool returned = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (BuildContext context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<AddressLocation>(
                    MaterialPageRoute<AddressLocation>(
                      builder: (_) => AddressLocationPicker(
                        initial: const AddressLocation(
                          'Địa chỉ cũ',
                          latitude: 22.66,
                          longitude: 106.25,
                        ),
                        mapBuilder:
                            (
                              BuildContext context,
                              double? lat,
                              double? lng,
                              void Function(double, double) onPick,
                            ) => TextButton(
                              onPressed: () => onPick(22.67, 106.26),
                              child: const Text('Move'),
                            ),
                      ),
                    ),
                  );
                  returned = true;
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('location-address-text')),
        'Địa chỉ mới',
      );
      await tester.tap(find.text('Move'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(returned, isTrue);
      expect(result, isNull);
    },
  );
  testWidgets('timeout keeps the chosen point and retry reports accuracy',
      (tester) async {
    final gps = FakeLocationProvider()..failure = LocationFailure.timeout;
    await tester.pumpWidget(MaterialApp(
        home: AddressLocationPicker(
      initial:
          const AddressLocation('Cao Bằng', latitude: 22.66, longitude: 106.25),
      location: gps,
      mapBuilder: (_, lat, lng, onPick) => Text('$lat,$lng'),
    )));
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Hết thời gian chờ'), findsOneWidget);
    expect(find.text('Điểm giao đã chọn. Chạm bản đồ để chuyển ghim.'), findsOneWidget);
    expect(find.text('22.66,106.25'), findsOneWidget);
    gps.failure = null;
    gps.next = LocationFix(
        latitude: 22.68,
        longitude: 106.27,
        accuracyMeters: 350,
        takenAt: DateTime.now());
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('location-picker-error')), findsNothing);
    expect(find.text('22.68,106.27'), findsOneWidget);
    expect(find.textContaining('sai số khoảng 350 m'), findsOneWidget);
  });

  testWidgets('late GPS does not replace a point picked while waiting',
      (tester) async {
    final gps = _PendingLocation();
    await tester.pumpWidget(MaterialApp(
        home: AddressLocationPicker(
      initial: const AddressLocation('Cao Bằng'),
      location: gps,
      mapBuilder: (_, lat, lng, onPick) => TextButton(
          key: const Key('map-pick'),
          onPressed: () => onPick(22.67, 106.26),
          child: Text('$lat,$lng')),
    )));
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('map-pick')));
    gps.result.complete(LocationFix(
        latitude: 22.7,
        longitude: 106.3,
        accuracyMeters: 10,
        takenAt: DateTime.now()));
    await tester.pumpAndSettle();
    expect(find.text('22.67,106.26'), findsOneWidget);
    expect(find.text('Điểm giao đã chọn. Chạm bản đồ để chuyển ghim.'), findsOneWidget);
  });
}

class _PendingLocation implements LocationProvider {
  final result = Completer<LocationFix>();
  @override
  Future<LocationFix> currentFix() => result.future;
}
