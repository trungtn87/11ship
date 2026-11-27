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
  const AppUpdateNotice({required this.versionCode, this.versionName, this.storeUrl});

  /// Null for an iOS build: no marketing name is configured on the server, so the popup shows the build number instead.
  final String? versionName;
  final int versionCode;

  /// The store page of THIS platform when the newer build is a store build (the server sends it only then): Google Play on Android, the App Store on iOS.
  /// A link for the other platform is dropped. The popup offers the button only when this is set.
  final String? storeUrl;

  static final RegExp _playLink = RegExp(r'^https://play\.google\.com/store/apps/details\?id=[a-z][a-z0-9_.]{1,100}$');
  static final RegExp _appStoreLink = RegExp(r'^https://apps\.apple\.com/vn/app/[A-Za-z0-9-]{1,100}/id[0-9]{1,15}$');

  /// The store link this platform may open (null for any other host or form). Limited to what the server documents, so a wrong link never reaches the launcher.
  static String? storeLinkFor(Object? store, TargetPlatform platform) {
    if (store is! String || store.length > 200) {
      return null;
    }
    if (platform == TargetPlatform.iOS) {
      return _appStoreLink.hasMatch(store) ? store : null;
    }
    if (platform == TargetPlatform.android) {
      return _playLink.hasMatch(store) ? store : null;
    }
    return null;
  }

  /// null = no newer build. Throws [FormatException] on an answer that is not what the server documents.
  /// [platform] is the platform of this phone (defaults to the running one); a store link of another platform is dropped.
  static AppUpdateNotice? fromCheck(Object? data, {TargetPlatform? platform}) {
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
    // An iOS build has no name on the server (null); an Android build always has one.
    final bool nameOk = name == null || (name is String && name.isNotEmpty && name.length <= 32);
    if (!nameOk || code is! int || code <= 0) {
      throw const FormatException('release');
    }
    final String? store = storeLinkFor(data['store_url'], platform ?? defaultTargetPlatform);
    return AppUpdateNotice(versionName: name as String?, versionCode: code, storeUrl: store);
  }
}

/// Opens the store page through the Android launch channel (`open`, https and an allowed host only). Answers false, never throws, when nothing opens it.
class StoreLauncher {
  const StoreLauncher({MethodChannel? channel}) : _channel = channel;

  final MethodChannel? _channel;

  MethodChannel get _c => _channel ?? const MethodChannel('vn.eleven.n11/launch');

  Future<bool> open(String url) async {
    try {
      return await _c.invokeMethod<bool>('open', <String, Object?>{'url': url}) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
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

  /// The platform the check asks for: `IOS` on an iPhone build (its build number is the App Store CFBundleVersion), otherwise `ANDROID`.
  static String platformName() => defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID';

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
      final ApiResponse response = await transport.send('GET', '/v1/app-updates/check?component=$component&version_code=$installedVersionCode&platform=${platformName()}');
      if (response.status != 200) {
        throw const FormatException('status');
      }
      final AppUpdateNotice? found = AppUpdateNotice.fromCheck(response.data, platform: defaultTargetPlatform);
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
