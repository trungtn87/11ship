import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_m07.dart';
import 'package:ship/ship_online.dart';

// S01 "Bật định vị ngay": one local fix for drawing the receiving area. It asks for the location permission only, never starts sharing, never sends a
// position and never changes the online switch, for a guest and for a signed-in shipper alike.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

const String _denied = 'Bạn chưa cho 11Ship dùng vị trí nên chưa vẽ được khu vực nhận đơn quanh bạn.';
const String _disabled = 'Định vị của điện thoại đang tắt. Bật định vị để xem khu vực nhận đơn.';
const String _failed = 'Chưa lấy được vị trí. Hãy ra nơi thoáng hơn rồi thử lại.';

/// The phone's location feed: records what the app asks of the service. Nothing here is a server call.
class _Feed extends LocationFeed {
  int starts = 0;
  int stops = 0;
  final List<String> settings = <String>[];

  @override
  Stream<Map<String, dynamic>> get positions => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<void> start({String? apiBaseUrl}) async => starts++;

  @override
  Future<void> stop() async => stops++;

  @override
  Future<void> openSettings(String kind) async => settings.add(kind);
}

/// The one-shot fix source behind the button: returns [next] (a fix or a refusal) and counts the asks.
class _Locator implements LocationProvider {
  Object next = LocationFix(latitude: 22.67, longitude: 106.26, accuracyMeters: 12, takenAt: DateTime.utc(2026, 11, 14, 8));
  int calls = 0;

  @override
  Future<LocationFix> currentFix() async {
    calls++;
    final Object outcome = next;
    if (outcome is LocationException) throw outcome;
    return outcome as LocationFix;
  }
}

Map<String, Object?> _driverProfile() => <String, Object?>{
      'driver_id': '55555555-5555-4555-8555-555555555555',
      'user_id': '11111111-1111-4111-8111-111111111111',
      'shipper_code': 'SH000001',
      'full_name': 'Trần Văn Shipper',
      'phone': '+84901234567',
      'plate_number': null,
      'status': 'ACTIVE',
      'review_state': 'APPROVED',
      'accepting_deliveries': false,
      'version': 1,
    };

class _Home {
  _Home({required this.api, required this.session, required this.online, required this.locator, required this.feed, this.driver});
  final FakeApiTransport api;
  final SessionController session;
  final ShipOnline online;
  final _Locator locator;
  final _Feed feed;
  final DriverController? driver;

  /// Requests that change something on the server (anything but a read).
  List<RecordedRequest> get writes => api.requests.where((RecordedRequest r) => r.method != 'GET').toList();
}

Future<_Home> _guest(WidgetTester tester) async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  final _Feed feed = _Feed();
  final ShipLocationReporter reporter = ShipLocationReporter(session: session, feed: feed);
  final ShipOnline online = ShipOnline(session: session, reporter: reporter);
  addTearDown(() { online.dispose(); reporter.dispose(); });
  return _Home(api: api, session: session, online: online, locator: _Locator(), feed: feed);
}

Future<void> _pumpHome(WidgetTester tester, _Home h) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(
      body: ShipHome(
        session: h.session,
        driver: h.driver,
        onNotifications: () {},
        onlineOverride: h.online,
        locationProvider: h.locator,
      ),
    ),
  ));
  await tester.pump();
  await tester.pump();
}

/// The app's own font, so text wraps as on a phone (the test default, Ahem, draws every glyph as a full em box and changes the line count).
Future<void> _loadAppFonts() async {
  final FontLoader loader = FontLoader('packages/n11_shared/PlusJakartaSans');
  for (final String w in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
    final Uint8List bytes = File('../packages/n11_shared/assets/fonts/PlusJakartaSans-$w.ttf').readAsBytesSync();
    loader.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
  }
  await loader.load();
  final FontLoader icons = FontLoader('MaterialIcons');
  icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

void main() {
  testWidgets('390x844 first screen as in the Android smoke (offline alert above, navigation below): the button sits on the map and the map label band is above the navigation', (WidgetTester tester) async {
    await tester.runAsync(_loadAppFonts);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: buildN11Theme(),
      home: Scaffold(
        body: Column(
          children: <Widget>[
            Expanded(
              child: ShipHomeLayout(
                reason: kOnlineReason,
                onNotifications: () {},
                // The CI run had the "Không có kết nối mạng" alert (about 148 px) above the receiving area; the same height is used here.
                alert: const SizedBox(key: Key('ci-offline-alert'), width: double.infinity, height: 148),
                // The guest footer seen in the same CI screenshot ("Đăng nhập tài khoản shipper").
                footer: N11Link('Đăng nhập tài khoản shipper', onPressed: () {}),
                onLocate: () {},
              ),
            ),
            const SizedBox(key: Key('nav-stub'), height: 116),
          ],
        ),
      ),
    ));
    await tester.pump();
    await tester.pump();
    final double navTop = tester.getTopLeft(find.byKey(const Key('nav-stub'))).dy;
    expect(navTop, 728);
    final Rect panel = tester.getRect(find.byKey(const Key('home-v5-map-panel')));
    final Rect button = tester.getRect(find.byKey(const Key('home-locate-cta')));
    expect(find.byKey(const Key('home-radius-pending')), findsOneWidget);
    // The button is laid over the map's top-right corner: inside the map panel, above the navigation, and not moving the map.
    expect(panel.contains(button.topLeft) && panel.contains(button.bottomRight), isTrue);
    expect(button.center.dy, lessThan(730));
    expect(button.bottom, lessThan(navTop));
    // The map frame starts above the navigation and its label band (top 56 px) is on the first screen.
    expect(panel.top + 56, lessThan(navTop), reason: 'the map label band must be visible above the navigation');
    expect(tester.takeException(), isNull);
  });

  testWidgets('guest cold launch without a position: the button shows and the map panel stays on the first screen', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    await _pumpHome(tester, h);
    expect(find.byKey(const Key('home-locate-cta')), findsOneWidget);
    expect(find.text('Bật định vị ngay'), findsOneWidget);
    expect(find.byKey(const Key('home-radius-pending')), findsOneWidget);
    expect(find.byKey(const Key('home-v5-map-panel')), findsOneWidget);
    expect(tester.getTopLeft(find.byKey(const Key('home-v5-map-panel'))).dy, lessThan(730), reason: 'the map stays above the bottom navigation at 390x844');
    expect(find.byKey(const Key('home-locate-note')), findsNothing);
  });

  testWidgets('guest taps: only the permission and one fix; no sharing, no upload, no online change, no server write', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    await _pumpHome(tester, h);
    final int writesBefore = h.writes.length;
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(h.locator.calls, 1, reason: 'the permission and the one fix are asked once');
    expect(h.feed.starts, 0, reason: 'the location service is never started from here');
    expect(h.feed.stops, 0);
    expect(h.writes.length, writesBefore, reason: 'no request that changes anything on the server');
    expect(h.online.busy, isFalse);
    expect(h.session.status, isNot(SessionStatus.signedIn));
    expect(tester.widget<FilledButton>(find.byKey(const Key('online-button'))).onPressed, isNull, reason: 'guest stays offline');
  });

  testWidgets('a usable fix hides the button and draws the area on this phone', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    await _pumpHome(tester, h);
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('home-locate-cta')), findsNothing);
    expect(find.byKey(const Key('home-radius-ready')), findsOneWidget);
    expect(find.text(kShipRadiusLabel), findsOneWidget);
  });

  testWidgets('a refused permission: a short plain instruction and "Mở cài đặt" opens the app settings', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    h.locator.next = const LocationException(LocationFailure.denied);
    await _pumpHome(tester, h);
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(find.text(_denied), findsOneWidget);
    expect(find.textContaining('PERMISSION', findRichText: true), findsNothing);
    expect(find.textContaining('denied', findRichText: true), findsNothing);
    expect(find.byKey(const Key('home-locate-cta')), findsOneWidget, reason: 'the button stays so the person can ask again');
    await tester.tap(find.byKey(const Key('home-locate-action')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    expect(h.feed.settings, <String>['app']);
    expect(h.feed.starts, 0);
  });

  testWidgets('phone location switched off: the instruction opens the location settings', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    h.locator.next = const LocationException(LocationFailure.disabled);
    await _pumpHome(tester, h);
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(find.text(_disabled), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-locate-action')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    expect(h.feed.settings, <String>['location']);
  });

  testWidgets('no fix (timeout or unavailable): a retry line, and "Thử lại" asks again', (WidgetTester tester) async {
    final _Home h = await tester.runAsync(() => _guest(tester)) as _Home;
    h.locator.next = const LocationException(LocationFailure.timeout);
    await _pumpHome(tester, h);
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(find.text(_failed), findsOneWidget);
    h.locator.next = LocationFix(latitude: 22.67, longitude: 106.26, accuracyMeters: 9, takenAt: DateTime.utc(2026, 11, 14, 8));
    await tester.tap(find.byKey(const Key('home-locate-action')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(h.locator.calls, 2);
    expect(find.byKey(const Key('home-locate-cta')), findsNothing);
  });

  testWidgets('regression: a signed-in shipper who is offline taps the button; the online switch and the server are untouched', (WidgetTester tester) async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    FakeDriverServer(api)
      ..profile = _driverProfile()
      ..walletReady = true
      ..locationReady = true
      ..enableLocationRoutes(api);
    final SessionController session = createSessionController(ClientApp.ship, config, transport: api, bridge: FakeDeviceBridge());
    final _Feed feed = _Feed();
    final _Locator locator = _Locator();
    late final _Home h;
    await tester.runAsync(() async {
      await session.start();
      await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    });
    final DriverController driver = DriverController(session: session);
    final ShipLocationReporter reporter = ShipLocationReporter(session: session, feed: feed);
    final ShipOnline online = ShipOnline(session: session, reporter: reporter, driver: driver);
    addTearDown(() { online.dispose(); reporter.dispose(); driver.dispose(); });
    await tester.runAsync(() async {
      online.attach();
      await driver.load();
    });
    h = _Home(api: api, session: session, online: online, locator: locator, feed: feed, driver: driver);
    await _pumpHome(tester, h);
    final int writesBefore = h.writes.length;
    expect(driver.profile?.acceptingDeliveries, isFalse);
    expect(find.byKey(const Key('home-locate-cta')), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-locate-cta')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(locator.calls, 1);
    expect(feed.starts, 0, reason: 'the button does not start sharing');
    expect(api.to('POST', '/v1/driver/me/accepting'), isEmpty, reason: 'the online switch is not sent');
    expect(api.to('PUT', '/v1/driver/location'), isEmpty, reason: 'no position is sent to the server');
    expect(h.writes.length, writesBefore);
    expect(driver.profile?.acceptingDeliveries, isFalse, reason: 'still offline after the button');
    expect(find.text('Bạn đang offline'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
