import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminCall, adminErrorCode, AdminApp, AdminResponse, startAdminApp } from './support/admin-fixtures';

// Issue #49 follow-up (docs/tasks/M01-D-ADMIN-BACKEND-transport-headers-followup.md): the transport headers of
// /v1/admin-auth and /v1/admin on failures answered by the BODY PARSER itself (JSON syntax error, body over the limit),
// through the real pipeline (AppModule + configureApp, the one main.ts uses) and raw HTTP. Same shape as the activation
// transport suite. Auth, Origin and CSRF decisions are unchanged: the middleware only sets headers.

const PREFIXES = [
  ['/v1/admin-auth', ['/login', '/totp/enrollment/verify', '/totp/verify', '/logout']],
  ['/v1/admin', ['/operations', '/invitations', '/invitations/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/revoke']],
] as const;

describe('issue #49 — transport headers on parser-level failures of /v1/admin-auth and /v1/admin', () => {
  let ctx: AdminApp;

  beforeAll(async () => {
    ctx = await startAdminApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const expectTransport = (response: AdminResponse): void => {
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  };
  const expectEnvelope = (response: AdminResponse): void => {
    expect(Object.keys(response.body)).toEqual(['error']);
    expect(Object.keys(response.body.error ?? {}).sort()).toEqual(['code', 'details', 'message', 'request_id']);
    expect(response.body.error?.request_id).toBe(response.headers['x-request-id']);
  };

  for (const [prefix, routes] of PREFIXES) {
    for (const route of routes) {
      it(`${prefix}${route}: a JSON syntax error is a 4xx envelope with the transport headers`, async () => {
        const response = await adminCall(ctx.running.baseUrl, 'POST', route, { basePath: prefix, rawBody: '{"password":"SECRET-zzz' });
        expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 400, code: 'BAD_REQUEST' });
        expectTransport(response);
        expectEnvelope(response);
        expect(response.text).not.toContain('SECRET-zzz');
      });

      it(`${prefix}${route}: a body over the parser limit is a 4xx envelope with the transport headers`, async () => {
        const response = await adminCall(ctx.running.baseUrl, 'POST', route, {
          basePath: prefix,
          rawBody: JSON.stringify({ pad: 'x'.repeat(120_000) }),
        });
        expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 413, code: 'CLIENT_ERROR' });
        expectTransport(response);
        expectEnvelope(response);
      });
    }
  }

  it('the headers are the same without an Origin or a session, so a rejected request is not cacheable either', async () => {
    const response = await adminCall(ctx.running.baseUrl, 'POST', '/login', { rawBody: '{', origin: null });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expectTransport(response);
  });

  it('does not touch other routes: health and the application Auth keep their own headers, unknown /v1/administrator is not an admin prefix', async () => {
    const health = await fetch(`${ctx.running.baseUrl}/v1/health/live`);
    expect(health.status).toBe(200);
    expect(health.headers.get('pragma')).toBeNull();
    expect(health.headers.get('referrer-policy')).toBeNull();
    const auth = await adminCall(ctx.running.baseUrl, 'POST', '/login', { basePath: '/v1/auth', rawBody: '{', origin: null });
    expect(auth.status).toBe(400);
    expect(auth.headers['pragma']).toBeUndefined();
    expect(auth.headers['referrer-policy']).toBeUndefined();
    const lookalike = await adminCall(ctx.running.baseUrl, 'GET', '/x', { basePath: '/v1/administrator' });
    expect(lookalike.status).toBe(404);
    expect(lookalike.headers['pragma']).toBeUndefined();
  });

  it('Auth/Origin/CSRF are unchanged: a wrong Origin or a missing session still gets the same codes', async () => {
    const badOrigin = await adminCall(ctx.running.baseUrl, 'POST', '/login', { body: {}, origin: 'https://evil.example' });
    expect({ status: badOrigin.status, code: adminErrorCode(badOrigin) }).toEqual({ status: 403, code: 'ADMIN_CSRF_INVALID' });
    expectTransport(badOrigin);
    const noSession = await adminCall(ctx.running.baseUrl, 'GET', '/me');
    expect({ status: noSession.status, code: adminErrorCode(noSession) }).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    expectTransport(noSession);
  });
});
