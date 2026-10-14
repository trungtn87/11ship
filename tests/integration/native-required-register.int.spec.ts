import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, countRows, dataOf, errorCode, PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';
import { FixtureTrust, NativePhone } from './support/native-device-fixtures';

// Issue #102: the Android apps register in REQUIRED mode (OTP + verification_token) and the OTP proof does NOT replace the native
// device proof. FIXTURE attestation (server logic only, not a real phone); the OTP provider is the test fake of this suite.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const DEVICE = { device_id: 'android-food-0001', platform: 'ANDROID', app: 'FOOD' };

describe('ANDROID registration in REQUIRED mode (OTP proof + native device proof)', () => {
  let trust: FixtureTrust;
  let app: AuthApp;

  beforeAll(async () => {
    trust = new FixtureTrust();
    // No clientPhoneVerificationMode: the server runs REQUIRED.
    app = await startAuthApp({}, { relaxTimeouts: true, deviceTrust: trust, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  async function proofFor(phone: ReturnType<typeof randomPhone>): Promise<string> {
    const requested = await app.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
    expect(requested.status).toBe(201);
    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    const verified = await app.call('POST', `/auth/phone-verifications/${String(dataOf(requested).verification_id)}/verify`, { body: { otp } });
    expect(verified.status).toBe(200);
    return String(dataOf(verified).verification_token);
  }

  const bodyOf = (phone: ReturnType<typeof randomPhone>, proof: string): Record<string, unknown> => ({
    phone: phone.local,
    password: PASSWORD,
    verification_token: proof,
    device: DEVICE,
    full_name: 'Nguyễn Văn An',
    consent: { terms_version: TERMS, privacy_version: PRIVACY },
  });

  it('needs the native proof as well as the OTP proof: the OTP alone creates nothing and consumes nothing', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await proofFor(phone);
    const bare = await app.call('POST', '/client-auth/register', { headers: { 'idempotency-key': randomUUID() }, body: bodyOf(phone, proof) });
    expect([bare.status, errorCode(bare)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone.normalized])).toBe(0);
  });

  it('registers with both proofs, binds the session to the device, and replays a lost answer with the SAME token', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const native = new NativePhone(app, trust);
    const enrolled = await native.enroll('FOOD');
    expect(enrolled.response.status).toBe(201);
    const registration = { token: enrolled.token, keyId: enrolled.keyId };
    const proof = await proofFor(phone);
    const key = randomUUID();

    const done = await native.authCall('FOOD', '/client-auth/register', bodyOf(phone, proof), registration, { idempotencyKey: key });
    expect(done.response.status).toBe(201);
    expect(done.response.headers.get('x-device-binding-generation')).toBe('1');
    const bindingId = String(done.response.headers.get('x-device-binding-id'));
    expect(await countRows(app.pool, 'SELECT 1 FROM app.client_session_bindings WHERE binding_id = $1::uuid AND is_current AND app = $2', [bindingId, 'FOOD'])).toBe(1);
    const user = await app.pool.query<{ account_origin: string; verified: boolean }>('SELECT account_origin, phone_verified_at IS NOT NULL AS verified FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    expect(user.rows[0]).toEqual({ account_origin: 'PHONE_VERIFIED', verified: true });

    const replay = await native.authCall('FOOD', '/client-auth/register', bodyOf(phone, proof), registration, { idempotencyKey: key });
    expect(replay.response.status).toBe(201);
    expect(dataOf(replay.response).access_token).toBe(dataOf(done.response).access_token);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);

    // The consumed OTP proof cannot register a second account, even with a fresh native grant.
    const again = await native.reauth('FOOD');
    const reuse = await native.authCall('FOOD', '/client-auth/register', bodyOf(phone, proof), { token: again.token, keyId: native.keys.FOOD?.keyId ?? '' }, { idempotencyKey: randomUUID() });
    expect(reuse.response.status).toBeGreaterThanOrEqual(400);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
  });
});
