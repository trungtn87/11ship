import { describe, expect, it } from '@jest/globals';
import { formatInvalidConfigMessage, loadConfig } from './app-config';
import {
  FIXTURE_K1_BASE64,
  FIXTURE_K2_BASE64,
  FIXTURE_KEYRING_ENV,
} from '../crypto/test-keys.fixture';

const SECRET = 'SECRET_MARKER_CONFIG_7f3a';
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
    expect(invalidOf({ APP_ENV: 'production' })).toEqual(['DATABASE_URL']);
  });

  it('rejects a missing or unknown APP_ENV', () => {
    expect(invalidOf({ DATABASE_URL: validEnv.DATABASE_URL })).toEqual(['APP_ENV']);
    expect(invalidOf({ ...validEnv, APP_ENV: 'prod' })).toEqual(['APP_ENV']);
    expect(invalidOf({ ...validEnv, APP_ENV: '' })).toEqual(['APP_ENV']);
  });

  it.each(['development', 'staging', 'production', 'test'])('accepts APP_ENV=%s', (value) => {
    expect(loadConfig({ ...validEnv, APP_ENV: value }).ok).toBe(true);
  });

  it('rejects NODE_ENV=staging while still allowing APP_ENV=staging', () => {
    expect(invalidOf({ ...validEnv, NODE_ENV: 'staging' })).toEqual(['NODE_ENV']);
    expect(loadConfig({ ...validEnv, APP_ENV: 'staging', NODE_ENV: 'production' }).ok).toBe(true);
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
