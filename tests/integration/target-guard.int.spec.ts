import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import {
  ALLOWED_TEST_DATABASE,
  ALLOWED_TEST_USER,
  assertTestDatabaseTarget,
  assertTestEnvironment,
  TestTargetError,
} from './support/assert-test-target';
import { GUARD_CLI, minimalChildEnv, withDatabaseName } from './support/test-helpers';

function runGuard(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [GUARD_CLI], {
    env: minimalChildEnv(env),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('F06 — test target guard (pure logic)', () => {
  it('rejects every APP_ENV other than test before touching any database', () => {
    for (const appEnv of ['development', 'staging', 'production', '', undefined]) {
      expect(() =>
        assertTestEnvironment({ APP_ENV: appEnv, DATABASE_URL: 'postgres://u:p@h/db' }),
      ).toThrow(TestTargetError);
    }
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => assertTestEnvironment({ APP_ENV: 'test' })).toThrow(TestTargetError);
  });

  it('accepts only the allowed database and user as reported by the server', async () => {
    const answer = (database: string, user: string) => ({
      query: async () => ({ rows: [{ database_name: database, user_name: user }] }),
    });

    await expect(
      assertTestDatabaseTarget(answer(ALLOWED_TEST_DATABASE, ALLOWED_TEST_USER)),
    ).resolves.toBeUndefined();
    await expect(assertTestDatabaseTarget(answer('postgres', ALLOWED_TEST_USER))).rejects.toThrow(
      TestTargetError,
    );
    await expect(assertTestDatabaseTarget(answer('ship11_dev', ALLOWED_TEST_USER))).rejects.toThrow(
      TestTargetError,
    );
    await expect(
      assertTestDatabaseTarget(answer(ALLOWED_TEST_DATABASE, 'postgres')),
    ).rejects.toThrow(TestTargetError);
    await expect(
      assertTestDatabaseTarget(answer(ALLOWED_TEST_DATABASE, 'ship11_dev')),
    ).rejects.toThrow(TestTargetError);
  });

  it('rejects an empty result instead of passing', async () => {
    await expect(assertTestDatabaseTarget({ query: async () => ({ rows: [] }) })).rejects.toThrow(
      TestTargetError,
    );
  });
});

describe('F06 — test target guard (real process and real database)', () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';

  it('passes for the real test database', () => {
    const result = runGuard({ APP_ENV: 'test', DATABASE_URL: databaseUrl });
    expect(result.status).toBe(0);
  });

  it('fails when APP_ENV is not test', () => {
    const result = runGuard({ APP_ENV: 'development', DATABASE_URL: databaseUrl });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TEST_TARGET_GUARD_FAILED');
    expect(result.stderr).toContain('APP_ENV=test');
  });

  it('fails before any DDL when the server reports a different database, whatever the URL suffix says', async () => {
    const otherUrl = withDatabaseName(databaseUrl, 'postgres');
    const result = runGuard({ APP_ENV: 'test', DATABASE_URL: otherUrl });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TEST_TARGET_GUARD_FAILED');
    expect(result.stderr).toContain('not the allowed test database');

    const password = decodeURIComponent(new URL(databaseUrl).password);
    if (password !== '') {
      expect(result.stderr).not.toContain(password);
      expect(result.stdout).not.toContain(password);
    }

    // The other database was not modified: the smoke migration schema must not exist there.
    const other = new Client({ connectionString: otherUrl, connectionTimeoutMillis: 3000 });
    await other.connect();
    try {
      const schemas = await other.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'",
      );
      expect(schemas.rowCount).toBe(0);
    } finally {
      await other.end();
    }
  });

  // Real wrong-user proof. It needs a second PostgreSQL login that can reach ship11_test but is not
  // ship11_test. CI creates one and passes it as TEST_WRONG_USER_DATABASE_URL. A plain local setup
  // (compose.dev.yml) does not have it, so only this one test is skipped there; the pure-logic
  // user-mismatch test above and every other test still run. CI asserts that this test is NOT skipped.
  const wrongUserUrl = process.env.TEST_WRONG_USER_DATABASE_URL ?? '';
  const itWithWrongUserFixture = wrongUserUrl === '' ? it.skip : it;

  itWithWrongUserFixture(
    'fails against the allowed database when the real PostgreSQL server user is outside the allowlist',
    async () => {
      // Precondition: this is the allowed database with a different real server user, not an auth
      // failure or a database-name mismatch.
      const probe = new Client({ connectionString: wrongUserUrl, connectionTimeoutMillis: 3000 });
      await probe.connect();
      try {
        const identity = await probe.query<{ database_name: string; user_name: string }>(
          'SELECT current_database() AS database_name, current_user AS user_name',
        );
        expect(identity.rows).toHaveLength(1);
        expect(identity.rows[0].database_name).toBe(ALLOWED_TEST_DATABASE);
        expect(identity.rows[0].user_name).not.toBe(ALLOWED_TEST_USER);
      } finally {
        await probe.end();
      }

      const result = runGuard({ APP_ENV: 'test', DATABASE_URL: wrongUserUrl });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('TEST_TARGET_GUARD_FAILED');
      expect(result.stderr).toContain('not the allowed test database and user');

      const password = decodeURIComponent(new URL(wrongUserUrl).password);
      expect(password).not.toBe('');
      expect(result.stderr).not.toContain(password);
      expect(result.stdout).not.toContain(password);
    },
  );
});
