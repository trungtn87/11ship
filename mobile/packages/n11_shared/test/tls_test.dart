import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/tls.dart';

// The development CA is trusted only in a non-release build, only when it is handed in, and only for local hosts - and the chain and
// host name are still verified. The TLS cases use real certificates made with the openssl command (skipped where it is missing).

Future<bool> _hasOpenssl() async {
  try {
    return (await Process.run('openssl', <String>['version'])).exitCode == 0;
  } on ProcessException {
    return false;
  }
}

class _Pki {
  _Pki(this.dir, this.caPem, this.certPath, this.keyPath);
  final Directory dir;
  final String caPem;
  final String certPath;
  final String keyPath;
  String get caBase64 => base64Encode(utf8.encode(caPem));
}

Future<void> _run(List<String> args) async {
  final ProcessResult r = await Process.run('openssl', args);
  if (r.exitCode != 0) {
    throw StateError('openssl ${args.first} failed: ${r.stderr}');
  }
}

/// A CA and a server certificate signed by it, valid for [san] only.
Future<_Pki> _makePki(String name, String san) async {
  final Directory dir = await Directory.systemTemp.createTemp('n11tls_$name');
  final String ca = '${dir.path}/ca.pem', caKey = '${dir.path}/ca.key', key = '${dir.path}/key.pem', csr = '${dir.path}/s.csr', cert = '${dir.path}/cert.pem', ext = '${dir.path}/s.ext';
  await _run(<String>['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', caKey, '-out', ca, '-days', '2', '-subj', '/CN=test CA $name', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  await _run(<String>['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=server']);
  await File(ext).writeAsString('basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=$san\n');
  await _run(<String>['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '2', '-extfile', ext]);
  return _Pki(dir, await File(ca).readAsString(), cert, key);
}

Future<HttpServer> _serve(_Pki pki) async {
  final SecurityContext context = SecurityContext()
    ..useCertificateChain(pki.certPath)
    ..usePrivateKey(pki.keyPath);
  final HttpServer server = await HttpServer.bindSecure(InternetAddress.loopbackIPv4, 0, context);
  server.listen((HttpRequest request) {
    request.response
      ..write('ok')
      ..close();
  });
  return server;
}

Future<String> _get(HttpClient client, Uri uri) async {
  final HttpClientRequest request = await client.getUrl(uri);
  final HttpClientResponse response = await request.close();
  return response.transform(utf8.decoder).join();
}

void main() {
  const String pem = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
  final String pemB64 = base64Encode(utf8.encode(pem));
  final Uri local = Uri.parse('https://127.0.0.1:8446/v1/health/live');

  group('localDevCaBytes', () {
    test('returns the CA only for a non-release build, a loopback https host and a PEM', () {
      expect(localDevCaBytes(local, pemBase64: pemB64, release: false), isNotNull);
      expect(localDevCaBytes(Uri.parse('https://10.0.2.2:8446/'), pemBase64: pemB64, release: false), isNotNull);
      expect(localDevCaBytes(Uri.parse('https://localhost/'), pemBase64: pemB64, release: false), isNotNull);
    });

    test('a release build ignores the CA', () {
      expect(localDevCaBytes(local, pemBase64: pemB64, release: true), isNull);
    });

    test('no define, a non-local host, plain http or garbage never yields a CA', () {
      expect(localDevCaBytes(local, pemBase64: '', release: false), isNull);
      expect(localDevCaBytes(Uri.parse('https://103.9.78.67.sslip.io/'), pemBase64: pemB64, release: false), isNull);
      expect(localDevCaBytes(Uri.parse('https://192.168.1.5/'), pemBase64: pemB64, release: false), isNull);
      expect(localDevCaBytes(Uri.parse('http://127.0.0.1/'), pemBase64: pemB64, release: false), isNull);
      expect(localDevCaBytes(local, pemBase64: '***not base64***', release: false), isNull);
      expect(localDevCaBytes(local, pemBase64: base64Encode(utf8.encode('just text')), release: false), isNull);
    });

    test('the build default (no define) is no CA', () {
      expect(localDevCaBytes(local, release: false), isNull);
    });
  });

  group('real TLS handshake', () {
    late bool openssl;
    setUpAll(() async => openssl = await _hasOpenssl());

    Future<void> withServer(String san, Future<void> Function(HttpServer server, _Pki pki) body) async {
      final _Pki pki = await _makePki('t', san);
      final HttpServer server = await _serve(pki);
      try {
        await body(server, pki);
      } finally {
        await server.close(force: true);
        await pki.dir.delete(recursive: true);
      }
    }

    test('trusted local CA + matching SAN: connects', () async {
      if (!openssl) {
        return;
      }
      await withServer('DNS:localhost,IP:127.0.0.1', (HttpServer server, _Pki pki) async {
        final Uri uri = Uri.parse('https://127.0.0.1:${server.port}/');
        final HttpClient client = newN11HttpClient(uri, pemBase64: pki.caBase64, release: false);
        expect(await _get(client, uri), 'ok');
        client.close(force: true);
      });
    });

    test('same server without the CA is refused (normal verification)', () async {
      if (!openssl) {
        return;
      }
      await withServer('DNS:localhost,IP:127.0.0.1', (HttpServer server, _Pki pki) async {
        final Uri uri = Uri.parse('https://127.0.0.1:${server.port}/');
        final HttpClient client = newN11HttpClient(uri, pemBase64: '', release: false);
        await expectLater(_get(client, uri), throwsA(isA<HandshakeException>()));
        client.close(force: true);
      });
    });

    test('a release build is refused even when the CA is supplied', () async {
      if (!openssl) {
        return;
      }
      await withServer('DNS:localhost,IP:127.0.0.1', (HttpServer server, _Pki pki) async {
        final Uri uri = Uri.parse('https://127.0.0.1:${server.port}/');
        final HttpClient client = newN11HttpClient(uri, pemBase64: pki.caBase64, release: true);
        await expectLater(_get(client, uri), throwsA(isA<HandshakeException>()));
        client.close(force: true);
      });
    });

    test('a certificate for another host name is refused although its CA is trusted', () async {
      if (!openssl) {
        return;
      }
      await withServer('DNS:other.example', (HttpServer server, _Pki pki) async {
        final Uri uri = Uri.parse('https://127.0.0.1:${server.port}/');
        final HttpClient client = newN11HttpClient(uri, pemBase64: pki.caBase64, release: false);
        await expectLater(_get(client, uri), throwsA(isA<HandshakeException>()));
        client.close(force: true);
      });
    });

    test('a certificate from a different CA is refused', () async {
      if (!openssl) {
        return;
      }
      final _Pki other = await _makePki('other', 'DNS:localhost,IP:127.0.0.1');
      try {
        await withServer('DNS:localhost,IP:127.0.0.1', (HttpServer server, _Pki pki) async {
          final Uri uri = Uri.parse('https://127.0.0.1:${server.port}/');
          final HttpClient client = newN11HttpClient(uri, pemBase64: other.caBase64, release: false);
          await expectLater(_get(client, uri), throwsA(isA<HandshakeException>()));
          client.close(force: true);
        });
      } finally {
        await other.dir.delete(recursive: true);
      }
    });
  });
}
