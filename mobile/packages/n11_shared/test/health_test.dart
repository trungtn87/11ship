import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

final Uri base = Uri.parse('https://example.test');

const RawHealthResponse liveOk = RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}');
const RawHealthResponse readyOk = RawHealthResponse(status: 200, body: '{"data":{"status":"ready"}}');

HealthTransport routes(Map<String, FutureOr<RawHealthResponse> Function()> table) {
  return (Uri uri, Duration timeout) async => table[uri.path]!();
}

HealthMonitor monitor(HealthTransport transport, {Uri? url, Duration timeout = const Duration(seconds: 5)}) =>
    HealthMonitor(baseUrl: url ?? base, transport: transport, timeout: timeout);

void main() {
  test('ready when /live and /ready both answer with the agreed body', () async {
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => liveOk, kReadyPath: () => readyOk}));
    final HealthSnapshot s = await m.check();
    expect(s.phase, HealthPhase.ready);
    expect(s.live.state, ProbeState.ok);
    expect(s.ready.state, ProbeState.ok);
    expect(s.lastCheckedAt, isNotNull);
  });

  test('503 on /ready is "backend not ready", not offline', () async {
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{
      kLivePath: () => liveOk,
      kReadyPath: () => const RawHealthResponse(status: 503, body: ''),
    }));
    final HealthSnapshot s = await m.check();
    expect(s.phase, HealthPhase.backendNotReady);
    expect(s.ready.reason, HealthFailureReason.notReady);
  });

  test('network failure is offline and /ready is not asked', () async {
    int readyCalls = 0;
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{
      kLivePath: () => throw const SocketException('boom password=hunter2'),
      kReadyPath: () {
        readyCalls++;
        return readyOk;
      },
    }));
    final HealthSnapshot s = await m.check();
    expect(s.phase, HealthPhase.offline);
    expect(s.ready.state, ProbeState.skipped);
    expect(readyCalls, 0);
  });

  test('TLS handshake failure is reported as a certificate problem', () async {
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => throw const HandshakeException('bad cert')}));
    final HealthSnapshot s = await m.check();
    expect(s.phase, HealthPhase.tlsFailed);
    expect(s.live.reason, HealthFailureReason.tls);
  });

  test('the default health timeout is 15 seconds', () {
    expect(kHealthTimeout, const Duration(seconds: 15));
    expect(HealthMonitor(baseUrl: base, transport: (Uri u, Duration t) async => throw StateError('unused')).timeout, kHealthTimeout);
  });

  test('a transport that never answers ends as timeout', () async {
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => Completer<RawHealthResponse>().future}),
        timeout: const Duration(milliseconds: 30));
    final HealthSnapshot s = await m.check();
    expect(s.phase, HealthPhase.timeout);
  });

  test('a TimeoutException from the transport is a timeout', () async {
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => throw TimeoutException('x')}));
    expect((await m.check()).phase, HealthPhase.timeout);
  });

  test('200 with a wrong body, oversize body or other status is a bad response', () async {
    for (final RawHealthResponse bad in <RawHealthResponse>[
      const RawHealthResponse(status: 200, body: '<html>captive portal</html>'),
      const RawHealthResponse(status: 200, body: '{"data":{"status":"ready"}}'), // /live expects "ok"
      const RawHealthResponse(status: 200, body: '{"data":{"status":"ok"}}', oversize: true),
      const RawHealthResponse(status: 500, body: ''),
      const RawHealthResponse(status: 302, body: ''),
    ]) {
      final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => bad}));
      expect((await m.check()).phase, HealthPhase.badResponse, reason: '${bad.status} ${bad.body}');
    }
  });

  test('no base URL: notConfigured and the transport is never called', () async {
    int calls = 0;
    final HealthMonitor m = HealthMonitor(baseUrl: null, transport: (Uri u, Duration t) async {
      calls++;
      return liveOk;
    });
    expect((await m.check()).phase, HealthPhase.notConfigured);
    expect(calls, 0);
  });

  test('a recheck shows "checking" at once and drops the old ready state', () async {
    final Completer<RawHealthResponse> gate = Completer<RawHealthResponse>();
    int n = 0;
    final HealthMonitor m = monitor((Uri uri, Duration t) async {
      if (uri.path == kLivePath) {
        n++;
        return n == 1 ? liveOk : gate.future;
      }
      return readyOk;
    });
    expect((await m.check()).phase, HealthPhase.ready);
    final Future<HealthSnapshot> second = m.check();
    expect(m.snapshot.phase, HealthPhase.checking);
    expect(m.snapshot.lastCheckedAt, isNotNull);
    gate.complete(liveOk);
    expect((await second).phase, HealthPhase.ready);
  });

  test('a stale slow answer never overwrites a newer check', () async {
    final Completer<RawHealthResponse> slow = Completer<RawHealthResponse>();
    int n = 0;
    final HealthMonitor m = monitor((Uri uri, Duration t) async {
      if (uri.path == kLivePath) {
        n++;
        if (n == 1) {
          return slow.future; // old check, answers last with a failure
        }
        return liveOk;
      }
      return readyOk;
    });
    final Future<HealthSnapshot> first = m.check();
    final HealthSnapshot second = await m.check();
    expect(second.phase, HealthPhase.ready);
    slow.complete(const RawHealthResponse(status: 500, body: ''));
    final HealthSnapshot firstResult = await first;
    expect(m.snapshot.phase, HealthPhase.ready);
    expect(m.snapshot.generation, second.generation);
    expect(firstResult.phase, HealthPhase.ready);
  });

  test('markOffline wins over a check that was already running', () async {
    final Completer<RawHealthResponse> slow = Completer<RawHealthResponse>();
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => slow.future, kReadyPath: () => readyOk}));
    final Future<HealthSnapshot> running = m.check();
    m.markOffline();
    slow.complete(liveOk);
    await running;
    expect(m.snapshot.phase, HealthPhase.offline);
  });

  test('stop() discards the answer of a check in flight', () async {
    final Completer<RawHealthResponse> slow = Completer<RawHealthResponse>();
    final HealthMonitor m = monitor(routes(<String, FutureOr<RawHealthResponse> Function()>{kLivePath: () => slow.future, kReadyPath: () => readyOk}));
    final Future<HealthSnapshot> running = m.check();
    m.stop();
    slow.complete(liveOk);
    await running;
    expect(m.snapshot.phase, HealthPhase.checking);
  });

  test('requests go to /v1/health/live then /v1/health/ready over https', () async {
    final List<Uri> seen = <Uri>[];
    final HealthMonitor m = monitor((Uri uri, Duration t) async {
      seen.add(uri);
      return uri.path == kLivePath ? liveOk : readyOk;
    });
    await m.check();
    expect(seen.map((Uri u) => u.toString()).toList(), <String>['https://example.test/v1/health/live', 'https://example.test/v1/health/ready']);
  });

  test('polling re-checks while started and stops after stop()', () async {
    int live = 0;
    final HealthMonitor m = HealthMonitor(
      baseUrl: base,
      pollInterval: const Duration(milliseconds: 20),
      transport: (Uri uri, Duration t) async {
        if (uri.path == kLivePath) {
          live++;
        }
        return uri.path == kLivePath ? liveOk : readyOk;
      },
    );
    m.start();
    await Future<void>.delayed(const Duration(milliseconds: 200));
    m.stop();
    final int after = live;
    expect(after, greaterThan(2));
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(live, after);
    m.dispose();
  });

  test('derivePhase covers the probe combinations', () {
    const ProbeResult ok = ProbeResult.ok(httpStatus: 200, elapsedMs: 1);
    expect(derivePhase(ProbeResult.pending, ProbeResult.pending), HealthPhase.checking);
    expect(derivePhase(ok, ok), HealthPhase.ready);
    expect(derivePhase(ok, ProbeResult.pending), HealthPhase.checking);
    expect(derivePhase(const ProbeResult.failed(HealthFailureReason.notReady, elapsedMs: 1), ProbeResult.skipped), HealthPhase.badResponse);
  });

  test('isHealthBody accepts only the exact shape', () {
    expect(isHealthBody(<String, dynamic>{'data': <String, dynamic>{'status': 'ok'}}, 'ok'), isTrue);
    expect(isHealthBody(<String, dynamic>{'status': 'ok'}, 'ok'), isFalse);
    expect(isHealthBody('ok', 'ok'), isFalse);
    expect(isHealthBody(<String, dynamic>{'data': <String, dynamic>{'status': 1}}, 'ok'), isFalse);
  });
}
