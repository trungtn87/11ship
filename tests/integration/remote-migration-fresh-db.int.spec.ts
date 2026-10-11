import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { REPO_ROOT } from './support/test-helpers';

// M00-D1 — the remote migration path end to end, on a DISPOSABLE PostgreSQL 17 database (never Supabase).
//
// It needs a fixture that only CI creates (see .github/workflows/ci.yml, "Create restricted test role..."): an empty
// database `ship11_remote_path_test` on the throwaway service container, two NON-superuser roles, and schema `app`
// created by the admin AUTHORIZATION the migrator role, exactly as ops/runbooks/render-supabase-staging.md §3 says.
// Without TEST_REMOTE_PATH_DATABASE_URL (a plain local setup) the whole block is skipped, like the wrong-user test;
// CI asserts that it is NOT skipped.
//
// What it proves, with the real node-pg-migrate runner on the real migrations:
//   - the migrator (not a superuser) applies every migration into schema app, history in app.pgmigrations;
//   - nothing is created in schema public (Supabase's exposed schema), in particular no public.pgmigrations;
//   - a second run finds nothing to do;
//   - the per-table runtime grants in the runbook match the tables the migrations really create, and the runtime role
//     cannot touch the migration history.

const MIGRATOR_URL = process.env.TEST_REMOTE_PATH_DATABASE_URL ?? '';
const RUNTIME_URL = process.env.TEST_REMOTE_PATH_RUNTIME_URL ?? '';
const ALLOWED_DATABASE = 'ship11_remote_path_test';
const MIGRATOR_ROLE = 'ship11_remote_migrator';
const RUNTIME_ROLE = 'ship11_remote_app';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

interface MigrationState {
  files: string[];
  applied: string[];
  pending: string[];
  unknownApplied: string[];
}
interface RemoteMigrationScript {
  readMigrationState(client: Client, dir?: string, schema?: string): Promise<MigrationState>;
  schemaExists(client: Client, schema?: string): Promise<boolean>;
  MIGRATIONS_SCHEMA: string;
}

const execFileAsync = promisify(execFile);
const script = createRequire(__filename)(path.join(REPO_ROOT, 'scripts', 'db-migrate-remote.js')) as RemoteMigrationScript;
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');

/** The disposable target only: loopback host, the fixed database, the fixed role. Anything else stops the suite. */
function assertDisposableUrl(raw: string, role: string): void {
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!LOOPBACK_HOSTS.has(url.hostname) || database !== ALLOWED_DATABASE || decodeURIComponent(url.username) !== role) {
    throw new Error(`Refusing to run: the remote-path fixture must be ${role}@loopback/${ALLOWED_DATABASE}.`);
  }
}

/** Table -> privileges, read from the runbook table so the document and the migrations cannot drift apart silently. */
function readRunbookGrants(): Map<string, string[]> {
  const text = readFileSync(path.join(REPO_ROOT, 'ops', 'runbooks', 'render-supabase-staging.md'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Table | Privileges'));
  if (start < 0) {
    throw new Error('runbook grants table not found');
  }
  const grants = new Map<string, string[]>();
  for (const line of lines.slice(start + 2)) {
    const match = /^\| ([a-z_]+) \| ([^|]+) \|$/.exec(line);
    if (match === null) {
      break;
    }
    const [, table, cell] = match;
    const privileges = (cell?.split('(')[0] ?? '').match(/SELECT|INSERT|UPDATE|DELETE/g) ?? [];
    if (table === undefined || privileges.length === 0) {
      throw new Error('unreadable runbook grants row');
    }
    grants.set(table, privileges);
  }
  return grants;
}

const describeWithFixture = MIGRATOR_URL === '' || RUNTIME_URL === '' ? describe.skip : describe;

describeWithFixture('M00-D1 — remote migration path on a fresh disposable PostgreSQL 17 (app.pgmigrations)', () => {
  let migrator: Client;
  let runtime: Client;

  beforeAll(async () => {
    assertDisposableUrl(MIGRATOR_URL, MIGRATOR_ROLE);
    assertDisposableUrl(RUNTIME_URL, RUNTIME_ROLE);
    migrator = new Client({ connectionString: MIGRATOR_URL, connectionTimeoutMillis: 3000 });
    await migrator.connect();
    runtime = new Client({ connectionString: RUNTIME_URL, connectionTimeoutMillis: 3000 });
    await runtime.connect();
    // Server-reported identity, before anything is changed.
    const identity = await migrator.query<{ db: string; usr: string; super: boolean; version: number }>(
      "SELECT current_database() AS db, current_user AS usr, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, current_setting('server_version_num')::int AS version",
    );
    const row = identity.rows[0];
    if (row?.db !== ALLOWED_DATABASE || row.usr !== MIGRATOR_ROLE || row.super !== false || row.version < 170000) {
      throw new Error('Refusing to run: the fixture is not the disposable PostgreSQL 17 database with a non-superuser migrator.');
    }
  });

  afterAll(async () => {
    await runtime.end();
    await migrator.end();
  });

  it('starts from the runbook preparation: schema app owned by the migrator, empty; nothing in public', async () => {
    expect(await script.schemaExists(migrator)).toBe(true);
    const owner = await migrator.query<{ owner: string }>(
      "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'app'",
    );
    expect(owner.rows[0]?.owner).toBe(MIGRATOR_ROLE);
    const objects = await migrator.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname IN ('app', 'public')",
    );
    expect(objects.rows[0]?.n).toBe('0');
  });

  it('applies every migration as the non-superuser migrator, with the history in app.pgmigrations only', async () => {
    const before = await script.readMigrationState(migrator, MIGRATIONS_DIR);
    expect(before.applied).toEqual([]);
    expect(before.pending).toEqual(before.files);
    expect(before.files.length).toBeGreaterThanOrEqual(7);

    // node-pg-migrate loads with a dynamic import(), which Jest's module sandbox does not allow, so the runner
    // runs in a plain Node child process against the same disposable database. It prints only counts.
    const { stdout } = await runRunnerInChild(MIGRATOR_URL);
    const outcome = JSON.parse(stdout.trim()) as { ran: number };
    expect(outcome.ran).toBe(before.files.length);

    const after = await script.readMigrationState(migrator, MIGRATIONS_DIR);
    expect(after.applied).toEqual(after.files);
    expect(after.pending).toEqual([]);
    expect(after.unknownApplied).toEqual([]);

    // Catalog lookup, not to_regclass('public....'): the fixture revokes USAGE on public, as the runbook does.
    const history = await migrator.query<{ schema_name: string }>(
      "SELECT s.nspname AS schema_name FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE c.relname = 'pgmigrations' AND c.relkind = 'r'",
    );
    expect(history.rows.map((row) => row.schema_name)).toEqual(['app']);

    const publicObjects = await migrator.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public'",
    );
    expect(publicObjects.rows[0]?.n).toBe('0');

    const tables = await migrator.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const names = tables.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(['users', 'sessions', 'shops', 'drivers', 'idempotency_records', 'outbox_events', 'audit_logs']));
  });

  it('finds nothing to do on a second run', async () => {
    const before = await script.readMigrationState(migrator, MIGRATIONS_DIR);
    const { stdout } = await runRunnerInChild(MIGRATOR_URL);
    expect((JSON.parse(stdout.trim()) as { ran: number }).ran).toBe(0);
    const after = await script.readMigrationState(migrator, MIGRATIONS_DIR);
    expect(after.applied).toEqual(before.applied);
    expect(after.pending).toEqual([]);
  });

  it('runbook per-table grants cover exactly the tables the migrations create, and the runtime role cannot touch the history', async () => {
    const grants = readRunbookGrants();
    const tables = await migrator.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE' AND table_name <> 'pgmigrations' ORDER BY table_name",
    );
    expect([...grants.keys()].sort()).toEqual(tables.rows.map((row) => row.table_name));

    // Before any grant the runtime role has nothing in app.
    await expect(runtime.query('SELECT 1 FROM app.users LIMIT 1')).rejects.toMatchObject({ code: '42501' });

    for (const [table, privileges] of grants) {
      await migrator.query(`GRANT ${privileges.join(', ')} ON app.${table} TO ${RUNTIME_ROLE}`);
    }

    // Runtime can read what the grants say, cannot read the history, and audit_logs is insert-only.
    await expect(runtime.query('SELECT 1 FROM app.users LIMIT 1')).resolves.toBeDefined();
    await expect(runtime.query('SELECT 1 FROM app.pgmigrations LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('SELECT 1 FROM app.audit_logs LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    const privilege = await migrator.query<{ ins: boolean; del: boolean; hist: boolean }>(
      `SELECT has_table_privilege($1, 'app.audit_logs', 'INSERT') AS ins,
              has_table_privilege($1, 'app.users', 'DELETE') AS del,
              has_table_privilege($1, 'app.pgmigrations', 'SELECT') AS hist`,
      [RUNTIME_ROLE],
    );
    expect(privilege.rows[0]).toEqual({ ins: true, del: false, hist: false });
    await expect(runtime.query('CREATE TABLE app.runtime_must_not_create (id int)')).rejects.toMatchObject({ code: '42501' });

    // M01.02 — the effective privileges of the REAL restricted runtime role on EVERY table equal the runbook row: the
    // new customer tables get exactly what the matrix says, and no other table (the administration ones included)
    // gained anything.
    const kinds = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
    for (const [table, privileges] of grants) {
      const effective = await migrator.query<{ kind: string; granted: boolean }>(
        `SELECT k AS kind, has_table_privilege($1, 'app.' || $2, k) AS granted FROM unnest($3::text[]) AS k ORDER BY k`,
        [RUNTIME_ROLE, table, kinds],
      );
      const granted = effective.rows.filter((row) => row.granted).map((row) => row.kind);
      expect([table, granted]).toEqual([table, kinds.filter((kind) => privileges.includes(kind)).sort()]);
    }

    // M01.02 — what the runtime may do with the customer tables, as the runtime role itself.
    const userId = '0192b1c0-0000-4000-8000-00000000f102';
    try {
      await migrator.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
                                created_at, updated_at)
         VALUES ($1::uuid, '+84900000102', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
        [userId],
      );
      await runtime.query('INSERT INTO app.customer_profiles (user_id) VALUES ($1::uuid)', [userId]);
      await expect(
        runtime.query('SELECT user_id, version FROM app.customer_profiles WHERE user_id = $1::uuid FOR UPDATE', [userId]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        runtime.query(
          `UPDATE app.customer_profiles SET full_name = 'Nguyen Van A', version = version + 1, updated_at = clock_timestamp()
            WHERE user_id = $1::uuid AND version = 1`,
          [userId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(runtime.query('DELETE FROM app.customer_profiles WHERE user_id = $1::uuid', [userId])).rejects.toMatchObject({
        code: '42501',
      });

      await runtime.query(
        `INSERT INTO app.user_consents (id, user_id, terms_version, privacy_version, accepted_at, client_app)
         VALUES ('0192b1c0-0000-4000-8000-00000000f103'::uuid, $1::uuid, 'terms-1', 'privacy-1', clock_timestamp(), 'FOOD')`,
        [userId],
      );
      await expect(runtime.query('SELECT id FROM app.user_consents WHERE user_id = $1::uuid', [userId])).resolves.toMatchObject({
        rowCount: 1,
      });
      await expect(
        runtime.query("UPDATE app.user_consents SET client_app = 'SHIP' WHERE user_id = $1::uuid", [userId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('DELETE FROM app.user_consents WHERE user_id = $1::uuid', [userId])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(runtime.query('TRUNCATE app.user_consents')).rejects.toMatchObject({ code: '42501' });
      // Out of scope: DDL on the new tables and any change of the administration tables stay denied.
      await expect(runtime.query('ALTER TABLE app.user_consents DISABLE TRIGGER user_consents_immutable')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(runtime.query('DROP TABLE app.customer_profiles')).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('DELETE FROM app.admin_memberships')).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('UPDATE app.admin_app_permissions SET user_id = user_id')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await migrator.query('TRUNCATE app.user_consents');
      await migrator.query('DELETE FROM app.customer_profiles WHERE user_id = $1::uuid', [userId]);
      await migrator.query('DELETE FROM app.users WHERE user_id = $1::uuid', [userId]);
    }
  });
});

async function runRunnerInChild(databaseUrl: string): Promise<{ stdout: string }> {
  const source = `
    const { Client } = require('pg');
    const script = require(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'db-migrate-remote.js'))});
    (async () => {
      const c = new Client({ connectionString: process.env.REMOTE_PATH_URL });
      await c.connect();
      try {
        const ran = await script.defaultRunMigrations({ client: c, dir: ${JSON.stringify(MIGRATIONS_DIR)}, log: () => undefined });
        console.log(JSON.stringify({ ran: ran.length }));
      } finally {
        await c.end();
      }
    })().catch((e) => { console.error(e && e.code ? String(e.code) : 'FAILED', e && e.message); process.exit(1); });
  `;
  try {
    return await execFileAsync(process.execPath, ['-e', source], {
      cwd: REPO_ROOT,
      // Only the disposable URL; the guarded ship11_test DATABASE_URL is not passed on.
      env: { PATH: process.env.PATH ?? '', REMOTE_PATH_URL: databaseUrl },
      timeout: 120000,
    });
  } catch (error) {
    // The child prints only an error code and message from the disposable database (no URL), so it is safe to show.
    const stderr = (error as { stderr?: unknown }).stderr;
    throw new Error(`runner child failed: ${typeof stderr === 'string' ? stderr.slice(0, 1500) : 'no stderr'}`);
  }
}
