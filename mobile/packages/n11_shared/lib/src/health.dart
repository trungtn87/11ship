import 'dart:async';
import 'dart:convert';
import 'dart:typed_data' show BytesBuilder;
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'errors.dart';

// Backend reachability for the two phone apps (catalog F05/F06/S06, C03). Port of apps/client-shared/src/health.ts.
//
//   GET /v1/health/live  -> 200 {"data":{"status":"ok"}}
//   GET /v1/health/ready -> 200 {"data":{"status":"ready"}}   or   HTTP 503 (process alive, not ready to serve)
//
// Rules this file enforces:
//  * every request has a time limit (15 s) and asks for no cached answer: a health answer is never reused;
//  * no credentials, cookies or tokens are sent: health is public and carries no session;
//  * the body is checked exactly: a 200 whose body is not the agreed one is a failure, never "ok";
//  * a result is applied only if it belongs to the NEWEST check (generation guard), so a slow old answer can never
//    overwrite the state a newer check already set;
//  * a result carries a reason from a closed list, never an exception message or server text;
//  * TLS is verified by the platform exactly as for any HTTPS client: there is no certificate override anywhere.

const Duration kHealthTimeout = Duration(seconds: 15);
const String kLivePath = '/v1/health/live';
const String kReadyPath = '/v1/health/ready';

/// Largest health body that is read. The real ones are about 30 bytes; anything bigger is not a health answer.
const int _maxBodyBytes = 4096;

/// What the transport hands back: the HTTP status and the (size-limited) body.
class RawHealthResponse {
  const RawHealthResponse({required this.status, required this.body, this.oversize = false});

  final int status;
  final String body;

  /// True when the server sent more than the allowed number of bytes (the rest was not read).
  final bool oversize;
}

/// One GET. Throws on any network failure (a [TimeoutException] when it took longer than `timeout`).
typedef HealthTransport = Future<RawHealthResponse> Function(Uri uri, Duration timeout);

enum ProbeState { pending, skipped, ok, failed }

@immutable
class ProbeResult {
  const ProbeResult._(this.state, {this.reason, this.httpStatus, this.elapsedMs = 0});

  const ProbeResult.ok({required int httpStatus, required int elapsedMs}) : this._(ProbeState.ok, httpStatus: httpStatus, elapsedMs: elapsedMs);

  const ProbeResult.failed(HealthFailureReason reason, {int? httpStatus, required int elapsedMs})
      : this._(ProbeState.failed, reason: reason, httpStatus: httpStatus, elapsedMs: elapsedMs);

  static const ProbeResult pending = ProbeResult._(ProbeState.pending);
  static const ProbeResult skipped = ProbeResult._(ProbeState.skipped);

  final ProbeState state;
  final HealthFailureReason? reason;
  final int? httpStatus;
  final int elapsedMs;
}

@immutable
class HealthSnapshot {
  const HealthSnapshot({required this.phase, required this.generation, required this.live, required this.ready, this.lastCheckedAt});

  const HealthSnapshot.initial()
      : phase = HealthPhase.checking,
        generation = 0,
        live = ProbeResult.pending,
        ready = ProbeResult.pending,
        lastCheckedAt = null;

  final HealthPhase phase;

  /// Number of the check this snapshot belongs to (0 = nothing was checked yet).
  final int generation;
  final ProbeResult live;
  final ProbeResult ready;

  /// When the last check FINISHED. Kept while a new check runs so the screen can say "last check".
  final DateTime? lastCheckedAt;
}

/// True for exactly `{"data":{"status":<expected>}}` (an object, a `data` object, a string `status`).
bool isHealthBody(Object? value, String expected) {
  if (value is! Map<String, dynamic>) {
    return false;
  }
  final Object? data = value['data'];
  if (data is! Map<String, dynamic>) {
    return false;
  }
  return data['status'] == expected;
}

/// What the person is told, from the two probe results. Pure, so every combination is testable.
HealthPhase derivePhase(ProbeResult live, ProbeResult ready) {
  if (live.state == ProbeState.pending) {
    return HealthPhase.checking;
  }
  if (live.state == ProbeState.failed) {
    return _phaseOfReason(live.reason!, liveWasOk: false);
  }
  if (live.state != ProbeState.ok) {
    return HealthPhase.checking;
  }
  if (ready.state == ProbeState.ok) {
    return HealthPhase.ready;
  }
  if (ready.state == ProbeState.failed) {
    return _phaseOfReason(ready.reason!, liveWasOk: true);
  }
  return HealthPhase.checking;
}

HealthPhase _phaseOfReason(HealthFailureReason reason, {required bool liveWasOk}) {
  switch (reason) {
    case HealthFailureReason.offline:
      return HealthPhase.offline;
    case HealthFailureReason.timeout:
      return HealthPhase.timeout;
    case HealthFailureReason.tls:
      return HealthPhase.tlsFailed;
    case HealthFailureReason.notReady:
      return liveWasOk ? HealthPhase.backendNotReady : HealthPhase.badResponse;
    case HealthFailureReason.badResponse:
    case HealthFailureReason.unexpectedStatus:
      return HealthPhase.badResponse;
  }
}

/// The real transport: dart:io HttpClient with the platform's normal TLS verification. No `badCertificateCallback`, no
/// redirects followed, no cookies kept, one client per request that is always closed.
Future<RawHealthResponse> httpHealthTransport(Uri uri, Duration timeout) async {
  final HttpClient client = HttpClient()
    ..connectionTimeout = timeout
    ..idleTimeout = const Duration(seconds: 1);
  try {
    return await _get(client, uri).timeout(timeout);
  } finally {
    client.close(force: true);
  }
}

Future<RawHealthResponse> _get(HttpClient client, Uri uri) async {
  final HttpClientRequest request = await client.getUrl(uri);
  request.followRedirects = false;
  request.headers.set(HttpHeaders.acceptHeader, 'application/json');
  request.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
  final HttpClientResponse response = await request.close();
  final BytesBuilder bytes = BytesBuilder(copy: false);
  bool oversize = false;
  await for (final List<int> chunk in response) {
    if (bytes.length + chunk.length > _maxBodyBytes) {
      oversize = true;
      break;
    }
    bytes.add(chunk);
  }
  return RawHealthResponse(status: response.statusCode, body: utf8.decode(bytes.takeBytes(), allowMalformed: true), oversize: oversize);
}

/// Runs the two checks and tells listeners what the person should be told. Port of HealthMonitor (health.ts).
class HealthMonitor extends ChangeNotifier {
  HealthMonitor({
    required this.baseUrl,
    required this.transport,
    this.timeout = kHealthTimeout,
    this.pollInterval,
    this.shouldPoll,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  /// `https://host[:port]` without a path, or null when the build has no valid address (nothing is requested then).
  final Uri? baseUrl;
  final HealthTransport transport;
  final Duration timeout;

  /// Re-check every this long while [start] is active. Null or zero = only on demand.
  final Duration? pollInterval;

  /// Polling pauses while this returns false (for example when the app is in the background). Default: always poll.
  final bool Function()? shouldPoll;
  final DateTime Function() _clock;

  static const Duration _grace = Duration(milliseconds: 250);

  HealthSnapshot _snapshot = const HealthSnapshot.initial();
  int _generation = 0;
  bool _running = false;
  bool _disposed = false;
  Timer? _pollTimer;

  HealthSnapshot get snapshot => _snapshot;

  /// Begins periodic checking (if an interval was given) and runs a check now.
  void start() {
    _running = true;
    unawaited(check());
  }

  /// Stops periodic checking and cancels interest in a check in flight (its answer will not be applied).
  void stop() {
    _running = false;
    _clearPoll();
    _generation += 1;
  }

  /// Starts a new check and returns the state when THIS check finishes. If a newer check (or [markOffline]) replaced it first,
  /// this one stops and returns whatever the current state is at that moment, without changing it. While the new check runs the
  /// state is `checking`: the old "Sẵn sàng" is gone immediately, it is never shown next to a check that has not answered.
  Future<HealthSnapshot> check() async {
    _clearPoll();
    _generation += 1;
    final int generation = _generation;
    final Uri? base = baseUrl;
    if (base == null) {
      _set(HealthSnapshot(phase: HealthPhase.notConfigured, generation: generation, live: ProbeResult.skipped, ready: ProbeResult.skipped));
      return _snapshot;
    }
    _set(HealthSnapshot(phase: HealthPhase.checking, generation: generation, live: ProbeResult.pending, ready: ProbeResult.pending, lastCheckedAt: _snapshot.lastCheckedAt));

    final ProbeResult live = await _probe(base.replace(path: kLivePath), 'ok');
    // Generation guard: a newer check (or markOffline / stop) already took over, so this answer is old and is dropped.
    if (generation != _generation) {
      return _snapshot;
    }
    // Interim state: liveness is known, readiness is being asked. The person still sees "checking".
    _set(HealthSnapshot(phase: HealthPhase.checking, generation: generation, live: live, ready: ProbeResult.pending, lastCheckedAt: _snapshot.lastCheckedAt));

    ProbeResult ready;
    if (live.state == ProbeState.ok) {
      ready = await _probe(base.replace(path: kReadyPath), 'ready');
      if (generation != _generation) {
        return _snapshot;
      }
    } else {
      // The process did not answer /live: asking /ready would only wait for a second timeout.
      ready = ProbeResult.skipped;
    }
    _set(HealthSnapshot(phase: derivePhase(live, ready), generation: generation, live: live, ready: ready, lastCheckedAt: _clock()));
    _schedulePoll(generation);
    return _snapshot;
  }

  /// The platform says the network is gone: show "offline" at once, without waiting for a timeout.
  void markOffline() {
    _generation += 1;
    _set(HealthSnapshot(
      phase: HealthPhase.offline,
      generation: _generation,
      live: const ProbeResult.failed(HealthFailureReason.offline, elapsedMs: 0),
      ready: ProbeResult.skipped,
      lastCheckedAt: _snapshot.lastCheckedAt,
    ));
  }

  /// One GET with its own deadline. It always resolves to a result and never decides whether the result is still wanted: that
  /// is [check]'s job (generation guard).
  Future<ProbeResult> _probe(Uri uri, String expected) async {
    final Stopwatch stopwatch = Stopwatch()..start();
    ProbeResult failed(HealthFailureReason reason, [int? status]) =>
        ProbeResult.failed(reason, httpStatus: status, elapsedMs: stopwatch.elapsedMilliseconds);

    final RawHealthResponse response;
    try {
      response = await transport(uri, timeout).timeout(timeout + _grace);
    } on TimeoutException {
      return failed(HealthFailureReason.timeout);
    } on TlsException {
      return failed(HealthFailureReason.tls);
    } catch (_) {
      // Network failure, refused connection, DNS: the message is never used.
      return failed(HealthFailureReason.offline);
    }
    final int status = response.status;
    if (expected == 'ready' && status == 503) {
      return failed(HealthFailureReason.notReady, 503);
    }
    if (status != 200) {
      return failed(HealthFailureReason.unexpectedStatus, status);
    }
    if (response.oversize || response.body.length > _maxBodyBytes) {
      return failed(HealthFailureReason.badResponse, status);
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      return failed(HealthFailureReason.badResponse, status);
    }
    if (isHealthBody(decoded, expected)) {
      return ProbeResult.ok(httpStatus: status, elapsedMs: stopwatch.elapsedMilliseconds);
    }
    return failed(HealthFailureReason.badResponse, status);
  }

  void _set(HealthSnapshot snapshot) {
    if (_disposed) {
      return;
    }
    _snapshot = snapshot;
    notifyListeners();
  }

  void _clearPoll() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  void _schedulePoll(int generation) {
    final Duration? interval = pollInterval;
    if (!_running || interval == null || interval <= Duration.zero || generation != _generation || _disposed) {
      return;
    }
    _pollTimer = Timer(interval, () {
      _pollTimer = null;
      if (!_running || _disposed) {
        return;
      }
      final bool Function()? gate = shouldPoll;
      if (gate == null || gate()) {
        unawaited(check());
      } else {
        _schedulePoll(_generation);
      }
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _running = false;
    _clearPoll();
    super.dispose();
  }
}
