import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M00-D2 — the account_origin migration: a REAL upgrade over existing verified users, a no-op second up, a
// database that enforces the origin/verification pairing on its own, and a down that refuses to destroy a fixture.
//
// Like the other migration suites this one RESETS the guarded test database (after the target guard passed) and
// always leaves it fully migrated for the specs that follow.
describe('M00-D2 — account_origin migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const names = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => file.replace(/\.sql$/, ''));
  const ACCT = names.find((name) => name.endsWith('add-users-account-origin')) as string;
  const acctSql = readFileSync(path.join(migrationsDir, `${ACCT}.sql`), 'utf8');
  const downSql = acctSql.split('-- Down Migration')[1] as string;
  const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  function migrate(extra: string[] = []): ReturnType<typeof runNpmScript> {
    return runNpmScript('db:migrate', extra, minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }));
  }

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client);
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations');
  }

  async function historyNames(): Promise<string[]> {
    const result = await client.query<{ name: string }>('SELECT name FROM public.pgmigrations ORDER BY id');
    return result.rows.map((row) => row.name);
  }

  async function insertUser(phone: string, origin: string | undefined, verifiedAt: string | null): Promise<void> {
    const columns = ['user_id', 'phone_normalized', 'password_hash', 'phone_verified_at', 'created_at', 'updated_at'];
    const values: unknown[] = [randomUUID(), phone, HASH, verifiedAt];
    let sql = 'VALUES ($1::uuid, $2, $3, $4::timestamptz, clock_timestamp(), clock_timestamp()';
    if (origin !== undefined) {
      columns.push('account_origin');
      values.push(origin);
      sql += ', $5';
    }
    await client.query(`INSERT INTO app.users (${columns.join(', ')}) ${sql})`, values);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      const result = migrate();
      if (result.status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
      await client.query("DELETE FROM app.users WHERE phone_normalized LIKE '+8491100%'");
    } finally {
      await client.end();
    }
  });

  it('is the LAST migration and is new (applied migrations are never edited)', () => {
    expect(ACCT).toBeDefined();
    expect(names[names.length - 1]).toBe(ACCT);
    expect(names.filter((name) => name.endsWith('add-users-account-origin'))).toHaveLength(1);
  });

  it('a REAL upgrade keeps every existing verified user as PHONE_VERIFIED with its proof time and data untouched', async () => {
    await reset();
    expect(migrate([String(names.length - 1)]).status).toBe(0);
    expect(await historyNames()).toEqual(names.slice(0, -1));
    const before = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['app', 'users']);
    expect(before.rows.map((row: { column_name: string }) => row.column_name)).not.toContain('account_origin');

    await insertUser('+84911000001', undefined, '2026-01-02T03:04:05Z');
    await insertUser('+84911000002', undefined, '2026-02-03T04:05:06Z');
    const snapshot = await client.query(
      'SELECT user_id, phone_normalized, password_hash, phone_verified_at, status, version FROM app.users ORDER BY phone_normalized',
    );

    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);

    const after = await client.query(
      'SELECT user_id, phone_normalized, password_hash, phone_verified_at, status, version, account_origin FROM app.users ORDER BY phone_normalized',
    );
    expect(after.rows.map((row: { account_origin: string }) => row.account_origin)).toEqual(['PHONE_VERIFIED', 'PHONE_VERIFIED']);
    const withoutOrigin = after.rows.map((row: Record<string, unknown>) => {
      const copy = { ...row };
      delete copy.account_origin;
      return copy;
    });
    expect(withoutOrigin).toEqual(snapshot.rows);
  });

  it('a second up is a no-op (history rows untouched)', async () => {
    const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(migrate().status).toBe(0);
    const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  it('the column is NOT NULL, defaults to PHONE_VERIFIED, and only the two origins exist', async () => {
    const column = await client.query<{ is_nullable: string; column_default: string | null; udt_name: string }>(
      `SELECT is_nullable, column_default, udt_name FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'users' AND column_name = 'account_origin'`,
    );
    expect(column.rows[0]?.is_nullable).toBe('NO');
    expect(column.rows[0]?.column_default).toContain('PHONE_VERIFIED');
    const verifiedAt = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'users' AND column_name = 'phone_verified_at'`,
    );
    expect(verifiedAt.rows[0]?.is_nullable).toBe('YES');
    await expect(insertUser('+84911000010', 'SOMETHING_ELSE', null)).rejects.toMatchObject({ code: '23514' });
  });

  it('CHECK allows exactly the two valid combinations and rejects every wrong one', async () => {
    await insertUser('+84911000011', 'PHONE_VERIFIED', '2026-03-01T00:00:00Z');
    await insertUser('+84911000012', 'STAGING_FIXTURE', null);
    // A fixture can never carry a proof time, and a verified account can never lack one.
    await expect(insertUser('+84911000013', 'STAGING_FIXTURE', '2026-03-01T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
    await expect(insertUser('+84911000014', 'PHONE_VERIFIED', null)).rejects.toMatchObject({ code: '23514' });
    await expect(insertUser('+84911000015', undefined, null)).rejects.toMatchObject({ code: '23514' });
    // And an UPDATE cannot turn a fixture into a verified account without a proof time, or back.
    await expect(
      client.query("UPDATE app.users SET account_origin = 'PHONE_VERIFIED' WHERE phone_normalized = '+84911000012'"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query("UPDATE app.users SET phone_verified_at = NULL WHERE phone_normalized = '+84911000011'"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query("UPDATE app.users SET phone_verified_at = clock_timestamp() WHERE phone_normalized = '+84911000012'"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('down REFUSES while a fixture exists, changes nothing, and succeeds (as a rolled back transaction) once none does', async () => {
    await client.query('BEGIN');
    try {
      await client.query('SAVEPOINT refuse');
      await expect(client.query(downSql)).rejects.toMatchObject({ message: expect.stringContaining('staging fixture accounts exist') });
      await client.query('ROLLBACK TO SAVEPOINT refuse');
      const stillThere = await client.query("SELECT count(*)::int AS n FROM app.users WHERE account_origin = 'STAGING_FIXTURE'");
      expect(stillThere.rows[0]?.n).toBe(1);

      await client.query("DELETE FROM app.users WHERE account_origin = 'STAGING_FIXTURE'");
      await client.query(downSql);
      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'users' AND column_name IN ('account_origin', 'phone_verified_at')`,
      );
      expect(columns.rows).toEqual([{ column_name: 'phone_verified_at', is_nullable: 'NO' }]);
    } finally {
      await client.query('ROLLBACK');
    }
    const restored = await client.query("SELECT count(*)::int AS n FROM app.users WHERE account_origin = 'STAGING_FIXTURE'");
    expect(restored.rows[0]?.n).toBe(1);
  });
});
