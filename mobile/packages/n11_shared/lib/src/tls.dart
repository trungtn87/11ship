import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show kReleaseMode;

// The one place an HttpClient is made for the server. Normal TLS verification is always on: the chain must reach a trusted
// root AND the host name must match the certificate. There is no badCertificateCallback and no trust-all.
//
// dart:io on Android trusts only the system CA store, not CAs the user installs. A LOCAL development server (native gateway,
// scripts/native-gateway.mjs) therefore needs its CA handed to the SecurityContext explicitly. That is possible only when ALL hold:
//   * the app is NOT a release build (kReleaseMode) - a release build ignores the define entirely;
//   * the build was started with --dart-define=N11_DEV_CA_PEM_B64=<base64 of the CA PEM> (nothing in the repository sets it);
//   * the target host is a loopback/emulator-host name ([kLocalDevHosts]).
// The CA is added next to the system roots, so every other host is verified exactly as before.

const String _kDevCaBase64 = String.fromEnvironment('N11_DEV_CA_PEM_B64');

/// Hosts a developer's machine is reached on from the app: itself, or the Android emulator's alias of the PC.
const Set<String> kLocalDevHosts = <String>{'localhost', '127.0.0.1', '10.0.2.2'};

/// The CA bytes to trust for [target], or null (use the normal trust store only). Pure, so it is testable.
List<int>? localDevCaBytes(Uri target, {String pemBase64 = _kDevCaBase64, bool release = kReleaseMode}) {
  if (release || pemBase64.isEmpty || target.scheme != 'https' || !kLocalDevHosts.contains(target.host)) {
    return null;
  }
  try {
    final List<int> bytes = base64Decode(pemBase64);
    return utf8.decode(bytes, allowMalformed: true).contains('-----BEGIN CERTIFICATE-----') ? bytes : null;
  } on FormatException {
    return null;
  }
}

/// A client with normal verification; for a local development host it also trusts the development CA described above.
HttpClient newN11HttpClient(Uri target, {String pemBase64 = _kDevCaBase64, bool release = kReleaseMode}) {
  final List<int>? ca = localDevCaBytes(target, pemBase64: pemBase64, release: release);
  if (ca == null) {
    return HttpClient();
  }
  try {
    final SecurityContext context = SecurityContext(withTrustedRoots: true)..setTrustedCertificatesBytes(ca);
    return HttpClient(context: context);
  } on TlsException {
    // An unusable CA adds nothing: the connection is verified against the normal roots and fails honestly.
    return HttpClient();
  }
}
