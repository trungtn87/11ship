import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { REPO_ROOT } from './support/test-helpers';

// M00-D1: what `npm run db:migrate:remote` relies on from PostgreSQL and node-pg-migrate, proven on the guarded
// test database. The remote command itself cannot run in CI (no TLS database, no Supabase), so its two moving
// parts are exercised directly: the SQL that reads the migration history, and the node-pg-migrate runner call on
// an already-connected client. Nothing here leaves a change behind: the runner has nothing to apply on the fully
// migrated database, and every history edit is rolled back.
interface MigrationState {
  files: string[];
  applied: string[];
  pending: string[];
  unknownApplied: string[];
}
interface RemoteMigrationScript {
  readMigrationState(client: Client, dir?: string, schema?: string): Promise<MigrationState>;
  schemaExists(client: Client, schema?: string): Promise<boolean>;
  defaultRunMigrations(options: {
    client: Client;
    dir: string;
    log: (message: unknown) => void;
    schema?: string;
  }): Promise<unknown[]>;
  listMigrationFiles(dir?: string): string[];
  MIGRATIONS_SCHEMA: string;
}

const nodeRequire = createRequire(__filename);
const script = nodeRequire(path.join(REPO_ROOT, 'scripts', 'db-migrate-remote.js')) as RemoteMigrationScript;
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');
// The remote command keeps its history in the "app" schema. The guarded test database was migrated by
// `npm run db:migrate`, which uses node-pg-migrate's default (public.pgmigrations), so these tests point the same
// code at that schema. The schema is a parameter of the code under test, not a different code path.
const HISTORY_SCHEMA = 'public';

describe('M00-D1 — the remote migration path against a real PostgreSQL', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await assertTestDatabaseTarget(client); // never touch anything before the guard has passed
  });

  afterAll(async () => {
    await client.end();
  });

  it('reads the real history: every migration file applied, nothing pending, nothing unknown', async () => {
    const state = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(state.files.length).toBeGreaterThanOrEqual(7);
    expect(state.applied).toEqual(state.files);
    expect(state.pending).toEqual([]);
    expect(state.unknownApplied).toEqual([]);
  });

  it('defaults to the app schema for the remote history and can tell whether a schema exists', async () => {
    expect(script.MIGRATIONS_SCHEMA).toBe('app');
    expect(await script.schemaExists(client, 'app')).toBe(true);
    expect(await script.schemaExists(client, 'schema_that_does_not_exist_d1')).toBe(false);
    await expect(script.schemaExists(client, 'app; DROP SCHEMA app')).rejects.toThrow();
  });

  it('reports a migration as pending when the history is behind, and an unknown one when it is ahead', async () => {
    const { files } = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    const last = files[files.length - 1] as string;
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM public.pgmigrations WHERE name = $1', [last]);
      await client.query("INSERT INTO public.pgmigrations (name, run_on) VALUES ('999999999999999_from_another_branch', now())");
      const state = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
      expect(state.pending).toEqual([last]);
      expect(state.unknownApplied).toEqual(['999999999999999_from_another_branch']);
    } finally {
      await client.query('ROLLBACK');
    }
    const restored = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(restored.pending).toEqual([]);
  });

  it('reports everything as pending on a database without a history table', async () => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE public.pgmigrations RENAME TO pgmigrations_renamed_for_test');
      const state = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
      expect(state.applied).toEqual([]);
      expect(state.pending).toEqual(state.files);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('lets node-pg-migrate run on an already-connected client and finds nothing to do on a migrated database', async () => {
    const before = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    const messages: string[] = [];
    const ran = await script.defaultRunMigrations({
      client,
      dir: MIGRATIONS_DIR,
      log: (message) => messages.push(String(message)),
      schema: HISTORY_SCHEMA,
    });
    expect(ran).toEqual([]);
    const after = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(after.applied).toEqual(before.applied);
    // The client is still usable afterwards (the runner did not close a connection it does not own).
    const alive = await client.query<{ ok: number }>('SELECT 1 AS ok');
    expect(alive.rows[0]?.ok).toBe(1);
  });
});
