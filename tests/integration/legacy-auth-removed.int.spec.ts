import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, startAuthApp } from './support/auth-fixtures';

// OD-1 — the four legacy /v1/auth account routes are gone (the replacement is /v1/client-auth/*). Each answers 404 whatever
// the method, body or credentials, and no duplicate route answers instead. The phone-verification routes of the same
// controller stay (Phase 3) and are covered by their own suites.

describe('OD-1 — legacy /auth account routes are removed', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const routes: readonly (readonly ['GET' | 'POST', string])[] = [
    ['POST', '/auth/register'],
    ['POST', '/auth/login'],
    ['POST', '/auth/role/select'],
    ['GET', '/auth/me'],
  ];

  it.each(routes)('%s /v1%s answers 404', async (method, path) => {
    const bare = await app.call(method, path, method === 'POST' ? { body: {} } : {});
    expect(bare.status).toBe(404);
    const withBearer = await app.call(method, path, { bearer: 'A'.repeat(43), ...(method === 'POST' ? { body: {} } : {}) });
    expect(withBearer.status).toBe(404);
  });

  it('the replacement routes still exist (not 404)', async () => {
    expect((await app.call('GET', '/client-auth/me', {})).status).not.toBe(404);
  });
});
