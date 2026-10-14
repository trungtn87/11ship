import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

HourRange day(String o, String c) => HourRange(open: o, close: c, kind: RangeKind.day);

Future<({SessionController session, FakeApiTransport api, FakeShopOpsServer server, ShopOpsController ops, FakeLocationProvider gps})> setup() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final FakeShopOpsServer server = FakeShopOpsServer(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  expect(await session.login(phone: '0901234567', password: 'Correct-Horse-9'), isTrue);
  final FakeLocationProvider gps = FakeLocationProvider();
  final ShopOpsController ops = ShopOpsController(session: session, location: gps, pollEvery: Duration.zero);
  await ops.load();
  return (session: session, api: api, server: server, ops: ops, gps: gps);
}

void main() {
  test('loads the shop, schedule and the SERVER availability; a failed refresh keeps the data and says it is out of date', () async {
    final t = await setup();
    expect(t.ops.loadState, OpsLoad.ready);
    expect(t.ops.overview!.name, 'Ốc 11');
    expect(t.ops.overview!.availability.reason, 'NO_BUSINESS_HOURS');
    expect(t.ops.overview!.availability.evaluatedAt, DateTime.utc(2026, 10, 14, 11, 30));
    t.server.readFailure = 503;
    await t.ops.refresh();
    expect(t.ops.stale, isTrue);
    expect(t.ops.overview!.name, 'Ốc 11');
    expect(t.ops.loadState, OpsLoad.ready);
    t.server.readFailure = null;
    await t.ops.refresh();
    expect(t.ops.stale, isFalse);
  });

  test('a first load that fails is a load failure (not an empty form), and Thử lại works', () async {
    final FakeApiTransport api = FakeApiTransport();
    installAccountRoutes(api);
    final FakeShopOpsServer server = FakeShopOpsServer(api)..readFailure = 503;
    final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
    await session.start();
    await session.login(phone: '0901234567', password: 'Correct-Horse-9');
    final ShopOpsController ops = ShopOpsController(session: session, location: FakeLocationProvider(), pollEvery: Duration.zero);
    await ops.load();
    expect(ops.loadState, OpsLoad.failed);
    expect(ops.overview, isNull);
    server.readFailure = null;
    await ops.load();
    expect(ops.loadState, OpsLoad.ready);
  });

  test('saving hours writes the whole week once, reads it back, and the draft becomes what the server holds', () async {
    final t = await setup();
    t.ops.applyAllWeek(<HourRange>[day('17:00', '23:00')]);
    t.ops.setDay(6, <HourRange>[day('17:00', '22:00')]);
    expect(t.ops.hoursDirty, isTrue);
    expect(await t.ops.saveHours(), isTrue);
    expect(t.server.effects, hasLength(1));
    expect((t.server.effects.single['intervals']! as List<Object?>), hasLength(7));
    expect(t.server.effects.single['expected_version'], 2);
    expect(t.ops.overview!.version, 3);
    expect(t.ops.hoursDirty, isFalse);
    expect(t.ops.pending, isNull);
    expect(t.ops.notice, 'Đã lưu lịch hoạt động.');
  });

  test('UNKNOWN outcome keeps the key and body; edits and other writes are locked; a retry that is still offline keeps them; the retry that lands writes ONCE', () async {
    final t = await setup();
    t.ops.applyAllWeek(<HourRange>[day('17:00', '23:00')]);
    t.server.loseAnswerOnce = true;
    expect(await t.ops.saveHours(), isFalse);
    final PendingWrite first = t.ops.pending!;
    expect(t.ops.locked, isTrue);
    expect(t.ops.writeFailure!.outcomeUnknown, isTrue);
    expect(t.server.effects, hasLength(1), reason: 'the server did commit; the app does not know');

    // No new write and no draft edit while the outcome is unknown.
    t.ops.setDay(2, <HourRange>[day('08:00', '09:00')]);
    expect(t.ops.hoursDraft[2].single, day('17:00', '23:00'));
    t.ops.profile.name = 'Tên khác';
    expect(await t.ops.saveProfile(), isFalse);
    expect(await t.ops.saveHours(), isFalse);
    expect(t.server.arrived, hasLength(1));

    // The retry is offline again: still the same key and body.
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    expect(await t.ops.retryPending(), isFalse);
    expect(t.ops.pending!.key, first.key);
    expect(t.ops.pending!.body, first.body);
    expect(t.ops.locked, isTrue);

    // It lands: the server replays the stored result, nothing is written twice, the version moved once.
    expect(await t.ops.retryPending(), isTrue);
    expect(t.server.effects, hasLength(1));
    expect(t.server.version, 3);
    expect(t.server.arrived.toSet(), <String>{'hours:${first.key}'});
    expect(t.ops.pending, isNull);
    expect(t.ops.locked, isFalse);
    expect(t.ops.overview!.version, 3);
  });

  test('a definite refusal releases the pending write (it is not an unknown outcome)', () async {
    final t = await setup();
    t.server.status = 'DISABLED';
    await t.ops.refresh();
    expect(t.ops.readOnly, isTrue);
    t.ops.applyAllWeek(<HourRange>[day('17:00', '23:00')]);
    expect(await t.ops.saveHours(), isFalse);
    expect(t.server.arrived, isEmpty, reason: 'a DISABLED shop sends no write');
  });

  test('a conflict keeps the draft; loading the new data replaces it only when the person asks', () async {
    final t = await setup();
    t.ops.profile.name = 'Ốc 11 Mới';
    t.server.changeElsewhere(newName: 'Ốc 11 Nơi Khác');
    expect(await t.ops.saveProfile(), isFalse);
    expect(t.ops.conflict, isTrue);
    expect(t.ops.pending, isNull);
    expect(t.ops.profile.name, 'Ốc 11 Mới');
    expect(t.server.effects, isEmpty);
    await t.ops.refresh();
    expect(t.ops.profile.name, 'Ốc 11 Mới', reason: 'a refresh never overwrites a draft that holds edits or a conflict');
    expect(await t.ops.loadNewReplacingDrafts(), isTrue);
    expect(t.ops.profile.name, 'Ốc 11 Nơi Khác');
    expect(t.ops.conflict, isFalse);
  });

  test('profile: invalid input sends nothing; GPS denial keeps the stored position; a fresh fix is sent; empty optional fields are null', () async {
    final t = await setup();
    t.ops.profile.phone = '12';
    t.ops.profile.address = '  ';
    expect(await t.ops.saveProfile(), isFalse);
    expect(t.ops.profileErrors.keys, containsAll(<String>['phone', 'address']));
    expect(t.server.arrived, isEmpty);

    t.ops.revertProfile();
    t.gps.failure = LocationFailure.denied;
    await t.ops.capturePosition();
    expect(t.ops.locationFailure, LocationFailure.denied);
    expect(t.ops.fix, isNull);
    expect(t.ops.overview!.pickupLat, 22.6657);

    t.gps.failure = null;
    await t.ops.capturePosition();
    expect(t.ops.profileDirty, isTrue);
    t.ops.profile.name = '  Ốc 11 Mới ';
    t.ops.profile.zalo = '';
    expect(await t.ops.saveProfile(), isTrue);
    final Map<String, Object?> effect = t.server.effects.single;
    expect(effect['name'], 'Ốc 11 Mới');
    expect(effect['zalo'], isNull);
    expect(effect['pickup_lat'], 10.0123);
    expect(t.ops.fix, isNull);
  });

  test('saved but the read-back failed: the data is stored, the screen says so, and Tải lại finishes it', () async {
    final t = await setup();
    t.ops.applyAllWeek(<HourRange>[day('17:00', '23:00')]);
    t.api.routes['GET /v1/shop/me'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
    expect(await t.ops.saveHours(), isTrue);
    expect(t.ops.savedNotReloaded, isTrue);
    expect(t.ops.pending, isNull);
    t.api.routes['GET /v1/shop/me'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': t.server.view()});
    await t.ops.reloadAfterSave();
    expect(t.ops.savedNotReloaded, isFalse);
    expect(t.ops.overview!.version, 3);
  });

  test('a session that ends drops the drafts and the pending write: nothing is replayed under another account', () async {
    final t = await setup();
    t.ops.applyAllWeek(<HourRange>[day('17:00', '23:00')]);
    t.server.loseAnswerOnce = true;
    await t.ops.saveHours();
    expect(t.ops.pending, isNotNull);
    await t.session.logout();
    expect(t.ops.pending, isNull);
    expect(t.ops.overview, isNull);
    expect(t.ops.hoursDraft.every((List<HourRange> d) => d.isEmpty), isTrue);
    expect(await t.ops.retryPending(), isFalse);
    expect(t.server.arrived, hasLength(1));
  });
}
