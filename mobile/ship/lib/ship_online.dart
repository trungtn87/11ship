import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_m07.dart';

// The ONE online switch of 11Ship. Turning it on shares the position first and only then asks the server to accept orders; turning it off stops new
// orders at once and stops the position as soon as nothing needs it. Every screen (Home, the delivery screens, the profile switch) reads and drives
// this object, so they cannot disagree. The server decides every condition; the app only orders the steps and cleans up after a failed one:
//
//   on : start sharing -> a fresh, valid position reaches the server -> POST accepting=true      (any failure: stop sharing again unless something needs it)
//   off: POST accepting=false -> keep sharing only while the server says work is in progress    (the report answer says when that ends)
//   open the app / sign in: read the server, then start or stop sharing to match what the server says is needed.
//
// It lives with the session, not with a screen.
class ShipOnline extends ChangeNotifier {
  ShipOnline({required this.session, required this.reporter, DriverController? driver}) : _driver = driver;

  final SessionController session;
  final ShipLocationReporter reporter;
  DriverController? _driver;

  bool _attached = false;
  bool _disposed = false;
  bool _busy = false;
  bool _turningOn = false;
  bool _reconciling = false;
  bool _autoBlocked = false;
  int _sessionEpoch = -1;
  LocationProblem _problem = LocationProblem.none;
  String? _message;
  Timer? _retryTimer;

  DriverController? get driver => _driver;

  /// A turn-on or turn-off is in progress: the button ignores further taps.
  bool get busy => _busy;
  LocationProblem get problem => _problem != LocationProblem.none ? _problem : reporter.problem;

  /// A plain sentence from the server's refusal (for example the wallet), when the last turn-on was refused. Never a code or an id.
  String? get message => _message;

  /// Late binding for a screen that has the controller before the one that created this object had it.
  void adopt(DriverController? driver) {
    if (_driver == null && driver != null) {
      _driver = driver;
      if (_attached) _bindDriver(driver);
    }
  }

  /// Idempotent: starts watching the session, the profile and the reporter. Safe to call from any screen; only the first call does anything.
  void attach() {
    if (_attached || _disposed) return;
    _attached = true;
    session.addListener(_onSession);
    reporter.addListener(_notify);
    reporter.onAck = _onAck;
    reporter.onRefused = () => unawaited(_reload());
    reporter.onResumed = () { _autoBlocked = false; unawaited(_reload()); };
    final DriverController? d = _driver;
    if (d != null) _bindDriver(d);
    _onSession();
  }

  void _bindDriver(DriverController d) {
    d.addListener(_onDriver);
    d.acceptingHandler = setOnline;
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    if (_attached) {
      session.removeListener(_onSession);
      reporter.removeListener(_notify);
      _driver?.removeListener(_onDriver);
      if (reporter.onAck == _onAck) reporter.onAck = null;
      _driver?.acceptingHandler = null;
    }
    super.dispose();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _onSession() {
    if (session.status == SessionStatus.signedIn) {
      if (_sessionEpoch != session.sessionEpoch) {
        _sessionEpoch = session.sessionEpoch;
        _problem = LocationProblem.none;
        _message = null;
        _autoBlocked = false;
        reporter.observe();
        unawaited(_reload());
      }
    } else {
      // Signed out or the session was revoked: the reporter stops itself (and never sends with the old token); forget what this screen knew.
      _sessionEpoch = -1;
      _problem = LocationProblem.none;
      _message = null;
      _autoBlocked = false;
      _retryTimer?.cancel();
    }
    _notify();
  }

  void _onDriver() {
    _notify();
    unawaited(reconcile());
  }

  Future<void> _reload() async {
    final DriverController? d = _driver;
    if (d == null || session.status != SessionStatus.signedIn) return;
    await d.load();
  }

  void _onAck(LocationAck ack) {
    // While turning on, the server still says "not needed": the answer to the first report is not a reason to stop.
    if (_busy) return;
    final DriverProfile? p = _driver?.profile;
    if (p == null) return;
    final bool pausedByPosition = p.presence?.pausedReason != null;
    if (ack.shouldShare == false || (ack.intentOnline != null && ack.intentOnline != p.acceptingDeliveries) || (ack.intentOnline == true && pausedByPosition)) {
      unawaited(_reload());
    }
  }

  bool _wantShare(DriverProfile p) => p.presence?.shouldShareLocation ?? (p.acceptingDeliveries && p.status == 'ACTIVE');

  /// Makes the location service match what the server says is needed. Does nothing while a turn-on/off runs (that flow does its own cleanup).
  Future<void> reconcile({bool force = false}) async {
    final DriverController? d = _driver;
    if (_disposed || _busy || _reconciling || d == null || d.busy || session.status != SessionStatus.signedIn) return;
    final DriverProfile? p = d.profile;
    if (p == null) return;
    _reconciling = true;
    try {
      await _apply(p, force: force);
    } finally {
      _reconciling = false;
      _notify();
    }
  }

  Future<void> _apply(DriverProfile p, {bool force = false}) async {
    final bool want = _wantShare(p);
    if (want && !reporter.sharing && !reporter.starting) {
      if (_autoBlocked && !force) return;
      _autoBlocked = false;
      await reporter.start();
      if (reporter.sharing) {
        _problem = LocationProblem.none;
      } else {
        // No prompt again until the Shipper comes back to the app or taps "Thử lại".
        _problem = reporter.problem;
        _autoBlocked = true;
      }
    } else if (!want && (reporter.sharing || reporter.starting)) {
      await reporter.stop();
      _problem = LocationProblem.none;
    }
  }

  /// The tap on "Thử lại": turns on again when the switch is off, otherwise restores the sharing that should be running.
  Future<void> retry() async {
    final DriverProfile? p = _driver?.profile;
    if (_busy || p == null) return;
    _problem = LocationProblem.none;
    _message = null;
    _autoBlocked = false;
    if (p.acceptingDeliveries || (p.presence?.hasActiveWork ?? false)) {
      await reconcile(force: true);
    } else {
      await setOnline(true);
    }
  }

  Future<void> openSettings(String kind) => reporter.openSettings(kind);

  /// The one handler of the online switch (Home button, profile switch). Returns whether the server now has the requested state.
  Future<bool> setOnline(bool on) async {
    final DriverController? d = _driver;
    if (_disposed || _busy || d == null || d.profile == null || session.status != SessionStatus.signedIn) return false;
    _busy = true;
    _turningOn = on;
    _problem = LocationProblem.none;
    _message = null;
    _autoBlocked = false;
    _notify();
    try {
      return on ? await _turnOn(d) : await _turnOff(d);
    } finally {
      _busy = false;
      _turningOn = false;
      _notify();
    }
  }

  Future<bool> _turnOn(DriverController d) async {
    final DriverProfile p = d.profile!;
    if (!p.acceptingDeliveries && !p.readiness.canAccept) return false;
    final bool shared = await reporter.acquire();
    if (session.status != SessionStatus.signedIn) return false;
    if (!shared) {
      _problem = reporter.problem == LocationProblem.none ? LocationProblem.noFix : reporter.problem;
      await _releaseIfUnneeded(d);
      return false;
    }
    final bool accepted = await d.sendAccepting(true);
    if (session.status != SessionStatus.signedIn) return false;
    if (accepted) {
      _problem = LocationProblem.none;
      return true;
    }
    final AuthFailure? failure = d.failure;
    _message = failure == null ? null : (driverRefusalMessage(failure) ?? (failure.outcomeUnknown ? 'Chưa kết nối được. Kiểm tra mạng rồi thử lại.' : 'Chưa bật được online. Thử lại sau ít phút.'));
    // A lost answer may still have switched the server on: read it before deciding to stop the sharing.
    if (failure?.outcomeUnknown ?? false) await d.load();
    await _releaseIfUnneeded(d);
    return false;
  }

  Future<bool> _turnOff(DriverController d) async {
    final bool done = await d.sendAccepting(false);
    if (session.status != SessionStatus.signedIn) return false;
    if (!done) {
      if (d.failure?.outcomeUnknown ?? false) await d.load();
      return false;
    }
    // The answer carries what the server still needs: the position stays while work is in progress, and stops here otherwise.
    final DriverProfile? p = d.profile;
    if (p != null) await _apply(p);
    return true;
  }

  /// After a failed turn-on: stop the sharing this attempt started unless the server (re-read) says it is needed. If the server cannot be read the
  /// sharing stays and a later read decides, so the app and the server cannot end up disagreeing about an unseen success.
  Future<void> _releaseIfUnneeded(DriverController d) async {
    final DriverProfile? p = d.profile;
    final bool unknown = d.loadState != DriverLoad.ready || p == null || (d.failure?.outcomeUnknown ?? false);
    if (unknown) {
      _retryTimer?.cancel();
      _retryTimer = Timer(const Duration(seconds: 30), () { unawaited(_reload()); });
      return;
    }
    if (!_wantShare(p)) {
      await reporter.stop();
    }
  }

  // ---- what the screens show ------------------------------------------------------------------------------------------------

  bool get intent => _driver?.profile?.acceptingDeliveries ?? false;
  bool get hasActiveWork => _driver?.profile?.presence?.hasActiveWork ?? false;

  /// The server confirmed every condition AND the server holds a position this app sent a moment ago.
  bool get receiving {
    final DriverProfile? p = _driver?.profile;
    if (p == null || !p.acceptingDeliveries || !reporter.serverHasPosition) return false;
    return p.presence?.canReceiveOrders ?? p.readiness.canAccept;
  }

  /// The switch is on but receiving is paused (no position yet, or it went stale): nothing is cancelled and it resumes by itself.
  bool get paused => intent && !receiving && !_turningOn;

  /// The small line under the logo and on the delivery screens; null when there is nothing to say.
  String? get statusLine {
    final DriverProfile? p = _driver?.profile;
    if (p == null || session.status != SessionStatus.signedIn) return null;
    if (_turningOn || reporter.starting) return 'Đang lấy vị trí…';
    final bool work = hasActiveWork;
    if (!intent && !work) return null;
    final bool shared = reporter.serverHasPosition;
    if (work) return shared ? 'Đang giao đơn · Vẫn chia sẻ vị trí' : 'Đang giao đơn · Chưa có vị trí';
    if (shared) return 'Đang chia sẻ vị trí';
    if (reporter.sharing && reporter.lastUpload == null && problem == LocationProblem.none) return 'Đang lấy vị trí…';
    return 'Chưa có vị trí · Tạm dừng nhận đơn';
  }
}

/// One online controller per session, created on first use; later calls may hand it the profile controller if it had none.
final Expando<ShipOnline> _onlines = Expando<ShipOnline>('ship-online');

ShipOnline shipOnlineFor(SessionController session, {DriverController? driver}) {
  final ShipOnline online = _onlines[session] ??= ShipOnline(session: session, reporter: reporterFor(session), driver: driver);
  online.adopt(driver);
  return online;
}

/// The delivery screens' slot: one small line, from the same state as the online button (nothing to switch here).
class ShipLocationStatusLine extends StatelessWidget {
  const ShipLocationStatusLine({super.key, required this.online});

  final ShipOnline online;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: online,
      builder: (BuildContext context, Widget? _) {
        final String? line = online.statusLine;
        if (line == null && online.problem == LocationProblem.none) {
          return const SizedBox.shrink();
        }
        return Padding(
          key: const Key('m07-share-card'),
          padding: const EdgeInsets.only(bottom: N11Space.gap2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (line != null) Text(line, key: const Key('m07-share-line'), style: N11Text.caption),
              ShipLocationProblemNote(online: online),
            ],
          ),
        );
      },
    );
  }
}

/// The short instruction and the one fitting button, shown only while there is a problem. No request id or technical code ever appears here.
class ShipLocationProblemNote extends StatelessWidget {
  const ShipLocationProblemNote({super.key, required this.online});

  final ShipOnline online;

  @override
  Widget build(BuildContext context) {
    final LocationProblem problem = online.problem;
    if (problem == LocationProblem.none) {
      return const SizedBox.shrink();
    }
    final (String text, String? settings, String settingsLabel) = switch (problem) {
      LocationProblem.permission => ('11Ship cần quyền vị trí để nhận đơn. Hãy cho phép trong cài đặt rồi thử lại.', 'app', 'Mở cài đặt'),
      LocationProblem.gpsOff => ('GPS đang tắt. Hãy bật Vị trí trên điện thoại rồi thử lại.', 'location', 'Mở cài đặt vị trí'),
      LocationProblem.notification => ('Hãy bật thông báo của 11Ship để vị trí được chia sẻ khi bạn dùng ứng dụng khác.', 'notifications', 'Mở cài đặt thông báo'),
      LocationProblem.noFix => ('Chưa lấy được vị trí. Hãy ra nơi thoáng hơn rồi thử lại.', null, ''),
      LocationProblem.upload => ('Chưa gửi được vị trí. Kiểm tra kết nối rồi thử lại.', null, ''),
      LocationProblem.none => ('', null, ''),
    };
    return Padding(
      padding: const EdgeInsets.only(top: N11Space.gap2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(text, key: const Key('ship-location-problem'), style: N11Text.captionInk2),
          const SizedBox(height: N11Space.gap2),
          Wrap(
            spacing: N11Space.gap3,
            children: <Widget>[
              N11Button(key: const Key('ship-location-retry'), label: 'Thử lại', kind: ButtonKind.secondary, compact: true, onPressed: online.busy ? null : () => unawaited(online.retry())),
              if (settings != null) N11Button(key: const Key('ship-location-settings'), label: settingsLabel, kind: ButtonKind.secondary, compact: true, onPressed: () => unawaited(online.openSettings(settings))),
            ],
          ),
        ],
      ),
    );
  }
}
