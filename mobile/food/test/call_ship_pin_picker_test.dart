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

FoodPinMapBuilder _fakeMap(_Probe probe) => (BuildContext context, List<Map<String, dynamic>> pins, _PointFn onPoint, void Function(String) onError) {
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

FilledButton _confirm(WidgetTester tester) => tester.widget<FilledButton>(find.byKey(const Key('pin-confirm')));

void main() {
  group('FoodPinPickScreen', () {
    testWidgets('empty start: AppBar, instruction, hint icon, confirm disabled, no pin drawn', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(tester, FoodPinPickScreen(title: 'Ghim điểm lấy hàng', onPick: (double a, double b) => picked++, mapBuilder: _fakeMap(probe)));
      expect(find.text('Ghim điểm lấy hàng'), findsOneWidget);
      expect(find.text('Chạm bản đồ để đặt ghim'), findsOneWidget);
      expect(find.byKey(const Key('pin-hint')), findsOneWidget);
      expect(find.text('Xác nhận vị trí'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNull);
      expect(probe.pins, isEmpty);
      expect(picked, 0);
    });

    testWidgets('tap inside: real pin at the tapped point, preview, no auto close, 2nd tap moves it, confirm calls onPick once with the last point', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      final List<(double, double)> picked = <(double, double)>[];
      await _mount(tester, FoodPinPickScreen(title: 'Ghim', onPick: (double a, double b) => picked.add((a, b)), mapBuilder: _fakeMap(probe)));
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
      await tester.tap(find.byKey(const Key('pin-confirm')), warnIfMissed: false);
      await tester.pump();
      expect(picked, <(double, double)>[(22.7, 106.3)]);
    });

    testWidgets('existing point: old pin shown, confirm enabled, editable', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      await _mount(tester, FoodPinPickScreen(title: 'Ghim', initialLat: 22.65, initialLng: 106.2, onPick: (double a, double b) {}, mapBuilder: _fakeMap(probe)));
      expect(probe.pins.single['lat'], 22.65);
      expect(find.textContaining('22.65000, 106.20000'), findsOneWidget);
      expect(_confirm(tester).onPressed, isNotNull);
      probe.onPoint!(22.68, 106.22, true);
      await tester.pump();
      expect(probe.pins.single['lat'], 22.68);
    });

    testWidgets('tap outside coverage: no point stored, no close, short message', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(tester, FoodPinPickScreen(title: 'Ghim', onPick: (double a, double b) => picked++, mapBuilder: _fakeMap(probe)));
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

    testWidgets('map error is shown and saves nothing; invalid coordinate is ignored', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      int picked = 0;
      await _mount(tester, FoodPinPickScreen(title: 'Ghim', onPick: (double a, double b) => picked++, mapBuilder: _fakeMap(probe)));
      probe.onError!('Không mở được bản đồ Cao Bằng');
      await tester.pump();
      expect(find.text('Không mở được bản đồ Cao Bằng'), findsOneWidget);
      probe.onPoint!(double.nan, 106.0, true);
      await tester.pump();
      expect(_confirm(tester).onPressed, isNull);
      expect(picked, 0);
    });

    testWidgets('map instance is not rebuilt when nothing about the pin changed', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      await _mount(tester, FoodPinPickScreen(title: 'Ghim', onPick: (double a, double b) {}, mapBuilder: _fakeMap(probe)));
      probe.onError!('x');
      await tester.pump();
      probe.onError!('y');
      await tester.pump();
      expect(probe.builds, 1);
    });
  });

  group('Gọi ship form with the picker', () {
    M07PinPickerBuilder builder(_Probe probe) => (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng, String? label}) =>
        FoodPinPickScreen(title: label ?? 'Ghim', initialLat: lat, initialLng: lng, onPick: onPick, mapBuilder: _fakeMap(probe));

    testWidgets('pickup and drop-off stay separate; Back keeps the value; confirm overwrites', (WidgetTester tester) async {
      final _Probe probe = _Probe();
      await _mount(tester, CustomerCallScreen(source: SampleCustomerDeliverySource(), pinPicker: builder(probe)));
      // Pickup: pin, confirm.
      await tester.tap(find.text('Ghim vị trí lấy hàng (tùy chọn)'));
      await _nav(tester);
      expect(find.text('Ghim điểm lấy hàng'), findsOneWidget);
      probe.onPoint!(22.661, 106.251, true);
      await tester.pump();
      expect(find.text('Ghim vị trí lấy hàng (tùy chọn)'), findsNothing); // still on the picker, not the form
      await tester.tap(find.byKey(const Key('pin-confirm')));
      await _nav(tester);
      expect(find.text('Đã ghim (22.661, 106.251)'), findsOneWidget);
      // Drop-off: starts empty (not the pickup point), pin, confirm.
      await tester.tap(find.text('Ghim vị trí giao hàng (tùy chọn)'));
      await _nav(tester);
      expect(find.text('Ghim điểm giao hàng'), findsOneWidget);
      expect(probe.pins, isEmpty);
      probe.onPoint!(22.7, 106.3, true);
      await tester.pump();
      await tester.tap(find.byKey(const Key('pin-confirm')));
      await _nav(tester);
      expect(find.text('Đã ghim (22.661, 106.251)'), findsOneWidget);
      expect(find.text('Đã ghim (22.700, 106.300)'), findsOneWidget);
      // Reopen pickup: old pin visible; move it, then Back => unchanged.
      await tester.tap(find.text('Đã ghim (22.661, 106.251)'));
      await _nav(tester);
      expect(probe.pins.single['lat'], 22.661);
      probe.onPoint!(22.9, 106.9, true);
      await tester.pump();
      await tester.pageBack();
      await _nav(tester);
      expect(find.text('Đã ghim (22.661, 106.251)'), findsOneWidget);
      expect(find.text('Đã ghim (22.900, 106.900)'), findsNothing);
      // Reopen and confirm a new point => overwritten.
      await tester.tap(find.text('Đã ghim (22.661, 106.251)'));
      await _nav(tester);
      probe.onPoint!(22.9, 106.9, true);
      await tester.pump();
      await tester.tap(find.byKey(const Key('pin-confirm')));
      await _nav(tester);
      expect(find.text('Đã ghim (22.900, 106.900)'), findsOneWidget);
      expect(find.text('Đã ghim (22.700, 106.300)'), findsOneWidget);
    });
  });
}
