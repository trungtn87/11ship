import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'models.dart';

// HTTPS transport and the closed mapping from a server answer to an [AuthFailure]. Only normal TLS verification is ever used:
// there is no badCertificateCallback, no trust-all and no cleartext. A phone that must trust a local test certificate does so
// through the Android certificate store of the test package (mobile/README.md), never through this code.

class ApiResponse {
  const ApiResponse({required this.status, required this.headers, required this.body});

  final int status;

  /// Lower-case header names.
  final Map<String, String> headers;
  final String body;

  Map<String, Object?>? get json {
    try {
      final Object? decoded = jsonDecode(body);
      return decoded is Map<String, Object?> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  Object? get data => json?['data'];

  String? get errorCode {
    final Object? error = json?['error'];
    if (error is Map<String, Object?> && error['code'] is String) {
      return error['code']! as String;
    }
    return null;
  }
}

abstract class ApiTransport {
  /// Throws [AuthFailure] (unknownOutcome / tls) when no complete answer arrived.
  Future<ApiResponse> send(String method, String pathAndQuery, {Map<String, String> headers = const <String, String>{}, List<int>? body});
}

class HttpApiTransport implements ApiTransport {
  HttpApiTransport({required this.base, this.timeout = const Duration(seconds: 15)});

  final Uri base;
  final Duration timeout;

  @override
  Future<ApiResponse> send(String method, String pathAndQuery, {Map<String, String> headers = const <String, String>{}, List<int>? body}) async {
    final HttpClient client = HttpClient()..connectionTimeout = timeout;
    try {
      final Uri uri = base.resolve(pathAndQuery);
      if (uri.scheme != 'https') {
        throw const AuthFailure(AuthFailureKind.tls);
      }
      final HttpClientRequest request = await client.openUrl(method, uri).timeout(timeout);
      headers.forEach(request.headers.set);
      if (body != null) {
        request.headers.contentType = ContentType('application', 'json', charset: 'utf-8');
        request.add(body);
      }
      final HttpClientResponse response = await request.close().timeout(timeout);
      final List<int> bytes = await response.expand((List<int> chunk) => chunk).toList().timeout(timeout);
      final Map<String, String> out = <String, String>{};
      response.headers.forEach((String name, List<String> values) => out[name.toLowerCase()] = values.join(', '));
      return ApiResponse(status: response.statusCode, headers: out, body: utf8.decode(bytes, allowMalformed: true));
    } on HandshakeException {
      throw const AuthFailure(AuthFailureKind.tls);
    } on TlsException {
      throw const AuthFailure(AuthFailureKind.tls);
    } on TimeoutException {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    } on SocketException {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    } on HttpException {
      throw const AuthFailure(AuthFailureKind.unknownOutcome);
    } finally {
      client.close(force: true);
    }
  }
}

/// A server refusal as a closed failure. Nothing the server wrote (message, details) is carried.
AuthFailure failureOf(ApiResponse response) {
  final String? code = response.errorCode;
  final int status = response.status;
  AuthFailureKind kind;
  switch (code) {
    case 'INVALID_CREDENTIALS':
      kind = AuthFailureKind.invalidCredentials;
    case 'SESSION_INVALID' || 'SESSION_REVOKED' || 'SESSION_EXPIRED':
      kind = AuthFailureKind.sessionEnded;
    case 'DEVICE_PROOF_UNSUPPORTED':
      kind = AuthFailureKind.deviceUnsupported;
    case 'DEVICE_PROOF_INVALID' || 'DEVICE_PROOF_EXPIRED' || 'DEVICE_PROOF_REQUIRED':
      kind = AuthFailureKind.deviceProofRefused;
    case 'VERSION_CONFLICT':
      kind = AuthFailureKind.versionConflict;
    case 'PHONE_ALREADY_REGISTERED':
      kind = AuthFailureKind.phoneRegistered;
    case 'AUTH_RESULT_NOT_REPLAYABLE' || 'IDEMPOTENCY_REPLAY_EXPIRED':
      kind = AuthFailureKind.notReplayable;
    case 'ACCOUNT_DISABLED':
      kind = AuthFailureKind.accountDisabled;
    case 'AUTH_REGISTRATION_UNAVAILABLE':
      kind = AuthFailureKind.verificationUnsupported;
    case 'DEVICE_RATE_LIMITED' || 'OTP_RATE_LIMITED':
      kind = AuthFailureKind.rateLimited;
    case 'TRANSACTION_OUTCOME_UNKNOWN' || 'SERVICE_UNAVAILABLE' || 'IDEMPOTENCY_KEY_UNAVAILABLE':
      kind = AuthFailureKind.serverUnavailable;
    default:
      if (status == 503) {
        kind = AuthFailureKind.serverUnavailable;
      } else if (status == 429) {
        kind = AuthFailureKind.rateLimited;
      } else if (status == 401) {
        kind = AuthFailureKind.sessionEnded;
      } else if (status >= 400 && status < 500) {
        kind = AuthFailureKind.badRequest;
      } else {
        kind = AuthFailureKind.badResponse;
      }
  }
  return AuthFailure(kind, code: code, status: status);
}

/// A random UUID v4 for an Idempotency-Key.
String newIdempotencyKey([Random? random]) {
  final Random source = random ?? Random.secure();
  final Uint8List bytes = Uint8List.fromList(List<int>.generate(16, (int _) => source.nextInt(256)));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  String hex(int from, int to) => bytes.sublist(from, to).map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}
