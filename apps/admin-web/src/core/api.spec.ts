import { describe, expect, it } from '@jest/globals';
import { AdminAuthApi, fetchTransport, parseRetryAfter } from './api';
import { FakeServer, fail, loginOk, ok } from './test-support';

describe('admin web API client', () => {
  it('sends the exact login body with the fixed device labels and no CSRF header', async () => {
    const server = new FakeServer().on('POST', '/login', loginOk('ENROLL_TOTP'));
    const result = await server.api().login('0912345678', 'pw', 'web-0123');
    expect(result).toEqual({ kind: 'ok', data: { nextStep: 'ENROLL_TOTP', expiresAt: '2999-01-01T00:00:00.000Z', csrfToken: 'csrf-pre-1' } });
    expect(server.requests[0]).toEqual({
      method: 'POST',
      path: '/login',
      body: { phone: '0912345678', password: 'pw', device: { device_id: 'web-0123', platform: 'WEB', app: 'ADMIN_WEB' } },
    });
  });

  it('sends {} and the CSRF token on enrollment start and logout, {code} on the two verify routes', async () => {
    const server = new FakeServer()
      .on('POST', '/totp/enrollment', fail(401, 'ADMIN_PREAUTH_INVALID'))
      .on('POST', '/totp/enrollment/verify', fail(400, 'ADMIN_TOTP_INVALID'))
      .on('POST', '/totp/verify', fail(400, 'ADMIN_TOTP_INVALID'))
      .on('POST', '/logout', { status: 204 });
    const api = server.api();
    await api.startEnrollment('c1');
    await api.completeEnrollment('c2', '012345');
    await api.verify('c3', '000001');
    expect(await api.logout('c4')).toEqual({ kind: 'ok', data: null });
    expect(server.requests).toEqual([
      { method: 'POST', path: '/totp/enrollment', body: {}, csrf: 'c1' },
      { method: 'POST', path: '/totp/enrollment/verify', body: { code: '012345' }, csrf: 'c2' },
      { method: 'POST', path: '/totp/verify', body: { code: '000001' }, csrf: 'c3' },
      { method: 'POST', path: '/logout', body: {}, csrf: 'c4' },
    ]);
  });

  it('maps an error envelope to its code and reads Retry-After only on 429', async () => {
    const server = new FakeServer()
      .on('POST', '/login', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'Retry-After': '897' }))
      .on('POST', '/login', fail(401, 'INVALID_CREDENTIALS', { 'Retry-After': '5' }));
    const api = server.api();
    expect(await api.login('0912345678', 'x', 'd')).toEqual({ kind: 'error', status: 429, code: 'ADMIN_AUTH_RATE_LIMITED', retryAfterSeconds: 897 });
    expect(await api.login('0912345678', 'x', 'd')).toEqual({ kind: 'error', status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('treats a thrown fetch, an unreadable 200 or an unknown shape as network, and a bare 5xx as unavailable', async () => {
    const server = new FakeServer()
      .on('GET', '/state', 'network')
      .on('GET', '/state', { status: 200, body: 'not json' })
      .on('GET', '/state', ok({ state: 'SESSION', next_step: null, expires_at: 'x' }))
      .on('GET', '/state', { status: 502 })
      .on('GET', '/state', { status: 404 });
    const api = server.api();
    expect(await api.state()).toEqual({ kind: 'network' });
    expect(await api.state()).toEqual({ kind: 'network' });
    expect(await api.state()).toEqual({ kind: 'network' });
    expect(await api.state()).toEqual({ kind: 'error', status: 502, code: 'SERVICE_UNAVAILABLE' });
    expect(await api.state()).toEqual({ kind: 'network' });
  });

  it('accepts only the two roles and an otpauth TOTP URI', async () => {
    const server = new FakeServer()
      .on('GET', '/me', ok({ user_id: 'u', admin_role: 'ROOT', expires_at: 'x', csrf_token: 'c' }))
      .on('POST', '/totp/enrollment', ok({ secret: 'S', otpauth_uri: 'https://evil.example/qr', expires_at: 'x' }));
    const api = server.api();
    expect(await api.me()).toEqual({ kind: 'network' });
    expect(await api.startEnrollment('c')).toEqual({ kind: 'network' });
  });

  it('logout: anything but 204 is not a success', async () => {
    const server = new FakeServer().on('POST', '/logout', ok({})).on('POST', '/logout', 'network');
    const api = server.api();
    expect((await api.logout('c')).kind).toBe('network');
    expect(await api.logout('c')).toEqual({ kind: 'network' });
  });

  it('parses Retry-After strictly', () => {
    expect(parseRetryAfter('60')).toBe(60);
    expect(parseRetryAfter(' 7 ')).toBe(7);
    expect(parseRetryAfter('0')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('1.5')).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('the browser transport: same-origin credentials, no-store, no redirect, JSON + CSRF headers, relative URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { secret: 'S', otpauth_uri: 'otpauth://totp/x', expires_at: 'e' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new AdminAuthApi(fetchTransport(fakeFetch));
    const result = await api.startEnrollment('csrf-1');
    expect(result.kind).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/v1/admin-auth/totp/enrollment');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: '{}',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': 'csrf-1' },
    });
    // No Origin, no Authorization: the browser sets Origin, and there is no bearer token.
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('origin');
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization');
  });
});
