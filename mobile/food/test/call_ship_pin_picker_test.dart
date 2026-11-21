import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food/food_m14.dart';
import 'package:n11_shared/n11_shared.dart';

// #321: "Gọi ship" pin picker. The native map is replaced by a probe that exposes the onPoint/onError callbacks and the pins it was given.

typedef _PointFn = void Function(double lat, double lng, bool inside);

class _Probe {
  _PointFn? onPoint;
  void Function(String)? onError;
  List<Map<String, dynamic>> pins = <Map<String, dynamic>>[];
  int builds = 0;
}

FoodPinMapBuilder _fakeMap(_Probe probe) => (BuildContext context,
        List<Map<String, dynamic>> pins,
        _PointFn onPoint,
        void Function(String) onError) {
      probe.onPoint = onPoint;
      probe.onError = onError;
      probe.pins = pins;
      probe.builds++;
      return const SizedBox.expand(key: Key('fake-map'));
    };

Future<void> _mount(WidgetTester tester, Widget home) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: home));
  await tester.pump(const Duration(milliseconds: 50));
}

Future<void> _nav(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

FilledButton _confirm(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const Key('pin-confirm')));

void main() {
  group('FoodPinPickScreen', () {
    testWidgets(
        'empty start: AppBar, instruction, hint icon, confirm disabled, no pin drawn',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim điểm lấy hàng',
              onPick: (double a, double b) => picked++,
              mapBuilder: _fakeMap(probe)));
      expect(find.text('Ghim điểm lấy hàng'), findsOneWidget);
      expect(find.text('Chạm bản đồ để đặt ghim'), findsOneWidget);
      expect(find.byKey(const Key('pin-hint')), findsOneWidget);
      expect(find.text('Xác nhận vị trí'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNull);
      expect(probe.pins, isEmpty);
      expect(picked, 0);
    });

    testWidgets(
        'tap inside: real pin at the tapped point, preview, no auto close, 2nd tap moves it, confirm calls onPick once with the last point',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final List<(double, double)> picked = <(double, double)>[];
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) => picked.add((a, b)),
              mapBuilder: _fakeMap(probe)));
      probe.onPoint!(22.66, 106.25, true);
      await tester.pump();
      expect(picked, isEmpty);
      expect(probe.pins.single['lat'], 22.66);
      expect(probe.pins.single['lon'], 106.25);
      expect(find.byKey(const Key('pin-hint')), findsNothing);
      expect(find.textContaining('22.66000, 106.25000'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNotNull);
      probe.onPoint!(22.7, 106.3, true);
      await tester.pump();
      expect(probe.pins.single['lat'], 22.7);
      expect(find.textContaining('22.70000, 106.30000'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pin-confirm')));
      await tester.tap(find.byKey(const Key('pin-confirm')),
          warnIfMissed: false);
      await tester.pump();
      expect(picked, <(double, double)>[(22.7, 106.3)]);
    });

    testWidgets('existing point: old pin shown, confirm enabled, editable',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              initialLat: 22.65,
              initialLng: 106.2,
              onPick: (double a, double b) {},
              mapBuilder: _fakeMap(probe)));
      expect(probe.pins.single['lat'], 22.65);
      expect(find.textContaining('22.65000, 106.20000'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNotNull);
      probe.onPoint!(22.68, 106.22, true);
      await tester.pump();
      expect(probe.pins.single['lat'], 22.68);
    });

    testWidgets(
        'tap outside coverage: no point stored, no close, short message',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) => picked++,
              mapBuilder: _fakeMap(probe)));
      probe.onPoint!(10.0, 100.0, false);
      await tester.pump();
      expect(find.textContaining('ngoài vùng bản đồ'), findsOneWidget);
      expect(probe.pins, isEmpty);
      expect(_confirm(tester).onPressed, isNull);
      // Outside after a valid pin keeps the valid pin.
      probe.onPoint!(22.66, 106.25, true);
      await tester.pump();
      probe.onPoint!(10.0, 100.0, false);
      await tester.pump();
      expect(probe.pins.single['lat'], 22.66);
      expect(picked, 0);
    });

    testWidgets(
        'map error is shown and saves nothing; invalid coordinate is ignored',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) => picked++,
              mapBuilder: _fakeMap(probe)));
      probe.onError!('Không mở được bản đồ Cao Bằng');
      await tester.pump();
      expect(find.text('Không mở được bản đồ Cao Bằng'), findsOneWidget);
      probe.onPoint!(double.nan, 106.0, true);
      await tester.pump();
      expect(_confirm(tester).onPressed, isNull);
      expect(picked, 0);
    });

    testWidgets(
        'map instance is not rebuilt when nothing about the pin changed',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) {},
              mapBuilder: _fakeMap(probe)));
      probe.onError!('x');
      await tester.pump();
      probe.onError!('y');
      await tester.pump();
      expect(probe.builds, 1);
    });
  });

  // #413: Gọi ship uses the shared address flow (block -> saved list -> map), not the old pin-only screen.
  group('Gọi ship form with the shared address flow', () {
    AddressMapBuilder sharedMap() => (BuildContext context, double? lat,
            double? lng, void Function(double, double) onPick) =>
        Column(children: <Widget>[
          Text('$lat,$lng', key: const Key('test-pin')),
          TextButton(
              key: const Key('test-move-pin'),
              onPressed: () => onPick(22.661, 106.251),
              child: const Text('move')),
        ]);

    testWidgets(
        'pickup: text from the map, description joined after a comma, pin shown in the block',
        (WidgetTester tester) async {
      await _mount(
          tester,
          CustomerCallScreen(
              source: SampleCustomerDeliverySource(),
              addressMapBuilder: sharedMap()));
      expect(find.textContaining('Chưa ghim (tùy chọn)'), findsNWidgets(2));
      await tester.tap(find.byKey(const Key('m07-c-pickup-addr')));
      await _nav(tester);
      expect(find.byKey(const Key('pick-add-new')), findsOneWidget);
      await tester.tap(find.byKey(const Key('pick-add-new')));
      await _nav(tester);
      await tester.enterText(
          find.byKey(const Key('location-address-text')), 'Số 1 Phố Huế');
      await tester.enterText(
          find.byKey(const Key('location-extra-note')), 'Tầng 2');
      await tester.tap(find.byKey(const Key('test-move-pin')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('location-save')));
      await _nav(tester);
      expect(find.text('Số 1 Phố Huế, Tầng 2'), findsOneWidget);
      expect(find.text('Đã ghim (22.661, 106.251)'), findsOneWidget);
      expect(find.textContaining('Chưa ghim (tùy chọn)'), findsOneWidget,
          reason: 'the drop-off point is still unpinned');
    });

    testWidgets(
        'Vị trí hiện tại inside the area pins the drop-off; a refusal outside pins nothing',
        (WidgetTester tester) async {
      final _FakeLocation location =
          _FakeLocation(<Object>[_fix(10.0, 106.0), _fix(22.668, 106.26)]);
      await _mount(
          tester,
          CustomerCallScreen(
              source: SampleCustomerDeliverySource(),
              addressMapBuilder: sharedMap(),
              location: location));
      await tester.ensureVisible(find.byKey(const Key('m07-c-dropoff-addr')));
      await tester.tap(find.byKey(const Key('m07-c-dropoff-addr')));
      await _nav(tester);
      await tester.tap(find.byKey(const Key('pick-add-new')));
      await _nav(tester);
      await tester.enterText(
          find.byKey(const Key('location-address-text')), 'Số 10 Phố Trúc');
      await tester.tap(find.byKey(const Key('location-current')));
      await tester.pumpAndSettle();
      expect(find.text(kOutsideCoverageMessage), findsOneWidget);
      await tester.tap(find.byKey(const Key('location-current')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('location-save')));
      await _nav(tester);
      expect(find.text('Số 10 Phố Trúc'), findsOneWidget);
      expect(find.text('Đã ghim (22.668, 106.260)'), findsOneWidget);
    });
  });

  group('Vị trí hiện tại (one foreground fix, only on the press)', () {
    testWidgets(
        'no GPS on open; a fix moves only the preview pin; nothing saved until confirm',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final _FakeLocation location =
          _FakeLocation(<Object>[_fix(22.668, 106.26)]);
      final List<(double, double)> picked = <(double, double)>[];
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim điểm lấy hàng',
              onPick: (double a, double b) => picked.add((a, b)),
              location: location,
              mapBuilder: _fakeMap(probe)));
      expect(location.calls, 0);
      expect(probe.pins, isEmpty);
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pumpAndSettle();
      expect(location.calls, 1);
      expect(probe.pins.single['lat'], 22.668);
      expect(probe.pins.single['lon'], 106.26);
      expect(find.textContaining('22.66800, 106.26000'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNotNull);
      expect(picked, isEmpty);
      await tester.tap(find.byKey(const Key('pin-confirm')));
      await tester.pump();
      expect(picked, <(double, double)>[(22.668, 106.26)]);
    });

    testWidgets(
        'a refusal shows its reason, saves nothing, keeps the map usable, and a retry can succeed',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final _FakeLocation location = _FakeLocation(<Object>[
        const LocationException(LocationFailure.denied),
        _fix(22.668, 106.26)
      ]);
      int picked = 0;
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) => picked++,
              location: location,
              mapBuilder: _fakeMap(probe)));
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Chưa được cấp quyền vị trí'), findsOneWidget);
      expect(probe.pins, isEmpty);
      expect(_confirm(tester).onPressed, isNull);
      expect(probe.builds, 1);
      // A manual tap still works after the refusal.
      probe.onPoint!(22.7, 106.3, true);
      await tester.pump();
      expect(probe.pins.single['lat'], 22.7);
      expect(find.textContaining('Chưa được cấp quyền vị trí'), findsNothing);
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pumpAndSettle();
      expect(probe.pins.single['lat'], 22.668);
      expect(picked, 0);
    });

    testWidgets(
        'disabled, timeout and unavailable each say what happened and never invent a point',
        (WidgetTester tester) async {
      final List<(LocationFailure, String)> cases = <(LocationFailure, String)>[
        (LocationFailure.disabled, 'Hãy bật định vị'),
        (LocationFailure.timeout, 'Chưa lấy được vị trí'),
        (LocationFailure.unavailable, 'chưa cung cấp vị trí hợp lệ'),
      ];
      for (int i = 0; i < cases.length; i++) {
        final _Probe probe = _Probe();
        final _FakeLocation location =
            _FakeLocation(<Object>[LocationException(cases[i].$1)]);
        await _mount(
            tester,
            FoodPinPickScreen(
                key: ValueKey<int>(i),
                title: 'Ghim',
                onPick: (double a, double b) {},
                location: location,
                mapBuilder: _fakeMap(probe)));
        await tester.tap(find.byKey(const Key('pin-current-location')));
        await tester.pumpAndSettle();
        expect(find.textContaining(cases[i].$2), findsOneWidget,
            reason: cases[i].$1.name);
        expect(probe.pins, isEmpty, reason: cases[i].$1.name);
        expect(_confirm(tester).onPressed, isNull, reason: cases[i].$1.name);
      }
    });

    testWidgets(
        'a fix outside the Cao Bằng coverage is refused with a message, not pinned',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final _FakeLocation location = _FakeLocation(<Object>[_fix(21.0, 105.8)]);
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) {},
              location: location,
              mapBuilder: _fakeMap(probe)));
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pumpAndSettle();
      expect(find.textContaining('nằm ngoài vùng bản đồ Cao Bằng'),
          findsOneWidget);
      expect(probe.pins, isEmpty);
      expect(_confirm(tester).onPressed, isNull);
    });

    testWidgets(
        'an existing point is never overwritten on open; only the press replaces the preview',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final _FakeLocation location =
          _FakeLocation(<Object>[_fix(22.668, 106.26)]);
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              initialLat: 22.65,
              initialLng: 106.2,
              onPick: (double a, double b) {},
              location: location,
              mapBuilder: _fakeMap(probe)));
      expect(location.calls, 0);
      expect(probe.pins.single['lat'], 22.65);
      expect(find.textContaining('22.65000, 106.20000'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pumpAndSettle();
      expect(probe.pins.single['lat'], 22.668);
    });

    testWidgets('a tap made while the fix is pending wins over the late fix',
        (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final _DelayedLocation location = _DelayedLocation();
      await _mount(
          tester,
          FoodPinPickScreen(
              title: 'Ghim',
              onPick: (double a, double b) {},
              location: location,
              mapBuilder: _fakeMap(probe)));
      await tester.tap(find.byKey(const Key('pin-current-location')));
      await tester.pump();
      expect(find.text('Đang lấy vị trí…'), findsOneWidget);
      probe.onPoint!(22.7, 106.3, true);
      await tester.pump();
      location.complete(_fix(22.668, 106.26));
      await tester.pumpAndSettle();
      expect(probe.pins.single['lat'], 22.7);
      expect(find.text('Vị trí hiện tại'), findsOneWidget);
    });
  });
}

LocationFix _fix(double lat, double lng) => LocationFix(
    latitude: lat,
    longitude: lng,
    accuracyMeters: 8,
    takenAt: DateTime(2026, 11, 19));

/// Answers each call in order (the last answer repeats); records the number of calls.
class _FakeLocation implements LocationProvider {
  _FakeLocation(this.answers);
  final List<Object> answers;
  int calls = 0;
  @override
  Future<LocationFix> currentFix() async {
    final Object next =
        answers[calls < answers.length ? calls : answers.length - 1];
    calls++;
    if (next is LocationException) throw next;
    return next as LocationFix;
  }
}

/// A fix that arrives only when the test completes it.
class _DelayedLocation implements LocationProvider {
  final Completer<LocationFix> _fix = Completer<LocationFix>();
  void complete(LocationFix fix) => _fix.complete(fix);
  @override
  Future<LocationFix> currentFix() => _fix.future;
}
