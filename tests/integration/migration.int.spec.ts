import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget, assertTestTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// F03 (B1) and C23 (M00-C1A1): clean install, second `up` as a no-op, a REAL upgrade from the previous
// slice, drift that is not hidden, and the guard that keeps all of this on the test database only.
//
// The guarded database is the one place these migrations may run, so the tests RESET it (drop schema
// "app" and the default history table) after the target guard has verified database and user. The
// suite always leaves the database fully migrated, because later specs use app.idempotency_records.
describe('F03 / C23 — migrations on the guarded test database', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const expectedNames = files.map((file) => file.replace(/\.sql$/, ''));
  const B1 = expectedNames.find((name) => name.endsWith('create-app-schema')) as string;
  const C1A1 = expectedNames.find((name) => name.endsWith('create-idempotency-records')) as string;
  const idempotencySql = readFileSync(path.join(migrationsDir, `${C1A1}.sql`), 'utf8');

  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  function migrate(extra: string[] = []): ReturnType<typeof runNpmScript> {
    // Exactly what a developer has in local mode: APP_ENV and DATABASE_URL, no admin credential.
    return runNpmScript('db:migrate', extra, minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }));
  }

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client); // never DDL before the guard has passed
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations');
  }

  async function historyNames(): Promise<string[]> {
    const result = await client.query<{ name: string }>('SELECT name FROM public.pgmigrations ORDER BY id');
    return result.rows.map((row) => row.name);
  }

  async function tableExists(): Promise<boolean> {
    const result = await client.query("SELECT to_regclass('app.idempotency_records') IS NOT NULL AS present");
    return (result.rows[0] as { present: boolean }).present;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      // Leave the database migrated to the latest slice for every other spec.
      const result = migrate();
      if (result.status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
    } finally {
      await client.end();
    }
  });

  it('has the B1 and C1A1 migrations, in order', () => {
    expect(expectedNames.length).toBeGreaterThanOrEqual(2);
    expect(expectedNames.indexOf(B1)).toBeLessThan(expectedNames.indexOf(C1A1));
  });

  it('C23: clean install applies B1 + C1A1 and records both in the history', async () => {
    await reset();
    const first = migrate();
    expect(first.status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
    expect(await tableExists()).toBe(true);
  });

  it('C23: a second up with the same history is a no-op (nothing re-applied, history untouched)', async () => {
    const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    const second = migrate();
    expect(second.status).toBe(0);
    const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
    expect(await historyNames()).toEqual(expectedNames);
  });

  it('C23: a REAL upgrade from B1 to C1A1 (history holds only B1, then the next up adds the table)', async () => {
    await reset();
    const baseOnly = migrate(['--count', '1']);
    expect(baseOnly.status).toBe(0);
    expect(await historyNames()).toEqual([B1]);
    expect(await tableExists()).toBe(false);
    const schema = await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'");
    expect(schema.rowCount).toBe(1);

    const upgrade = migrate();
    expect(upgrade.status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
    expect(await tableExists()).toBe(true);
  });

  it('C23: schema drift is NOT hidden: a pre-existing conflicting table makes the migration fail and stay unrecorded', async () => {
    await reset();
    expect(migrate(['--count', '1']).status).toBe(0);
    await client.query('CREATE TABLE app.idempotency_records (drifted integer)');

    const failing = migrate();
    expect(failing.status).not.toBe(0);
    expect(await historyNames()).toEqual([B1]);
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'idempotency_records'`,
    );
    expect(columns.rows).toEqual([{ column_name: 'drifted' }]); // the drifted table was left alone

    await client.query('DROP TABLE app.idempotency_records');
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
  });

  it('C23: the migration has no blanket IF NOT EXISTS / IF EXISTS and the down migration is explicit', () => {
    const statements = idempotencySql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(idempotencySql).toMatch(/--\s*Down Migration[\s\S]*DROP TABLE app\.idempotency_records;/);
    // nothing outside the idempotency scope is created
    expect(statements).not.toMatch(/audit_logs|outbox_events|\busers\b|\bsessions\b/i);
  });

  it('C23: local mode needs only DATABASE_URL (no admin credential reaches the migration process)', () => {
    const env = minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl });
    expect(env.PGPASSWORD).toBeUndefined();
    expect(env.TEST_WRONG_USER_DATABASE_URL).toBeUndefined();
    expect(migrate().status).toBe(0);
  });

  it('C23: the test target guard still passes after the migrations, and the table belongs to the test role', async () => {
    await assertTestTarget(process.env);
    const owner = await client.query<{ owner: string }>(
      `SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = 'idempotency_records'`,
    );
    expect(owner.rows[0]?.owner).toBe('ship11_test');
  });

  describe('the migrated table matches the contract (drift detection)', () => {
    it('has exactly the documented constraints and indexes', async () => {
      const constraints = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'app.idempotency_records'::regclass AND contype IN ('p', 'u', 'c')
          ORDER BY conname`,
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual(
        [
          'idempotency_records_ciphertext_size_ck',
          'idempotency_records_fingerprint_ck',
          'idempotency_records_format_ck',
          'idempotency_records_guard_ck',
          'idempotency_records_identity_bounds_ck',
          'idempotency_records_iv_length_ck',
          'idempotency_records_key_format_ck',
          'idempotency_records_key_id_ck',
          'idempotency_records_ms_precision_ck',
          'idempotency_records_pkey',
          'idempotency_records_replay_all_or_none_ck',
          'idempotency_records_scope_key_uq',
          'idempotency_records_status_ck',
          'idempotency_records_tag_length_ck',
          'idempotency_records_ttl_ck',
        ].sort(),
      );
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'idempotency_records' ORDER BY indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'idempotency_records_dedupe_cleanup_idx',
        'idempotency_records_pkey',
        'idempotency_records_replay_cleanup_idx',
        'idempotency_records_scope_key_uq',
      ]);
    });

    const VALID: Record<string, string> = {
      record_id: 'gen_random_uuid()',
      scope_type: "'mig_test'",
      scope_id: "'s1'",
      operation_id: "'op'",
      idempotency_key: "'3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34'",
      request_fingerprint: "repeat('a', 64)",
      crypto_key_id: "'k1'",
      response_status: '201',
      replay_format_version: '1',
      replay_guard: "'{}'::jsonb",
      replay_ciphertext: "'\\x01'::bytea",
      replay_iv: "decode(repeat('00', 12), 'hex')",
      replay_tag: "decode(repeat('00', 16), 'hex')",
      created_at: "timestamptz '2030-01-01 00:00:00+00'",
      replay_expires_at: "timestamptz '2030-01-01 00:15:00+00'",
      dedupe_expires_at: "timestamptz '2030-01-08 00:00:00+00'",
    };

    async function attempt(overrides: Record<string, string>): Promise<{ code?: string; constraint?: string }> {
      const row = { ...VALID, ...overrides };
      const columns = Object.keys(row);
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO app.idempotency_records (${columns.join(', ')}) VALUES (${columns.map((column) => row[column]).join(', ')})`);
        return {};
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        return { code: failure.code, constraint: failure.constraint };
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('accepts a valid record and a valid tombstone', async () => {
      expect(await attempt({})).toEqual({});
      expect(await attempt({ replay_ciphertext: 'NULL', replay_iv: 'NULL', replay_tag: 'NULL' })).toEqual({});
    });

    const violations: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ['uppercase key', { idempotency_key: "'3F2B8C1E-9D4A-4B6F-8A21-5C7E0D9F1A34'" }, 'idempotency_records_key_format_ck'],
      ['nil UUID key', { idempotency_key: "'00000000-0000-0000-0000-000000000000'" }, 'idempotency_records_key_format_ck'],
      ['empty scope id', { scope_id: "''" }, 'idempotency_records_identity_bounds_ck'],
      ['short fingerprint', { request_fingerprint: "repeat('a', 63) || ' '" }, 'idempotency_records_fingerprint_ck'],
      ['bad key id', { crypto_key_id: "'bad key'" }, 'idempotency_records_key_id_ck'],
      ['status 500', { response_status: '500' }, 'idempotency_records_status_ck'],
      ['format version 2', { replay_format_version: '2' }, 'idempotency_records_format_ck'],
      ['guard is an array', { replay_guard: "'[]'::jsonb" }, 'idempotency_records_guard_ck'],
      ['only the tag NULL', { replay_tag: 'NULL' }, 'idempotency_records_replay_all_or_none_ck'],
      ['11-byte IV', { replay_iv: "decode(repeat('00', 11), 'hex')" }, 'idempotency_records_iv_length_ck'],
      ['15-byte tag', { replay_tag: "decode(repeat('00', 15), 'hex')" }, 'idempotency_records_tag_length_ck'],
      ['empty ciphertext', { replay_ciphertext: "''::bytea" }, 'idempotency_records_ciphertext_size_ck'],
      ['microsecond precision', { replay_expires_at: "timestamptz '2030-01-01 00:15:00.000001+00'" }, 'idempotency_records_ms_precision_ck'],
      ['replay TTL below 1 s', { replay_expires_at: "timestamptz '2030-01-01 00:00:00.999+00'" }, 'idempotency_records_ttl_ck'],
      ['replay after dedupe', { dedupe_expires_at: "timestamptz '2030-01-01 00:10:00+00'" }, 'idempotency_records_ttl_ck'],
      ['dedupe above 7 days', { dedupe_expires_at: "timestamptz '2030-01-08 00:00:01+00'" }, 'idempotency_records_ttl_ck'],
    ];
    for (const [label, overrides, constraint] of violations) {
      it(`refuses ${label} (${constraint})`, async () => {
        const outcome = await attempt(overrides);
        expect(outcome.code).toBe('23514');
        expect(outcome.constraint).toBe(constraint);
      });
    }

    it('refuses a duplicate of the exact tuple (UNIQUE) and a NULL in any identity column', async () => {
      await client.query('BEGIN');
      try {
        const columns = Object.keys(VALID);
        const insert = `INSERT INTO app.idempotency_records (${columns.join(', ')}) VALUES (${columns.map((column) => VALID[column]).join(', ')})`;
        await client.query(insert);
        await client.query('SAVEPOINT duplicate');
        let code: string | undefined;
        try {
          await client.query(insert);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe('23505');
        await client.query('ROLLBACK TO SAVEPOINT duplicate');
      } finally {
        await client.query('ROLLBACK');
      }
      expect((await attempt({ scope_id: 'NULL' })).code).toBe('23502');
    });
  });
});
