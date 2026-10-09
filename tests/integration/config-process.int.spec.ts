import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  FIXTURE_K1_BASE64,
  FIXTURE_K2_BASE64,
  FIXTURE_KEYRING_ENV,
} from '../../apps/backend/src/crypto/test-keys.fixture';
import { createTestPki } from '../../apps/backend/src/database/test-tls.fixture';
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

  // C16-A0: the new transaction/timeout/keyring configuration is validated at startup by the same
  // real entry point. A child process that needs a key gets the fixture keyring explicitly from the
  // test; nothing here depends on a key in the parent environment.
  describe('M00-C1A0 configuration', () => {
    const base = { APP_ENV: 'test', DATABASE_URL: validUrl };

    it('exits nonzero when the client query timeout is not larger than the server statement timeout', () => {
      const result = startMain({
        ...base,
        DB_QUERY_TIMEOUT_MS: '800',
        DB_STATEMENT_TIMEOUT_MS: '800',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DB_QUERY_TIMEOUT_MS');
      expect(result.stderr).toContain('DB_STATEMENT_TIMEOUT_MS');
      expect(result.stderr).not.toContain('DATABASE_URL');
      expect(result.stderr).not.toContain(SECRET);
    });

    it('exits nonzero when the transaction timeout is not larger than the statement timeout', () => {
      const result = startMain({
        ...base,
        DB_TRANSACTION_TIMEOUT_MS: '700',
        DB_STATEMENT_TIMEOUT_MS: '800',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DB_TRANSACTION_TIMEOUT_MS');
      expect(result.stderr).toContain('DB_STATEMENT_TIMEOUT_MS');
    });

    it('exits nonzero for an out-of-range idle-in-transaction timeout and names only it', () => {
      const result = startMain({ ...base, DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '5' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS');
      expect(result.stderr).not.toContain('DB_STATEMENT_TIMEOUT_MS');
    });

    it('exits nonzero for a malformed keyring, names only CRYPTO_KEYRING and prints no key material', () => {
      const result = startMain({
        ...base,
        // Two entries with the same id: a real key value inside an invalid keyring.
        CRYPTO_KEYRING: `k1:${FIXTURE_K1_BASE64},k1:${FIXTURE_K2_BASE64}`,
        CRYPTO_ACTIVE_KEY_ID: 'k1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CRYPTO_KEYRING');
      expect(result.stderr).not.toContain('CRYPTO_ACTIVE_KEY_ID');
      for (const output of [result.stderr, result.stdout]) {
        expect(output).not.toContain(FIXTURE_K1_BASE64);
        expect(output).not.toContain(FIXTURE_K2_BASE64);
        expect(output).not.toContain(SECRET);
      }
    });

    it('exits nonzero when the active key id is not in the keyring and names only CRYPTO_ACTIVE_KEY_ID', () => {
      const result = startMain({
        ...base,
        CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
        CRYPTO_ACTIVE_KEY_ID: 'ACTIVE_ID_MARKER_9z',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CRYPTO_ACTIVE_KEY_ID');
      expect(result.stderr).not.toContain('CRYPTO_KEYRING');
      expect(result.stderr).not.toContain('ACTIVE_ID_MARKER_9z');
      expect(result.stderr).not.toContain(FIXTURE_K1_BASE64);
    });

    it('does not mention a VALID keyring when some other variable is the problem', () => {
      const result = startMain({
        ...base,
        PORT: 'not-a-port',
        CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
        CRYPTO_ACTIVE_KEY_ID: 'k1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PORT');
      expect(result.stderr).not.toContain('CRYPTO');
      expect(result.stderr).not.toContain(FIXTURE_K1_BASE64);
      expect(result.stdout).not.toContain(FIXTURE_K2_BASE64);
    });
  });

  // C16/C23-A1: idempotency TTL and lock settings, and the keyring requirement where the executor
  // is wired, through real child processes. Only variable NAMES are ever printed.
  describe('M00-C1A1 configuration', () => {
    const base = { APP_ENV: 'test', DATABASE_URL: validUrl };
    const WIRED_CLI = path.join(__dirname, 'support', 'wired-startup-cli.js');

    function startWired(env: Record<string, string | undefined>) {
      return spawnSync(process.execPath, [WIRED_CLI], {
        env: minimalChildEnv(env),
        encoding: 'utf8',
        timeout: 30_000,
      });
    }

    const invalidCases: ReadonlyArray<readonly [string, Record<string, string>, readonly string[]]> = [
      ['advisory wait 0', { IDEMPOTENCY_ADVISORY_WAIT_MS: '0' }, ['IDEMPOTENCY_ADVISORY_WAIT_MS']],
      ['advisory wait above 5 s', { IDEMPOTENCY_ADVISORY_WAIT_MS: '5001' }, ['IDEMPOTENCY_ADVISORY_WAIT_MS']],
      ['advisory wait not a number', { IDEMPOTENCY_ADVISORY_WAIT_MS: 'soon' }, ['IDEMPOTENCY_ADVISORY_WAIT_MS']],
      ['business budget 0', { IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS: '0' }, ['IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS']],
      ['replay TTL 0', { IDEMPOTENCY_REPLAY_TTL_SECONDS: '0' }, ['IDEMPOTENCY_REPLAY_TTL_SECONDS']],
      ['dedupe TTL above 7 days', { IDEMPOTENCY_DEDUPE_TTL_SECONDS: '604801' }, ['IDEMPOTENCY_DEDUPE_TTL_SECONDS']],
      [
        'replay TTL above dedupe TTL',
        { IDEMPOTENCY_REPLAY_TTL_SECONDS: '1000', IDEMPOTENCY_DEDUPE_TTL_SECONDS: '999' },
        ['IDEMPOTENCY_REPLAY_TTL_SECONDS', 'IDEMPOTENCY_DEDUPE_TTL_SECONDS'],
      ],
      [
        'advisory wait not below the statement timeout',
        { IDEMPOTENCY_ADVISORY_WAIT_MS: '800', DB_STATEMENT_TIMEOUT_MS: '800', DB_QUERY_TIMEOUT_MS: '1500', DB_TRANSACTION_TIMEOUT_MS: '2000' },
        ['IDEMPOTENCY_ADVISORY_WAIT_MS', 'DB_STATEMENT_TIMEOUT_MS'],
      ],
    ];
    for (const [label, env, named] of invalidCases) {
      it(`exits nonzero for ${label}, names ${named.join(' + ')} and prints no value`, () => {
        const result = startMain({ ...base, ...env });
        expect(result.status).toBe(1);
        for (const name of named) {
          expect(result.stderr).toContain(name);
        }
        expect(result.stderr).not.toContain('DATABASE_URL');
        for (const value of Object.values(env)) {
          expect(result.stderr).not.toContain(`=${value}`);
        }
        expect(result.stderr).not.toContain(SECRET);
        expect(result.stdout).not.toContain(SECRET);
      });
    }

    it('where the executor is wired, a missing keyring stops startup nonzero naming only the two keyring variables', () => {
      const result = startWired({ ...base });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CRYPTO_KEYRING');
      expect(result.stderr).toContain('CRYPTO_ACTIVE_KEY_ID');
      expect(result.stderr).not.toContain('DATABASE_URL');
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain('WIRED_STARTUP_OK');
    });

    it('where the executor is wired, a valid keyring lets startup complete and prints no key material', () => {
      const result = startWired({ ...base, CRYPTO_KEYRING: FIXTURE_KEYRING_ENV, CRYPTO_ACTIVE_KEY_ID: 'k1' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('WIRED_STARTUP_OK');
      for (const output of [result.stdout, result.stderr]) {
        expect(output).not.toContain(FIXTURE_K1_BASE64);
        expect(output).not.toContain(FIXTURE_K2_BASE64);
        expect(output).not.toContain(SECRET);
      }
    });

    it('the plain server (idempotency not wired) still starts configuration checks without requiring a keyring', () => {
      // An invalid PORT is reported alone: the absence of a keyring is not an error for AppModule.
      const result = startMain({ ...base, PORT: 'not-a-port' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PORT');
      expect(result.stderr).not.toContain('CRYPTO');
    });
  });
});

// M00-D1 — the real compiled entry point fails closed on database TLS. Every case is invalid, so it exits at
// configuration time: no database is contacted and the server never starts.
describe('M00-D1 — database TLS stops the process and leaks nothing', () => {
  const SECRET = 'SECRET_MARKER_D1_TLS_5e92';
  const url = `postgres://ship11_app.projref:${SECRET}@pooler.example.test:5432/postgres`;
  const ca = createTestPki().caPem;
  const staging = { APP_ENV: 'staging', NODE_ENV: 'production', DATABASE_URL: url };

  it.each(['staging', 'production'])(
    'exits nonzero in APP_ENV=%s without a CA and names only the two CA variables',
    (appEnv) => {
      const result = startMain({ ...staging, APP_ENV: appEnv });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DB_SSL_CA');
      expect(result.stderr).toContain('DB_SSL_CA_FILE');
      // Fails at configuration, before the OTP gate and before anything is opened.
      expect(result.stderr).not.toContain('OTP_PROVIDER');
      expect(result.stderr).not.toContain('DATABASE_URL');
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain(SECRET);
      expect(result.stdout).not.toContain('server_listening');
    },
  );

  it('exits nonzero when the URL carries sslmode=no-verify, naming DATABASE_URL and echoing nothing', () => {
    const result = startMain({ ...staging, DB_SSL_CA: ca, DATABASE_URL: `${url}?sslmode=no-verify` });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('no-verify');
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain('server_listening');
  });

  it('exits nonzero when NODE_TLS_REJECT_UNAUTHORIZED=0 would switch verification off', () => {
    const result = startMain({ ...staging, DB_SSL_CA: ca, NODE_TLS_REJECT_UNAUTHORIZED: '0' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(result.stderr).not.toContain(SECRET);
  });

  it('exits nonzero for a CA that is not a certificate and never prints it', () => {
    const result = startMain({ ...staging, DB_SSL_CA: `${ca}${createTestPki().serverKeyPem}` });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DB_SSL_CA');
    expect(result.stderr).not.toContain('PRIVATE KEY');
    expect(result.stderr).not.toContain((ca.split('\n')[1] ?? 'x').slice(0, 30));
  });

  it('exits nonzero for an unreadable CA file without printing its path', () => {
    const result = startMain({ ...staging, DB_SSL_CA_FILE: '/definitely/not/here/SECRET_PATH_MARKER.crt' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DB_SSL_CA_FILE');
    expect(result.stderr).not.toContain('SECRET_PATH_MARKER');
  });
});
