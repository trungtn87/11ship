import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

// Issue #190: "Hoàn tất thiết lập cửa hàng" - the checklist x/4 the SERVER computes from the real data (account, shop info + schedule, a pickup point
// from GPS, a first sellable dish). GET /v1/onboarding/shop/setup. The app decides nothing: it draws steps and states, opens the right screen for a
// missing one, and says "ready" only when the server says the shop is public. There is no "submit" and no waiting for an administrator.
// The same rules as the other owner reads: the LATEST answer wins, a failed refresh keeps the last answer marked out of date, a session that ended
// drops everything, and nothing is invented.

enum SetupLoad { idle, loading, ready, failed }

@immutable
class SetupStepView {
  const SetupStepView({required this.key, required this.done, required this.missing});

  final String key;
  final bool done;
  final List<String> missing;
}

@immutable
class ShopSetup {
  const ShopSetup({
    required this.shopId,
    required this.status,
    required this.state,
    required this.completedSteps,
    required this.totalSteps,
    required this.steps,
    required this.missing,
    required this.isPublic,
    required this.activated,
    required this.activatedAt,
    required this.requestNote,
    required this.lock,
  });

  final String shopId;

  /// INCOMPLETE (profile not finished) / ACTIVE / DISABLED, as the shop row says.
  final String status;

  /// INCOMPLETE (not set up) / ACTIVATED / LOCKED / NEEDS_REVIEW.
  final String state;
  final int completedSteps;
  final int totalSteps;
  final List<SetupStepView> steps;
  final List<String> missing;

  /// Customers can see the shop now.
  final bool isPublic;
  final bool activated;
  final DateTime? activatedAt;

  /// The administrator's request to complete the setup, if one is pending.
  final String? requestNote;

  /// ADMIN / OWNER_ACCOUNT when the shop is locked.
  final String? lock;

  bool get isActivated => state == 'ACTIVATED' && isPublic;
  bool get isLocked => state == 'LOCKED';
  SetupStepView? step(String key) {
    for (final SetupStepView s in steps) {
      if (s.key == key) return s;
    }
    return null;
  }

  static const List<String> keys = <String>['ACCOUNT', 'SHOP_INFO', 'LOCATION', 'FIRST_ITEM'];
  static const List<String> states = <String>['INCOMPLETE', 'ACTIVATED', 'LOCKED', 'NEEDS_REVIEW'];

  /// Strict: anything that is not exactly the documented shape is null (the caller then shows "could not read", never a half-filled checklist).
  static ShopSetup? tryParse(Object? data) {
    if (data is! Map<String, Object?>) return null;
    final Object? id = data['shop_id'];
    final Object? status = data['status'];
    final Object? state = data['state'];
    final Object? completed = data['completed_steps'];
    final Object? total = data['total_steps'];
    final Object? steps = data['steps'];
    final Object? missing = data['missing'];
    final Object? isPublic = data['public'];
    final Object? activated = data['activated'];
    if (id is! String || status is! String || state is! String || !states.contains(state) || completed is! int || total is! int || total != keys.length || completed < 0 || completed > total) return null;
    if (steps is! List<Object?> || missing is! List<Object?> || isPublic is! bool || activated is! bool) return null;
    final List<SetupStepView> parsed = <SetupStepView>[];
    for (final Object? raw in steps) {
      if (raw is! Map<String, Object?>) return null;
      final Object? key = raw['key'];
      final Object? done = raw['done'];
      final Object? list = raw['missing'];
      if (key is! String || !keys.contains(key) || done is! bool || list is! List<Object?> || list.any((Object? e) => e is! String)) return null;
      parsed.add(SetupStepView(key: key, done: done, missing: <String>[for (final Object? e in list) e! as String]));
    }
    if (parsed.length != keys.length || missing.any((Object? e) => e is! String)) return null;
    String? note;
    final Object? request = data['request'];
    if (request != null) {
      if (request is! Map<String, Object?> || request['note'] is! String) return null;
      note = request['note']! as String;
    }
    final Object? lock = data['lock'];
    if (lock != null && lock is! String) return null;
    final Object? at = data['activated_at'];
    return ShopSetup(
      shopId: id,
      status: status,
      state: state,
      completedSteps: completed,
      totalSteps: total,
      steps: parsed,
      missing: <String>[for (final Object? e in missing) e! as String],
      isPublic: isPublic,
      activated: activated,
      activatedAt: at is String ? DateTime.tryParse(at) : null,
      requestNote: note,
      lock: lock as String?,
    );
  }
}

class ShopSetupController extends ChangeNotifier {
  ShopSetupController({required this.session, this.pollEvery = const Duration(seconds: 30), DateTime Function()? clock}) : _clock = clock ?? DateTime.now {
    session.addListener(_onSession);
    _sessionEpoch = session.sessionEpoch;
  }

  final SessionController session;
  final Duration pollEvery;
  final DateTime Function() _clock;

  SetupLoad _load = SetupLoad.idle;
  ShopSetup? _setup;
  AuthFailure? _failure;
  bool _stale = false;
  bool _refreshing = false;
  bool _justActivated = false;
  bool _celebrated = false;
  Timer? _timer;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;

  SetupLoad get loadState => _load;

  /// The last answer of the server; null = the person has no shop or nothing was read yet.
  ShopSetup? get setup => _setup;
  AuthFailure? get failure => _failure;

  /// The last answer is kept but a newer read failed.
  bool get stale => _stale;

  /// The shop became public while this controller was watching (or moments before it started): show the "ready" message once.
  bool get justActivated => _justActivated;

  void acknowledgeActivation() {
    if (!_justActivated) return;
    _justActivated = false;
    _notify();
  }

  Future<void> load() async {
    if (_load == SetupLoad.loading) return;
    _load = SetupLoad.loading;
    _failure = null;
    _notify();
    await _read(initial: true);
  }

  /// After a screen that may have changed the setup, on resume and on the timer. Never overlaps itself.
  Future<void> refresh() async {
    if (_refreshing || _load == SetupLoad.loading) return;
    await _read(initial: false);
  }

  Future<void> _read({required bool initial}) async {
    if (_refreshing) return;
    final int epoch = _epoch;
    _refreshing = true;
    try {
      final ApiResponse response = await session.protectedCall('GET', '/v1/onboarding/shop/setup');
      if (epoch != _epoch) return;
      if (response.status != 200) throw failureOf(response);
      if (response.json?.containsKey('data') != true) throw AuthFailure(AuthFailureKind.badResponse, status: response.status, endpoint: '/v1/onboarding/shop/setup');
      final Object? data = response.data;
      final ShopSetup? parsed = ShopSetup.tryParse(data);
      if (data != null && parsed == null) throw AuthFailure(AuthFailureKind.badResponse, status: response.status, endpoint: '/v1/onboarding/shop/setup');
      final ShopSetup? before = _setup;
      _setup = parsed;
      _stale = false;
      _failure = null;
      _load = SetupLoad.ready;
      if (parsed != null && parsed.isActivated && !_celebrated) {
        final DateTime? at = parsed.activatedAt;
        final bool becameActive = before != null && !before.isActivated;
        final bool justNow = before == null && at != null && _clock().difference(at.toLocal()).abs() < const Duration(minutes: 15);
        if (becameActive || justNow) {
          _justActivated = true;
          _celebrated = true;
        }
      }
      if (parsed != null && !parsed.isActivated) _celebrated = false;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) return;
      if (_load == SetupLoad.ready || _setup != null) {
        _stale = true;
        _load = SetupLoad.ready;
      } else {
        _failure = failure;
        _load = SetupLoad.failed;
      }
    } finally {
      _refreshing = false;
    }
    _notify();
  }

  void startPolling() {
    _timer?.cancel();
    if (pollEvery == Duration.zero) return;
    _timer = Timer.periodic(pollEvery, (Timer _) => unawaited(refresh()));
  }

  void stopPolling() {
    _timer?.cancel();
    _timer = null;
  }

  void _onSession() {
    if (session.sessionEpoch != _sessionEpoch || session.status != SessionStatus.signedIn) {
      _sessionEpoch = session.sessionEpoch;
      _epoch++;
      _setup = null;
      _failure = null;
      _stale = false;
      _justActivated = false;
      _celebrated = false;
      _load = SetupLoad.idle;
      _refreshing = false;
      stopPolling();
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    stopPolling();
    session.removeListener(_onSession);
    super.dispose();
  }
}
