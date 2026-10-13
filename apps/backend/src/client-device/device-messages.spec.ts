import { describe, expect, it } from '@jest/globals';
import {
  authMessage,
  fromBase64,
  fromBase64Url,
  JOIN_KEY_PREFIX,
  registerKeyMessage,
  requestMessage,
  sha256Hex,
  toBase64Url,
} from './device-messages';

// The canonical messages are a cross-language contract: the Dart client (mobile/packages/n11_shared/test/device_proof_test.dart) and
// the Kotlin join (mobile/tool/android-templates/kotlin-test/N11PeerPolicyTest.kt) assert the SAME literal strings, so a change on
// either side that is not mirrored fails there.
const spkiHash = sha256Hex(Buffer.from('spki'));
const body = Buffer.from('{"phone":"0901234567","password":"x"}');
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('device messages', () => {
  it('register-key message, with and without a join', () => {
    expect(
      registerKeyMessage({ environment: 'local-test', challengeId: '00000000-0000-4000-8000-000000000001', nonce: NONCE, app: 'FOOD', spkiSha256Hex: spkiHash, bindingId: null, authorizerKeyId: null }).toString('utf8'),
    ).toBe(`11SHIP-REGISTER-KEY-V1\nlocal-test\n00000000-0000-4000-8000-000000000001\n${NONCE}\nFOOD\n${spkiHash}\n\n`);
    expect(
      registerKeyMessage(
        { environment: 'local-test', challengeId: '00000000-0000-4000-8000-000000000001', nonce: NONCE, app: 'SHIP', spkiSha256Hex: spkiHash, bindingId: '33333333-3333-4333-8333-333333333333', authorizerKeyId: '22222222-2222-4222-8222-222222222222' },
        JOIN_KEY_PREFIX,
      ).toString('utf8'),
    ).toBe(`11SHIP-JOIN-KEY-V1\nlocal-test\n00000000-0000-4000-8000-000000000001\n${NONCE}\nSHIP\n${spkiHash}\n33333333-3333-4333-8333-333333333333\n22222222-2222-4222-8222-222222222222`);
  });

  it('login / register message', () => {
    expect(
      authMessage({
        environment: 'local-test',
        method: 'POST',
        path: '/v1/client-auth/login',
        bodySha256Hex: sha256Hex(body),
        idempotencyKeySha256Hex: sha256Hex('11111111-1111-4111-8111-111111111111'),
        registrationTokenSha256Hex: sha256Hex('tok'),
        time: '1760000000',
        nonce: 'bm9uY2U',
      }).toString('utf8'),
    ).toBe(
      '11SHIP-AUTH-V1\nlocal-test\nPOST\n/v1/client-auth/login\n2ce61ce4a9a162847db485227fab169b180fe4889677768c8dfe654d3991d898\nbd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9\n1a7674eb4ee78df7e1ac439a93c3fa8e3c945784d4dec9fd8e3011738b2f1d62\n1760000000\nbm9uY2U',
    );
  });

  it('per-request message', () => {
    expect(
      requestMessage({
        environment: 'local-test',
        keyId: '22222222-2222-4222-8222-222222222222',
        time: '1760000000',
        nonce: 'bm9uY2U',
        method: 'PUT',
        url: '/v1/customer/me/profile',
        bodySha256Hex: sha256Hex(body),
        bearerSha256Hex: sha256Hex('bearer-token'),
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }).toString('utf8'),
    ).toBe(
      '11SHIP-REQUEST-V1\nlocal-test\n22222222-2222-4222-8222-222222222222\n1760000000\nbm9uY2U\nPUT\n/v1/customer/me/profile\n2ce61ce4a9a162847db485227fab169b180fe4889677768c8dfe654d3991d898\nfea84c89725c7fdf3a723637f40b9990a1e77e80777382894814450ba622302c\n11111111-1111-4111-8111-111111111111',
    );
  });

  it('base64url is canonical and bounded; standard base64 likewise', () => {
    expect(toBase64Url(Buffer.from([251, 255]))).toBe('-_8');
    expect(fromBase64Url('-_8', 4)).toEqual(Buffer.from([251, 255]));
    for (const bad of ['', '-_8=', 'a b', '-_9', 'A'.repeat(100), 5, undefined]) {
      expect(fromBase64Url(bad, 8)).toBeUndefined();
    }
    const encoded = Buffer.from('spkis').toString('base64');
    expect(fromBase64(encoded, 16)?.toString()).toBe('spkis');
    for (const bad of ['', encoded.replace('=', ''), `${encoded}=`, '!!!', 'A'.repeat(100), null]) {
      expect(fromBase64(bad, 16)).toBeUndefined();
    }
  });
});
