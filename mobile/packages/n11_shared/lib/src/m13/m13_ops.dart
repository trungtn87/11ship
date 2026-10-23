import 'dart:async';
import 'dart:convert';
import 'dart:ui' show PlatformDispatcher;

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

  Timer? _timer;
  Timer? _busyTimer;
  String? _reportedFor;
  bool _flushing = false;
  late final _OpsLifecycle _lifecycle = _OpsLifecycle(this);

  String get component => app.label;

  /// Starts the periodic work: the update check, the version report and the queue delivery. Safe to call once at start.
  void start() {
    session.addListener(_onSession);
    WidgetsBinding.instance.addObserver(_lifecycle);
    unawaited(queue.load());
    unawaited(updates.check());
    _timer = Timer.periodic(flushInterval, (Timer _) => unawaited(tick()));
    // While a REQUIRED update waits, learn quickly that the last order ended.
    _busyTimer = Timer.periodic(const Duration(minutes: 1), (Timer _) => unawaited(updates.refreshBusy()));
  }

  void dispose() {
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
