import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { adminErrorCode, AdminResponse } from './support/admin-fixtures';
import { act, ActivationApp, bucketRows, startActivationApp } from './support/activation-fixtures';

// M01-D-ADMIN-1C - transport gate, through the REAL pipeline (the AppModule with configureApp, the one main.ts uses) and raw
// HTTP requests. A JSON syntax error and a body over the JSON parser limit are answered by the framework's body parser
// BEFORE any route or module middleware runs; the response must still carry the activation transport headers, must not
// carry a validator, and nothing of the request body may come back in the response or reach a log line.

const SECRET = 'SECRET-TOKEN-0123456789abcdef';
const PASSWORD = 'P@ssw0rd-SECRET-zzz';
const POST_ROUTES = ['/start', '/restart', '/otp/request', '/otp/verify', '/password', '/totp/enrollment', '/complete'] as const;

describe('M01-D-ADMIN-1C - transport headers on parser-level failures (raw HTTP, real pipeline)', () => {
  let ctx: ActivationApp;

  beforeAll(async () => {
    ctx = await startActivationApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.app.clearLimits();
  });

  const expectTransport = (response: AdminResponse): void => {
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['etag']).toBeUndefined();
    expect(response.headers['last-modified']).toBeUndefined();
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  };

  const expectNothingReflected = (response: AdminResponse): void => {
    for (const secret of [SECRET, PASSWORD, 'token', 'password']) {
      expect(response.text).not.toContain(secret);
    }
    expect(ctx.app.running.logs.join('\n')).not.toContain(SECRET);
    expect(ctx.app.running.logs.join('\n')).not.toContain(PASSWORD);
  };

  it.each(POST_ROUTES)('%s: a JSON syntax error is the generic 400 BAD_REQUEST with the transport headers, before the quota', async (route) => {
    const before = await bucketRows(ctx.pool);
    const response = await act(ctx.app, 'POST', route, { rawBody: `{"token":"${SECRET}","password":"${PASSWORD}` });
    expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 400, code: 'BAD_REQUEST' });
    expectTransport(response);
    expectNothingReflected(response);
    expect(await bucketRows(ctx.pool)).toEqual(before);
  });

  it.each(POST_ROUTES)('%s: a body over the JSON parser limit is a generic 413 CLIENT_ERROR with the transport headers', async (route) => {
    const before = await bucketRows(ctx.pool);
    const response = await act(ctx.app, 'POST', route, { rawBody: JSON.stringify({ token: SECRET, password: PASSWORD, pad: 'x'.repeat(120_000) }) });
    expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 413, code: 'CLIENT_ERROR' });
    expectTransport(response);
    expectNothingReflected(response);
    expect(await bucketRows(ctx.pool)).toEqual(before);
  });

  it('the same headers on a successful-path rejection that reaches the controller (control: unchanged behaviour)', async () => {
    const unknown = await act(ctx.app, 'POST', '/start', { body: { token: generateToken().token } });
    expect(unknown.status).toBe(404);
    expectTransport(unknown);
    const malformedShape = await act(ctx.app, 'POST', '/start', { body: { token: SECRET } });
    expect({ status: malformedShape.status, code: adminErrorCode(malformedShape) }).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expectTransport(malformedShape);
  });

  it('conditional request headers cannot produce a 304 on the activation routes', async () => {
    const response = await act(ctx.app, 'GET', '/state', { headers: { 'if-none-match': '*', 'if-modified-since': 'Wed, 21 Oct 2037 07:28:00 GMT' } });
    expect(response.status).toBe(401);
    expectTransport(response);
  });
});
