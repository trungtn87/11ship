import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';
import { COMPILED_MAIN, minimalChildEnv } from './support/test-helpers';

// F05 — the real compiled entry point must exit nonzero on bad configuration and name only the
// offending variables. Every case here is invalid, so the server never starts or hangs.
function startMain(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [COMPILED_MAIN], {
    env: minimalChildEnv(env),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('F05 — invalid configuration stops the process', () => {
  const SECRET = 'SECRET_MARKER_F05_c81b';
  const validUrl = `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`;

  it('exits nonzero when DATABASE_URL is missing and names only DATABASE_URL', () => {
    const result = startMain({ APP_ENV: 'test' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('PORT');
    expect(result.stderr).not.toContain('APP_ENV');
  });

  it('exits nonzero for an invalid PORT, names only PORT and prints no values', () => {
    const result = startMain({ APP_ENV: 'test', DATABASE_URL: validUrl, PORT: 'not-a-port' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PORT');
    expect(result.stderr).not.toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('not-a-port');
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it('never prints a bad DATABASE_URL value', () => {
    const result = startMain({ APP_ENV: 'test', DATABASE_URL: `mysql://u:${SECRET}@h/db` });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it('exits nonzero for APP_ENV=production without a DATABASE_URL (no fallback)', () => {
    const result = startMain({ APP_ENV: 'production' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });
});
