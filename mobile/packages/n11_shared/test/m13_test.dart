import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

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
}
