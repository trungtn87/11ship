import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// F03 — migrate up twice on the test database. The migration history table is kept in a random
// schema owned by this test, so cleanup only ever drops that schema.
describe('F03 — migrations apply once and stay consistent', () => {
  const historySchema = `mig_${randomBytes(6).toString('hex')}`;
  const upgradeHistorySchema = `mig_${randomBytes(6).toString('hex')}`;
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const expectedNames = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.replace(/\.sql$/, ''))
    .sort();

  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  function migrate(
    schema = historySchema,
    extraArgs: string[] = [],
  ): ReturnType<typeof runNpmScript> {
    return runNpmScript(
      'db:migrate',
      ['--migrations-schema', schema, '--create-migrations-schema', ...extraArgs],
      minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }),
    );
  }

  async function historyNames(): Promise<string[]> {
    const result = await client.query<{ name: string }>(
      `SELECT name FROM ${historySchema}.pgmigrations ORDER BY id`,
    );
    return result.rows.map((row) => row.name);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    // This suite runs only after the global target guard has verified the disposable ship11_test
    // database/user. Reset the application schema so F03 proves a clean install with its own
    // migration history instead of relying on the CI smoke migration history.
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
  });

  afterAll(async () => {
    // Only the random schema created by this test is removed.
    if (/^mig_[0-9a-f]{12}$/.test(historySchema)) {
      await client.query(`DROP SCHEMA IF EXISTS ${historySchema} CASCADE`);
    }
    if (/^mig_[0-9a-f]{12}$/.test(upgradeHistorySchema)) {
      await client.query(`DROP SCHEMA IF EXISTS ${upgradeHistorySchema} CASCADE`);
    }
    await client.end();
  });

  it('has at least one migration to apply', () => {
    expect(expectedNames.length).toBeGreaterThan(0);
  });

  it('applies every migration on the first run', async () => {
    const first = migrate();
    expect(first.status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);

    const baseSchema = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'",
    );
    expect(baseSchema.rowCount).toBe(1);
    const idempotency = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'idempotency_records'",
    );
    expect(idempotency.rowCount).toBe(1);
  });

  it('does not apply anything twice on the second run', async () => {
    const before = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM ${historySchema}.pgmigrations ORDER BY id`,
    );

    const second = migrate();
    expect(second.status).toBe(0);

    const after = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM ${historySchema}.pgmigrations ORDER BY id`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(await historyNames()).toEqual(expectedNames);
  });

  it('upgrades the B1-only schema to C1A1 with the same migration history', async () => {
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');

    const baseOnly = migrate(upgradeHistorySchema, ['--count', '1']);
    expect(baseOnly.status).toBe(0);
    const before = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'idempotency_records'",
    );
    expect(before.rowCount).toBe(0);

    const upgrade = migrate(upgradeHistorySchema);
    expect(upgrade.status).toBe(0);
    const after = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'idempotency_records'",
    );
    expect(after.rowCount).toBe(1);
  });

});
