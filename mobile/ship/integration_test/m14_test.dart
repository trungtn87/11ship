import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:n11_m14/n11_m14.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native M14 map, route/cache and no implicit GPS/history', (WidgetTester tester) async {
    const M14Client client = M14Client();
    final Map<String, dynamic> status = await client.status();
    expect(status['recording'], false);
    expect(status['lat'], null);
    final Map<String, dynamic> data = await client.mapPackage();
    expect(data['version'], contains('caobang-v1.3'));
    final Completer<void> ready = Completer<void>();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: M14OfflineMap(onReady: () => ready.complete(), onError: (String error) => ready.completeError(error)))));
    await tester.pumpAndSettle(const Duration(seconds: 2));
    expect(find.byType(AndroidView), findsOneWidget);
    await tester.runAsync(() => ready.future.timeout(const Duration(seconds: 60)));
    // Two real OSM road vertices; this is an explicit route request, never a GPS fix.
    final Map<String, dynamic> route = await client.calculate(
      origin: 'https://one1ship-m14-routing.onrender.com',
      startLat: 22.6672017, startLon: 106.2638557,
      endLat: 22.6566272, endLon: 106.2585301);
    expect(route['km'], greaterThan(1));
    expect(route['km'], lessThan(3));
    expect((route['coordinates'] as List).length, greaterThan(2));
    expect((await client.savedRoute())!['km'], route['km']);
    expect((await client.status())['recording'], false);
    expect((await client.status())['lat'], null);
    await tester.pumpWidget(const SizedBox()); // Exercise platform-view disposal.
    await tester.pumpAndSettle();
  });
}
