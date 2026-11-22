import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// #413: the one address flow for Đặt món and Gọi ship. Block (A) -> saved list (B) -> map (C), with the rules of the approved design.

DeliveryAddress _saved(String id,
        {String? note,
        String? name,
        AddressLabel label = AddressLabel.home,
        double? lat = 22.66,
        double? lng = 106.25}) =>
    DeliveryAddress(
      id: id,
      label: label,
      displayName: name,
      recipientName: 'Người nhận',
      contactPhone: '+84912345678',
      addressText: 'Số 1 Phố Huế',
      deliveryNote: note,
      version: 1,
      latitude: lat,
      longitude: lng,
    );

class _Book implements AddressApi {
  _Book(this.rows);
  final List<DeliveryAddress> rows;

  @override
  Future<List<DeliveryAddress>> list() async => rows;

  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) =>
      throw UnimplementedError();

  @override
  Future<DeliveryAddress> update(String id, AddressInput input,
          {required int expectedVersion, required String key}) =>
      throw UnimplementedError();

  @override
  Future<String?> delete(String id, {required String key}) =>
      throw UnimplementedError();

  @override
  Future<void> setDefault(String id, {required String key}) =>
      throw UnimplementedError();

  @override
  Future<void> setDefaultKind(String id, AddressDefaultKind kind, bool enabled,
          {required String key}) =>
      throw UnimplementedError();
}

class _Search implements PlaceSearchApi {
  _Search(this.rows);
  final List<PlaceSearchResult> rows;

  @override
  Future<List<PlaceSearchResult>> search(String query) async => rows;
}

/// The map of C in tests: shows the pin as text and lets the test move it.
Widget _map(BuildContext context, double? lat, double? lng,
        void Function(double, double) onPick) =>
    Column(children: <Widget>[
      Text('$lat,$lng', key: const Key('test-pin')),
      TextButton(
          key: const Key('test-move-pin'),
          onPressed: () => onPick(22.67, 106.26),
          child: const Text('move')),
      TextButton(
          key: const Key('test-outside'),
          onPressed: () => onPick(10.0123, 106.0456),
          child: const Text('outside')),
    ]);

class _Harness {
  _Harness(
      {this.book,
      this.search,
      this.location,
      this.initial = const AddressLocation('')});

  final AddressBookController? book;
  final PlaceSearchApi? search;
  final LocationProvider? location;
  final AddressLocation initial;

  bool returned = false;
  SharedAddressSelection? result;

  Future<void> mount(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (BuildContext context) => Scaffold(
          body: TextButton(
            key: const Key('open'),
            onPressed: () async {
              result = await pickSharedAddress(context,
                  initial: initial,
                  book: book,
                  location: location,
                  searchApi: search,
                  mapBuilder: _map);
              returned = true;
            },
            child: const Text('Open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.byKey(const Key('open')));
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets('the confirm block opens the saved list, never the map',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
        book:
            AddressBookController(api: _Book(<DeliveryAddress>[_saved('h1')])));
    await h.mount(tester);
    expect(find.byKey(const Key('pick-search')), findsOneWidget);
    expect(find.text('Địa chỉ đã lưu'), findsOneWidget);
    expect(find.byKey(const Key('location-address-text')), findsNothing);
    expect(find.byKey(const Key('test-pin')), findsNothing);
  });

  testWidgets(
      'a saved address is picked at once and returns to the caller without the map',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
        book:
            AddressBookController(api: _Book(<DeliveryAddress>[_saved('h1')])),
        initial: const AddressLocation('Số 1 Phố Huế'));
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-saved-h1')));
    await tester.pumpAndSettle();
    expect(h.returned, isTrue);
    expect(h.result?.saved?.id, 'h1');
    expect(h.result?.location, isNull);
    expect(find.byKey(const Key('location-address-text')), findsNothing);
  });

  testWidgets(
      'Nhà and Công ty are offered when missing, and a saved Công ty is listed with its name',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
        book: AddressBookController(
            api: _Book(<DeliveryAddress>[
      _saved('o1', label: AddressLabel.office, name: 'Văn phòng')
    ])));
    await h.mount(tester);
    expect(find.byKey(const Key('pick-add-home')), findsOneWidget);
    expect(find.byKey(const Key('pick-add-office')), findsNothing);
    expect(find.byKey(const Key('pick-saved-o1')), findsOneWidget);
    expect(find.text('Văn phòng'), findsOneWidget);
  });

  testWidgets('Sửa opens the map prefilled with the address in use',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
        book:
            AddressBookController(api: _Book(<DeliveryAddress>[_saved('h1')])),
        initial: const AddressLocation('12 Lê Lợi',
            latitude: 22.66, longitude: 106.25));
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-edit-current')));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const Key('location-address-text')))
            .controller!
            .text,
        '12 Lê Lợi');
    expect(find.text('22.66,106.25'), findsOneWidget);
  });

  testWidgets('Thêm địa chỉ mới and the map icon both open the map',
      (WidgetTester tester) async {
    final _Harness h =
        _Harness(book: AddressBookController(api: _Book(<DeliveryAddress>[])));
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-open-map')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('location-address-text')), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pick-add-new')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('location-address-text')), findsOneWidget);
  });

  testWidgets(
      'a suggestion from the search opens the map with its point and text',
      (WidgetTester tester) async {
    final PlaceSearchResult place = PlaceSearchResult(
        id: 'bv',
        name: 'Bệnh viện',
        address: 'Bệnh viện Cao Bằng',
        latitude: 22.66,
        longitude: 106.25,
        inCaoBang: true,
        kind: 'Bệnh viện');
    final _Harness h = _Harness(search: _Search(<PlaceSearchResult>[place]));
    await h.mount(tester);
    await tester.enterText(find.byKey(const Key('pick-search')), 'Bệnh');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pick-result-bv')));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const Key('location-address-text')))
            .controller!
            .text,
        'Bệnh viện Cao Bằng');
    expect(find.text('22.66,106.25'), findsOneWidget);
  });

  testWidgets(
      'typing keeps the pin, never asks keep or clear, and Save returns both',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
      book: AddressBookController(api: _Book(<DeliveryAddress>[_saved('h1')])),
      initial: const AddressLocation('12 Lê Lợi',
          latitude: 22.66, longitude: 106.25),
    );
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-edit-current')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('location-address-text')), '12 Lê Lợi, ngõ 8');
    await tester.pump();
    expect(find.text('Giữ ghim – chỉ bổ sung mô tả'), findsNothing);
    expect(find.text('Bỏ ghim – đổi địa điểm'), findsNothing);
    expect(find.text('22.66,106.25'), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(h.result?.location?.text, '12 Lê Lợi, ngõ 8');
    expect(h.result?.location?.latitude, 22.66);
    expect(h.result?.location?.longitude, 106.25);
  });

  testWidgets(
      'dragging the pin changes the coordinates and leaves the text alone',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
        initial:
            const AddressLocation('Tổ 3', latitude: 22.66, longitude: 106.25));
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-edit-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('test-move-pin')));
    await tester.pump();
    expect(find.text('22.67,106.26'), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(h.result?.location?.text, 'Tổ 3');
    expect(h.result?.location?.latitude, 22.67);
  });

  testWidgets('Vị trí hiện tại inside the area sets the pin',
      (WidgetTester tester) async {
    final FakeLocationProvider gps = FakeLocationProvider()
      ..next = LocationFix(
          latitude: 22.66,
          longitude: 106.25,
          accuracyMeters: 8,
          takenAt: DateTime.utc(2026, 11, 20));
    final _Harness h = _Harness(location: gps);
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-open-map')));
    await tester.pumpAndSettle();
    // The address text is still required to save; the pin is what the fix sets.
    await tester.enterText(
        find.byKey(const Key('location-address-text')), 'Tổ 16');
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(gps.calls, 1);
    expect(find.text('22.66,106.25'), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(h.result?.location?.latitude, 22.66);
  });

  testWidgets(
      'Vị trí hiện tại refused (denied, disabled, outside the area) explains it and changes nothing',
      (WidgetTester tester) async {
    final FakeLocationProvider gps = FakeLocationProvider()
      ..failure = LocationFailure.denied;
    final _Harness h = _Harness(location: gps);
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-open-map')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Chưa được cấp quyền'), findsOneWidget);
    expect(find.text('null,null'), findsOneWidget);

    gps.failure = LocationFailure.disabled;
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Hãy bật vị trí'), findsOneWidget);
    expect(find.text('null,null'), findsOneWidget);

    gps
      ..failure = null
      ..next = LocationFix(
          latitude: 10.0123,
          longitude: 106.0456,
          accuracyMeters: 8,
          takenAt: DateTime.utc(2026, 11, 20));
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    expect(find.text(kOutsideCoverageMessage), findsOneWidget);
    expect(find.text('null,null'), findsOneWidget);
  });

  testWidgets(
      'a map tap outside the covered area is refused with the same message',
      (WidgetTester tester) async {
    final _Harness h = _Harness();
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-open-map')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('test-outside')));
    await tester.pump();
    expect(find.text(kOutsideCoverageMessage), findsOneWidget);
    expect(find.text('null,null'), findsOneWidget);
  });

  testWidgets('saving without a pin is allowed and returns the typed text only',
      (WidgetTester tester) async {
    final _Harness h = _Harness();
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-add-new')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('location-address-text')), 'Tổ 3, Cao Bằng');
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('location-picker-error')), findsNothing);
    expect(h.result?.location?.text, 'Tổ 3, Cao Bằng');
    expect(h.result?.location?.latitude, isNull);
  });

  testWidgets(
      'the optional description is saved with the address and shown on the list and the address in use',
      (WidgetTester tester) async {
    final _Harness h = _Harness(
      book: AddressBookController(
          api: _Book(
              <DeliveryAddress>[_saved('h1', note: 'Tầng 2, cổng xanh')])),
      initial: const AddressLocation('12 Lê Lợi', note: 'Ngõ 8, nhà số 12'),
    );
    await h.mount(tester);
    expect(find.text('Số 1 Phố Huế · Tầng 2, cổng xanh'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('pick-current-note'))).data,
        'Ngõ 8, nhà số 12',
        reason: 'the address in use shows its description under the text');
    await tester.tap(find.byKey(const Key('pick-edit-current')));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const Key('location-extra-note')))
            .controller!
            .text,
        'Ngõ 8, nhà số 12');
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(h.result?.location?.note, 'Ngõ 8, nhà số 12');
  });

  testWidgets(
      'the description is optional and capped: an empty one is returned as empty, a long one at the delivery-note limit',
      (WidgetTester tester) async {
    final _Harness h = _Harness();
    await h.mount(tester);
    await tester.tap(find.byKey(const Key('pick-add-new')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('location-address-text')), 'Tổ 3');
    await tester.enterText(find.byKey(const Key('location-extra-note')),
        'x' * (kAddressNoteMaxLength + 50));
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(h.result?.location?.note.length, kAddressNoteMaxLength);
  });

  testWidgets(
      'Gọi ship uses the same flow: a saved pickup fills the point with its text, pin and description',
      (WidgetTester tester) async {
    final AddressBookController book = AddressBookController(
        api: _Book(<DeliveryAddress>[
      _saved('h1', note: 'Tầng 2', lat: 22.66, lng: 106.25)
    ]));
    await tester.pumpWidget(MaterialApp(
        home: CustomerCallScreen(
            source: SampleCustomerDeliverySource(), addresses: book)));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('m07-c-pickup-addr')));
    await tester.tap(find.byKey(const Key('m07-c-pickup-addr')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pick-saved-h1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('pick-saved-h1')));
    await tester.pumpAndSettle();
    expect(find.text('Số 1 Phố Huế, Tầng 2'), findsOneWidget);
    expect(find.text('Đã ghim (22.660, 106.250)'), findsOneWidget);
  });
}
