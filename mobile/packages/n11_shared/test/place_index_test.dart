import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #283: the offline place index built from the OpenStreetMap extract (scripts/places/build-search-index.mjs). These tests read the REAL
// generated asset, so they also guard the build output (bounds, shape, no invented coordinates).

OfflinePlaceIndex realIndex() => OfflinePlaceIndex.parse(File('assets/places/caobang-places.json').readAsStringSync());

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('the generated index', () {
    test('has the documented shape, stays inside the offline map bounds and carries its OpenStreetMap source', () {
      final Map<String, Object?> doc = jsonDecode(File('assets/places/caobang-places.json').readAsStringSync()) as Map<String, Object?>;
      expect(doc['version'], 1);
      expect(doc['mapVersion'], 'caobang-v1.3-2026-10-14');
      expect(doc['source'], contains('OpenStreetMap'));
      final List<double> b = (doc['bounds']! as List<Object?>).map((Object? v) => (v! as num).toDouble()).toList();
      expect(b, <double>[106.0, 22.43, 106.52, 22.91]);
      final List<Object?> places = doc['places']! as List<Object?>;
      expect(places.length, doc['count']);
      expect(places.length, greaterThan(300));
      for (final Object? p in places) {
        final List<Object?> row = p! as List<Object?>;
        final double lat = (row[1]! as num).toDouble();
        final double lng = (row[2]! as num).toDouble();
        expect(lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3], isTrue, reason: '${row[0]} is outside the map package, so it could not be pinned');
        expect((row[0]! as String).trim(), isNotEmpty);
      }
      expect(File('assets/places/caobang-places.json').lengthSync(), lessThan(300 * 1024), reason: 'the index must stay small in the APK');
    });

    test('every row is a place OpenStreetMap names: a house number the data does not have finds nothing, never an invented point', () {
      final OfflinePlaceIndex index = realIndex();
      expect(index.search('số 12 ngõ 8 xóm không có thật'), isEmpty);
      expect(index.search('zzzzzz'), isEmpty);
      expect(index.search('   '), isEmpty);
    });
  });

  group('searching', () {
    test('with and without Vietnamese marks and in any case finds the same place with a real point', () {
      final OfflinePlaceIndex index = realIndex();
      final List<PlaceSearchResult> marked = index.search('Bệnh viện đa khoa tỉnh Cao Bằng');
      final List<PlaceSearchResult> plain = index.search('benh vien da khoa tinh cao bang');
      final List<PlaceSearchResult> shouting = index.search('BỆNH VIỆN ĐA KHOA');
      expect(marked, isNotEmpty);
      expect(plain.first.id, marked.first.id);
      expect(shouting.map((PlaceSearchResult r) => r.name), contains('Bệnh viện Đa khoa tỉnh Cao Bằng'));
      expect(marked.first.latitude, inInclusiveRange(22.43, 22.91));
      expect(marked.first.longitude, inInclusiveRange(106.0, 106.52));
      expect(marked.first.approximate, isFalse);
    });

    test('a word typed half way, the places of a kind, and one typing mistake still find the place', () {
      final OfflinePlaceIndex index = realIndex();
      expect(index.search('cho tan gi').map((PlaceSearchResult r) => r.name), contains('Chợ Tân Giang'));
      expect(index.search('cho tan giang').first.name, 'Chợ Tân Giang');
      expect(index.search('khach san'), isNotEmpty, reason: 'the kind of place is searchable');
      expect(index.search('bưu dien tinh').map((PlaceSearchResult r) => r.name), contains('Bưu điện tỉnh Cao Bằng'));
      expect(index.search('benh vien da khoa tinh cao bnag').map((PlaceSearchResult r) => r.name), contains('Bệnh viện Đa khoa tỉnh Cao Bằng'));
    });

    test('a road, a village or a river is one real point on it and says so (approximate); a facility is not', () {
      final OfflinePlaceIndex index = realIndex();
      final PlaceSearchResult village = index.search('Bản Cáu').first;
      expect(village.name, 'Bản Cáu');
      expect(village.approximate, isTrue);
      expect(index.search('Cao Bằng').where((PlaceSearchResult r) => r.name == 'Cao Bằng' && r.approximate), isNotEmpty);
    });

    test('is fast enough for every key press: two hundred searches take well under a second', () {
      final OfflinePlaceIndex index = realIndex();
      final Stopwatch watch = Stopwatch()..start();
      for (int i = 0; i < 200; i++) {
        index.search(<String>['cho', 'benh vien', 'khach san', 'truong mam non', 'ngan hang'][i % 5]);
      }
      watch.stop();
      expect(watch.elapsedMilliseconds, lessThan(1000));
    });

    test('a damaged file is refused and a damaged row is skipped, never guessed', () {
      expect(() => OfflinePlaceIndex.parse('{"version":2}'), throwsFormatException);
      final OfflinePlaceIndex index = OfflinePlaceIndex.parse(
        '{"version":1,"mapVersion":"t","categories":{"place":"Địa danh"},"places":[["Ok",22.6,106.2,"place"],["No point","x",1,"place"],["Far",95,106.2,"place"],[1,2,3,"place"]]}',
      );
      expect(index.length, 1);
      expect(index.search('ok').single.address, 'Ok, Cao Bằng');
    });
  });

  testWidgets('the picker searches the bundled index with no Internet and no sign-in: choose a place, adjust nothing, Save returns its real point', (WidgetTester tester) async {
    AddressLocation? saved;
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (BuildContext context) => TextButton(
      child: const Text('Open'),
      onPressed: () async => saved = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(builder: (_) => AddressLocationPicker(
        initial: const AddressLocation(''), requirePoint: false,
        mapBuilder: (_, lat, lng, onPick) => const SizedBox(height: 100),
      ))),
    ))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), 'cho tan giang');
    await tester.pump(const Duration(milliseconds: 150));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();
    final Finder first = find.textContaining('Chợ Tân Giang');
    expect(first, findsWidgets);
    await tester.tap(first.first);
    await tester.pump();
    expect(find.text('Sẽ lưu địa chỉ cùng vị trí đã ghim.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    expect(saved?.text, contains('Chợ Tân Giang'));
    expect(saved?.latitude, inInclusiveRange(22.43, 22.91));
    expect(saved?.longitude, inInclusiveRange(106.0, 106.52));
  });

  testWidgets('choosing a road or village pins one point on it and asks the person to adjust the pin', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: AddressLocationPicker(
      initial: const AddressLocation(''), requirePoint: false,
      searchApi: OfflinePlaceSearchApi(loader: () async => File('assets/places/caobang-places.json').readAsStringSync()),
      mapBuilder: (_, lat, lng, onPick) => const SizedBox(height: 100),
    )));
    await tester.enterText(find.byKey(const Key('location-address-text')), 'Bản Cáu');
    await tester.pump(const Duration(milliseconds: 150));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();
    await tester.tap(find.byKey(Key('place-result-${realIndex().search('Bản Cáu').first.id}')));
    await tester.pump();
    expect(find.byKey(const Key('place-approximate-hint')), findsOneWidget);
  });
}
