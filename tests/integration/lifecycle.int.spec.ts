import { describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../apps/backend/src/database/database.constants';
import { loadIntegrationConfig, startApp } from './support/test-helpers';

// F09 — closing the app must end the HTTP server and the pool, leaving no open handles.
// Jest is run WITHOUT --forceExit, so a leaked handle makes the whole run hang and fail.
describe('F09 — clean shutdown', () => {
  it('closes the HTTP server and the database pool', async () => {
    const running = await startApp(loadIntegrationConfig());
    const pool = running.app.get<Pool>(DATABASE_POOL);

    // Open at least one real connection so there is something to close.
    const ready = await fetch(`${running.baseUrl}/v1/health/ready`);
    expect(ready.status).toBe(200);
    expect(pool.totalCount).toBeGreaterThan(0);

    await running.app.close();

    expect(pool.totalCount).toBe(0);
    await expect(fetch(`${running.baseUrl}/v1/health/live`)).rejects.toBeDefined();
    await expect(pool.query('SELECT 1')).rejects.toBeDefined();
  });

  it('starts and stops cleanly even when the database is unreachable', async () => {
    const config = loadIntegrationConfig();
    const running = await startApp({
      ...config,
      database: { ...config.database, url: 'postgres://ship11_test:unused@127.0.0.1:1/ship11_test' },
    });

    const live = await fetch(`${running.baseUrl}/v1/health/live`);
    expect(live.status).toBe(200);

    await expect(running.app.close()).resolves.toBeUndefined();
  });
});
