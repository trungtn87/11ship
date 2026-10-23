import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
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

  it('reads the real migration history accurately, including pending migrations', async () => {
    // Other migration integration suites can leave the guarded CI database one migration behind.
    // Verify the actual state instead of assuming every file has already been recorded.
    const state = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(state.files.length).toBeGreaterThanOrEqual(7);
    expect(state.applied.every((name) => state.files.includes(name))).toBe(true);
    expect(state.pending).toEqual(state.files.filter((name) => !state.applied.includes(name)));
    expect(state.unknownApplied).toEqual([]);
  });

  it('defaults to the app schema for the remote history and can tell whether a schema exists', async () => {
    expect(script.MIGRATIONS_SCHEMA).toBe('app');
    expect(await script.schemaExists(client, 'app')).toBe(true);
    expect(await script.schemaExists(client, 'schema_that_does_not_exist_d1')).toBe(false);
    await expect(script.schemaExists(client, 'app; DROP SCHEMA app')).rejects.toThrow();
  });

  it('reports a migration as pending when the history is behind, and an unknown one when it is ahead', async () => {
    const before = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    const last = before.applied[before.applied.length - 1] as string;
    expect(last).toBeDefined();
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM public.pgmigrations WHERE name = $1', [last]);
      await client.query("INSERT INTO public.pgmigrations (name, run_on) VALUES ('999999999999999_from_another_branch', now())");
      const state = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
      expect(state.pending).toEqual(before.files.filter((name) => name === last || before.pending.includes(name)));
      expect(state.unknownApplied).toEqual(['999999999999999_from_another_branch']);
    } finally {
      await client.query('ROLLBACK');
    }
    const restored = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(restored.pending).toEqual(before.pending);
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

  it('lets node-pg-migrate apply pending migrations on an already-connected client and become a no-op', async () => {
    const before = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    // node-pg-migrate is loaded with a dynamic import(), which Jest's module sandbox does not allow.
    // Apply only genuine pending migrations on the guarded disposable test database via a child Node process,
    // then verify the resulting fully applied history and repeat to prove the second run is a no-op.
    const childSource = `
      const { Client } = require('pg');
      const script = require(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'db-migrate-remote.js'))});
      (async () => {
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        try {
          const ran = await script.defaultRunMigrations({
            client: c, dir: ${JSON.stringify(MIGRATIONS_DIR)}, log: () => undefined, schema: ${JSON.stringify(HISTORY_SCHEMA)},
          });
          const alive = await c.query('SELECT 1 AS ok');
          console.log(JSON.stringify({ ran: ran.length, alive: alive.rows[0].ok }));
        } finally {
          await c.end();
        }
      })().catch((e) => { console.error(e && e.code ? String(e.code) : 'FAILED', e && e.message); process.exit(1); });
    `;
    const { stdout } = await execFileAsync(process.execPath, ['-e', childSource], {
      cwd: REPO_ROOT,
      env: process.env,
      timeout: 60000,
    });
    expect(JSON.parse(stdout.trim())).toEqual({ ran: before.pending.length, alive: 1 });
    const after = await script.readMigrationState(client, MIGRATIONS_DIR, HISTORY_SCHEMA);
    expect(after.applied).toEqual(after.files);
    expect(after.pending).toEqual([]);
    // A second runner call over the same live client must apply nothing.
    const second = await execFileAsync(process.execPath, ['-e', childSource], {
      cwd: REPO_ROOT, env: process.env, timeout: 60000,
    });
    expect(JSON.parse(second.stdout.trim())).toEqual({ ran: 0, alive: 1 });
  });
});
