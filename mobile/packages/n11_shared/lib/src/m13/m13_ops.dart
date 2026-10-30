import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/native_auth.dart';
import '../account/session_controller.dart';
import '../config.dart';
import 'm13_log_queue.dart';
import 'm13_update.dart';

// M13 on the phone: the update check, the version report and the offline error queue of one app. It adds no screen of its own except the update banner,
// it never blocks the app for a reason other than a REQUIRED update (and then not while the person is in the middle of an order), and it never sends
// anything before the redaction in m13_log_queue.dart.

class OpsClient {
  OpsClient({
    required this.app,
    required this.config,
    required this.session,
    required this.updates,
    required this.queue,
    this.flushInterval = const Duration(minutes: 10),
  });

  final ClientApp app;
  final AppConfig config;
  final SessionController session;
  final AppUpdateController updates;
  final ClientLogQueue queue;
  final Duration flushInterval;

  /// The running client of this app, for the static [report] gate (null before [start] and after [dispose]).
  static OpsClient? _current;

  Timer? _timer;
  Timer? _busyTimer;
  String? _reportedFor;
  bool _flushing = false;
  late final _OpsLifecycle _lifecycle = _OpsLifecycle(this);

  String get component => app.label;

  /// Starts the periodic work: the update check, the version report and the queue delivery. Safe to call once at start.
  void start() {
    _current = this;
    session.addListener(_onSession);
    WidgetsBinding.instance.addObserver(_lifecycle);
    unawaited(queue.load());
    unawaited(updates.check());
    _timer = Timer.periodic(flushInterval, (Timer _) => unawaited(tick()));
    // While a REQUIRED update waits, learn quickly that the last order ended.
    _busyTimer = Timer.periodic(const Duration(minutes: 1), (Timer _) => unawaited(updates.refreshBusy()));
  }

  void dispose() {
    if (identical(_current, this)) {
      _current = null;
    }
    _timer?.cancel();
    _busyTimer?.cancel();
    WidgetsBinding.instance.removeObserver(_lifecycle);
    session.removeListener(_onSession);
  }

  /// On return to the foreground and on the periodic timer.
  Future<void> tick() async {
    await updates.check();
    await flush();
  }

  void _onSession() {
    if (session.identity != null) {
      unawaited(flush());
    }
  }

  /// Records one error for the server (redacted, de-duplicated, bounded) and tries to deliver the queue.
  Future<void> record({required String kind, required String code, String? message, String? deliveryCode}) async {
    final bool queued = await queue.add(kind: kind, code: code, appVersion: _versionName(), message: message, deliveryCode: deliveryCode);
    if (queued) {
      unawaited(flush());
    }
  }

  /// The one safe way for any code of the app to report a non-crash error ([kind] is one of [clientLogKinds]). It goes through the running client's queue,
  /// so it is redacted, de-duplicated within the recent window and bounded like every other entry. Without a running client (no server address, before start,
  /// in a test) it does nothing; it never throws and never waits.
  static void report({required String kind, required String code, String? message, String? deliveryCode}) {
    final OpsClient? client = _current;
    if (client == null || !clientLogKinds.contains(kind)) {
      return;
    }
    try {
      unawaited(client.record(kind: kind, code: normalizeLogCode(code), message: message, deliveryCode: deliveryCode).catchError((Object _) {}));
    } on Object {
      // Reporting must never be the reason something else fails.
    }
  }

  /// A failed write (POST / PATCH / PUT / DELETE) that the server answered with an error or an answer the app could not understand. The code names the endpoint
  /// WITHOUT identifiers; the message never carries a body, a query or an id.
  static void reportActionFailure(String method, String path, {required String reason}) {
    report(kind: 'ACTION_ERROR', code: opsActionCode(method, path), message: '${method.toUpperCase()} ${_stablePath(path)}: $reason');
  }

  /// A route / distance calculation that failed. [code] names the failing step; the position that was asked about is never included.
  static void reportRouteError(String code, {String? message}) {
    report(kind: 'ROUTE_ERROR', code: code, message: message);
  }

  /// Test seam: replaces the client the static gate reports to.
  @visibleForTesting
  static void attachForTest(OpsClient? client) {
    _current = client;
  }

  void recordCrash(Object error, StackTrace? stack) {
    unawaited(record(kind: 'CRASH', code: normalizeLogCode(error.runtimeType.toString()), message: error.toString()));
  }

  /// Chains onto the existing handlers: the app keeps reporting to the console exactly as before.
  void installCrashHooks() {
    final FlutterExceptionHandler? previous = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      recordCrash(details.exception, details.stack);
      if (previous != null) {
        previous(details);
      } else {
        FlutterError.presentError(details);
      }
    };
    final bool Function(Object, StackTrace)? previousDispatcher = PlatformDispatcher.instance.onError;
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      recordCrash(error, stack);
      return previousDispatcher?.call(error, stack) ?? false;
    };
  }

  String _versionName() {
    final String name = config.versionName;
    return RegExp(r'^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$').hasMatch(name) ? name : '0.0.0';
  }

  /// Delivers the version report (once per signed-in person) and one batch of queued errors. Never throws.
  Future<void> flush() async {
    if (_flushing || session.identity == null) {
      return;
    }
    _flushing = true;
    try {
      await _reportVersion();
      await queue.flush(_send);
    } on Object {
      // The next tick tries again.
    } finally {
      _flushing = false;
    }
  }

  Future<void> _reportVersion() async {
    final String? userId = session.identity?.userId;
    final int code = int.tryParse(config.buildNumber) ?? 0;
    if (userId == null || _reportedFor == userId || code <= 0) {
      return;
    }
    try {
      final ApiResponse response = await session.protectedCall(
        'POST',
        '/v1/ops/client/version',
        body: jsonEncode(<String, Object?>{'component': component, 'version_name': _versionName(), 'version_code': code}),
      );
      if (response.status == 200) {
        _reportedFor = userId;
      }
    } on Object {
      // Reported at the next flush.
    }
  }

  Future<DeliveryOutcome> _send(List<Map<String, Object?>> batch) async {
    if (session.identity == null) {
      return DeliveryOutcome.signedOut;
    }
    try {
      final ApiResponse response = await session.protectedCall('POST', '/v1/ops/client/logs', body: jsonEncode(<String, Object?>{'entries': batch}));
      if (response.status == 200) {
        return DeliveryOutcome.accepted;
      }
      if (response.status == 401 || response.status == 403) {
        return DeliveryOutcome.signedOut;
      }
      if (response.status == 400) {
        return DeliveryOutcome.rejected;
      }
      return DeliveryOutcome.retry;
    } on AuthFailure catch (error) {
      return error.kind == AuthFailureKind.sessionEnded ? DeliveryOutcome.signedOut : DeliveryOutcome.retry;
    }
  }
}

/// Returning to the foreground re-checks for an update and delivers what waited (the shared minimum interval keeps this cheap).
class _OpsLifecycle with WidgetsBindingObserver {
  _OpsLifecycle(this.client);

  final OpsClient client;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(client.tick());
    }
  }
}

/// The M13 client of one app, or null when the build has no server address (then nothing is checked or sent). [busyProbe] says whether the person is in the
/// middle of work an update must not interrupt (a shipper with an active order).
OpsClient? createOpsClient(ClientApp app, SessionController session, AppConfig config, {Future<bool> Function()? busyProbe, UpdatePlatform platform = const MethodChannelUpdatePlatform()}) {
  final Uri? base = config.apiUri;
  if (base == null) {
    return null;
  }
  final int code = int.tryParse(config.buildNumber) ?? 0;
  final AppUpdateController updates = AppUpdateController(
    component: app.label,
    installedVersionCode: code,
    installedVersionName: config.versionName,
    transport: HttpApiTransport(base: base),
    files: HttpUpdateFileSource(base: base),
    platform: platform,
    busyProbe: busyProbe,
    // A local build without a build number is never told to "update".
    enabled: code > 0,
  );
  final ClientLogQueue queue = ClientLogQueue(store: FileLogQueueStore(() async => '${await platform.dataDirectory()}/ops-log-queue.json'));
  return OpsClient(app: app, config: config, session: session, updates: updates, queue: queue);
}

final RegExp _uuidSegment = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
final RegExp _numberSegment = RegExp(r'^[0-9]+$');

/// The fixed path of a request: no query, no version prefix, and every identifier replaced by `:id`.
String _stablePath(String path) {
  final List<String> parts = <String>[
    for (final String segment in path.split('?').first.split('/'))
      if (segment.isNotEmpty && segment != 'v1') (_uuidSegment.hasMatch(segment) || _numberSegment.hasMatch(segment)) ? ':id' : segment,
  ];
  return '/${parts.join('/')}';
}

/// A code in the server's vocabulary for a failed write: the method and the last two fixed parts of the endpoint, for example POST_ME_DELIVERIES_CANCEL.
String opsActionCode(String method, String path) {
  final List<String> fixed = _stablePath(path).split('/').where((String s) => s.isNotEmpty && s != ':id').toList();
  final List<String> tail = fixed.length > 2 ? fixed.sublist(fixed.length - 2) : fixed;
  return normalizeLogCode('${method.toUpperCase()}_${tail.join('_')}');
}
