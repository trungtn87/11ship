import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../account/api_client.dart';

// M13: the app asks the server whether a newer build exists, downloads it, checks its size and SHA-256 against what the server announced and only then
// hands it to the Android installer, where the person confirms. The application id and the signing key never change: Android itself refuses an update
// signed by another key. No Firebase, no silent install, nothing is installed by this code.

/// The largest file this app is willing to store (the real build is far smaller).
const int maxUpdateBytes = 150 * 1024 * 1024;

/// A closed list of reasons; the screens show plain Vietnamese for each, never platform text.
class UpdateFailure implements Exception {
  const UpdateFailure(this.code);

  /// OFFLINE, SERVER, BAD_ANSWER, SIZE_MISMATCH, SHA256_MISMATCH, INSTALL_PERMISSION, INSTALLER, NO_DIRECTORY
  final String code;

  @override
  String toString() => 'UpdateFailure($code)';
}

String updateFailureText(String code) {
  switch (code) {
    case 'OFFLINE':
      return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
    case 'SERVER':
      return 'Máy chủ chưa trả bản cập nhật. Thử lại sau ít phút.';
    case 'BAD_ANSWER':
      return 'Máy chủ trả thông tin cập nhật không hợp lệ.';
    case 'SIZE_MISMATCH':
    case 'SHA256_MISMATCH':
      return 'Tệp tải về không khớp mã kiểm tra nên đã bị bỏ. Không cài bản này.';
    case 'INSTALL_PERMISSION':
      return 'Hãy cho phép ứng dụng cài đặt trong màn hình vừa mở, rồi bấm Cập nhật lại.';
    case 'INSTALLER':
      return 'Không mở được trình cài đặt Android.';
    default:
      return 'Chưa cập nhật được ($code).';
  }
}

@immutable
class AppUpdateOffer {
  const AppUpdateOffer({
    required this.releaseId,
    required this.versionName,
    required this.versionCode,
    required this.required,
    required this.sizeBytes,
    required this.sha256,
    required this.downloadPath,
    this.reason,
    this.notes,
    this.compatibilityNote,
  });

  final String releaseId;
  final String versionName;
  final int versionCode;

  /// True only when the installed build is older than the minimum the server declared; otherwise the update is advice.
  final bool required;
  final int sizeBytes;
  final String sha256;
  final String downloadPath;
  final String? reason;
  final String? notes;
  final String? compatibilityNote;

  String get fileName => 'update-$versionCode.apk';

  /// null = no newer build. Throws [FormatException] on an answer that is not what the server documents (then nothing is downloaded).
  static AppUpdateOffer? fromCheck(Object? data) {
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
    String text(String key) {
      final Object? value = release[key];
      if (value is String && value.isNotEmpty) {
        return value;
      }
      throw FormatException(key);
    }

    String? optional(String key, int max) {
      final Object? value = release[key];
      return value is String && value.isNotEmpty ? (value.length > max ? value.substring(0, max) : value) : null;
    }

    int number(String key) {
      final Object? value = release[key];
      if (value is int && value > 0) {
        return value;
      }
      throw FormatException(key);
    }

    final String sha = text('sha256').toLowerCase();
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(sha)) {
      throw const FormatException('sha256');
    }
    final String path = text('download_path');
    if (!RegExp(r'^/v1/app-updates/download/[0-9a-fA-F-]{36}$').hasMatch(path)) {
      throw const FormatException('download_path');
    }
    final int size = number('size_bytes');
    if (size > maxUpdateBytes) {
      throw const FormatException('size_bytes');
    }
    final Object? reason = data['reason'];
    return AppUpdateOffer(
      releaseId: text('release_id'),
      versionName: text('version_name'),
      versionCode: number('version_code'),
      required: data['required'] == true,
      sizeBytes: size,
      sha256: sha,
      downloadPath: path,
      reason: reason is String && reason.isNotEmpty ? (reason.length > 300 ? reason.substring(0, 300) : reason) : null,
      notes: optional('release_notes', 1000),
      compatibilityNote: optional('compatibility_note', 300),
    );
  }
}

/// The file the server serves. [close] ends the connection early.
class UpdateDownload {
  const UpdateDownload({required this.bytes, required this.close});

  final Stream<List<int>> bytes;
  final void Function() close;
}

abstract class UpdateFileSource {
  /// Opens the file at [path]. Throws [UpdateFailure] (OFFLINE / SERVER) when the server does not answer 200.
  Future<UpdateDownload> open(String path);
}

/// Streams the file over HTTPS with normal TLS verification (no custom certificate callback). Redirects are not followed.
class HttpUpdateFileSource implements UpdateFileSource {
  HttpUpdateFileSource({required this.base, this.timeout = const Duration(seconds: 20)});

  final Uri base;
  final Duration timeout;

  @override
  Future<UpdateDownload> open(String path) async {
    final HttpClient client = HttpClient()..connectionTimeout = timeout;
    try {
      final Uri uri = base.resolve(path);
      if (uri.scheme != 'https') {
        throw const UpdateFailure('OFFLINE');
      }
      final HttpClientRequest request = await client.getUrl(uri).timeout(timeout);
      request.followRedirects = false;
      final HttpClientResponse response = await request.close().timeout(timeout);
      if (response.statusCode != 200) {
        await response.drain<void>();
        client.close(force: true);
        throw UpdateFailure(response.statusCode >= 500 || response.statusCode == 404 ? 'SERVER' : 'BAD_ANSWER');
      }
      return UpdateDownload(bytes: response.timeout(timeout), close: () => client.close(force: true));
    } on UpdateFailure {
      client.close(force: true);
      rethrow;
    } on Object {
      client.close(force: true);
      throw const UpdateFailure('OFFLINE');
    }
  }
}

/// What only the phone can do: where to put the file and the Android installer (Kotlin: N11UpdateChannel).
abstract class UpdatePlatform {
  Future<String> updateDirectory();
  Future<String> dataDirectory();

  /// 'OPENED' or 'INSTALL_PERMISSION' (the settings page for installing from this app was opened). Throws [UpdateFailure] otherwise.
  Future<String> install(String path);
}

class MethodChannelUpdatePlatform implements UpdatePlatform {
  const MethodChannelUpdatePlatform();

  static const MethodChannel _channel = MethodChannel('vn.eleven.n11/update');

  @override
  Future<String> updateDirectory() async {
    try {
      final String? path = await _channel.invokeMethod<String>('updateDirectory');
      if (path == null || path.isEmpty) {
        throw const UpdateFailure('NO_DIRECTORY');
      }
      return path;
    } on PlatformException {
      throw const UpdateFailure('NO_DIRECTORY');
    } on MissingPluginException {
      throw const UpdateFailure('NO_DIRECTORY');
    }
  }

  @override
  Future<String> dataDirectory() async {
    try {
      final String? path = await _channel.invokeMethod<String>('dataDirectory');
      if (path == null || path.isEmpty) {
        throw const UpdateFailure('NO_DIRECTORY');
      }
      return path;
    } on PlatformException {
      throw const UpdateFailure('NO_DIRECTORY');
    } on MissingPluginException {
      throw const UpdateFailure('NO_DIRECTORY');
    }
  }

  @override
  Future<String> install(String path) async {
    try {
      return await _channel.invokeMethod<String>('install', <String, Object?>{'path': path}) ?? 'INSTALLER';
    } on PlatformException catch (error) {
      throw UpdateFailure(error.code == 'INSTALL_PERMISSION' ? 'INSTALL_PERMISSION' : 'INSTALLER');
    } on MissingPluginException {
      throw const UpdateFailure('INSTALLER');
    }
  }
}

enum AppUpdatePhase { idle, checking, upToDate, available, downloading, installerOpened, failed }

class _DigestSink implements Sink<crypto.Digest> {
  crypto.Digest? value;

  @override
  void add(crypto.Digest data) {
    value = data;
  }

  @override
  void close() {}
}

/// One controller per app. [check] runs at start, on return to the foreground and then at most every [minInterval]; [download] never starts by itself.
class AppUpdateController extends ChangeNotifier {
  AppUpdateController({
    required this.component,
    required this.installedVersionCode,
    required this.installedVersionName,
    required this.transport,
    required this.files,
    required this.platform,
    this.isBusy = _never,
    this.busyProbe,
    this.minInterval = const Duration(minutes: 30),
    this.retryDelay = const Duration(seconds: 3),
    this.maxAttempts = 3,
    this.enabled = true,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  static bool _never() => false;

  /// FOOD or SHIP.
  final String component;
  final int installedVersionCode;
  final String installedVersionName;
  final ApiTransport transport;
  final UpdateFileSource files;
  final UpdatePlatform platform;

  /// True while the person is in the middle of work that an update screen must not interrupt (a shipper with an active order).
  final bool Function() isBusy;

  /// Asked (never more than once per [refreshBusy]) whether the person is mid-work, for apps that only learn it from the server (a shipper's active order).
  final Future<bool> Function()? busyProbe;
  bool _probedBusy = false;
  final Duration minInterval;
  final Duration retryDelay;
  final int maxAttempts;

  /// False for a build without a build number: it is never offered an update.
  final bool enabled;
  final DateTime Function() _now;

  AppUpdatePhase _phase = AppUpdatePhase.idle;
  AppUpdateOffer? _offer;
  String? _failure;
  double _progress = 0;
  DateTime? _lastCheck;
  bool _dismissed = false;

  AppUpdatePhase get phase => _phase;
  AppUpdateOffer? get offer => _offer;
  String? get failureCode => _failure;
  double get progress => _progress;

  /// An update that must be installed before the app is used further. Never while the person is busy (an active order): then it is only a banner.
  bool get blocking => _offer != null && _offer!.required && !_working && _phase != AppUpdatePhase.installerOpened;

  /// A required update that waits because the person is in the middle of an order.
  bool get deferred => _offer != null && _offer!.required && _working;

  bool get _working => isBusy() || _probedBusy;

  /// Re-reads "is the person mid-work" from [busyProbe]. A probe that fails counts as busy: an update screen never replaces an order on a guess.
  Future<void> refreshBusy() async {
    final Future<bool> Function()? probe = busyProbe;
    if (probe == null || _offer == null || !_offer!.required) {
      return;
    }
    bool busy;
    try {
      busy = await probe();
    } on Object {
      busy = true;
    }
    if (busy != _probedBusy) {
      _probedBusy = busy;
      notifyListeners();
    }
  }

  /// The banner is shown for an available update the person has not postponed (a required one cannot be postponed).
  bool get showBanner => _offer != null && (!_dismissed || _offer!.required) && (_phase == AppUpdatePhase.available || _phase == AppUpdatePhase.failed || _phase == AppUpdatePhase.downloading);

  void dismiss() {
    if (_offer != null && !_offer!.required) {
      _dismissed = true;
      notifyListeners();
    }
  }

  Future<void> check({bool force = false}) async {
    if (!enabled) {
      return;
    }
    if (_phase == AppUpdatePhase.checking || _phase == AppUpdatePhase.downloading) {
      return;
    }
    final DateTime now = _now();
    if (!force && _lastCheck != null && now.difference(_lastCheck!) < minInterval) {
      return;
    }
    _lastCheck = now;
    _phase = AppUpdatePhase.checking;
    notifyListeners();
    try {
      final ApiResponse response = await transport.send('GET', '/v1/app-updates/check?component=$component&version_code=$installedVersionCode');
      if (response.status != 200) {
        throw UpdateFailure(response.status >= 500 ? 'SERVER' : 'BAD_ANSWER');
      }
      final AppUpdateOffer? offer = AppUpdateOffer.fromCheck(response.data);
      if (offer != null && offer.versionCode <= installedVersionCode) {
        _offer = null;
        _phase = AppUpdatePhase.upToDate;
      } else if (offer == null) {
        _offer = null;
        _phase = AppUpdatePhase.upToDate;
      } else {
        if (_offer?.releaseId != offer.releaseId) {
          _dismissed = false;
        }
        _offer = offer;
        _phase = AppUpdatePhase.available;
        if (offer.required && busyProbe != null) {
          _probedBusy = true; // until the probe answers, an update screen must not cover work in progress
        }
      }
      _failure = null;
    } on FormatException {
      _failure = 'BAD_ANSWER';
      _phase = _offer == null ? AppUpdatePhase.idle : AppUpdatePhase.available;
    } on UpdateFailure catch (error) {
      _failure = error.code;
      _phase = _offer == null ? AppUpdatePhase.idle : AppUpdatePhase.available;
    } on Object {
      // A failed check is not an error the person must deal with: the last known offer (if any) stays, the next check tries again.
      _failure = 'OFFLINE';
      _phase = _offer == null ? AppUpdatePhase.idle : AppUpdatePhase.available;
    }
    notifyListeners();
    if (_offer != null && _offer!.required) {
      await refreshBusy();
    }
  }

  /// Downloads, verifies and opens the installer. A file that does not match what the server announced is deleted and never installed.
  Future<void> download() async {
    final AppUpdateOffer? offer = _offer;
    if (offer == null || _phase == AppUpdatePhase.downloading) {
      return;
    }
    _phase = AppUpdatePhase.downloading;
    _failure = null;
    _progress = 0;
    notifyListeners();
    try {
      final String directory = await platform.updateDirectory();
      await _clean(directory);
      final File file = File('$directory/${offer.fileName}');
      await _fetchVerified(offer, file);
      final String outcome = await platform.install(file.path);
      if (outcome == 'INSTALL_PERMISSION') {
        throw const UpdateFailure('INSTALL_PERMISSION');
      }
      _phase = AppUpdatePhase.installerOpened;
    } on UpdateFailure catch (error) {
      _failure = error.code;
      _phase = AppUpdatePhase.failed;
    } on Object {
      _failure = 'OFFLINE';
      _phase = AppUpdatePhase.failed;
    }
    notifyListeners();
  }

  Future<void> _clean(String directory) async {
    try {
      final Directory dir = Directory(directory);
      if (await dir.exists()) {
        await for (final FileSystemEntity entity in dir.list()) {
          if (entity is File) {
            await entity.delete();
          }
        }
      }
    } on Object {
      // A leftover file is replaced below; nothing else depends on this.
    }
  }

  Future<void> _fetchVerified(AppUpdateOffer offer, File file) async {
    UpdateFailure? last;
    for (int attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await _fetchOnce(offer, file);
        return;
      } on UpdateFailure catch (error) {
        last = error;
        await _delete(file);
        // A file that does not match is never retried into acceptance: the same bytes would be wrong again.
        if (error.code == 'SIZE_MISMATCH' || error.code == 'SHA256_MISMATCH' || error.code == 'BAD_ANSWER' || attempt == maxAttempts) {
          rethrow;
        }
        await Future<void>.delayed(retryDelay * attempt);
      }
    }
    throw last ?? const UpdateFailure('OFFLINE');
  }

  Future<void> _delete(File file) async {
    try {
      if (await file.exists()) {
        await file.delete();
      }
    } on Object {
      // Nothing to do.
    }
  }

  Future<void> _fetchOnce(AppUpdateOffer offer, File file) async {
    final UpdateDownload download = await files.open(offer.downloadPath);
    final _DigestSink digestSink = _DigestSink();
    final ByteConversionSink hash = crypto.sha256.startChunkedConversion(digestSink);
    final IOSink out = file.openWrite();
    int total = 0;
    try {
      await for (final List<int> chunk in download.bytes) {
        total += chunk.length;
        if (total > offer.sizeBytes) {
          throw const UpdateFailure('SIZE_MISMATCH');
        }
        hash.add(chunk);
        out.add(chunk);
        _progress = total / offer.sizeBytes;
        notifyListeners();
      }
    } on UpdateFailure {
      rethrow;
    } on Object {
      throw const UpdateFailure('OFFLINE');
    } finally {
      download.close();
      await out.close();
    }
    hash.close();
    if (total != offer.sizeBytes) {
      throw UpdateFailure(total < offer.sizeBytes ? 'OFFLINE' : 'SIZE_MISMATCH');
    }
    final crypto.Digest? digest = digestSink.value;
    if (digest == null || digest.toString() != offer.sha256) {
      throw const UpdateFailure('SHA256_MISMATCH');
    }
  }
}
