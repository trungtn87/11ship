import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

// Canonical messages of the native device protocol (docs/design/system-v2-20261011/11-m01-session-device-contract.md sections 7
// and 8; the server side is apps/backend/src/client-device/device-messages.ts and both must stay byte-identical). Every message is
// a list of UTF-8 lines joined by "\n" (no trailing newline); a SHA-256 inside a message is 64 lowercase hex digits; signatures are
// ECDSA P-256 over SHA-256, DER, base64url without padding. The app signs the exact bytes it sends, never a re-serialized body.

const String registerKeyPrefix = '11SHIP-REGISTER-KEY-V1';
const String authPrefix = '11SHIP-AUTH-V1';
const String requestPrefix = '11SHIP-REQUEST-V1';

String sha256Hex(List<int> data) => crypto.sha256.convert(data).toString();

String sha256HexOfText(String text) => sha256Hex(utf8.encode(text));

String base64UrlNoPad(List<int> data) => base64Url.encode(data).replaceAll('=', '');

Uint8List utf8Lines(List<String> lines) => Uint8List.fromList(utf8.encode(lines.join('\n')));

Uint8List registerKeyMessage({
  required String environment,
  required String challengeId,
  required String nonce,
  required String app,
  required String spkiSha256Hex,
  String? bindingId,
  String? authorizerKeyId,
}) {
  return utf8Lines(<String>[registerKeyPrefix, environment, challengeId, nonce, app, spkiSha256Hex, bindingId ?? '', authorizerKeyId ?? '']);
}

/// login / register: signed with the key behind the one-use registration token. Time and nonce make every attempt fresh.
Uint8List authMessage({
  required String environment,
  required String method,
  required String path,
  required List<int> body,
  required String idempotencyKey,
  required String registrationToken,
  required String time,
  required String nonce,
}) {
  return utf8Lines(<String>[
    authPrefix,
    environment,
    method,
    path,
    sha256Hex(body),
    sha256HexOfText(idempotencyKey),
    sha256HexOfText(registrationToken),
    time,
    nonce,
  ]);
}

/// Every authenticated request: the key the session was issued to signs target, body, Bearer token and Idempotency-Key.
Uint8List requestMessage({
  required String environment,
  required String keyId,
  required String time,
  required String nonce,
  required String method,
  required String url,
  required List<int> body,
  required String bearerToken,
  String idempotencyKey = '',
}) {
  return utf8Lines(<String>[
    requestPrefix,
    environment,
    keyId,
    time,
    nonce,
    method,
    url,
    sha256Hex(body),
    sha256HexOfText(bearerToken),
    idempotencyKey,
  ]);
}
