import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_alerts.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_m07.dart';

// #194 widget renders of the 11Ship home: normal, GPS off, Internet down, both down, server not answering, old position and a resting shipper. They are built
// from the real ShipHomeLayout, computeShipAlert and buildLocationView with scripted state: renders of the widgets, NOT a device or a server. Skipped unless
//   N11_SCREENSHOTS=/tmp/ship-home-alerts flutter test test/home_alert_screenshots_test.dart

void main() {
  final String? out = Platform.environment['N11_SCREENSHOTS'];
  final GlobalKey boundary = GlobalKey();
  final DateTime t0 = DateTime.utc(2026, 10, 25, 9);

  setUpAll(() async {
    if (out == null) return;
    final FontLoader loader = FontLoader('packages/n11_shared/PlusJakartaSans');
    for (final String w in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      final Uint8List bytes = File('../packages/n11_shared/assets/fonts/PlusJakartaSans-$w.ttf').readAsBytesSync();
      loader.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  Future<void> render(WidgetTester tester, String name, {required ShipAlert? alert, required ShipLocationView view, bool online = true, bool paused = false, bool openInfo = false, bool openDetails = false}) async {
    tester.view.physicalSize = const Size(720, 1480);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(RepaintBoundary(
      key: boundary,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildN11Theme(),
        home: Scaffold(
          body: ShipHomeLayout(
            online: online,
            paused: paused,
            reason: 'Ví đủ điều kiện. Bạn có thể bật hoạt động.',
            onNotifications: () {},
            alert: alert == null ? null : ShipAlertBanner(alert: alert, onAction: (ShipAlertAction _) {}),
            locationView: view,
          ),
        ),
      ),
    ));
    await tester.pump();
    if (openDetails && alert != null) {
      await tester.tap(find.byKey(const Key('ship-alert-more')));
      await tester.pump();
    }
    if (openInfo) {
      await tester.tap(find.byKey(const Key('home-location-info')));
      await tester.pump();
    }
    expect(find.byKey(const Key('home-location-label')), findsOneWidget);
    if (alert != null) expect(find.byKey(const Key('ship-alert')), findsOneWidget);
    if (out == null) return;
    final RenderRepaintBoundary object = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => object.toImage(pixelRatio: 2)))!;
    final ByteData? data = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  }

  ShipLocationView live({bool open = false}) => buildLocationView(intent: true, hasWork: false, starting: false, sharing: true, problem: LocationProblem.none, uploadFailed: false, now: t0.add(const Duration(seconds: 20)), ackAt: t0, fixAt: t0, accuracyMetres: 12, hasFix: true);
  ShipLocationView old() => buildLocationView(intent: true, hasWork: false, starting: false, sharing: true, problem: LocationProblem.none, uploadFailed: false, now: t0.add(const Duration(seconds: 130)), ackAt: t0, fixAt: t0, accuracyMetres: 12, hasFix: true);
  ShipLocationView problem(LocationProblem p) => buildLocationView(intent: true, hasWork: false, starting: false, sharing: true, problem: p, uploadFailed: false, now: t0.add(const Duration(seconds: 130)), ackAt: t0, fixAt: null, accuracyMetres: null, hasFix: false);

  testWidgets('01 online, everything works: only the small label', (WidgetTester tester) async {
    await render(tester, '01-online-ok', alert: null, view: live());
    expect(find.byKey(const Key('ship-alert')), findsNothing);
  });

  testWidgets('02 online with the location explanation open', (WidgetTester tester) async {
    await render(tester, '02-online-explanation', alert: null, view: live(), openInfo: true);
    expect(find.byKey(const Key('home-location-explainer')), findsOneWidget);
  });

  testWidgets('03 GPS off', (WidgetTester tester) async {
    await render(tester, '03-gps-off', alert: computeShipAlert(intent: true, hasWork: false, problem: LocationProblem.gpsOff, internetAvailable: true, health: HealthPhase.ready, paused: true, acquiring: false), view: problem(LocationProblem.gpsOff), paused: true);
  });

  testWidgets('04 Internet down (the phone says so), GPS fine', (WidgetTester tester) async {
    await render(tester, '04-internet-down', alert: computeShipAlert(intent: true, hasWork: false, problem: LocationProblem.none, internetAvailable: false, health: HealthPhase.offline, paused: false, acquiring: false), view: old());
  });

  testWidgets('05 Internet fine, the server does not answer', (WidgetTester tester) async {
    await render(tester, '05-server-unreachable', alert: computeShipAlert(intent: true, hasWork: false, problem: LocationProblem.none, internetAvailable: true, health: HealthPhase.timeout, paused: false, acquiring: false), view: old(), openDetails: true);
  });

  testWidgets('06 both really down', (WidgetTester tester) async {
    await render(tester, '06-network-and-gps', alert: computeShipAlert(intent: true, hasWork: false, problem: LocationProblem.gpsOff, internetAvailable: false, health: HealthPhase.offline, paused: true, acquiring: false), view: problem(LocationProblem.gpsOff), paused: true);
  });

  testWidgets('07 old position after the 100 s window', (WidgetTester tester) async {
    await render(tester, '07-stale-position', alert: computeShipAlert(intent: true, hasWork: false, problem: LocationProblem.none, internetAvailable: true, health: HealthPhase.ready, paused: true, acquiring: false), view: old(), paused: true, openInfo: true);
  });

  testWidgets('08 resting on purpose, GPS and Internet off: no red', (WidgetTester tester) async {
    final ShipLocationView v = buildLocationView(intent: false, hasWork: false, starting: false, sharing: false, problem: LocationProblem.none, uploadFailed: false, now: t0, ackAt: null, fixAt: null, accuracyMetres: null, hasFix: false);
    await render(tester, '08-resting', alert: computeShipAlert(intent: false, hasWork: false, problem: LocationProblem.none, internetAvailable: false, health: HealthPhase.offline, paused: false, acquiring: false), view: v, online: false);
    expect(find.byKey(const Key('ship-alert')), findsNothing);
  });
}
