import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

class _FakeTransport implements ApiTransport {
  _FakeTransport(this.answer);

  ApiResponse Function(String path) answer;
  final List<String> paths = <String>[];

  @override
  Future<ApiResponse> send(String method, String pathAndQuery, {Map<String, String> headers = const <String, String>{}, List<int>? body}) async {
    paths.add(pathAndQuery);
    return answer(pathAndQuery);
  }
}

ApiResponse _json(Object data, {int status = 200}) => ApiResponse(status: status, headers: const <String, String>{}, body: jsonEncode(<String, Object?>{'data': data}));

class _FakeFiles implements UpdateFileSource {
  _FakeFiles(this.chunks);

  List<List<int>> chunks;
  int opened = 0;
  Object? failFirst;

  @override
  Future<UpdateDownload> open(String path) async {
    opened += 1;
    if (failFirst != null && opened == 1) {
      throw failFirst!;
    }
    return UpdateDownload(bytes: Stream<List<int>>.fromIterable(chunks), close: () {});
  }
}

class _FakePlatform implements UpdatePlatform {
  _FakePlatform(this.dir);

  final Directory dir;
  String installOutcome = 'OPENED';
  final List<String> installed = <String>[];

  @override
  Future<String> updateDirectory() async => dir.path;

  @override
  Future<String> dataDirectory() async => dir.path;

  @override
  Future<String> install(String path) async {
    installed.add(path);
    return installOutcome;
  }
}

List<int> _apk() => List<int>.generate(5000, (int i) => i % 251);

String _sha(List<int> bytes) => crypto.sha256.convert(bytes).toString();

Map<String, Object?> _check({required bool required, List<int>? bytes, int versionCode = 9}) {
  final List<int> data = bytes ?? _apk();
  return <String, Object?>{
    'update_available': true,
    'required': required,
    'priority': required ? 'REQUIRED' : 'RECOMMENDED',
    'reason': required ? 'Lỗi bảo mật' : null,
    'release': <String, Object?>{
      'release_id': '11111111-2222-3333-4444-555555555555',
      'version_name': '1.9',
      'version_code': versionCode,
      'release_notes': 'Sửa lỗi',
      'size_bytes': data.length,
      'sha256': _sha(data),
      'download_path': '/v1/app-updates/download/11111111-2222-3333-4444-555555555555',
    },
  };
}

AppUpdateController _controller(_FakeTransport transport, _FakeFiles files, _FakePlatform platform, {bool Function()? busy, Future<bool> Function()? probe, int installed = 5}) =>
    AppUpdateController(
      component: 'SHIP',
      installedVersionCode: installed,
      installedVersionName: '1.0',
      transport: transport,
      files: files,
      platform: platform,
      isBusy: busy ?? () => false,
      busyProbe: probe,
      retryDelay: Duration.zero,
    );

const AppConfig _config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Future<({SessionController session, FakeApiTransport api})> _signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, _config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

/// A source whose token registration the server refuses (or that is offline); only what PushSync calls is implemented.
class _PushFailSource implements NotificationSource {
  _PushFailSource(this.session);

  final SessionController session;
  NotificationFailureKind kind = NotificationFailureKind.server;
  int tries = 0;

  @override
  Future<void> registerPushToken(String token) async {
    tries += 1;
    throw NotificationFailure(kind);
  }

  @override
  Future<void> reportPushPermissionDenied() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _PushPort implements PushPort {
  final StreamController<String> refreshes = StreamController<String>.broadcast();

  @override
  Future<PushState> state() async => const PushState(supported: true, permission: PushPermission.granted, token: 'tok-aaaaaaaaaaaaaaaaaaaa');

  @override
  Future<PushPermission> requestPermission() async => PushPermission.granted;

  @override
  Future<void> openSystemSettings() async {}

  @override
  Future<void> deleteToken() async {}

  @override
  Stream<String> get tokenRefreshes => refreshes.stream;

  @override
  Stream<String> get taps => const Stream<String>.empty();
}

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('n11-m13-');
  });

  tearDown(() async {
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  });

  group('update check and verified download', () {
    test('asks for its own component and build, and offers a newer build', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check(required: false)));
      final AppUpdateController c = _controller(transport, _FakeFiles(<List<int>>[_apk()]), _FakePlatform(dir));
      await c.check();
      expect(transport.paths.single, '/v1/app-updates/check?component=SHIP&version_code=5');
      expect(c.phase, AppUpdatePhase.available);
      expect(c.offer!.versionName, '1.9');
      expect(c.blocking, isFalse);
      expect(c.showBanner, isTrue);
    });

    test('no newer build, a refused answer or a malformed one leave no offer and never throw', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(<String, Object?>{'update_available': false, 'release': null}));
      final AppUpdateController c = _controller(transport, _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await c.check(force: true);
      expect(c.phase, AppUpdatePhase.upToDate);
      expect(c.offer, isNull);
      transport.answer = (String _) => _json(<String, Object?>{'update_available': true, 'release': <String, Object?>{'sha256': 'zz'}});
      await c.check(force: true);
      expect(c.offer, isNull);
      expect(c.failureCode, 'BAD_ANSWER');
      transport.answer = (String _) => throw const SocketException('down');
      await c.check(force: true);
      expect(c.failureCode, 'OFFLINE');
    });

    test('a build without a build number is never told to update', () async {
      final _FakeTransport transport = _FakeTransport((String _) => _json(_check(required: true)));
      final AppUpdateController c = AppUpdateController(
        component: 'FOOD', installedVersionCode: 0, installedVersionName: '0.0.0', transport: transport, files: _FakeFiles(<List<int>>[]), platform: _FakePlatform(dir), enabled: false,
      );
      await c.check();
      expect(transport.paths, isEmpty);
      expect(c.offer, isNull);
    });

    test('downloads, checks size and SHA-256 and only then opens the installer', () async {
      final _FakePlatform platform = _FakePlatform(dir);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[_apk().sublist(0, 2000), _apk().sublist(2000)]), platform);
      await c.check();
      await c.download();
      expect(c.phase, AppUpdatePhase.installerOpened);
      expect(platform.installed.single, '${dir.path}/update-9.apk');
      expect(_sha(File(platform.installed.single).readAsBytesSync()), c.offer!.sha256);
    });

    test('a tampered file is deleted and the installer is never opened', () async {
      final List<int> tampered = _apk()..[10] = 99;
      final _FakePlatform platform = _FakePlatform(dir);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[tampered]), platform);
      await c.check();
      await c.download();
      expect(c.phase, AppUpdatePhase.failed);
      expect(c.failureCode, 'SHA256_MISMATCH');
      expect(platform.installed, isEmpty);
      expect(File('${dir.path}/update-9.apk').existsSync(), isFalse);
    });

    test('a file of the wrong size is refused', () async {
      final _FakePlatform platform = _FakePlatform(dir);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[_apk(), <int>[1]]), platform);
      await c.check();
      await c.download();
      expect(c.failureCode, 'SIZE_MISMATCH');
      expect(platform.installed, isEmpty);
    });

    test('a network failure is retried a limited number of times and then reported', () async {
      final _FakeFiles files = _FakeFiles(<List<int>>[_apk()])..failFirst = const UpdateFailure('OFFLINE');
      final _FakePlatform platform = _FakePlatform(dir);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), files, platform);
      await c.check();
      await c.download();
      expect(files.opened, 2);
      expect(c.phase, AppUpdatePhase.installerOpened);
    });

    test('when installing from this app is not allowed yet the file stays verified and the person is told what to do', () async {
      final _FakePlatform platform = _FakePlatform(dir)..installOutcome = 'INSTALL_PERMISSION';
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[_apk()]), platform);
      await c.check();
      await c.download();
      expect(c.phase, AppUpdatePhase.failed);
      expect(c.failureCode, 'INSTALL_PERMISSION');
      expect(updateFailureText('INSTALL_PERMISSION'), contains('cho phép'));
    });

    test('a REQUIRED update blocks, except while the shipper has work in progress', () async {
      bool busy = false;
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => busy);
      await c.check();
      expect(c.blocking, isTrue);
      busy = true;
      await c.refreshBusy();
      expect(c.blocking, isFalse);
      expect(c.deferred, isTrue);
      busy = false;
      await c.refreshBusy();
      expect(c.blocking, isTrue);
    });

    test('a probe that fails counts as busy: an update screen never replaces an order on a guess', () async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => throw StateError('x'));
      await c.check();
      expect(c.blocking, isFalse);
      expect(c.deferred, isTrue);
    });

    test('a recommended update can be postponed; a required one cannot', () async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await c.check();
      c.dismiss();
      expect(c.showBanner, isFalse);
      final AppUpdateController r = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await r.check();
      r.dismiss();
      expect(r.blocking, isTrue);
    });
  });

  group('APK–backend compatibility (#193)', () {
    Map<String, Object?> unavailable() => <String, Object?>{
          'status': 'UPDATE_REQUIRED_UNAVAILABLE',
          'compatible': false,
          'required': true,
          'update_available': false,
          'min_supported_version_code': 30,
          'reason': 'Cần bản mới để nhận đơn đúng cách',
          'release': null,
        };

    test('required but nothing downloadable is never "up to date": no offer, blocks new work, and the screen offers a re-check, not a download', () async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(unavailable())), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await c.check();
      expect(c.offer, isNull);
      expect(c.requiredUnavailable, isTrue);
      expect(c.phase, isNot(AppUpdatePhase.upToDate));
      expect(c.blocking, isTrue);
      expect(c.blocksNewWork, isTrue);
      expect(c.unavailableReason, 'Cần bản mới để nhận đơn đúng cách');
      expect(c.minSupportedVersionCode, 30);
      await c.download();
      expect(c.phase, AppUpdatePhase.available);
    });

    test('with work in progress it is deferred (no screen) but new work is still refused; once the server says compatible it clears', () async {
      bool busy = true;
      Map<String, Object?> answer = unavailable();
      final _FakeTransport transport = _FakeTransport((String _) => _json(answer));
      final AppUpdateController c = _controller(transport, _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => busy);
      await c.check();
      expect(c.blocking, isFalse);
      expect(c.deferred, isTrue);
      expect(c.blocksNewWork, isTrue);
      answer = <String, Object?>{'status': 'COMPATIBLE', 'update_available': false, 'required': false, 'release': null};
      busy = false;
      await c.check(force: true);
      expect(c.requiredUnavailable, isFalse);
      expect(c.blocksNewWork, isFalse);
      expect(c.phase, AppUpdatePhase.upToDate);
    });

    test('a required update with a download also blocks new work from the moment it is known, even while deferred behind an order', () async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => true);
      await c.check();
      expect(c.deferred, isTrue);
      expect(c.blocksNewWork, isTrue);
      final AppUpdateController optional = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await optional.check();
      expect(optional.blocksNewWork, isFalse);
    });

    test('an unanswered check does not hide a pending update for half an hour, and does not forget what is known', () async {
      DateTime now = DateTime(2026, 10, 25, 8);
      bool offline = false;
      final _FakeTransport transport = _FakeTransport((String _) {
        if (offline) throw const SocketException('down');
        return _json(unavailable());
      });
      final AppUpdateController c = AppUpdateController(
        component: 'SHIP',
        installedVersionCode: 5,
        installedVersionName: '1.0',
        transport: transport,
        files: _FakeFiles(<List<int>>[]),
        platform: _FakePlatform(dir),
        now: () => now,
      );
      await c.check();
      expect(transport.paths, hasLength(1));
      now = now.add(const Duration(minutes: 5));
      await c.check();
      expect(transport.paths, hasLength(1), reason: 'a successful check is not repeated within 30 minutes');
      now = now.add(const Duration(minutes: 30));
      offline = true;
      await c.check();
      expect(transport.paths, hasLength(2));
      expect(c.failureCode, 'OFFLINE');
      expect(c.requiredUnavailable, isTrue, reason: 'offline is not "compatible"');
      now = now.add(const Duration(minutes: 1));
      await c.check();
      expect(transport.paths, hasLength(2), reason: 'not hammering a server that did not answer');
      now = now.add(const Duration(minutes: 2));
      offline = false;
      await c.check();
      expect(transport.paths, hasLength(3));
      expect(c.requiredUnavailable, isTrue);
    });

    test('the status words of the server are read; an older server without them leaves them unset', () async {
      expect(parseCompatStatus('UPDATE_OPTIONAL'), CompatStatus.updateOptional);
      expect(parseCompatStatus('COMPATIBLE'), CompatStatus.compatible);
      expect(parseCompatStatus('UNKNOWN_VERSION'), CompatStatus.unknownVersion);
      expect(parseCompatStatus('x'), isNull);
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(<String, Object?>{'update_available': false, 'release': null})), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await c.check();
      expect(c.compat, isNull);
      expect(c.phase, AppUpdatePhase.upToDate);
    });
  });

  group('compatibility screens (#193)', () {
    Widget app(AppUpdateController c, {Widget? home}) => MaterialApp(builder: (BuildContext context, Widget? child) => AppUpdateGate(controller: c, child: child!), home: home ?? const Scaffold(body: Text('trang chính')));
    Map<String, Object?> unavailable() => <String, Object?>{'status': 'UPDATE_REQUIRED_UNAVAILABLE', 'required': true, 'update_available': false, 'reason': 'Cần bản mới', 'release': null};

    testWidgets('required without a downloadable file: a clear screen with a re-check and no download button; an order in hand only gets a banner', (WidgetTester tester) async {
      bool busy = true;
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(unavailable())), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => busy);
      await tester.pumpWidget(app(c));
      await tester.runAsync(c.check);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-screen')), findsNothing);
      expect(find.byKey(const Key('m13-update-banner')), findsOneWidget);
      expect(find.textContaining('Hoàn thành đơn đang làm bình thường'), findsOneWidget);
      expect(find.byKey(const Key('m13-update-download')), findsNothing);
      busy = false;
      await tester.runAsync(c.refreshBusy);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-screen')), findsOneWidget);
      expect(find.text('Ứng dụng cần cập nhật để tiếp tục sử dụng'), findsOneWidget);
      expect(find.byKey(const Key('m13-update-download')), findsNothing);
      expect(find.byKey(const Key('m13-update-recheck')), findsOneWidget);
    });

    testWidgets('the account row "Kiểm tra cập nhật" re-checks on demand and reports plainly', (WidgetTester tester) async {
      Map<String, Object?> answer = <String, Object?>{'status': 'COMPATIBLE', 'update_available': false, 'required': false, 'release': null};
      final _FakeTransport transport = _FakeTransport((String _) => _json(answer));
      final AppUpdateController c = _controller(transport, _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await tester.pumpWidget(app(c, home: Scaffold(body: Builder(builder: (BuildContext context) {
        final AppUpdateController? scoped = AppUpdateScope.maybeOf(context);
        return scoped == null ? const Text('no scope') : ListenableBuilder(listenable: scoped, builder: (BuildContext context, Widget? _) => Text(updateCheckSummary(scoped), key: const Key('summary')));
      }))));
      expect(find.byKey(const Key('summary')), findsOneWidget);
      expect(find.text('Chạm để kiểm tra bản mới.'), findsOneWidget);
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.textContaining('chưa có bản mới để tải'), findsOneWidget);
      answer = unavailable();
      await tester.runAsync(() => c.check(force: true));
      await tester.pump();
      expect(find.textContaining('chưa sẵn sàng để tải'), findsWidgets);
      expect(find.textContaining('chưa có bản mới để tải'), findsNothing);
    });
  });

  group('shop owner busy probe (#193)', () {
    ShopOrderCounts counts({int pending = 0, int preparing = 0, int scheduled = 0, int delivering = 0, int attention = 0}) =>
        ShopOrderCounts(pending: pending, preparing: preparing, scheduled: scheduled, delivering: delivering, attention: attention);

    Future<bool> busy({SessionStatus status = SessionStatus.signedIn, List<String>? roles = const <String>['CUSTOMER', 'SHOP_OWNER'], required Future<ShopOrderCounts> Function() read}) =>
        shopOwnerBusy(status: status, roles: roles, counts: read);

    test('orders the shop is handling are work in hand, whichever stage', () async {
      expect(await busy(read: () async => counts(preparing: 1)), isTrue);
      expect(await busy(read: () async => counts(scheduled: 2)), isTrue);
      expect(await busy(read: () async => counts(delivering: 1)), isTrue);
      expect(await busy(read: () async => counts(attention: 1)), isTrue);
    });

    test('the shop has finished everything, or only has orders it has not accepted yet: free (those cannot be started until the app is updated)', () async {
      expect(await busy(read: () async => counts()), isFalse);
      expect(await busy(read: () async => counts(pending: 4)), isFalse);
    });

    test('a person without a shop, or nobody signed in, is free; the server is not even asked', () async {
      int asked = 0;
      Future<ShopOrderCounts> read() async {
        asked += 1;
        return counts(preparing: 9);
      }

      expect(await busy(roles: const <String>['CUSTOMER'], read: read), isFalse);
      expect(await busy(status: SessionStatus.guest, roles: null, read: read), isFalse);
      expect(asked, 0);
    });

    test('an unreadable answer or a session not known yet is never "idle": the probe throws', () async {
      await expectLater(busy(read: () async => throw const SocketException('down')), throwsA(isA<SocketException>()));
      await expectLater(busy(status: SessionStatus.starting, roles: null, read: () async => counts()), throwsA(isA<StateError>()));
      await expectLater(busy(status: SessionStatus.unverified, roles: const <String>['CUSTOMER'], read: () async => counts()), throwsA(isA<StateError>()));
      await expectLater(busy(roles: null, read: () async => counts()), throwsA(isA<StateError>()));
    });

    test('with the update controller: an order in hand defers the REQUIRED update, finishing it brings the screen, and a failing read keeps it deferred', () async {
      ShopOrderCounts now = counts(preparing: 1);
      bool failing = false;
      Future<bool> probe() => busy(read: () async {
            if (failing) throw const SocketException('down');
            return now;
          });
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: probe);
      await c.check();
      expect(c.deferred, isTrue);
      expect(c.blocking, isFalse);
      expect(c.blocksNewWork, isTrue, reason: 'no new work while the update waits behind the order in hand');
      failing = true;
      now = counts();
      await c.refreshBusy();
      expect(c.deferred, isTrue, reason: 'a failed read is not read as "the shop is free"');
      expect(c.blocking, isFalse);
      failing = false;
      await c.refreshBusy();
      expect(c.blocking, isTrue, reason: 'the last order is done: the update screen may come');
      expect(c.deferred, isFalse);
    });
  });

  group('update screens', () {
    Widget app(AppUpdateController c) => MaterialApp(builder: (BuildContext context, Widget? child) => AppUpdateGate(controller: c, child: child!), home: const Scaffold(body: Text('trang chính')));

    testWidgets('a recommended update shows a banner above the app and can be postponed', (WidgetTester tester) async {
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: false))), _FakeFiles(<List<int>>[]), _FakePlatform(dir));
      await tester.pumpWidget(app(c));
      await tester.runAsync(c.check);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-banner')), findsOneWidget);
      expect(find.text('trang chính'), findsOneWidget);
      expect(find.textContaining('1.9'), findsWidgets);
      await tester.tap(find.byKey(const Key('m13-update-later')));
      await tester.pump();
      expect(find.byKey(const Key('m13-update-banner')), findsNothing);
      expect(find.text('trang chính'), findsOneWidget);
    });

    testWidgets('a required update covers the app, but a shipper with an active order only gets a banner', (WidgetTester tester) async {
      bool busy = true;
      final AppUpdateController c = _controller(_FakeTransport((String _) => _json(_check(required: true))), _FakeFiles(<List<int>>[]), _FakePlatform(dir), probe: () async => busy);
      await tester.pumpWidget(app(c));
      await tester.runAsync(c.check);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-screen')), findsNothing);
      expect(find.byKey(const Key('m13-update-banner')), findsOneWidget);
      expect(find.textContaining('sau khi xong đơn'), findsOneWidget);
      busy = false;
      await tester.runAsync(c.refreshBusy);
      await tester.pump();
      expect(find.byKey(const Key('m13-update-screen')), findsOneWidget);
      expect(find.text('trang chính'), findsOneWidget);
    });
  });

  group('error queue', () {
    final DateTime start = DateTime.utc(2026, 10, 20, 8);

    ClientLogQueue queue(MemoryLogQueueStore store, DateTime Function() now, {LogQueueLimits limits = const LogQueueLimits()}) => ClientLogQueue(store: store, limits: limits, now: now);

    test('redacts tokens, phone numbers, e-mails, codes and long strings before anything is stored', () async {
      final MemoryLogQueueStore store = MemoryLogQueueStore();
      final ClientLogQueue q = queue(store, () => start);
      await q.add(
        kind: 'ACTION_ERROR',
        code: 'save failed',
        appVersion: '1.0',
        message: 'Bearer abc.def-123 phone 0912345678 mail a@b.vn otp: 123456 token=AbCdEfGhIjKlMnOpQrStUvWxYz012345 url https://x.vn/p?secret=1',
      );
      final String stored = store.content!;
      for (final String secret in <String>['abc.def-123', '0912345678', 'a@b.vn', '123456', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'secret=1']) {
        expect(stored.contains(secret), isFalse, reason: secret);
      }
      expect(q.entries.single.code, 'SAVE_FAILED');
    });

    test('the same error is kept once, within the queue and for a while after it was queued', () async {
      DateTime now = start;
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => now);
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isTrue);
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isFalse);
      await q.flush((List<Map<String, Object?>> _) async => DeliveryOutcome.accepted);
      expect(q.length, 0);
      now = start.add(const Duration(minutes: 1));
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isFalse);
      now = start.add(const Duration(minutes: 30));
      expect(await q.add(kind: 'MAP_ERROR', code: 'MAP_LOAD', appVersion: '1.0', message: 'x'), isTrue);
    });

    test('is bounded: the oldest entries go first', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start, limits: const LogQueueLimits(maxEntries: 3));
      for (int i = 0; i < 5; i += 1) {
        await q.add(kind: 'CRASH', code: 'E$i', appVersion: '1.0');
      }
      expect(q.entries.map((ClientLogEntry e) => e.code).toList(), <String>['E2', 'E3', 'E4']);
      expect(q.dropped, 2);
    });

    test('survives a restart through the store and drops damaged or expired entries', () async {
      final MemoryLogQueueStore store = MemoryLogQueueStore();
      DateTime now = start;
      final ClientLogQueue first = queue(store, () => now);
      await first.add(kind: 'CRASH', code: 'A', appVersion: '1.0');
      now = start.add(const Duration(days: 1));
      final ClientLogQueue second = queue(store, () => now);
      await second.load();
      expect(second.length, 1);
      now = start.add(const Duration(days: 8));
      final ClientLogQueue third = queue(store, () => now);
      await third.load();
      expect(third.length, 0);
      store.content = '{not json';
      final ClientLogQueue fourth = queue(store, () => now);
      await fourth.load();
      expect(fourth.length, 0);
    });

    test('delivery is retried with a growing wait and then given up after the limit', () async {
      DateTime now = start;
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => now, limits: const LogQueueLimits(maxAttempts: 3));
      await q.add(kind: 'CRASH', code: 'A', appVersion: '1.0');
      int calls = 0;
      Future<DeliveryOutcome> fail(List<Map<String, Object?>> _) async {
        calls += 1;
        return DeliveryOutcome.retry;
      }

      await q.flush(fail);
      expect(calls, 1);
      await q.flush(fail); // still waiting for its back-off
      expect(calls, 1);
      now = now.add(const Duration(minutes: 2));
      await q.flush(fail);
      now = now.add(const Duration(minutes: 10));
      await q.flush(fail);
      expect(calls, 3);
      expect(q.length, 0);
    });

    test('signed out keeps the entries untouched; a rejected batch is dropped; one batch is at most 50 entries', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start, limits: const LogQueueLimits(maxEntries: 100));
      for (int i = 0; i < 60; i += 1) {
        await q.add(kind: 'CRASH', code: 'E$i', appVersion: '1.0');
      }
      int sent = 0;
      await q.flush((List<Map<String, Object?>> batch) async {
        sent = batch.length;
        return DeliveryOutcome.signedOut;
      });
      expect(sent, 50);
      expect(q.length, 60);
      expect(q.entries.first.attempts, 0);
      await q.flush((List<Map<String, Object?>> batch) async => DeliveryOutcome.rejected);
      expect(q.length, 10);
    });

    test('an unknown kind is refused and the wire form carries only the documented fields', () async {
      final ClientLogQueue q = queue(MemoryLogQueueStore(), () => start);
      expect(await q.add(kind: 'OTHER', code: 'A', appVersion: '1.0'), isFalse);
      await q.add(kind: 'PUSH_ERROR', code: 'A', appVersion: '1.0', message: 'm', deliveryCode: 'D1');
      expect(q.entries.single.toWire().keys.toSet(), <String>{'at', 'kind', 'code', 'app_version', 'message', 'delivery_code'});
    });
  });

  group('error instrumentation (G20-D #264): the five kinds are really reported, redacted and not repeated', () {
    late MemoryLogQueueStore store;
    late ClientLogQueue queue;
    late OpsClient ops;

    setUp(() {
      store = MemoryLogQueueStore();
      queue = ClientLogQueue(store: store);
      // Signed out on purpose: reporting only queues; nothing is delivered in these tests.
      final SessionController signedOut = createSessionController(ClientApp.ship, _config, transport: FakeApiTransport(), bridge: FakeDeviceBridge());
      ops = OpsClient(
        app: ClientApp.ship,
        config: _config,
        session: signedOut,
        updates: _controller(_FakeTransport((String _) => _json(<String, Object?>{})), _FakeFiles(<List<int>>[]), _FakePlatform(dir)),
        queue: queue,
      );
      OpsClient.attachForTest(ops);
    });

    tearDown(() => OpsClient.attachForTest(null));

    Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

    test('the static gate queues every documented kind, redacts the text and ignores a repeat or an unknown kind; with no client it does nothing', () async {
      OpsClient.report(kind: 'ACTION_ERROR', code: 'post save', message: 'Bearer abc.def-123 for 0912345678 otp: 123456');
      OpsClient.report(kind: 'MAP_ERROR', code: 'PLACE_SEARCH_BAD');
      OpsClient.reportRouteError('ROUTE_DISTANCE_FAILED', message: 'at 22.66667,106.25833');
      OpsClient.report(kind: 'GPS_STALE', code: 'GPS_STALE_NO_SERVER_POSITION');
      OpsClient.report(kind: 'PUSH_ERROR', code: 'PUSH_REGISTER_SERVER');
      OpsClient.report(kind: 'PUSH_ERROR', code: 'PUSH_REGISTER_SERVER');
      OpsClient.report(kind: 'NOT_A_KIND', code: 'X');
      await settle();
      expect(queue.entries.map((ClientLogEntry e) => e.kind).toList(), <String>['ACTION_ERROR', 'MAP_ERROR', 'ROUTE_ERROR', 'GPS_STALE', 'PUSH_ERROR']);
      expect(queue.entries.first.code, 'POST_SAVE');
      final String stored = store.content!;
      for (final String secret in <String>['abc.def-123', '0912345678', '123456']) {
        expect(stored.contains(secret), isFalse, reason: secret);
      }
      OpsClient.attachForTest(null);
      OpsClient.report(kind: 'CRASH', code: 'NOBODY');
      await settle();
      expect(queue.length, 5);
    });

    test('an action code names the endpoint without identifiers or a query', () {
      expect(opsActionCode('post', '/v1/shop/me/deliveries/11111111-1111-4111-8111-111111111111/cancel?x=1'), 'POST_DELIVERIES_CANCEL');
      expect(opsActionCode('PATCH', '/v1/orders/12345/status'), 'PATCH_ORDERS_STATUS');
    });

    test('ACTION_ERROR: a server fault or an unreadable answer on a WRITE is reported; a refusal, a lost answer and a failed read are not', () async {
      final t = await _signedIn();
      const String id = '11111111-1111-4111-8111-111111111111';
      final HttpShopDeliverySource source = HttpShopDeliverySource(session: t.session);
      Future<void> cancel() async {
        try {
          await source.cancel(id, reason: 'x', expectedVersion: 1, key: '33333333-3333-4333-8333-333333333333');
        } on M07Failure {
          // expected
        }
      }

      t.api.routes['POST /v1/shop/me/deliveries/$id/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(409, 'DELIVERY_STATE_CONFLICT');
      await cancel();
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await cancel();
      t.api.routes['GET /v1/shop/me/deliveries/$id'] = (String m, String p, Map<String, String> h, String b) async => apiError(500, 'INTERNAL');
      try {
        await source.get(id);
      } on M07Failure {
        // expected
      }
      await settle();
      expect(queue.length, 0, reason: 'none of these is a server fault on a write');

      t.api.routes['POST /v1/shop/me/deliveries/$id/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(500, 'INTERNAL');
      await cancel();
      await settle();
      expect(queue.entries.single.kind, 'ACTION_ERROR');
      expect(queue.entries.single.code, 'POST_DELIVERIES_CANCEL');
      expect(queue.entries.single.message, contains('/shop/me/deliveries/:id/cancel'));
      expect(queue.entries.single.message, isNot(contains(id)));

      t.api.routes['POST /v1/shop/me/deliveries/$id/recall'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'delivery_id': id}});
      try {
        await source.recall(id, key: '44444444-4444-4444-8444-444444444444');
      } on M07Failure {
        // expected
      }
      await settle();
      expect(queue.entries.map((ClientLogEntry e) => e.code), contains('DELIVERY_BAD_RESPONSE'));
    });

    test('MAP_ERROR: a failed place search or a location that cannot be taken is reported; a refused permission and the typed text are not', () async {
      final t = await _signedIn();
      final HttpPlaceSearchApi places = HttpPlaceSearchApi(t.session);
      t.api.routes['GET /v1/customers/me/places?query=Cao+B%E1%BA%B1ng'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_DOWN');
      try {
        await places.search('Cao Bằng');
      } on Object {
        // expected
      }
      await settle();
      final int afterSearch = queue.length;
      expect(afterSearch, 1);
      expect(queue.entries.single.kind, 'MAP_ERROR');
      expect(store.content ?? '', isNot(contains('Cao B')));

      TestWidgetsFlutterBinding.ensureInitialized();
      const MethodChannel channel = MethodChannel('vn.eleven.n11/location-test');
      final MethodChannelLocationProvider provider = MethodChannelLocationProvider(channel: channel);
      String code = 'TIMEOUT';
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (MethodCall call) async => throw PlatformException(code: code));
      addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      await settle();
      expect(queue.entries.any((ClientLogEntry e) => e.kind == 'MAP_ERROR' && e.code == 'LOCATION_TIMEOUT'), isTrue);
      final int before = queue.length;
      code = 'DENIED';
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      code = 'DISABLED';
      await expectLater(provider.currentFix(), throwsA(isA<LocationException>()));
      await settle();
      expect(queue.length, before, reason: 'permission and GPS switch are the person\'s choices');
    });

    test('ROUTE_ERROR: a road-distance request that fails is reported once per failure; the card still says "unavailable", never a number', () async {
      final FakeDiscoveryApi api = FakeDiscoveryApi()..routeOffline = true;
      final RouteDistanceController routes = RouteDistanceController(api: api);
      final LocationFix here = LocationFix(latitude: 10.0123, longitude: 106.0456, accuracyMeters: 10, takenAt: DateTime.utc(2026, 10, 25));
      const ShopCardData shop = ShopCardData(shopId: 's1', name: 'Quán', address: 'x', reason: 'ONLINE', latitude: 10.02, longitude: 106.05);
      await routes.want(<ShopCardData>[shop], here);
      await settle();
      expect(routes.of(shop, here).kind, RouteDistanceKind.unavailable);
      expect(queue.entries.single.kind, 'ROUTE_ERROR');
      expect(queue.entries.single.code, 'ROUTE_DISTANCE_FAILED');
      expect(store.content!.contains('10.0123'), isFalse, reason: 'the position is never reported');
    });

    test('PUSH_ERROR: a token that the server did not accept is reported (not an offline phone), without the token', () async {
      final SessionController session = (await _signedIn()).session;
      final _PushFailSource source = _PushFailSource(session);
      final _PushPort port = _PushPort();
      final PushSync sync = PushSync(session: session, source: source, port: port);
      await settle();
      expect(source.tries, 1);
      expect(queue.entries.single.kind, 'PUSH_ERROR');
      expect(queue.entries.single.code, 'PUSH_REGISTER_SERVER');
      expect(store.content!.contains('tok-aaaaaaaaaaaaaaaaaaaa'), isFalse);
      source.kind = NotificationFailureKind.offline;
      port.refreshes.add('tok-bbbbbbbbbbbbbbbbbbbb');
      await settle();
      expect(source.tries, 2);
      expect(queue.length, 1, reason: 'being offline is not a push fault');
      sync.dispose();
    });
  });
}
