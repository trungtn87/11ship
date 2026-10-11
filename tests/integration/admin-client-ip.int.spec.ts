import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { TOTP_REQUEST_LIMIT } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { AdminApp, adminErrorCode, count, createSystem, loginBody, startAdminApp, SystemAccount } from './support/admin-fixtures';

// M01-D-LOGIN - the client address behind the rate limits, through the REAL pipeline.
//
// The test socket is always 127.0.0.1. With exactly that address configured as the trusted proxy, one X-Forwarded-For
// entry is believed; several entries, anything that is not exactly one IP literal, or a missing header are refused with
// 400 BEFORE any limiter, password or token work. With any other allowlist (or none) the header is ignored completely
// and the socket address is the identity: trust is exactly the configured literals, never widened.
//
// The TOTP request quota (30 per minute per address, reserved before the cookie is looked at) is the probe: a request
// without a cookie costs no password work, so the number of 401s before the first 429 shows which identity was used.

describe('M01-D-LOGIN - trusted proxy and X-Forwarded-For (socket in the allowlist)', () => {
  let app: AdminApp;
  let system: SystemAccount;

  beforeAll(async () => {
    app = await startAdminApp({ trustedProxyIps: ['127.0.0.1'] });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  const probe = (forwardedFor?: string) =>
    app.call('POST', '/totp/verify', {
      body: { code: '123456' },
      csrf: 'x',
      ...(forwardedFor === undefined ? {} : { headers: { 'x-forwarded-for': forwardedFor } }),
    });

  it('limits each forwarded IPv4 address on its own', async () => {
    for (let index = 0; index < TOTP_REQUEST_LIMIT; index += 1) {
      expect((await probe('203.0.113.21')).status).toBe(401);
    }
    const limited = await probe('203.0.113.21');
    expect(limited.status).toBe(429);
    expect(adminErrorCode(limited)).toBe('ADMIN_AUTH_RATE_LIMITED');
    const retry = Number(limited.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);

    // Another forwarded address has its own quota; the socket address is not what is limited.
    expect((await probe('203.0.113.22')).status).toBe(401);
  });

  it('limits a forwarded IPv6 address by its /64, whatever the spelling', async () => {
    for (let index = 0; index < TOTP_REQUEST_LIMIT; index += 1) {
      expect((await probe('2001:db8:1:2::1')).status).toBe(401);
    }
    // Same /64, another host part, upper case and expanded: the same bucket.
    expect((await probe('2001:DB8:1:2:0:0:0:ffff')).status).toBe(429);
    // A different /64 is a different bucket.
    expect((await probe('2001:db8:1:3::1')).status).toBe(401);
  });

  it.each([
    ['several entries', '203.0.113.1, 203.0.113.2'],
    ['not an address', 'unknown'],
    ['a host name', 'proxy.example.test'],
    ['an address with a port', '203.0.113.1:443'],
    ['an IPv6 zone id', 'fe80::1%eth0'],
    ['an empty value', ''],
  ])('refuses %s with 400 before any limiter, cookie or password work', async (_name, value) => {
    const totp = await probe(value);
    expect(totp.status).toBe(400);
    expect(totp.setCookie).toEqual([]);
    const login = await app.call('POST', '/login', { body: loginBody(system), headers: { 'x-forwarded-for': value } });
    expect(login.status).toBe(400);
    expect(login.setCookie).toEqual([]);
    // Neither request touched the limiter: no quota slot, no failure, no bucket at all.
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_auth_limits')).toBe(0);
  });

  it('refuses a trusted proxy that sends no X-Forwarded-For at all', async () => {
    const totp = await probe();
    expect(totp.status).toBe(400);
    const login = await app.call('POST', '/login', { body: loginBody(system) });
    expect(login.status).toBe(400);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_auth_limits')).toBe(0);
  });

  it('keeps refused requests from eating the quota: the full quota is still there afterwards', async () => {
    for (let index = 0; index < TOTP_REQUEST_LIMIT + 5; index += 1) {
      expect((await probe('203.0.113.1, 203.0.113.2')).status).toBe(400);
    }
    for (let index = 0; index < TOTP_REQUEST_LIMIT; index += 1) {
      expect((await probe('203.0.113.23')).status).toBe(401);
    }
    expect((await probe('203.0.113.23')).status).toBe(429);
  });
});

// The same probe against an allowlist that does NOT contain the socket address: a near miss, and no allowlist at all.
describe.each([
  ['a near-miss allowlist (127.0.0.2)', ['127.0.0.2']],
  ['no allowlist', [] as string[]],
])('M01-D-LOGIN - X-Forwarded-For is ignored entirely with %s', (_label, allowlist) => {
  let app: AdminApp;

  beforeAll(async () => {
    app = await startAdminApp({ trustedProxyIps: allowlist });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
  });

  const probe = (forwardedFor: string) =>
    app.call('POST', '/totp/verify', { body: { code: '123456' }, csrf: 'x', headers: { 'x-forwarded-for': forwardedFor } });

  it('uses the socket address as the identity: a different claimed address does not buy a new quota', async () => {
    for (let index = 0; index < TOTP_REQUEST_LIMIT; index += 1) {
      expect((await probe(`198.51.100.${String(index + 1)}`)).status).toBe(401);
    }
    const limited = await probe('198.51.100.200');
    expect(limited.status).toBe(429);
    expect(adminErrorCode(limited)).toBe('ADMIN_AUTH_RATE_LIMITED');
    // One bucket: the socket's. Thirty-one claimed addresses did not create thirty-one buckets.
    expect(await count(app.pool, `SELECT 1 FROM app.admin_auth_limits WHERE kind = 'TOTP_REQUEST_IP'`)).toBe(1);
  });

  it('does not even read a malformed or multi-valued header (no 400)', async () => {
    expect((await probe('not-an-ip')).status).toBe(401);
    expect((await probe('203.0.113.1, 203.0.113.2')).status).toBe(401);
    expect((await probe('')).status).toBe(401);
  });
});
