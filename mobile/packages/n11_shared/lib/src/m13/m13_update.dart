import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../account/api_client.dart';

// M13 (Owner decision 31/10/2026, issue #280): the app only COMPARES its build number with the newest one the server announces and tells the person
// when a newer build exists. It downloads nothing, installs nothing, asks for no install permission and never decides that the person is "in the middle
// of an order": the notice never blocks an order or a delivery. With a listing on Google Play the person is sent to that listing, which does the
// download and the update. Until the listing is announced (PLAY_LISTING_READY) the notice has no button that leads anywhere.

/// True only in a build made after both apps are published on Google Play under their own application id and signing key
/// (`--dart-define=PLAY_LISTING_READY=true`). Never a link that does not exist yet.
const bool kPlayListingReady = bool.fromEnvironment('PLAY_LISTING_READY');

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

/// What only the phone can do: where the app may keep its own data and opening this app's own Google Play page (Kotlin: N11UpdateChannel).
abstract class UpdatePlatform {
  Future<String> dataDirectory();

  /// Opens the Play listing of THIS application id (never another address). False when it could not be opened.
  Future<bool> openStore();
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

  @override
  Future<bool> openStore() async {
    try {
      return await _channel.invokeMethod<bool>('openStore') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
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
    this.playListingReady = kPlayListingReady,
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

  /// Whether this build may send the person to Google Play (see [kPlayListingReady]).
  final bool playListingReady;
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

  /// The person can be sent to Google Play.
  bool get canOpenStore => playListingReady;

  /// The popup is shown for a newer build the person has not postponed ("Để sau" holds until the app is started again or an even newer build appears).
  bool get showNotice => _notice != null && _dismissedCode != _notice!.versionCode;

  void dismiss() {
    if (_notice != null) {
      _dismissedCode = _notice!.versionCode;
      notifyListeners();
    }
  }

  /// Opens the Play listing. Does nothing while the listing is not announced.
  Future<bool> openStore() async {
    if (!playListingReady) {
      return false;
    }
    return platform.openStore();
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
