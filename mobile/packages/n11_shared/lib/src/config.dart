import 'package:flutter/foundation.dart';

// What this build is and where it talks to. Everything comes from --dart-define at build time (CI passes them); a build without
// API_BASE_URL has no server address and says so, it never guesses one.

/// Which key signed the APK. `stable` = the key stored in the GitHub Secrets (updates install over older builds);
/// `ephemeral` = a throw-away CI key (an older build must be uninstalled first); `unknown` = a local/dev build.
enum SigningMode {
  stable,
  ephemeral,
  unknown;

  static SigningMode parse(String value) {
    switch (value.trim()) {
      case 'stable':
        return SigningMode.stable;
      case 'ephemeral':
        return SigningMode.ephemeral;
      default:
        return SigningMode.unknown;
    }
  }

  String get label {
    switch (this) {
      case SigningMode.stable:
        return 'Khóa ký cố định (cập nhật cài đè được)';
      case SigningMode.ephemeral:
        return 'Khóa ký tạm của CI (cập nhật phải gỡ bản cũ)';
      case SigningMode.unknown:
        return 'Không rõ (bản dựng thử nội bộ)';
    }
  }
}

/// `https://host[:port]` from a build define, or null when it is missing or not a plain HTTPS origin. A path, query, fragment,
/// user-info or any other scheme makes it invalid: health checks are only ever sent over HTTPS.
Uri? parseApiBaseUrl(String raw) {
  final String text = raw.trim();
  if (text.isEmpty) {
    return null;
  }
  final Uri? uri = Uri.tryParse(text);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
    return null;
  }
  if (uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment) {
    return null;
  }
  if (uri.path.isNotEmpty && uri.path != '/') {
    return null;
  }
  return Uri(scheme: 'https', host: uri.host, port: uri.hasPort ? uri.port : null);
}

@immutable
class AppConfig {
  const AppConfig({
    this.apiBaseUrl = '',
    this.appId = '',
    this.versionName = '0.0.0',
    this.buildNumber = '0',
    this.ciRun = '',
    this.sourceSha = 'unknown',
    this.builtAt = '',
    this.signing = SigningMode.unknown,
    this.flutterVersion = '',
  });

  factory AppConfig.fromEnvironment() => AppConfig(
        apiBaseUrl: const String.fromEnvironment('API_BASE_URL'),
        appId: const String.fromEnvironment('APP_ID'),
        versionName: const String.fromEnvironment('APP_VERSION', defaultValue: '0.0.0'),
        buildNumber: const String.fromEnvironment('BUILD_NUMBER', defaultValue: '0'),
        ciRun: const String.fromEnvironment('CI_RUN'),
        sourceSha: const String.fromEnvironment('SOURCE_SHA', defaultValue: 'unknown'),
        builtAt: const String.fromEnvironment('BUILT_AT'),
        signing: SigningMode.parse(const String.fromEnvironment('SIGNING_MODE')),
        flutterVersion: const String.fromEnvironment('BUILD_FLUTTER'),
      );

  final String apiBaseUrl;
  final String appId;
  final String versionName;
  final String buildNumber;
  final String ciRun;
  final String sourceSha;
  final String builtAt;
  final SigningMode signing;
  final String flutterVersion;

  /// The validated server origin, or null (then no request is made and the screens say the address is missing).
  Uri? get apiUri => parseApiBaseUrl(apiBaseUrl);

  static final RegExp _sha = RegExp(r'^[0-9a-f]{40}$');

  bool get hasKnownSource => _sha.hasMatch(sourceSha);

  /// First 12 characters of the source commit, or a plain "unknown" (never an invented value).
  String get sourceShaShort => hasKnownSource ? sourceSha.substring(0, 12) : 'Không rõ';

  String get versionLabel => buildNumber == '0' ? versionName : '$versionName (bản dựng $buildNumber)';
}
