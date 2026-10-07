import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';
import { COMPILED_MAIN, minimalChildEnv } from './support/test-helpers';

// M00-C1C — C16 (configuration): the real compiled entry point must refuse invalid outbox configuration with a
// nonzero exit, name ONLY the offending variables and never print a value. Every case here is invalid, so the
// server never starts or hangs.
function startMain(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [COMPILED_MAIN], {
    env: minimalChildEnv(env),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('M00-C1C C16 — invalid outbox configuration stops the process and leaks nothing', () => {
  const SECRET = 'SECRET_MARKER_C1C_CFG_3e9d';
  const base = {
    APP_ENV: 'test',
    DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
  };

  it.each([
    ['OUTBOX_MAX_ATTEMPTS', '0'],
    ['OUTBOX_MAX_ATTEMPTS', '21'],
    ['OUTBOX_BATCH_SIZE', '0'],
    ['OUTBOX_BATCH_SIZE', '101'],
    ['OUTBOX_PUBLISH_CONCURRENCY', '0'],
    ['OUTBOX_PUBLISH_CONCURRENCY', '101'],
    ['OUTBOX_PUBLISH_TIMEOUT_MS', '99'],
    ['OUTBOX_PUBLISH_TIMEOUT_MS', '300001'],
    ['OUTBOX_LEASE_MS', '99'],
    ['OUTBOX_LEASE_MS', '300001'],
    ['OUTBOX_BACKOFF_BASE_MS', '99'],
    ['OUTBOX_BACKOFF_CAP_MS', '300001'],
  ])('exits nonzero for %s=%s and names only that variable', (name, value) => {
    const result = startMain({ ...base, [name]: value });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    const others = [
      'OUTBOX_MAX_ATTEMPTS',
      'OUTBOX_BATCH_SIZE',
      'OUTBOX_PUBLISH_CONCURRENCY',
      'OUTBOX_PUBLISH_TIMEOUT_MS',
      'OUTBOX_LEASE_MS',
      'OUTBOX_BACKOFF_BASE_MS',
      'OUTBOX_BACKOFF_CAP_MS',
      'DATABASE_URL',
    ].filter((other) => other !== name);
    for (const other of others) {
      expect(result.stderr).not.toContain(other);
    }
    expect(result.stderr).not.toContain(`=${value}`);
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it('never prints a malformed value, even one that looks like a secret', () => {
    const result = startMain({ ...base, OUTBOX_BATCH_SIZE: SECRET });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OUTBOX_BATCH_SIZE');
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it('exits nonzero when the lease is not longer than the publish timeout plus 2000 ms, naming both variables', () => {
    const result = startMain({ ...base, OUTBOX_PUBLISH_TIMEOUT_MS: '5000', OUTBOX_LEASE_MS: '7000' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OUTBOX_LEASE_MS');
    expect(result.stderr).toContain('OUTBOX_PUBLISH_TIMEOUT_MS');
    expect(result.stderr).not.toContain('7000');
    expect(result.stderr).not.toContain(SECRET);
  });

  it('exits nonzero when the backoff base is larger than the cap, naming both variables', () => {
    const result = startMain({ ...base, OUTBOX_BACKOFF_BASE_MS: '9000', OUTBOX_BACKOFF_CAP_MS: '1000' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OUTBOX_BACKOFF_BASE_MS');
    expect(result.stderr).toContain('OUTBOX_BACKOFF_CAP_MS');
    expect(result.stderr).not.toContain('9000');
    expect(result.stderr).not.toContain(SECRET);
  });

  it('reports several broken outbox variables at once and still prints no value', () => {
    const result = startMain({
      ...base,
      OUTBOX_MAX_ATTEMPTS: '0',
      OUTBOX_BATCH_SIZE: '1000',
      OUTBOX_PUBLISH_CONCURRENCY: 'many',
    });

    expect(result.status).toBe(1);
    for (const name of ['OUTBOX_MAX_ATTEMPTS', 'OUTBOX_BATCH_SIZE', 'OUTBOX_PUBLISH_CONCURRENCY']) {
      expect(result.stderr).toContain(name);
    }
    expect(result.stderr).not.toContain('many');
    expect(result.stderr).not.toContain('1000');
    expect(result.stderr).not.toContain(SECRET);
  });
});
