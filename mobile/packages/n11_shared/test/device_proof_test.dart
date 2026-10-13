import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// The messages the app signs must be BYTE-IDENTICAL to what the server rebuilds (apps/backend/src/client-device/device-messages.ts).
// The expected strings below were produced by that TypeScript code for the same inputs (see the PR); a change on either side that
// is not mirrored fails here or in tests/integration/native-device-binding.int.spec.ts.

void main() {
  final String spkiHash = sha256HexOfText('spki');
  final List<int> body = utf8.encode('{"phone":"0901234567","password":"x"}');

  test('register-key message (ENROLL / AUTH, then JOIN) matches the server', () {
    expect(
      utf8.decode(registerKeyMessage(environment: 'local-test', challengeId: '00000000-0000-4000-8000-000000000001', nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', app: 'FOOD', spkiSha256Hex: spkiHash)),
      '11SHIP-REGISTER-KEY-V1\nlocal-test\n00000000-0000-4000-8000-000000000001\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nFOOD\n6feecc8c16c5551d9feb3eb5f77e2da773bf68bd9ef9c52927ceb2c86e56892b\n\n',
    );
    expect(
      utf8.decode(registerKeyMessage(environment: 'local-test', challengeId: '00000000-0000-4000-8000-000000000001', nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', app: 'SHIP', spkiSha256Hex: spkiHash, bindingId: 'b1', authorizerKeyId: 'k1')),
      '11SHIP-REGISTER-KEY-V1\nlocal-test\n00000000-0000-4000-8000-000000000001\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nSHIP\n6feecc8c16c5551d9feb3eb5f77e2da773bf68bd9ef9c52927ceb2c86e56892b\nb1\nk1',
    );
  });

  test('login / register message matches the server', () {
    expect(
      utf8.decode(authMessage(
        environment: 'local-test',
        method: 'POST',
        path: '/v1/client-auth/login',
        body: body,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        registrationToken: 'tok',
        time: '1760000000',
        nonce: 'bm9uY2U',
      )),
      '11SHIP-AUTH-V1\nlocal-test\nPOST\n/v1/client-auth/login\n2ce61ce4a9a162847db485227fab169b180fe4889677768c8dfe654d3991d898\nbd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9\n1a7674eb4ee78df7e1ac439a93c3fa8e3c945784d4dec9fd8e3011738b2f1d62\n1760000000\nbm9uY2U',
    );
  });

  test('per-request message matches the server', () {
    expect(
      utf8.decode(requestMessage(
        environment: 'local-test',
        keyId: '22222222-2222-4222-8222-222222222222',
        time: '1760000000',
        nonce: 'bm9uY2U',
        method: 'PUT',
        url: '/v1/customer/me/profile',
        body: body,
        bearerToken: 'bearer-token',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      )),
      '11SHIP-REQUEST-V1\nlocal-test\n22222222-2222-4222-8222-222222222222\n1760000000\nbm9uY2U\nPUT\n/v1/customer/me/profile\n2ce61ce4a9a162847db485227fab169b180fe4889677768c8dfe654d3991d898\nfea84c89725c7fdf3a723637f40b9990a1e77e80777382894814450ba622302c\n11111111-1111-4111-8111-111111111111',
    );
  });

  test('an empty body hashes as SHA-256 of nothing and base64url has no padding', () {
    expect(sha256Hex(const <int>[]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(base64UrlNoPad(<int>[251, 255]), '-_8');
  });
}
