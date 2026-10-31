import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../account/api_client.dart';

// M13 (Owner decision 31/10/2026, issue #280): the app only COMPARES its build number with the newest one the server announces and tells the person
// when a newer build exists. It downloads nothing, installs nothing, asks for no install permission and never decides that the person is "in the middle
// of an order": the notice never blocks an order or a delivery, and it never blocks a hand-installed test build. Until the apps have a Google Play
// listing there is nothing to open, so the notice has no button.

/// A newer build than the installed one.
@immutable
class AppUpdateNotice {
  const AppUpdateNotice({required this.versionName, required this.versionCode});

  final String versionName;
  final int versionCode;

  /// null = no newer build. Throws [FormatException] on an answer that is not what the server documents.
  static AppUpdateNotice? fromCheck(Object? data) {
    if (data is! Map<String, Object?>) {
      throw const FormatException('update');
    }
    if (data['update_available'] != true) {
      return null;
    }
    final Object? release = data['release'];
    if (release is! Map<String, Object?>) {
      throw const FormatException('release');
    }
    final Object? name = release['version_name'];
    final Object? code = release['version_code'];
    if (name is! String || name.isEmpty || name.length > 32 || code is! int || code <= 0) {
      throw const FormatException('release');
    }
    return AppUpdateNotice(versionName: name, versionCode: code);
  }
}

/// What only the phone can do: where the app may keep its own data (Kotlin: N11UpdateChannel).
abstract class UpdatePlatform {
  Future<String> dataDirectory();
}

class MethodChannelUpdatePlatform implements UpdatePlatform {
  const MethodChannelUpdatePlatform();

  static const MethodChannel _channel = MethodChannel('vn.eleven.n11/update');

  @override
  Future<String> dataDirectory() async {
    try {
      final String? path = await _channel.invokeMethod<String>('dataDirectory');
      if (path == null || path.isEmpty) {
        throw StateError('NO_DIRECTORY');
      }
      return path;
    } on PlatformException {
      throw StateError('NO_DIRECTORY');
    } on MissingPluginException {
      throw StateError('NO_DIRECTORY');
    }
  }
}

enum AppUpdatePhase { idle, checking, upToDate, available, failed }

/// One controller per app. [check] runs at start, on return to the foreground and then at most every [minInterval]. It needs no sign-in.
class AppUpdateController extends ChangeNotifier {
  AppUpdateController({
    required this.component,
    required this.installedVersionCode,
    required this.installedVersionName,
    required this.transport,
    required this.platform,
    this.minInterval = const Duration(minutes: 30),
    this.failureRetryInterval = const Duration(minutes: 2),
    this.enabled = true,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  /// FOOD or SHIP.
  final String component;
  final int installedVersionCode;
  final String installedVersionName;
  final ApiTransport transport;
  final UpdatePlatform platform;
  final Duration minInterval;

  /// After a check that could not be answered (offline, server error) the next one may come this soon, not after the full [minInterval]:
  /// not hearing from the server says nothing about this build.
  final Duration failureRetryInterval;

  /// False for a build without a build number: it is never told to update.
  final bool enabled;
  final DateTime Function() _now;

  AppUpdatePhase _phase = AppUpdatePhase.idle;
  AppUpdateNotice? _notice;
  DateTime? _lastCheck;
  bool _lastCheckFailed = false;
  int? _dismissedCode;

  AppUpdatePhase get phase => _phase;
  AppUpdateNotice? get notice => _notice;

  /// True when the last check could not be answered. It says nothing about the build: never shown as "up to date".
  bool get lastCheckFailed => _lastCheckFailed;

  /// The popup is shown for a newer build the person has not postponed ("Để sau" holds until the app is started again or an even newer build appears).
  bool get showNotice => _notice != null && _dismissedCode != _notice!.versionCode;

  void dismiss() {
    if (_notice != null) {
      _dismissedCode = _notice!.versionCode;
      notifyListeners();
    }
  }

  Future<void> check({bool force = false}) async {
    if (!enabled || _phase == AppUpdatePhase.checking) {
      return;
    }
    final DateTime now = _now();
    if (!force && _lastCheck != null && now.difference(_lastCheck!) < (_lastCheckFailed ? failureRetryInterval : minInterval)) {
      return;
    }
    _lastCheck = now;
    final AppUpdatePhase before = _phase;
    _phase = AppUpdatePhase.checking;
    notifyListeners();
    try {
      final ApiResponse response = await transport.send('GET', '/v1/app-updates/check?component=$component&version_code=$installedVersionCode');
      if (response.status != 200) {
        throw const FormatException('status');
      }
      final AppUpdateNotice? found = AppUpdateNotice.fromCheck(response.data);
      if (found != null && found.versionCode > installedVersionCode) {
        _notice = found;
        _phase = AppUpdatePhase.available;
      } else {
        _notice = null;
        _phase = AppUpdatePhase.upToDate;
      }
      _lastCheckFailed = false;
    } on Object {
      // A check that could not be answered changes nothing the person sees: what is known stays, and the next check comes soon.
      _lastCheckFailed = true;
      _phase = _notice != null ? AppUpdatePhase.available : (before == AppUpdatePhase.upToDate ? AppUpdatePhase.upToDate : AppUpdatePhase.failed);
    }
    notifyListeners();
  }
}
