import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

void main() {
  group('parseApiBaseUrl', () {
    test('accepts a plain https origin', () {
      expect(parseApiBaseUrl('https://103.9.78.67.sslip.io').toString(), 'https://103.9.78.67.sslip.io');
      expect(parseApiBaseUrl(' https://host.test:8443/ ').toString(), 'https://host.test:8443');
    });
    test('rejects missing, http, path, query, userinfo, other schemes', () {
      for (final String raw in <String>['', '   ', 'http://host.test', 'https://host.test/api', 'https://host.test?x=1', 'https://u:p@host.test', 'ftp://host.test', 'host.test', 'https://']) {
        expect(parseApiBaseUrl(raw), isNull, reason: raw);
      }
    });
  });

  group('AppConfig', () {
    test('known sha is shortened, unknown is plain text', () {
      const String sha = '0123456789abcdef0123456789abcdef01234567';
      expect(const AppConfig(sourceSha: sha).sourceShaShort, '0123456789ab');
      expect(const AppConfig().sourceShaShort, 'Không rõ');
      expect(const AppConfig(sourceSha: 'not-a-sha').hasKnownSource, isFalse);
    });
    test('version label and signing parse', () {
      expect(const AppConfig(versionName: '0.1.0', buildNumber: '7').versionLabel, '0.1.0 (bản dựng 7)');
      expect(const AppConfig(versionName: '0.1.0').versionLabel, '0.1.0');
      expect(SigningMode.parse('stable'), SigningMode.stable);
      expect(SigningMode.parse('ephemeral'), SigningMode.ephemeral);
      expect(SigningMode.parse('x'), SigningMode.unknown);
    });
  });

  group('sanitizeDiagnosticText', () {
    test('redacts credentials and keys', () {
      final String out = sanitizeDiagnosticText('see https://user:pw@host.test password=hunter2 Bearer abcdef123456 token: "xyz"');
      expect(out, isNot(contains('hunter2')));
      expect(out, isNot(contains('user:pw')));
      expect(out, isNot(contains('abcdef123456')));
      expect(out, isNot(contains('xyz')));
    });
    test('redacts long opaque runs, drops stack lines, caps length, tolerates non-strings', () {
      expect(sanitizeDiagnosticText('k ${'a' * 40}'), isNot(contains('aaaa')));
      expect(sanitizeDiagnosticText('ok\n  at Foo.bar (x.js:1)'), 'ok');
      expect(sanitizeDiagnosticText('b' * 5 + ' ' + 'c' * 500, maxLength: 20).length, lessThanOrEqualTo(20));
      expect(sanitizeDiagnosticText(null), '');
    });
  });

  group('diagnosticsReport', () {
    const String sha = '0123456789abcdef0123456789abcdef01234567';
    test('lists build facts and probe rows, no free text from the server', () {
      final String report = diagnosticsReport(
        foodBrand,
        const AppConfig(apiBaseUrl: 'https://103.9.78.67.sslip.io', appId: 'vn.eleven.food.test', versionName: '0.1.0', buildNumber: '5', sourceSha: sha, signing: SigningMode.ephemeral),
        HealthSnapshot(
          phase: HealthPhase.backendNotReady,
          generation: 1,
          live: const ProbeResult.ok(httpStatus: 200, elapsedMs: 40),
          ready: const ProbeResult.failed(HealthFailureReason.notReady, httpStatus: 503, elapsedMs: 50),
          lastCheckedAt: DateTime(2026, 10, 12, 9, 5, 7),
        ),
      );
      expect(report, contains(sha));
      expect(report, contains('0.1.0 (bản dựng 5)'));
      expect(report, contains('vn.eleven.food.test'));
      expect(report, contains('https://103.9.78.67.sslip.io'));
      expect(report, contains('Còn sống (live): đạt (HTTP 200, 40 ms)'));
      expect(report, contains('503'));
      expect(report, contains('12/10/2026 09:05:07'));
    });
    test('unknown build says so instead of inventing values', () {
      final String report = diagnosticsReport(shipBrand, const AppConfig(), const HealthSnapshot.initial());
      expect(report, contains('Mã nguồn: không rõ'));
      expect(report, contains('chưa cấu hình'));
    });
  });

  test('features: auth is not wired and says why', () {
    expect(isWired(FeatureId.authLogin), isFalse);
    expect(isWired(FeatureId.authRegister), isFalse);
    expect(featureReason(FeatureId.authLogin), contains('M01.04'));
  });

  test('source never disables TLS verification', () {
    final List<File> files = <File>[];
    for (final String dir in <String>['lib', '../../food/lib', '../../ship/lib']) {
      final Directory d = Directory(dir);
      if (d.existsSync()) {
        files.addAll(d.listSync(recursive: true).whereType<File>().where((File f) => f.path.endsWith('.dart')));
      }
    }
    expect(files, isNotEmpty);
    for (final File f in files) {
      final String text = f.readAsStringSync();
      // The word may appear in comments that explain the rule; an actual assignment/call never may.
      expect(RegExp(r'badCertificateCallback\s*=|\.badCertificateCallback\s*\(|allowLegacyUnsafeRenegotiation').hasMatch(text), isFalse, reason: f.path);
    }
  });
}
