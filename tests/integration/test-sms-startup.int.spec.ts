import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { COMPILED_MAIN, minimalChildEnv } from './support/test-helpers';

// M01.22 (TS08) — the REAL compiled entry point refuses a TEST_INBOX selection outside a local development/test target
// BEFORE it opens anything: exit 1, only variable names are printed, no listener, no discovery state. Every case here is
// invalid, so the server never starts and never touches the database.
const SECRET = 'SECRET_MARKER_M0122_7d1e';
const LOCAL_DB = `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`;
const cwd = mkdtempSync(path.join(os.tmpdir(), 'tsms-startup-'));
writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: '11ship' }));

function startMain(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [COMPILED_MAIN], { env: minimalChildEnv(env), cwd, encoding: 'utf8', timeout: 30_000 });
}

function expectNothingOpened(result: ReturnType<typeof startMain>): void {
  expect(result.status).toBe(1);
  expect(existsSync(path.join(cwd, '.11ship-local'))).toBe(false);
  for (const output of [result.stderr, result.stdout]) {
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain('TEST_INBOX');
  }
}

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('M01.22 TS08 — TEST_INBOX is refused outside a local development/test target', () => {
  it('staging and production refuse OTP_PROVIDER=TEST_INBOX, naming only the variable', () => {
    for (const appEnv of ['staging', 'production']) {
      const result = startMain({ APP_ENV: appEnv, DATABASE_URL: LOCAL_DB, OTP_PROVIDER: 'TEST_INBOX' });
      expect(result.stderr).toContain('OTP_PROVIDER');
      expectNothingOpened(result);
    }
  });

  it('staging and production refuse ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX, naming only the variable', () => {
    for (const appEnv of ['staging', 'production']) {
      const result = startMain({ APP_ENV: appEnv, DATABASE_URL: LOCAL_DB, ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' });
      expect(result.stderr).toContain('ADMIN_ACTIVATION_OTP_MODE');
      expectNothingOpened(result);
    }
  });

  it('development/test refuse a non-loopback API host or a remote database with TEST_INBOX', () => {
    const wideHost = startMain({ APP_ENV: 'test', DATABASE_URL: LOCAL_DB, OTP_PROVIDER: 'TEST_INBOX', HOST: '0.0.0.0' });
    expect(wideHost.stderr).toContain('HOST');
    expectNothingOpened(wideHost);

    const remoteDb = startMain({
      APP_ENV: 'development',
      DATABASE_URL: `postgres://u:${SECRET}@db.example.com:5432/x`,
      OTP_PROVIDER: 'TEST_INBOX',
    });
    expect(remoteDb.stderr).toContain('DATABASE_URL');
    expectNothingOpened(remoteDb);
  });

  it('an unknown OTP_PROVIDER value is refused by variable name only', () => {
    const result = startMain({ APP_ENV: 'test', DATABASE_URL: LOCAL_DB, OTP_PROVIDER: 'SMS' });
    expect(result.stderr).toContain('OTP_PROVIDER');
    expect(result.stderr).not.toContain('SMS');
    expectNothingOpened(result);
  });
});
