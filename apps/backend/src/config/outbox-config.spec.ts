import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './app-config';
import {
  assertOutboxConfig,
  DEFAULT_OUTBOX_CONFIG,
  isValidBackoffRelation,
  isValidLeaseRelation,
  OutboxConfig,
} from './outbox-config';

const SECRET = 'SECRET_MARKER_OUTBOX_CONFIG_5c1d';
const validEnv = {
  APP_ENV: 'test',
  DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
};

function invalidOf(env: Record<string, string | undefined>): readonly string[] {
  const result = loadConfig({ ...validEnv, ...env });
  if (result.ok) {
    throw new Error('expected the configuration to be rejected');
  }
  return result.invalid;
}

function outboxOf(env: Record<string, string | undefined>): OutboxConfig {
  const result = loadConfig({ ...validEnv, ...env });
  if (!result.ok) {
    throw new Error('expected the configuration to be accepted');
  }
  return result.config.outbox;
}

describe('loadConfig — outbox dispatcher (M00-C1C)', () => {
  it('applies the documented defaults', () => {
    expect(outboxOf({})).toEqual({
      maxAttempts: 5,
      batchSize: 10,
      publishConcurrency: 10,
      publishTimeoutMs: 5000,
      leaseMs: 30_000,
      backoffBaseMs: 1000,
      backoffCapMs: 60_000,
    });
    expect(DEFAULT_OUTBOX_CONFIG).toEqual(outboxOf({}));
  });

  it('accepts both ends of every range', () => {
    expect(
      outboxOf({
        OUTBOX_MAX_ATTEMPTS: '1',
        OUTBOX_BATCH_SIZE: '1',
        OUTBOX_PUBLISH_CONCURRENCY: '1',
        OUTBOX_PUBLISH_TIMEOUT_MS: '100',
        OUTBOX_LEASE_MS: '2101',
        OUTBOX_BACKOFF_BASE_MS: '100',
        OUTBOX_BACKOFF_CAP_MS: '100',
      }),
    ).toEqual({
      maxAttempts: 1,
      batchSize: 1,
      publishConcurrency: 1,
      publishTimeoutMs: 100,
      leaseMs: 2101,
      backoffBaseMs: 100,
      backoffCapMs: 100,
    });
    expect(
      outboxOf({
        OUTBOX_MAX_ATTEMPTS: '20',
        OUTBOX_BATCH_SIZE: '100',
        OUTBOX_PUBLISH_CONCURRENCY: '100',
        OUTBOX_PUBLISH_TIMEOUT_MS: '297999',
        OUTBOX_LEASE_MS: '300000',
        OUTBOX_BACKOFF_BASE_MS: '300000',
        OUTBOX_BACKOFF_CAP_MS: '300000',
      }),
    ).toEqual({
      maxAttempts: 20,
      batchSize: 100,
      publishConcurrency: 100,
      publishTimeoutMs: 297_999,
      leaseMs: 300_000,
      backoffBaseMs: 300_000,
      backoffCapMs: 300_000,
    });
  });

  it.each([
    ['OUTBOX_MAX_ATTEMPTS', ['0', '21', '-1', '1.5', 'x', '', ' 5']],
    ['OUTBOX_BATCH_SIZE', ['0', '101', '-1', '1.5', 'x', '']],
    ['OUTBOX_PUBLISH_CONCURRENCY', ['0', '101', '-1', '1.5', 'x', '']],
    ['OUTBOX_PUBLISH_TIMEOUT_MS', ['99', '300001', '-1', 'x', '']],
    ['OUTBOX_LEASE_MS', ['99', '300001', '-1', 'x', '']],
    ['OUTBOX_BACKOFF_BASE_MS', ['99', '300001', '-1', 'x', '']],
    ['OUTBOX_BACKOFF_CAP_MS', ['99', '300001', '-1', 'x', '']],
  ] as Array<[string, string[]]>)('rejects out-of-range or malformed %s and names only that variable', (name, values) => {
    for (const value of values) {
      expect(invalidOf({ [name]: value })).toEqual([name]);
    }
  });

  it('enforces lease > publish timeout + 2000 ms (strictly), naming both variables', () => {
    expect(invalidOf({ OUTBOX_PUBLISH_TIMEOUT_MS: '5000', OUTBOX_LEASE_MS: '7000' })).toEqual([
      'OUTBOX_LEASE_MS',
      'OUTBOX_PUBLISH_TIMEOUT_MS',
    ]);
    expect(invalidOf({ OUTBOX_PUBLISH_TIMEOUT_MS: '5000', OUTBOX_LEASE_MS: '6999' })).toEqual([
      'OUTBOX_LEASE_MS',
      'OUTBOX_PUBLISH_TIMEOUT_MS',
    ]);
    expect(outboxOf({ OUTBOX_PUBLISH_TIMEOUT_MS: '5000', OUTBOX_LEASE_MS: '7001' }).leaseMs).toBe(7001);
    // The default lease (30 s) no longer fits a timeout of 29 s.
    expect(invalidOf({ OUTBOX_PUBLISH_TIMEOUT_MS: '28000' })).toEqual(['OUTBOX_LEASE_MS', 'OUTBOX_PUBLISH_TIMEOUT_MS']);
  });

  it('enforces base <= cap (equal is allowed), naming both variables', () => {
    expect(invalidOf({ OUTBOX_BACKOFF_BASE_MS: '2000', OUTBOX_BACKOFF_CAP_MS: '1000' })).toEqual([
      'OUTBOX_BACKOFF_BASE_MS',
      'OUTBOX_BACKOFF_CAP_MS',
    ]);
    expect(outboxOf({ OUTBOX_BACKOFF_BASE_MS: '1000', OUTBOX_BACKOFF_CAP_MS: '1000' }).backoffCapMs).toBe(1000);
  });

  it('does not judge a relation with an invalid member: a bad value is reported once, by its own name', () => {
    expect(invalidOf({ OUTBOX_PUBLISH_TIMEOUT_MS: '99', OUTBOX_LEASE_MS: '100' })).toEqual([
      'OUTBOX_PUBLISH_TIMEOUT_MS',
    ]);
    expect(invalidOf({ OUTBOX_BACKOFF_BASE_MS: 'x', OUTBOX_BACKOFF_CAP_MS: '100' })).toEqual(['OUTBOX_BACKOFF_BASE_MS']);
  });

  it('reports every broken variable together, and never a value', () => {
    const invalid = invalidOf({
      OUTBOX_MAX_ATTEMPTS: '0',
      OUTBOX_BATCH_SIZE: '1000',
      OUTBOX_BACKOFF_BASE_MS: '9000',
      OUTBOX_BACKOFF_CAP_MS: '1000',
    });
    expect([...invalid].sort()).toEqual([
      'OUTBOX_BACKOFF_BASE_MS',
      'OUTBOX_BACKOFF_CAP_MS',
      'OUTBOX_BATCH_SIZE',
      'OUTBOX_MAX_ATTEMPTS',
    ]);
    for (const name of invalid) {
      expect(name).toMatch(/^[A-Z_]+$/);
    }
    expect(JSON.stringify(invalid)).not.toContain(SECRET);
    expect(JSON.stringify(invalid)).not.toContain('1000');
  });
});

describe('assertOutboxConfig — guard for a config object handed straight to the store or dispatcher', () => {
  it('accepts the defaults', () => {
    expect(() => assertOutboxConfig(DEFAULT_OUTBOX_CONFIG)).not.toThrow();
  });

  it('rejects every out-of-range member and both relations, with a message that carries no value', () => {
    const bad: Array<Partial<OutboxConfig>> = [
      { maxAttempts: 0 },
      { maxAttempts: 21 },
      { batchSize: 0 },
      { batchSize: 101 },
      { publishConcurrency: 0 },
      { publishConcurrency: 101 },
      { publishTimeoutMs: 99 },
      { leaseMs: 300_001 },
      { backoffBaseMs: 99 },
      { backoffCapMs: 300_001 },
      { maxAttempts: 2.5 },
      { publishTimeoutMs: Number.NaN },
      { publishTimeoutMs: 29_000 }, // lease 30000 <= 29000 + 2000
      { leaseMs: 7000, publishTimeoutMs: 5000 },
      { backoffBaseMs: 2000, backoffCapMs: 1000 },
    ];
    for (const override of bad) {
      let message = '';
      try {
        assertOutboxConfig({ ...DEFAULT_OUTBOX_CONFIG, ...override });
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        message = (error as Error).message;
      }
      expect(message).toBe('invalid outbox configuration');
    }
  });

  it('exposes the two relations as pure predicates', () => {
    expect(isValidLeaseRelation(7001, 5000)).toBe(true);
    expect(isValidLeaseRelation(7000, 5000)).toBe(false);
    expect(isValidBackoffRelation(1000, 1000)).toBe(true);
    expect(isValidBackoffRelation(1001, 1000)).toBe(false);
  });
});
