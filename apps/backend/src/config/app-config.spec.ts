import { describe, expect, it } from '@jest/globals';
import { formatInvalidConfigMessage, loadConfig } from './app-config';

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
    });
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
});
