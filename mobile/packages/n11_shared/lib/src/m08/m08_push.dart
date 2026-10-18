import 'dart:async';

import 'package:flutter/services.dart';

import '../account/session_controller.dart';
import 'm08_source.dart';

// The phone side of push (M08.01): the Android notification permission, the FCM registration token and the tap on a notification, behind one small
// port. The token is bound to the SESSION on the server (a logout, a replacement or a revocation ends it there); on logout the phone also deletes its local
// token, so the next account on this phone gets its own and never receives the previous account's notifications. When the build carries no push
// provider (no Firebase configuration was supplied to the build) the port says `supported: false` and the settings screen says so: nothing is faked.

enum PushPermission { granted, denied, unknown }

class PushState {
  const PushState({required this.supported, required this.permission, this.token});

  /// This build can receive pushes at all (Android with the push provider compiled in).
  final bool supported;
  final PushPermission permission;
  final String? token;

  static const PushState unsupported = PushState(supported: false, permission: PushPermission.unknown);
}

abstract class PushPort {
  Future<PushState> state();

  /// Asks the system for the notification permission (Android 13+); returns the answer.
  Future<PushPermission> requestPermission();

  /// Opens the phone's own notification settings of this app.
  Future<void> openSystemSettings();

  /// Deletes the local registration token (so the next account gets a new one).
  Future<void> deleteToken();

  /// A new token after the provider rotated it.
  Stream<String> get tokenRefreshes;

  /// The id of the notification the person tapped in the system tray (cold start included).
  Stream<String> get taps;
}

/// No push on this build (iOS-less test hosts, builds without the provider, widget tests).
class NoPushPort implements PushPort {
  const NoPushPort();

  @override
  Future<PushState> state() async => PushState.unsupported;

  @override
  Future<PushPermission> requestPermission() async => PushPermission.unknown;

  @override
  Future<void> openSystemSettings() async {}

  @override
  Future<void> deleteToken() async {}

  @override
  Stream<String> get tokenRefreshes => const Stream<String>.empty();

  @override
  Stream<String> get taps => const Stream<String>.empty();
}

/// The Android implementation (channel `vn.eleven.n11/push`, native side: N11PushChannel.kt). A missing native side is "unsupported", never an error.
class MethodChannelPushPort implements PushPort {
  MethodChannelPushPort({MethodChannel? channel}) : _channel = channel ?? const MethodChannel('vn.eleven.n11/push') {
    _channel.setMethodCallHandler(_incoming);
  }

  final MethodChannel _channel;
  final StreamController<String> _tokens = StreamController<String>.broadcast();
  final StreamController<String> _taps = StreamController<String>.broadcast();
  String? _pendingTap;

  Future<Object?> _incoming(MethodCall call) async {
    final Object? args = call.arguments;
    if (call.method == 'token' && args is String) {
      _tokens.add(args);
    } else if (call.method == 'tap' && args is String) {
      _taps.add(args);
    }
    return null;
  }

  PushPermission _permission(Object? value) => switch (value) {
        'granted' => PushPermission.granted,
        'denied' => PushPermission.denied,
        _ => PushPermission.unknown,
      };

  @override
  Future<PushState> state() async {
    try {
      final Object? raw = await _channel.invokeMethod<Object?>('state');
      if (raw is! Map<Object?, Object?> || raw['supported'] != true) {
        return PushState.unsupported;
      }
      final Object? token = raw['token'];
      final Object? tap = raw['launch_notification_id'];
      if (tap is String && tap != _pendingTap) {
        _pendingTap = tap;
        scheduleMicrotask(() => _taps.add(tap));
      }
      return PushState(supported: true, permission: _permission(raw['permission']), token: token is String && token.isNotEmpty ? token : null);
    } on MissingPluginException {
      return PushState.unsupported;
    } on PlatformException {
      return PushState.unsupported;
    }
  }

  @override
  Future<PushPermission> requestPermission() async {
    try {
      return _permission(await _channel.invokeMethod<Object?>('requestPermission'));
    } on Object {
      return PushPermission.unknown;
    }
  }

  @override
  Future<void> openSystemSettings() async {
    try {
      await _channel.invokeMethod<void>('openSettings');
    } on Object {
      // Nothing to open on this build.
    }
  }

  @override
  Future<void> deleteToken() async {
    try {
      await _channel.invokeMethod<void>('deleteToken');
    } on Object {
      // No local token to delete.
    }
  }

  @override
  Stream<String> get tokenRefreshes => _tokens.stream;

  @override
  Stream<String> get taps => _taps.stream;
}

/// Keeps the phone's token bound to the CURRENT session: registers it once signed in, again when the provider rotates it, and after a sign-out deletes the
/// local token. A failed registration is tried again the next time the app returns to the foreground ([resync]); the inbox works without it.
class PushSync {
  PushSync({required this.session, required this.source, required this.port, this.onTap}) {
    session.addListener(_onSession);
    _tokenSub = port.tokenRefreshes.listen((String token) => unawaited(_register(token)));
    _tapSub = port.taps.listen((String id) => onTap?.call(id));
    _onSession();
  }

  final SessionController session;
  final NotificationSource source;
  final PushPort port;

  /// The person tapped a notification in the tray: the app opens it from the server (right and state are re-checked there).
  final void Function(String notificationId)? onTap;

  StreamSubscription<String>? _tokenSub;
  StreamSubscription<String>? _tapSub;
  SessionStatus? _last;
  String? _boundUser;
  String? _registered;
  bool _disposed = false;

  PushPermission _permission = PushPermission.unknown;
  bool _supported = false;

  bool get supported => _supported;
  PushPermission get permission => _permission;

  void _onSession() {
    final SessionStatus status = session.status;
    final String? user = session.identity?.userId;
    final bool wasIn = _last == SessionStatus.signedIn;
    _last = status;
    if (status == SessionStatus.signedIn) {
      if (_boundUser != user) {
        _boundUser = user;
        _registered = null;
      }
      unawaited(resync());
    } else if (wasIn || status == SessionStatus.guest) {
      if (_boundUser != null) {
        _boundUser = null;
        _registered = null;
        unawaited(port.deleteToken());
      }
    }
  }

  /// Reads the phone's push state and binds the token when the permission allows it.
  Future<void> resync() async {
    if (_disposed || session.status != SessionStatus.signedIn) {
      return;
    }
    final PushState state = await port.state();
    _supported = state.supported;
    _permission = state.permission;
    if (!state.supported) {
      return;
    }
    if (state.permission == PushPermission.denied) {
      try {
        await source.reportPushPermissionDenied();
      } on NotificationFailure {
        // Told again at the next resume.
      }
      return;
    }
    final String? token = state.token;
    if (token != null) {
      await _register(token);
    }
  }

  Future<void> _register(String token) async {
    if (_disposed || session.status != SessionStatus.signedIn || _registered == token) {
      return;
    }
    try {
      await source.registerPushToken(token);
      _registered = token;
    } on NotificationFailure {
      // Not bound: it is tried again at the next resume. Nothing claims the phone will receive pushes until then.
    }
  }

  /// Asks the permission (Android 13+), then binds the token.
  Future<PushPermission> askPermission() async {
    _permission = await port.requestPermission();
    await resync();
    return _permission;
  }

  void dispose() {
    _disposed = true;
    session.removeListener(_onSession);
    unawaited(_tokenSub?.cancel());
    unawaited(_tapSub?.cancel());
  }
}
