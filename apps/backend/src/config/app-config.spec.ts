import { describe, expect, it } from '@jest/globals';
import { formatInvalidConfigMessage, loadConfig } from './app-config';
import { createTestPki } from '../database/test-tls.fixture';
import {
  FIXTURE_K1_BASE64,
  FIXTURE_K2_BASE64,
  FIXTURE_KEYRING_ENV,
} from '../crypto/test-keys.fixture';

const SECRET = 'SECRET_MARKER_CONFIG_7f3a';
// Staging and production refuse to start without a database CA (M00-D1), so the tests that accept them supply one.
const TEST_CA = createTestPki().caPem;
const validEnv = {
  APP_ENV: 'test',
  DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
};

function invalidOf(env: Record<string, string | undefined>): readonly string[] {
  const result = loadConfig(env);
  if (result.ok) {
    throw new Error('expected the configuration to be rejected');
  }
  return result.invalid;
}

describe('loadConfig', () => {
  it('accepts a minimal valid environment and applies the documented defaults', () => {
    const result = loadConfig(validEnv);
    if (!result.ok) {
      throw new Error('expected the configuration to be accepted');
    }
    expect(result.config.appEnv).toBe('test');
    expect(result.config.nodeEnv).toBeUndefined();
    expect(result.config.host).toBe('127.0.0.1');
    expect(result.config.port).toBe(3000);
    expect(result.config.database).toEqual({
      url: validEnv.DATABASE_URL,
      poolMax: 10,
      connectTimeoutMs: 1000,
      queryTimeoutMs: 1000,
      statementTimeoutMs: 800,
    });
    expect(result.config.transaction).toEqual({ timeoutMs: 5000, idleInTransactionTimeoutMs: 2000 });
    // M00-C1A0: the keyring is optional until a slice consumes it.
    expect(result.config.crypto).toBeUndefined();
  });

  it('accepts explicit values inside the allowed bounds', () => {
    const result = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '65535',
      DB_POOL_MAX: '50',
      DB_CONNECT_TIMEOUT_MS: '100',
      DB_QUERY_TIMEOUT_MS: '30000',
    });
    if (!result.ok) {
      throw new Error('expected the configuration to be accepted');
    }
    expect(result.config.nodeEnv).toBe('production');
    expect(result.config.host).toBe('0.0.0.0');
    expect(result.config.port).toBe(65535);
    expect(result.config.database.poolMax).toBe(50);
    expect(result.config.database.connectTimeoutMs).toBe(100);
    expect(result.config.database.queryTimeoutMs).toBe(30000);
  });

  it('rejects a missing DATABASE_URL and names only that variable', () => {
    expect(invalidOf({ APP_ENV: 'test' })).toEqual(['DATABASE_URL']);
  });

  it('has no fallback for DATABASE_URL in production', () => {
    expect(invalidOf({ APP_ENV: 'production', DB_SSL_CA: TEST_CA })).toEqual(['DATABASE_URL']);
  });

  it('rejects a missing or unknown APP_ENV', () => {
    expect(invalidOf({ DATABASE_URL: validEnv.DATABASE_URL })).toEqual(['APP_ENV']);
    expect(invalidOf({ ...validEnv, APP_ENV: 'prod' })).toEqual(['APP_ENV']);
    expect(invalidOf({ ...validEnv, APP_ENV: '' })).toEqual(['APP_ENV']);
  });

  it.each(['development', 'staging', 'production', 'test'])('accepts APP_ENV=%s', (value) => {
    const tlsRequired = value === 'staging' || value === 'production';
    const env = { ...validEnv, APP_ENV: value, ...(tlsRequired ? { DB_SSL_CA: TEST_CA } : {}) };
    expect(loadConfig(env).ok).toBe(true);
  });

  it('rejects NODE_ENV=staging while still allowing APP_ENV=staging', () => {
    expect(invalidOf({ ...validEnv, NODE_ENV: 'staging' })).toEqual(['NODE_ENV']);
    expect(
      loadConfig({ ...validEnv, APP_ENV: 'staging', NODE_ENV: 'production', DB_SSL_CA: TEST_CA }).ok,
    ).toBe(true);
  });

  it.each(['abc', '0', '65536', '-1', '3000.5', ' 3000', '', '1e3', '0x50'])(
    'rejects PORT=%j and names only PORT',
    (value) => {
      expect(invalidOf({ ...validEnv, PORT: value })).toEqual(['PORT']);
    },
  );

  it('accepts the PORT boundaries 1 and 65535', () => {
    expect(loadConfig({ ...validEnv, PORT: '1' }).ok).toBe(true);
    expect(loadConfig({ ...validEnv, PORT: '65535' }).ok).toBe(true);
  });

  it.each([
    ['DB_POOL_MAX', '0'],
    ['DB_POOL_MAX', '51'],
    ['DB_POOL_MAX', 'many'],
    ['DB_CONNECT_TIMEOUT_MS', '99'],
    ['DB_CONNECT_TIMEOUT_MS', '30001'],
    ['DB_QUERY_TIMEOUT_MS', '99'],
    ['DB_QUERY_TIMEOUT_MS', '30001'],
  ])('rejects %s=%s as outside the bounded range', (name, value) => {
    expect(invalidOf({ ...validEnv, [name]: value })).toEqual([name]);
  });

  it.each(['not a url', 'mysql://u:p@127.0.0.1/db', 'postgres://127.0.0.1', 'postgres:///db', ''])(
    'rejects DATABASE_URL=%j',
    (value) => {
      expect(invalidOf({ ...validEnv, DATABASE_URL: value })).toEqual(['DATABASE_URL']);
    },
  );

  it('reports several bad variables in a fixed order', () => {
    expect(
      invalidOf({
        APP_ENV: 'x',
        NODE_ENV: 'staging',
        DATABASE_URL: 'mysql://u:p@h/db',
        PORT: '0',
      }),
    ).toEqual(['APP_ENV', 'NODE_ENV', 'DATABASE_URL', 'PORT']);
  });

  it('never puts a variable value into the failure message', () => {
    const invalid = invalidOf({
      APP_ENV: 'test',
      DATABASE_URL: `mysql://u:${SECRET}@h/db`,
      PORT: 'SECRET_PORT_VALUE',
    });
    const message = formatInvalidConfigMessage(invalid);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('SECRET_PORT_VALUE');
    expect(JSON.stringify(invalid)).not.toContain(SECRET);
  });

  it.each([
    ['DB_STATEMENT_TIMEOUT_MS', '99'],
    ['DB_STATEMENT_TIMEOUT_MS', '30001'],
    ['DB_TRANSACTION_TIMEOUT_MS', '99'],
    ['DB_TRANSACTION_TIMEOUT_MS', '30001'],
    ['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', '99'],
    ['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', '30001'],
    ['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 'soon'],
  ])('rejects %s=%s as outside the bounded range', (name, value) => {
    expect(invalidOf({ ...validEnv, [name]: value })).toEqual([name]);
  });

  it('accepts explicit transaction timeouts at the bounds', () => {
    const result = loadConfig({
      ...validEnv,
      DB_STATEMENT_TIMEOUT_MS: '100',
      DB_QUERY_TIMEOUT_MS: '101',
      DB_TRANSACTION_TIMEOUT_MS: '30000',
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '100',
      // M00-C1A1 (ADR-003 §13.1): both idempotency lock budgets must stay below the statement timeout,
      // so at a 100 ms statement timeout they are set explicitly below it. The A0 assertions are unchanged.
      IDEMPOTENCY_ADVISORY_WAIT_MS: '50',
      IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '99',
    });
    if (!result.ok) {
      throw new Error('expected the configuration to be accepted');
    }
    expect(result.config.database.statementTimeoutMs).toBe(100);
    expect(result.config.transaction).toEqual({ timeoutMs: 30000, idleInTransactionTimeoutMs: 100 });
  });

  describe('timeout relations (ADR-003 §13.1)', () => {
    it('requires the client query timeout to be LARGER than the server statement timeout', () => {
      expect(
        invalidOf({ ...validEnv, DB_QUERY_TIMEOUT_MS: '800', DB_STATEMENT_TIMEOUT_MS: '800' }),
      ).toEqual(['DB_STATEMENT_TIMEOUT_MS', 'DB_QUERY_TIMEOUT_MS']);
      expect(
        invalidOf({ ...validEnv, DB_QUERY_TIMEOUT_MS: '500', DB_STATEMENT_TIMEOUT_MS: '900' }),
      ).toEqual(['DB_STATEMENT_TIMEOUT_MS', 'DB_QUERY_TIMEOUT_MS']);
      expect(
        loadConfig({ ...validEnv, DB_QUERY_TIMEOUT_MS: '801', DB_STATEMENT_TIMEOUT_MS: '800' }).ok,
      ).toBe(true);
    });

    it('checks the default statement timeout too, so a bare small query timeout is refused', () => {
      expect(invalidOf({ ...validEnv, DB_QUERY_TIMEOUT_MS: '500' })).toEqual([
        'DB_STATEMENT_TIMEOUT_MS',
        'DB_QUERY_TIMEOUT_MS',
      ]);
    });

    it('requires the transaction timeout to be LARGER than the statement timeout', () => {
      expect(
        invalidOf({ ...validEnv, DB_TRANSACTION_TIMEOUT_MS: '800', DB_STATEMENT_TIMEOUT_MS: '800' }),
      ).toEqual(['DB_STATEMENT_TIMEOUT_MS', 'DB_TRANSACTION_TIMEOUT_MS']);
      expect(
        loadConfig({ ...validEnv, DB_TRANSACTION_TIMEOUT_MS: '801', DB_STATEMENT_TIMEOUT_MS: '800' })
          .ok,
      ).toBe(true);
    });

    it('does not report a relation for a value that is already invalid on its own', () => {
      expect(invalidOf({ ...validEnv, DB_STATEMENT_TIMEOUT_MS: 'x' })).toEqual([
        'DB_STATEMENT_TIMEOUT_MS',
      ]);
    });

    it('never gives the client and server timeouts the same value by default', () => {
      const result = loadConfig(validEnv);
      if (!result.ok) {
        throw new Error('expected the configuration to be accepted');
      }
      expect(result.config.database.queryTimeoutMs).toBeGreaterThan(
        result.config.database.statementTimeoutMs,
      );
      expect(result.config.transaction.timeoutMs).toBeGreaterThan(
        result.config.database.statementTimeoutMs,
      );
    });
  });

  describe('crypto keyring', () => {
    it('accepts a valid keyring and active key id', () => {
      const result = loadConfig({
        ...validEnv,
        CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
        CRYPTO_ACTIVE_KEY_ID: 'k2',
      });
      if (!result.ok) {
        throw new Error('expected the configuration to be accepted');
      }
      expect(result.config.crypto?.activeKeyId).toBe('k2');
      expect(result.config.crypto?.keyIds()).toEqual(['k1', 'k2']);
    });

    it('is all-or-nothing: one variable without the other is invalid and named', () => {
      expect(invalidOf({ ...validEnv, CRYPTO_KEYRING: FIXTURE_KEYRING_ENV })).toEqual([
        'CRYPTO_ACTIVE_KEY_ID',
      ]);
      expect(invalidOf({ ...validEnv, CRYPTO_ACTIVE_KEY_ID: 'k1' })).toEqual(['CRYPTO_KEYRING']);
    });

    it.each([
      ['not base64', 'k1:not-base64'],
      ['wrong length', `k1:${Buffer.alloc(16).toString('base64')}`],
      ['duplicate id', `k1:${FIXTURE_K1_BASE64},k1:${FIXTURE_K2_BASE64}`],
      ['missing separator', FIXTURE_K1_BASE64],
      ['empty', ''],
    ])('rejects a keyring that is %s and names only CRYPTO_KEYRING', (_label, raw) => {
      expect(invalidOf({ ...validEnv, CRYPTO_KEYRING: raw, CRYPTO_ACTIVE_KEY_ID: 'k1' })).toEqual([
        'CRYPTO_KEYRING',
      ]);
    });

    it('rejects an active key id that is not in the keyring and names only CRYPTO_ACTIVE_KEY_ID', () => {
      expect(
        invalidOf({ ...validEnv, CRYPTO_KEYRING: FIXTURE_KEYRING_ENV, CRYPTO_ACTIVE_KEY_ID: 'k9' }),
      ).toEqual(['CRYPTO_ACTIVE_KEY_ID']);
    });

    it('never puts key material or the active id into the failure message', () => {
      const invalid = invalidOf({
        ...validEnv,
        CRYPTO_KEYRING: `k1:${FIXTURE_K1_BASE64},k1:${FIXTURE_K2_BASE64}`,
        CRYPTO_ACTIVE_KEY_ID: 'ACTIVE_ID_SECRET_MARKER',
      });
      const message = formatInvalidConfigMessage(invalid);
      expect(message).toContain('CRYPTO_KEYRING');
      expect(message).not.toContain(FIXTURE_K1_BASE64);
      expect(message).not.toContain(FIXTURE_K2_BASE64);
      expect(message).not.toContain('ACTIVE_ID_SECRET_MARKER');
    });
  });
});

describe('loadConfig — idempotency (M00-C1A1)', () => {
  function configOf(env: Record<string, string | undefined>) {
    const result = loadConfig(env);
    if (!result.ok) {
      throw new Error('expected the configuration to be accepted');
    }
    return result.config;
  }

  it('defaults: 250 ms advisory wait, 500 ms business lock budget, 900 s replay, 604800 s dedupe', () => {
    expect(configOf(validEnv).idempotency).toEqual({
      advisoryWaitMs: 250,
      businessLockTimeoutMs: 500,
      replayTtlSeconds: 900,
      dedupeTtlSeconds: 604800,
    });
  });

  it('accepts explicit values inside the bounds', () => {
    expect(
      configOf({
        ...validEnv,
        IDEMPOTENCY_ADVISORY_WAIT_MS: '5',
        IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '700',
        IDEMPOTENCY_REPLAY_TTL_SECONDS: '60',
        IDEMPOTENCY_DEDUPE_TTL_SECONDS: '3600',
        DB_STATEMENT_TIMEOUT_MS: '800',
      }).idempotency,
    ).toEqual({
      advisoryWaitMs: 5,
      businessLockTimeoutMs: 700,
      replayTtlSeconds: 60,
      dedupeTtlSeconds: 3600,
    });
  });

  it('accepts the advisory wait bounds 1 ms and 5 s when the statement timeout is larger', () => {
    expect(configOf({ ...validEnv, IDEMPOTENCY_ADVISORY_WAIT_MS: '1' }).idempotency.advisoryWaitMs).toBe(1);
    expect(
      configOf({
        ...validEnv,
        IDEMPOTENCY_ADVISORY_WAIT_MS: '5000',
        DB_STATEMENT_TIMEOUT_MS: '5001',
        DB_QUERY_TIMEOUT_MS: '5002',
        DB_TRANSACTION_TIMEOUT_MS: '9000',
        IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '500',
      }).idempotency.advisoryWaitMs,
    ).toBe(5000);
  });

  it.each([
    ['IDEMPOTENCY_ADVISORY_WAIT_MS', '0'],
    ['IDEMPOTENCY_ADVISORY_WAIT_MS', '5001'],
    ['IDEMPOTENCY_ADVISORY_WAIT_MS', 'soon'],
    ['IDEMPOTENCY_ADVISORY_WAIT_MS', ''],
    ['IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS', '0'],
    ['IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS', '30001'],
    ['IDEMPOTENCY_REPLAY_TTL_SECONDS', '0'],
    ['IDEMPOTENCY_REPLAY_TTL_SECONDS', '604801'],
    ['IDEMPOTENCY_DEDUPE_TTL_SECONDS', '0'],
    ['IDEMPOTENCY_DEDUPE_TTL_SECONDS', '604801'],
    ['IDEMPOTENCY_DEDUPE_TTL_SECONDS', '1.5'],
  ])('rejects %s=%s and names only that variable', (name, value) => {
    expect(invalidOf({ ...validEnv, [name]: value })).toEqual([name]);
  });

  describe('relations (ADR-003 §13.1, §13.4)', () => {
    it('refuses an advisory wait that is not below the statement timeout', () => {
      expect(
        invalidOf({ ...validEnv, IDEMPOTENCY_ADVISORY_WAIT_MS: '800', DB_STATEMENT_TIMEOUT_MS: '800' }),
      ).toEqual(['IDEMPOTENCY_ADVISORY_WAIT_MS', 'DB_STATEMENT_TIMEOUT_MS']);
    });

    it('refuses a business lock budget that is not below the statement timeout', () => {
      expect(
        invalidOf({
          ...validEnv,
          IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '800',
          DB_STATEMENT_TIMEOUT_MS: '800',
        }),
      ).toEqual(['IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS']);
    });

    it('checks the DEFAULT lock budgets against an explicit small statement timeout', () => {
      // 250 ms and 500 ms default budgets are not below a 200 ms statement timeout.
      expect(invalidOf({ ...validEnv, DB_STATEMENT_TIMEOUT_MS: '200', DB_QUERY_TIMEOUT_MS: '300' })).toEqual([
        'IDEMPOTENCY_ADVISORY_WAIT_MS',
        'DB_STATEMENT_TIMEOUT_MS',
        'IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS',
      ]);
    });

    it('requires replay TTL <= dedupe TTL', () => {
      expect(
        invalidOf({
          ...validEnv,
          IDEMPOTENCY_REPLAY_TTL_SECONDS: '1000',
          IDEMPOTENCY_DEDUPE_TTL_SECONDS: '999',
        }),
      ).toEqual(['IDEMPOTENCY_REPLAY_TTL_SECONDS', 'IDEMPOTENCY_DEDUPE_TTL_SECONDS']);
      // equality is allowed
      expect(
        configOf({
          ...validEnv,
          IDEMPOTENCY_REPLAY_TTL_SECONDS: '900',
          IDEMPOTENCY_DEDUPE_TTL_SECONDS: '900',
        }).idempotency.dedupeTtlSeconds,
      ).toBe(900);
    });

    it('checks the default replay TTL when only the dedupe TTL is lowered', () => {
      expect(invalidOf({ ...validEnv, IDEMPOTENCY_DEDUPE_TTL_SECONDS: '600' })).toEqual([
        'IDEMPOTENCY_REPLAY_TTL_SECONDS',
        'IDEMPOTENCY_DEDUPE_TTL_SECONDS',
      ]);
    });

    it('does not double-report a variable that is already individually invalid', () => {
      expect(
        invalidOf({
          ...validEnv,
          IDEMPOTENCY_ADVISORY_WAIT_MS: '0',
          IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '100',
          DB_STATEMENT_TIMEOUT_MS: '300',
          DB_QUERY_TIMEOUT_MS: '400',
        }),
      ).toEqual(['IDEMPOTENCY_ADVISORY_WAIT_MS']);
    });
  });

  it('never puts a configured value into the failure message', () => {
    const invalid = invalidOf({
      ...validEnv,
      IDEMPOTENCY_REPLAY_TTL_SECONDS: 'SECRET_TTL_VALUE_3c',
      IDEMPOTENCY_ADVISORY_WAIT_MS: '99999',
    });
    const message = formatInvalidConfigMessage(invalid);
    expect(message).toContain('IDEMPOTENCY_REPLAY_TTL_SECONDS');
    expect(message).toContain('IDEMPOTENCY_ADVISORY_WAIT_MS');
    expect(message).not.toContain('SECRET_TTL_VALUE_3c');
    expect(message).not.toContain('99999');
    expect(message).not.toContain(SECRET);
  });
});

// M00-D1: strict database TLS decided at startup, from variable NAMES only.
describe('loadConfig: database TLS (M00-D1)', () => {
  const pki = createTestPki();
  const stagingBase = {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DATABASE_URL: `postgres://ship11_app.projref:${SECRET}@pooler.example.test:5432/postgres`,
  };

  it('keeps development and test exactly as before: no tls key at all without a CA', () => {
    for (const appEnv of ['development', 'test']) {
      const result = loadConfig({ ...validEnv, APP_ENV: appEnv });
      if (!result.ok) {
        throw new Error('expected the configuration to be accepted');
      }
      expect('tls' in result.config.database).toBe(false);
    }
  });

  it('keeps a URL query such as ?sslmode=disable working in development/test when no CA is supplied', () => {
    const result = loadConfig({ ...validEnv, DATABASE_URL: `${validEnv.DATABASE_URL}?sslmode=disable` });
    expect(result.ok).toBe(true);
  });

  it('refuses staging and production without a CA, naming both variables and no value', () => {
    for (const appEnv of ['staging', 'production']) {
      const invalid = invalidOf({ ...stagingBase, APP_ENV: appEnv });
      expect(invalid).toEqual(['DB_SSL_CA', 'DB_SSL_CA_FILE']);
      const message = formatInvalidConfigMessage(invalid);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('pooler.example.test');
    }
  });

  it('accepts staging and production with a CA and carries strict TLS into the database config', () => {
    for (const appEnv of ['staging', 'production']) {
      const result = loadConfig({ ...stagingBase, APP_ENV: appEnv, DB_SSL_CA: pki.caPem });
      if (!result.ok) {
        throw new Error('expected the configuration to be accepted');
      }
      expect(result.config.database.tls?.rejectUnauthorized).toBe(true);
      expect(result.config.database.tls?.ca).toBe(pki.caPem.trim() + '\n');
    }
  });

  it('refuses a URL query once TLS is required, so the URL cannot weaken verification', () => {
    const invalid = invalidOf({
      ...stagingBase,
      DB_SSL_CA: pki.caPem,
      DATABASE_URL: `${stagingBase.DATABASE_URL}?sslmode=no-verify`,
    });
    expect(invalid).toEqual(['DATABASE_URL']);
    expect(formatInvalidConfigMessage(invalid)).not.toContain('no-verify');
  });

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED=0 in staging by name', () => {
    expect(
      invalidOf({ ...stagingBase, DB_SSL_CA: pki.caPem, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
    ).toEqual(['NODE_TLS_REJECT_UNAUTHORIZED']);
  });

  it('reports a bad CA by name and never echoes the CA text, the key or the URL', () => {
    const badCa = `${pki.caPem}${pki.serverKeyPem}`;
    const invalid = invalidOf({ ...stagingBase, DB_SSL_CA: badCa });
    expect(invalid).toEqual(['DB_SSL_CA']);
    const message = formatInvalidConfigMessage(invalid);
    expect(message).not.toContain('PRIVATE KEY');
    expect(message).not.toContain((pki.caPem.split('\n')[1] ?? 'x').slice(0, 30));
    expect(message).not.toContain(SECRET);
  });

  it('does not report TLS problems twice when the URL itself is invalid', () => {
    expect(invalidOf({ ...stagingBase, DATABASE_URL: 'not a url', DB_SSL_CA: pki.caPem })).toEqual([
      'DATABASE_URL',
    ]);
  });

  it('reads the CA from a file variable and refuses an unreadable one by name', () => {
    expect(
      invalidOf({ ...stagingBase, DB_SSL_CA_FILE: '/definitely/not/a/real/file/ca.crt' }),
    ).toEqual(['DB_SSL_CA_FILE']);
  });

  it('does not let a missing APP_ENV hide behind the TLS check', () => {
    expect(invalidOf({ DATABASE_URL: stagingBase.DATABASE_URL })).toEqual(['APP_ENV']);
  });
});
