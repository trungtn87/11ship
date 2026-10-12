import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthResult, createAuthClient } from '../../apps/client-shared/src/auth/client';
import { AuthApp, PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';

// M01.06 — smoke of the shared client-auth adapter (apps/client-shared/src/auth) against the REAL backend: the real Nest
// application on a real HTTP listener and the real PostgreSQL of the integration job (TEST database only). It proves the wire
// shapes the adapter sends and parses are the ones the backend really speaks (OTP -> proof -> register -> me -> context ->
// logout -> login). Client-side races (stale answers, lost responses, timeouts) need controlled answers and live in
// tests/client-shell/auth-client.test.mjs.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';

function ok<T>(result: AuthResult<T>): T {
  if (result.kind !== 'ok') {
    throw new Error(`expected ok, got ${result.code}`);
  }
  return result.value;
}

describe('M01.06 — client-auth adapter against the real backend', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  const clientFor = () => createAuthClient({ fetch, app: 'FOOD', baseUrl: app.running.baseUrl });

  it('OTP, proof, register, me, logout, login (Unicode password) and wrong password', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const password = `${PASSWORD} Ấ ü`;
    const client = clientFor();

    const issued = ok(await client.requestRegisterOtp({ phone: phone.local }));
    expect(issued.verificationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(issued.resendAtMs).toBeGreaterThan(Date.now() - 5_000);

    const otp = app.provider.lastOtpFor(phone.normalized);
    expect(otp).toBeDefined();
    const wrong = await client.verifyRegisterOtp({ verificationId: issued.verificationId, code: otp === '000000' ? '111111' : '000000' });
    expect(wrong.kind).toBe('failure');
    const proof = ok(await client.verifyRegisterOtp({ verificationId: issued.verificationId, code: String(otp) }));

    const signedIn = ok(
      await client.register({
        phone: phone.local,
        password,
        verificationToken: proof.verificationToken,
        fullName: 'Nguyễn Văn An',
        consent: { termsVersion: TERMS, privacyVersion: PRIVACY },
      }),
    );
    expect(signedIn.identity.phoneNormalized).toBe(phone.normalized);
    expect(signedIn.identity.availableRoles).toEqual(['CUSTOMER']);
    expect(client.session.identity()?.userId).toBe(signedIn.identity.userId);

    const me = ok(await client.me());
    expect(me.identity.userId).toBe(signedIn.identity.userId);

    const context = ok(await client.selectContext('CUSTOMER'));
    expect(context.identity.activeRole).toBe('CUSTOMER');

    const out = ok(await client.logout());
    expect(out).toMatchObject({ hadSession: true, serverRevoked: true });
    expect(client.session.state().kind).toBe('anonymous');

    const bad = await client.login({ phone: phone.local, password: `${password} ` });
    expect(bad).toMatchObject({ kind: 'failure', code: 'INVALID_CREDENTIALS' });
    expect(client.session.state().kind).toBe('anonymous');

    const again = ok(await client.login({ phone: phone.local, password }));
    expect(again.identity.userId).toBe(signedIn.identity.userId);
    ok(await client.logout());
  });
});
