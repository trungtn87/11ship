import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, dataOf, errorCode, obtainProof, PASSWORD, OTHER_PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';

const device = { device_id: 'food-password-0001', platform: 'WEB', app: 'FOOD' };
const terms = 'test-terms-20261011-v1';
const privacy = 'test-privacy-20261011-v1';

describe('Issue 114: own password change through HTTP and PostgreSQL', () => {
  let app: AuthApp;
  beforeAll(async () => { app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: terms, privacyVersion: privacy } } }); });
  afterAll(async () => { await app.close(); });

  it('rejects wrong/invalid passwords, persists new credentials, replays once and revokes other sessions', async () => {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', { headers: { 'idempotency-key': randomUUID() }, body: {
      phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device,
      full_name: 'Nguyễn Văn An', consent: { terms_version: terms, privacy_version: privacy },
    } });
    expect(registered.status).toBe(201);
    const token = String(dataOf(registered).access_token);
    const login = (password: string, appName = 'FOOD') => app.call('POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password, device: { ...device, app: appName } },
    });
    const other = await login(PASSWORD, 'SHIP');
    expect(other.status).toBe(200);
    const change = (current: string, next: string, key = randomUUID(), extra = {}) => app.call('POST', '/client-auth/change-password', {
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, body: { current_password: current, new_password: next, ...extra },
    });
    expect(errorCode(await change('wrong', OTHER_PASSWORD))).toBe('CURRENT_PASSWORD_INVALID');
    expect((await app.call('GET', '/client-auth/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await change(PASSWORD, 'short')).status).toBe(400);
    expect((await change(PASSWORD, OTHER_PASSWORD, randomUUID(), { user_id: randomUUID() })).status).toBe(400);
    expect((await app.call('POST', '/client-auth/change-password', { body: { current_password: PASSWORD, new_password: OTHER_PASSWORD } })).status).toBe(401);
    const key = randomUUID();
    expect((await change(PASSWORD, OTHER_PASSWORD, key)).status).toBe(200);
    expect((await change(PASSWORD, OTHER_PASSWORD, key)).status).toBe(200);
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login(OTHER_PASSWORD)).status).toBe(200);
    expect((await app.call('GET', '/client-auth/me', { headers: { authorization: `Bearer ${String(dataOf(other).access_token)}` } })).status).toBe(401);
  });
});
