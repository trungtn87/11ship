import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

void main() {
  addressPickerUxTests();
  testWidgets('place search debounces and a late older response cannot replace the latest results', (WidgetTester tester) async {
    final _PendingSearch search = _PendingSearch();
    await tester.pumpWidget(MaterialApp(home: AddressLocationPicker(
      initial: const AddressLocation(''), requirePoint: false, searchApi: search,
      mapBuilder: (_, lat, lng, onPick) => const SizedBox.shrink(),
    )));
    await tester.enterText(find.byKey(const Key('location-address-text')), 'Cao');
    await tester.pump(const Duration(milliseconds: 499));
    expect(search.queries, isEmpty);
    await tester.pump(const Duration(milliseconds: 1));
    expect(search.queries, <String>['Cao']);
    await tester.enterText(find.byKey(const Key('location-address-text')), 'Bệnh viện');
    await tester.pump(const Duration(milliseconds: 500));
    expect(search.queries, <String>['Cao', 'Bệnh viện']);
    search.answers[1].complete(const <PlaceSearchResult>[
      PlaceSearchResult(id: 'new', name: 'Bệnh viện Cao Bằng', address: 'Bệnh viện Cao Bằng, Cao Bằng', latitude: 22.66, longitude: 106.25, inCaoBang: true),
    ]);
    await tester.pump();
    search.answers[0].complete(const <PlaceSearchResult>[
      PlaceSearchResult(id: 'old', name: 'Kết quả cũ', address: 'Cũ', latitude: 21, longitude: 105, inCaoBang: false),
    ]);
    await tester.pump();
    expect(find.text('Bệnh viện Cao Bằng'), findsOneWidget);
    expect(find.text('Kết quả cũ'), findsNothing);
  });

  testWidgets('editing text never silently keeps a stale pin', (WidgetTester tester) async {
    AddressLocation? saved;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => TextButton(
      child: const Text('Open'),
      onPressed: () async => saved = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(builder: (_) => AddressLocationPicker(
        initial: const AddressLocation('A', latitude: 22.66, longitude: 106.25), requirePoint: false,
        mapBuilder: (_, lat, lng, onPick) => const SizedBox.shrink(),
      ))),
    ))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), 'B');
    await tester.pump();
    expect(find.byKey(const Key('pin-text-confirmation')), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pump();
    expect(saved, isNull);
    await tester.tap(find.text('Bỏ ghim – đổi địa điểm'));
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(saved?.text, 'B');
    expect(saved?.latitude, isNull);
  });

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

class _PendingSearch implements PlaceSearchApi {
  final List<String> queries = <String>[];
  final List<Completer<List<PlaceSearchResult>>> answers = <Completer<List<PlaceSearchResult>>>[];

  @override
  Future<List<PlaceSearchResult>> search(String query) {
    queries.add(query);
    final Completer<List<PlaceSearchResult>> answer = Completer<List<PlaceSearchResult>>();
    answers.add(answer);
    return answer.future;
  }
}

// Issue #283 (UX): suggestions are optional help; typed text and Save always work.
class _FixedSearch implements PlaceSearchApi {
  _FixedSearch(this.results, {this.fail = false});
  final List<PlaceSearchResult> results;
  final bool fail;

  @override
  Future<List<PlaceSearchResult>> search(String query) async {
    if (fail) throw const AuthFailure(AuthFailureKind.unknownOutcome);
    return results;
  }
}

void addressPickerUxTests() {
  Future<AddressLocation?> openPicker(WidgetTester tester, PlaceSearchApi? search, {AddressLocation initial = const AddressLocation('')}) async {
    AddressLocation? saved;
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => TextButton(
      child: const Text('Open'),
      onPressed: () async => saved = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(builder: (_) => AddressLocationPicker(
        initial: initial, requirePoint: false, searchApi: search,
        mapBuilder: (_, lat, lng, onPick) => const SizedBox(key: Key('test-map'), height: 320),
      ))),
    ))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    return saved;
  }

  List<PlaceSearchResult> many() => <PlaceSearchResult>[
        for (int i = 0; i < 6; i++) PlaceSearchResult(id: 'p$i', name: 'Nhà $i', address: 'Nhà $i, Cao Bằng', latitude: 22.66 + i / 1000, longitude: 106.25, inCaoBang: true),
      ];

  testWidgets('free text is saved as typed with no pin, without choosing any suggestion', (WidgetTester tester) async {
    AddressLocation? saved;
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => TextButton(
      child: const Text('Open'),
      onPressed: () async => saved = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(builder: (_) => AddressLocationPicker(
        initial: const AddressLocation(''), requirePoint: false, searchApi: _FixedSearch(many()),
        mapBuilder: (_, lat, lng, onPick) => const SizedBox.shrink(),
      ))),
    ))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), 'nhà số 12, ngõ 8, Cao Bằng');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    expect(find.byKey(const Key('place-result-p0')), findsOneWidget, reason: 'suggestions appear but are not chosen for the person');
    expect(find.text('Sẽ lưu địa chỉ chữ, chưa ghim vị trí. Ghim bản đồ là tùy chọn.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(saved?.text, 'nhà số 12, ngõ 8, Cao Bằng');
    expect(saved?.latitude, isNull);
    expect(saved?.longitude, isNull);
  });

  testWidgets('six suggestions never push the map and Save out of reach; they can be hidden', (WidgetTester tester) async {
    await openPicker(tester, _FixedSearch(many()));
    await tester.enterText(find.byKey(const Key('location-address-text')), 'nhà');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    expect(tester.getSize(find.byKey(const Key('place-suggestions-box'))).height, lessThanOrEqualTo(208));
    expect(find.byKey(const Key('location-save')).hitTestable(), findsOneWidget);
    await tester.tap(find.byKey(const Key('place-suggestions-toggle')));
    await tester.pump();
    expect(find.byKey(const Key('place-suggestions-box')), findsNothing);
    expect(find.byKey(const Key('location-address-text')), findsOneWidget);
    await tester.tap(find.byKey(const Key('place-suggestions-toggle')));
    await tester.pump();
    expect(find.byKey(const Key('place-suggestions-box')), findsOneWidget);
  });

  testWidgets('choosing a suggestion pins its point and saves it; a failed search does not stop typing or Save', (WidgetTester tester) async {
    await openPicker(tester, _FixedSearch(many()));
    await tester.enterText(find.byKey(const Key('location-address-text')), 'nhà');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    await tester.tap(find.byKey(const Key('place-result-p2')));
    await tester.pump();
    expect(find.text('Sẽ lưu địa chỉ cùng vị trí đã ghim.'), findsOneWidget);
  });

  testWidgets('a failed search keeps the typed draft and Save still works', (WidgetTester tester) async {
    AddressLocation? saved;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => TextButton(
      child: const Text('Open'),
      onPressed: () async => saved = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(builder: (_) => AddressLocationPicker(
        initial: const AddressLocation(''), requirePoint: false, searchApi: _FixedSearch(const <PlaceSearchResult>[], fail: true),
        mapBuilder: (_, lat, lng, onPick) => const SizedBox.shrink(),
      ))),
    ))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), 'xóm Nà Lạn');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    expect(find.byKey(const Key('place-search-error')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('location-address-text'))).controller!.text, 'xóm Nà Lạn');
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(saved?.text, 'xóm Nà Lạn');
    expect(saved?.latitude, isNull);
  });
}
