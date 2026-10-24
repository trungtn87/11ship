import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { fixtureKeyring, FIXTURE_MASTER_K2 } from '../../apps/backend/src/crypto/test-keys.fixture';
import { D2_ORIGIN_NAME, D2_ORIGIN_UP_SQL, S42_ORIGIN_UP_SQL } from './support/account-origin-histories';
import {
  ADMIN_PASSWORD,
  AdminApp,
  adminData,
  adminErrorCode,
  cookieFrom,
  createSystem,
  enrollAndLogin,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  SystemAccount,
  totpNow,
} from './support/admin-fixtures';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { randomPhone } from './support/auth-fixtures';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// Issue #49 follow-up — `npm run staging:db-upgrade-from-42` (scripts/staging-db-upgrade-from-42.js) against a database that
// is built with the EXACT migration history of PR #42 (10 migrations, two of them named add-users-account-origin) and
// holds a real SYSTEM administrator created by the real application. Guarded test database only: never staging.
//
// What is proven: the upgrade works; the SYSTEM keeps its phone, password hash, SYSTEM membership and TOTP factor (it logs in
// again with the OLD password and a code from the OLD authenticator secret, under the same keyring); there is exactly one
// SYSTEM; old sessions are gone; schema and history equal a fresh database migrated by the real runner; a failure in the middle
// (or an audit failure, a busy lock, a changed identity) leaves the database exactly as it was; the snapshot is encrypted and
// recovers the SYSTEM; every stop condition changes nothing.

interface Identity {
  readonly user: Record<string, unknown>;
  readonly membership: Record<string, unknown>;
  readonly factor: Record<string, unknown>;
  readonly limitConfig: Record<string, unknown> | null;
}
interface Inspection {
  readonly state: 'PRE' | 'DONE' | 'STOP';
  readonly problems: string[];
  readonly counts?: Record<string, number>;
}
interface Tool {
  main(options: { argv: string[]; env: Record<string, string | undefined>; deps: object; out: (m: string) => void; err: (m: string) => void }): Promise<number>;
  inspect(client: Client, options: { files: string[]; historyTable: string; keyring: Keyring }): Promise<Inspection>;
  verify(client: Client, options: { files: string[]; historyTable: string; keyring: Keyring; snapshot: Identity }): Promise<{ state: string; problems: string[] }>;
  rebuild(client: Client, options: Record<string, unknown>): Promise<unknown>;
  readSystemIdentity(client: Client): Promise<{ problems: string[]; identity?: Identity }>;
  insertIdentity(client: Client, identity: Identity): Promise<void>;
  decryptSnapshot(buffer: Buffer, key: Buffer): Identity;
  EXPECTED_PRE_HISTORY: string[];
  CONFIRM_PHRASE: string;
}
const tool = createRequire(__filename)(path.join(REPO_ROOT, 'scripts', 'staging-db-upgrade-from-42.js')) as Tool;

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');
const NAMES = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).map((file) => file.replace(/\.sql$/, '')).sort();
const ORIGIN = '1791936000000_add-users-account-origin';
const ADMIN_AUTH = '1792022400000_create-admin-auth';
const HISTORY_TABLE = 'public.pgmigrations';
const upOf = (name: string): string => {
  const text = readFileSync(path.join(MIGRATIONS_DIR, `${name}.sql`), 'utf8');
  return (text.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
};

const HOST = 'pooler.example.test';
const REF = 'abcdefghij0123456789';
const urlFor = (role: string): string => `postgres://${role}.${REF}:pw-not-used@${HOST}:5432/postgres`;
const SNAPSHOT_KEY = Buffer.alloc(32, 5).toString('base64');

describe('issue #49 — staging DB upgrade from the PR #42 history (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;
  let workDir: string;
  let system: SystemAccount;
  let firstLogin: { cookie: string; secret: string };
  let identity: Identity;
  let oldAdminSessions: string;
  let freshSchema: string;
  let freshHistory: string;

  const migrate = (extra: string[] = []): ReturnType<typeof runNpmScript> =>
    runNpmScript('db:migrate', extra, minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }));

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client);
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations');
  }

  async function schemaFingerprint(): Promise<string> {
    const result = await client.query<{ fp: string }>(
      `SELECT jsonb_build_object(
        'tables', (SELECT jsonb_agg(relname || ':' || relkind::text ORDER BY relname) FROM pg_class WHERE relnamespace = 'app'::regnamespace AND relkind NOT IN ('i', 'I')),
        'columns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.ordinal_position) FROM (
            SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, datetime_precision
              FROM information_schema.columns WHERE table_schema = 'app') c),
        'constraints', (SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text, conname, pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text, conname) FROM pg_constraint WHERE connamespace = 'app'::regnamespace),
        'indexes', (SELECT jsonb_agg(jsonb_build_array(tablename, indexname, indexdef) ORDER BY tablename, indexname) FROM pg_indexes WHERE schemaname = 'app'),
        'triggers', (SELECT jsonb_agg(jsonb_build_array(tgrelid::regclass::text, tgname, pg_get_triggerdef(oid)) ORDER BY tgrelid::regclass::text, tgname)
                       FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'app'::regnamespace)),
        'functions', (SELECT jsonb_agg(jsonb_build_array(proname, pg_get_functiondef(oid)) ORDER BY proname) FROM pg_proc WHERE pronamespace = 'app'::regnamespace)
      )::text AS fp`,
    );
    return (result.rows[0] as { fp: string }).fp;
  }
  async function historyRows(): Promise<string> {
    const result = await client.query<{ id: number; name: string }>(`SELECT id, name FROM ${HISTORY_TABLE} ORDER BY id`);
    return JSON.stringify(result.rows);
  }
  /** Everything that must not move when a run is refused or rolled back: schema, history, every row of every table, every grant. */
  async function wholeState(): Promise<string> {
    const tables = await client.query<{ relname: string; acl: string | null }>(
      `SELECT relname, relacl::text AS acl FROM pg_class WHERE relnamespace = 'app'::regnamespace AND relkind = 'r' ORDER BY relname`,
    );
    const data: Record<string, unknown> = {};
    for (const table of tables.rows) {
      const digest = await client.query<{ d: string; n: number }>(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d, count(*)::int AS n FROM app."${table.relname}" t`,
      );
      data[table.relname] = [digest.rows[0], table.acl];
    }
    return JSON.stringify({ schema: await schemaFingerprint(), history: await historyRows(), data });
  }
  async function currentIdentity(): Promise<Identity> {
    const read = await tool.readSystemIdentity(client);
    if (read.identity === undefined) {
      throw new Error(`no identity: ${read.problems.join(',')}`);
    }
    return read.identity;
  }

  /** The EXACT history of PR #42, built with the real SQL (the first seven files, both account_origin variants, admin-auth). */
  async function build42(): Promise<void> {
    await reset();
    await client.query('CREATE TABLE public.pgmigrations (id serial PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL)');
    const steps: Array<[string, string]> = [
      ...NAMES.slice(0, NAMES.indexOf(ORIGIN)).map((name): [string, string] => [name, upOf(name)]),
      [D2_ORIGIN_NAME, D2_ORIGIN_UP_SQL],
      [ORIGIN, S42_ORIGIN_UP_SQL],
      [ADMIN_AUTH, upOf(ADMIN_AUTH)],
    ];
    for (const [name, sql] of steps) {
      await client.query(sql);
      await client.query('INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())', [name]);
    }
    expect(JSON.parse(await historyRows()).map((row: { name: string }) => row.name)).toEqual(tool.EXPECTED_PRE_HISTORY);
  }

  /** A #42 database with the real SYSTEM identity, its old sessions, and test data that the upgrade is allowed to drop. */
  async function seed42(): Promise<void> {
    await build42();
    await tool.insertIdentity(client, identity);
    await client.query(
      `INSERT INTO app.admin_sessions SELECT * FROM jsonb_populate_recordset(null::app.admin_sessions, $1::jsonb)`,
      [oldAdminSessions],
    );
    const other = randomPhone().normalized;
    const otherId = randomUUID();
    await client.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [otherId, other],
    );
    await client.query(`INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'CUSTOMER', now())`, [otherId]);
    await client.query(
      `INSERT INTO app.sessions (session_id, user_id, token_digest, device_id, platform, app, expires_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, repeat('a', 64), 'dev-1', 'ANDROID', 'CUSTOMER_APP', now() + interval '1 day', now(), now())`,
      [randomUUID(), otherId],
    );
    const audit = new AuditWriter();
    await audit.append(
      { isActive: true, query: (text, values) => client.query(text, values as unknown[]) as never },
      { requestId: randomUUID(), actorType: 'USER', action: 'test.before_upgrade.v1', outcome: 'SUCCESS' },
    );
    await client.query('GRANT SELECT ON app.shops TO PUBLIC');
  }

  const out: string[] = [];
  const err: string[] = [];
  const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
    APP_ENV: 'staging',
    MIGRATION_DATABASE_URL: urlFor('ship11_migrator'),
    DATABASE_URL: urlFor('ship11_app'),
    MIGRATION_CONFIRM_TARGET: `${HOST}:5432/postgres/${REF}`,
    DB_SSL_CA: 'not-used',
    CRYPTO_KEYRING: 'not-used',
    CRYPTO_ACTIVE_KEY_ID: 'k1',
    ...extra,
  });
  const applyEnv = (file: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> =>
    env({ STAGING_UPGRADE_SNAPSHOT_KEY: SNAPSHOT_KEY, STAGING_UPGRADE_SNAPSHOT_FILE: file, STAGING_UPGRADE_CONFIRM: tool.CONFIRM_PHRASE, ...extra });
  const deps = (options: { keyring?: Keyring; dir?: string; audit?: () => unknown; client?: () => unknown } = {}): object => ({
    resolveDatabaseTls: () => ({ ok: true, tls: { ca: 'not-used', rejectUnauthorized: true } }),
    parseKeyringConfig: () => ({ ok: true, keyring: options.keyring ?? fixtureKeyring('k1') }),
    safeErrorCode: (error: unknown) => (error as { code?: string }).code ?? 'UNKNOWN',
    createAudit: options.audit ?? ((): AuditWriter => new AuditWriter()),
    createClient: options.client ?? ((): Client => new Client({ connectionString: databaseUrl })),
    migrationsDir: options.dir ?? MIGRATIONS_DIR,
    historyTable: HISTORY_TABLE,
  });
  const run = async (argv: string[], environment: Record<string, string | undefined>, options: Parameters<typeof deps>[0] = {}): Promise<number> => {
    out.length = 0;
    err.length = 0;
    return tool.main({ argv, env: environment, deps: deps(options), out: (m) => out.push(m), err: (m) => err.push(m) });
  };
  const printed = (): string => [...out, ...err].join('\n');
  const snapshotFile = (name: string): string => path.join(workDir, name);

  /** A copy of the migrations in which one file's Up section is replaced by a failing statement. */
  function brokenMigrations(name: string, label: string): string {
    const dir = path.join(workDir, `broken-${label}`);
    mkdirSync(dir);
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    writeFileSync(path.join(dir, `${name}.sql`), '-- Up Migration\nSELECT 1/0;\n-- Down Migration\nSELECT 1;\n');
    return dir;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
    workDir = mkdtempSync(path.join(tmpdir(), 'staging-upgrade-'));

    // A fresh database migrated by the real runner: the reference schema/history. The real application creates the SYSTEM.
    await reset();
    expect(migrate().status).toBe(0);
    freshSchema = await schemaFingerprint();
    freshHistory = await historyRows();
    const app: AdminApp = await startAdminApp();
    try {
      system = await createSystem(app, ADMIN_PASSWORD);
      firstLogin = await enrollAndLogin(app, system);
      identity = await currentIdentity();
      oldAdminSessions = (await client.query<{ s: string }>(`SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)::text AS s FROM app.admin_sessions s WHERE user_id = $1::uuid`, [system.userId])).rows[0]?.s as string;
      expect(JSON.parse(oldAdminSessions)).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 180_000);

  afterAll(async () => {
    try {
      await reset();
      if (migrate().status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
    } finally {
      await client.end();
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('the fixture is the exact PR #42 history and the tool classifies it as ready (PRE) with the SYSTEM identity verified', async () => {
    await seed42();
    expect(await historyRows()).not.toBe(freshHistory);
    const state = await tool.inspect(client, { files: NAMES, historyTable: HISTORY_TABLE, keyring: fixtureKeyring('k1') });
    expect({ state: state.state, problems: state.problems }).toEqual({ state: 'PRE', problems: [] });
    expect(state.counts?.users).toBe(2);
    expect(state.counts?.admin_sessions).toBe(1);
  });

  it('the dry-run (default) checks everything and changes nothing, not even a file', async () => {
    await seed42();
    const before = await wholeState();
    expect(await run([], env())).toBe(0);
    expect(printed()).toContain('ready for the rebuild');
    expect(printed()).toContain('dry-run; nothing was changed');
    expect(await wholeState()).toBe(before);
  });

  it('--apply: SYSTEM keeps its identity, schema and history equal a fresh database, test data and old sessions are gone, grants come back, one audit row', async () => {
    await seed42();
    const file = snapshotFile('apply.snapshot');
    expect(await run(['--apply'], applyEnv(file))).toBe(0);
    expect(printed()).toContain('committed');

    // M01.02 and the fixture migration are part of the standard history now: the upgrade creates the customer tables (empty).
    expect(NAMES).toHaveLength(53);
    expect(NAMES).toContain('1792540800000_create-customer-profiles-consents');
    expect(NAMES[NAMES.length - 1]).toBe('1796342400000_m07-fee-revision');
    const customerTables = await client.query<{ profiles: number; consents: number }>(
      `SELECT (SELECT count(*) FROM app.customer_profiles)::int AS profiles, (SELECT count(*) FROM app.user_consents)::int AS consents`,
    );
    expect(customerTables.rows[0]).toEqual({ profiles: 0, consents: 0 });

    // Same schema, same history (ids and names) as a database built by the real runner.
    expect(await schemaFingerprint()).toBe(freshSchema);
    expect(await historyRows()).toBe(freshHistory);

    // The identity is bit-for-bit the same (hash, factor ciphertext/iv/tag, version, anti-replay step, limiter check).
    expect(await currentIdentity()).toEqual(identity);

    // Exactly one SYSTEM and nothing else.
    const counts = await client.query<Record<string, number>>(
      `SELECT (SELECT count(*) FROM app.users)::int AS users,
              (SELECT count(*) FROM app.users WHERE account_origin = 'ADMIN_PROVISIONED')::int AS provisioned,
              (SELECT count(*) FROM app.admin_memberships)::int AS memberships,
              (SELECT count(*) FROM app.admin_memberships WHERE admin_role = 'SYSTEM')::int AS systems,
              (SELECT count(*) FROM app.admin_totp_factors)::int AS factors,
              (SELECT count(*) FROM app.admin_auth_limit_config)::int AS limits,
              (SELECT count(*) FROM app.admin_sessions)::int AS admin_sessions,
              (SELECT count(*) FROM app.sessions)::int AS sessions,
              (SELECT count(*) FROM app.user_roles)::int AS roles,
              (SELECT count(*) FROM app.audit_logs)::int AS audits,
              (SELECT count(*) FROM app.audit_logs WHERE action = 'ops.staging_db_rebuild.v1' AND outcome = 'SUCCESS')::int AS rebuild_audits`,
    );
    expect(counts.rows[0]).toEqual({ users: 1, provisioned: 1, memberships: 1, systems: 1, factors: 1, limits: 1, admin_sessions: 0, sessions: 0, roles: 0, audits: 1, rebuild_audits: 1 });

    // The runtime grant of an existing table is back.
    const grant = await client.query(`SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid = 'app.shops'::regclass AND a.grantee = 0 AND a.privilege_type = 'SELECT'`);
    expect(grant.rowCount).toBe(1);

    // The snapshot: mode 0600, encrypted (no hash / ciphertext in the file), decrypts to the same identity, outside the repository.
    expect(statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? statSync(file).mode & 0o777 : 0o600);
    const raw = readFileSync(file);
    expect(raw.includes(String(identity.user.password_hash))).toBe(false);
    expect(raw.includes(String(identity.user.phone_normalized))).toBe(false);
    expect(tool.decryptSnapshot(raw, Buffer.from(SNAPSHOT_KEY, 'base64'))).toEqual(identity);
    expect(path.relative(REPO_ROOT, file).startsWith('..')).toBe(true);

    // Nothing sensitive was printed.
    const text = printed();
    for (const secret of [ADMIN_PASSWORD, firstLogin.secret, system.phone.local, system.phone.normalized, system.userId, String(identity.user.password_hash), SNAPSHOT_KEY, file, 'postgres://']) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.stringify([out, err])).not.toContain(Buffer.from(identity.factor.ciphertext as Buffer).toString('base64'));

    // Running again is a no-op (the history is complete); a repeated --apply needs a NEW snapshot file and says there is nothing to do.
    expect(await run([], env())).toBe(0);
    expect(printed()).toContain('nothing to do');
    expect(await run(['--apply'], applyEnv(file))).toBe(1);
    expect(printed()).toContain('SNAPSHOT_EXISTS');
  });

  it('the SYSTEM logs in again with the OLD password and a code from the OLD authenticator secret; the old session is dead; the replay window survived', async () => {
    await seed42();
    // The stored anti-replay step is moved far ahead BEFORE the upgrade; it must come through unchanged.
    await client.query('UPDATE app.admin_totp_factors SET last_accepted_step = last_accepted_step + 100000');
    expect(await run(['--apply'], applyEnv(snapshotFile('login.snapshot')))).toBe(0);
    const app = await startAdminApp();
    try {
      const old = await app.call('GET', '/me', { cookies: sessionCookies(firstLogin) });
      expect({ status: old.status, code: adminErrorCode(old) }).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });

      const wrong = await app.call('POST', '/login', { body: { phone: system.phone.local, password: `${ADMIN_PASSWORD}x`, device: { device_id: 'admin-web-0001', platform: 'WEB', app: 'ADMIN_WEB' } } });
      expect(wrong.status).toBeGreaterThanOrEqual(400);

      const preauth = await loginStep(app, system); // the OLD password
      expect(preauth.nextStep).toBe('VERIFY_TOTP');
      // The anti-replay step came along: the code of the CURRENT step is refused while the stored step is ahead of it.
      const replay = await app.call('POST', '/totp/verify', { body: { code: totpNow(firstLogin.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
      expect({ status: replay.status, code: adminErrorCode(replay) }).toEqual({ status: 400, code: 'ADMIN_TOTP_INVALID' });
      await rewindAcceptedStep(app, system.userId, 100_010);
      const again = await loginStep(app, system);
      const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(firstLogin.secret) }, cookies: preauthCookies(again), csrf: again.csrf });
      expect(verified.status).toBe(200);
      const cookie = cookieFrom(verified, ADMIN_SESSION_COOKIE) as string;
      const me = await app.call('GET', '/me', { cookies: sessionCookies({ cookie }) });
      expect(me.status).toBe(200);
      expect(JSON.stringify(adminData(me))).toContain('SYSTEM');
    } finally {
      await app.close();
    }
  }, 120_000);

  describe('a failure leaves the database exactly as it was (and is recoverable by running again)', () => {
    it('a migration that fails in the middle or at the end rolls everything back; the same run then succeeds with the real files', async () => {
      await seed42();
      const before = await wholeState();
      for (const [label, index] of [['middle', 3], ['last', NAMES.length - 1]] as const) {
        const dir = brokenMigrations(NAMES[index] as string, label);
        expect(await run(['--apply'], applyEnv(snapshotFile(`${label}.snapshot`)), { dir })).toBe(1);
        expect(printed()).toContain('never reached COMMIT');
        expect(await wholeState()).toBe(before);
      }
      // Recoverable: the same database upgrades with the real files and a new snapshot path.
      expect(await run(['--apply'], applyEnv(snapshotFile('recovered.snapshot')))).toBe(0);
      expect(await schemaFingerprint()).toBe(freshSchema);
      expect(await currentIdentity()).toEqual(identity);
    });

    it('a failing audit write after everything else rolls everything back', async () => {
      await seed42();
      const before = await wholeState();
      const failing = { append: async (): Promise<void> => Promise.reject(Object.assign(new Error('audit down'), { code: 'AUDIT_DOWN' })) };
      expect(await run(['--apply'], applyEnv(snapshotFile('audit.snapshot')), { audit: () => failing })).toBe(1);
      expect(printed()).toContain('AUDIT_DOWN');
      expect(await wholeState()).toBe(before);
    });

    it('a busy migration lock or a busy table stops the run without waiting forever and without a change', async () => {
      await seed42();
      const before = await wholeState();
      const other = new Client({ connectionString: databaseUrl });
      await other.connect();
      try {
        await other.query('SELECT pg_advisory_lock(7241865325823964)');
        expect(await run(['--apply'], applyEnv(snapshotFile('lock.snapshot')))).toBe(1);
        expect(printed()).toContain('MIGRATION_LOCK_BUSY');
        await other.query('SELECT pg_advisory_unlock(7241865325823964)');
        expect(await wholeState()).toBe(before);

        await other.query('BEGIN');
        await other.query('LOCK TABLE app.users IN SHARE MODE');
        expect(await run(['--apply'], applyEnv(snapshotFile('table.snapshot')))).toBe(1);
        expect(printed()).toContain('55P03');
        await other.query('ROLLBACK');
        expect(await wholeState()).toBe(before);
      } finally {
        await other.end();
      }
    }, 90_000);

    it('an identity that is not the one under the locks (changed after the snapshot) is refused', async () => {
      await seed42();
      const before = await wholeState();
      const changed: Identity = { ...identity, user: { ...identity.user, password_hash: `${String(identity.user.password_hash)}x` } };
      await expect(
        tool.rebuild(client, { identity: changed, files: NAMES, dir: MIGRATIONS_DIR, historyTable: HISTORY_TABLE, keyring: fixtureKeyring('k1') }),
      ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(await wholeState()).toBe(before);
    });
  });

  describe('recovery from the encrypted snapshot', () => {
    it('puts the SYSTEM back into a migrated database that lost it, refuses a non-empty target and a wrong key', async () => {
      await seed42();
      const file = snapshotFile('recover.snapshot');
      expect(await run(['--apply'], applyEnv(file))).toBe(0);
      const full = await wholeState();

      // Not empty: refused, nothing changes.
      expect(await run(['--restore-snapshot'], applyEnv(file))).toBe(1);
      expect(printed()).toContain('TARGET_NOT_EMPTY');
      expect(await wholeState()).toBe(full);

      // The SYSTEM is lost (for example after a wrong cleanup), the schema and history are intact.
      await client.query('DELETE FROM app.admin_totp_factors');
      await client.query('DELETE FROM app.admin_memberships');
      await client.query('DELETE FROM app.users');
      expect(await run(['--restore-snapshot'], applyEnv(file, { STAGING_UPGRADE_SNAPSHOT_KEY: Buffer.alloc(32, 9).toString('base64') }))).toBe(1);
      expect(await client.query('SELECT 1 FROM app.users')).toHaveProperty('rowCount', 0);

      expect(await run(['--restore-snapshot'], applyEnv(file))).toBe(0);
      expect(await currentIdentity()).toEqual(identity);
      expect(await schemaFingerprint()).toBe(freshSchema);
    });
  });

  /**
   * A connection whose COMMIT misbehaves, the only statement that is altered:
   *  LOST_ACK     the COMMIT really reaches the server and succeeds, the acknowledgement is lost (the caller sees a connection error);
   *  LOST_BEFORE  the backend is terminated just before COMMIT, so the COMMIT can never succeed (the caller sees a connection error).
   * It records every statement so a test can prove that nothing was retried.
   */
  function faultyClient(mode: 'LOST_ACK' | 'LOST_BEFORE'): { make: () => unknown; seen: string[] } {
    const seen: string[] = [];
    const make = (): unknown => {
      const real = new Client({ connectionString: databaseUrl });
      return {
        on: (): void => {
          real.on('error', () => undefined);
        },
        connect: async (): Promise<void> => {
          await real.connect();
        },
        end: (): Promise<void> => real.end(),
        query: async (text: string, values?: unknown[]): Promise<unknown> => {
          seen.push(text);
          if (text !== 'COMMIT') {
            return real.query(text, values);
          }
          if (mode === 'LOST_ACK') {
            await real.query('COMMIT');
            throw new Error('Connection terminated unexpectedly');
          }
          const pid = (await real.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
          const killer = new Client({ connectionString: databaseUrl });
          await killer.connect();
          try {
            await killer.query('SELECT pg_terminate_backend($1::int)', [pid]);
          } finally {
            await killer.end();
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          throw new Error('Connection terminated unexpectedly');
        },
      };
    };
    return { make, seen };
  }
  const writes = (seen: string[], pattern: RegExp): number => seen.filter((text) => pattern.test(text)).length;
  /** Statements sent AFTER the COMMIT was asked: there must be none (no ROLLBACK, no retry). */
  const afterCommit = (seen: string[]): string[] => seen.slice(seen.indexOf('COMMIT') + 1);
  const verifyEnv = (file: string): Record<string, string | undefined> => applyEnv(file, { STAGING_UPGRADE_CONFIRM: undefined });

  describe('COMMIT outcome unknown (lost acknowledgement / lost connection)', () => {
    const expectUnknown = (seen: string[]): void => {
      expect(printed()).toContain('COMMIT_OUTCOME_UNKNOWN');
      expect(printed()).toContain('do NOT run any write command again');
      expect(printed()).toContain('-- --verify');
      expect(printed()).not.toMatch(/rolled back|never reached COMMIT|exactly as it was/);
      expect(writes(seen, /^COMMIT$/)).toBe(1); // asked once, never retried
      expect(afterCommit(seen)).toEqual([]); // nothing is sent after a COMMIT of unknown outcome
      expect(writes(seen, /^BEGIN$/)).toBe(1);
    };

    it('rebuild, COMMIT succeeded but the ACK was lost: exit 2, fixed code, snapshot kept, --verify says UPGRADED_OK (read-only)', async () => {
      await seed42();
      const file = snapshotFile('ack.snapshot');
      const faulty = faultyClient('LOST_ACK');
      expect(await run(['--apply'], applyEnv(file), { client: faulty.make })).toBe(2);
      expectUnknown(faulty.seen);
      expect(existsSync(file)).toBe(true);

      // The database really changed: complete history and the same SYSTEM.
      const after = await wholeState();
      expect(await run(['--verify'], verifyEnv(file))).toBe(0);
      expect(printed()).toContain('UPGRADED_OK');
      expect(await wholeState()).toBe(after); // --verify is read-only
      expect(await schemaFingerprint()).toBe(freshSchema);
      expect(await currentIdentity()).toEqual(identity);
      // A second --apply would be refused (existing snapshot file) and a new one is a no-op ("nothing to do").
      expect(await run(['--apply'], applyEnv(snapshotFile('ack-again.snapshot')))).toBe(0);
      expect(printed()).toContain('nothing to do');
    });

    it('rebuild, connection lost before COMMIT could succeed: exit 2, --verify says PRE_UNCHANGED and the whole state is untouched; a new --apply then works', async () => {
      await seed42();
      const before = await wholeState();
      const file = snapshotFile('lost.snapshot');
      const faulty = faultyClient('LOST_BEFORE');
      expect(await run(['--apply'], applyEnv(file), { client: faulty.make })).toBe(2);
      expect(printed()).toContain('COMMIT_OUTCOME_UNKNOWN');
      expect(printed()).not.toMatch(/rolled back|never reached COMMIT|exactly as it was/);
      expect(writes(faulty.seen, /^COMMIT$/)).toBe(1);
      expect(afterCommit(faulty.seen)).toEqual([]);
      expect(existsSync(file)).toBe(true);

      expect(await run(['--verify'], verifyEnv(file))).toBe(0);
      expect(printed()).toContain('PRE_UNCHANGED');
      expect(await wholeState()).toBe(before);
      expect(await run(['--apply'], applyEnv(file))).toBe(1); // the kept snapshot is never overwritten
      expect(printed()).toContain('SNAPSHOT_EXISTS');
      expect(await run(['--apply'], applyEnv(snapshotFile('lost-2.snapshot')))).toBe(0);
      expect(await currentIdentity()).toEqual(identity);
    });

    it('restore, COMMIT succeeded but the ACK was lost: exit 2, --verify says UPGRADED_OK', async () => {
      await seed42();
      const file = snapshotFile('restore-ack.snapshot');
      expect(await run(['--apply'], applyEnv(file))).toBe(0);
      await client.query('DELETE FROM app.admin_totp_factors');
      await client.query('DELETE FROM app.admin_memberships');
      await client.query('DELETE FROM app.users');
      const faulty = faultyClient('LOST_ACK');
      expect(await run(['--restore-snapshot'], applyEnv(file), { client: faulty.make })).toBe(2);
      expect(printed()).toContain('COMMIT_OUTCOME_UNKNOWN');
      expect(printed()).not.toMatch(/rolled back|never reached COMMIT|exactly as it was/);
      expect(writes(faulty.seen, /^COMMIT$/)).toBe(1);
      expect(afterCommit(faulty.seen)).toEqual([]);
      expect(existsSync(file)).toBe(true);
      expect(await run(['--verify'], verifyEnv(file))).toBe(0);
      expect(printed()).toContain('UPGRADED_OK');
      expect(await currentIdentity()).toEqual(identity);
    });

    it('restore, connection lost before COMMIT could succeed: exit 2, --verify says MIGRATED_WITHOUT_SYSTEM; the restore then succeeds', async () => {
      await seed42();
      const file = snapshotFile('restore-lost.snapshot');
      expect(await run(['--apply'], applyEnv(file))).toBe(0);
      await client.query('DELETE FROM app.admin_totp_factors');
      await client.query('DELETE FROM app.admin_memberships');
      await client.query('DELETE FROM app.users');
      const faulty = faultyClient('LOST_BEFORE');
      expect(await run(['--restore-snapshot'], applyEnv(file), { client: faulty.make })).toBe(2);
      expect(printed()).toContain('COMMIT_OUTCOME_UNKNOWN');
      expect(writes(faulty.seen, /^COMMIT$/)).toBe(1);
      expect(existsSync(file)).toBe(true);
      const before = await wholeState();
      expect(await run(['--verify'], verifyEnv(file))).toBe(0);
      expect(printed()).toContain('MIGRATED_WITHOUT_SYSTEM');
      expect(await wholeState()).toBe(before);
      expect(await run(['--restore-snapshot'], applyEnv(file))).toBe(0);
      expect(await currentIdentity()).toEqual(identity);
    });

    it('a complete history alone is not enough: --verify reports ABNORMAL when the SYSTEM differs from the snapshot, or there is a second user', async () => {
      await seed42();
      const file = snapshotFile('abnormal.snapshot');
      expect(await run(['--apply'], applyEnv(file))).toBe(0);
      await client.query(`UPDATE app.users SET password_hash = password_hash || 'x'`);
      let before = await wholeState();
      expect(await run(['--verify'], verifyEnv(file))).toBe(1);
      expect(printed()).toContain('ABNORMAL');
      expect(printed()).toContain('IDENTITY_DIFFERS');
      expect(await wholeState()).toBe(before);

      await client.query(`UPDATE app.users SET password_hash = left(password_hash, -1)`);
      await client.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', NULL, 'STAGING_FIXTURE', 'ACTIVE', 1, now(), now())`,
        [randomUUID(), randomPhone().normalized],
      );
      before = await wholeState();
      expect(await run(['--verify'], verifyEnv(file))).toBe(1);
      expect(printed()).toContain('UNEXPECTED_ROWS');
      expect(await wholeState()).toBe(before);
    });

    it('--verify on a history that is neither #42 nor complete is ABNORMAL; it needs the snapshot, takes no other option and changes nothing', async () => {
      await seed42();
      const file = snapshotFile('verify-gates.snapshot');
      expect(await run(['--apply'], applyEnv(file))).toBe(0);
      await client.query(`DELETE FROM public.pgmigrations WHERE name = $1`, [NAMES[NAMES.length - 1]]);
      const before = await wholeState();
      expect(await run(['--verify'], verifyEnv(file))).toBe(1);
      expect(printed()).toContain('HISTORY_UNKNOWN');
      expect(await run(['--verify'], verifyEnv(snapshotFile('does-not-exist.snapshot')))).toBe(1);
      expect(printed()).toContain('SNAPSHOT_MISSING');
      expect(await run(['--verify', '--apply'], verifyEnv(file))).toBe(1);
      expect(await wholeState()).toBe(before);
    });
  });

  describe('nothing outside schema app is ever dropped (DROP TABLE … RESTRICT, no CASCADE)', () => {
    const cleanup = async (): Promise<void> => {
      await client.query('DROP VIEW IF EXISTS public.ext_view_of_app');
      await client.query('DROP FUNCTION IF EXISTS public.ext_fn_of_app()');
      await client.query('DROP TABLE IF EXISTS public.ext_ref_to_app');
    };
    const externalState = async (): Promise<string> => {
      const parts: unknown[] = [];
      for (const sql of [
        `SELECT pg_get_viewdef('public.ext_view_of_app'::regclass) AS d`,
        `SELECT pg_get_functiondef('public.ext_fn_of_app()'::regprocedure) AS d`,
        `SELECT string_agg(pg_get_constraintdef(oid), '|' ORDER BY conname) AS d FROM pg_constraint WHERE conrelid = 'public.ext_ref_to_app'::regclass`,
        `SELECT count(*)::text AS d FROM public.ext_ref_to_app`,
      ]) {
        try {
          parts.push((await client.query<{ d: string }>(sql)).rows[0]?.d);
        } catch {
          parts.push('absent');
        }
      }
      return JSON.stringify(parts);
    };

    const cases: Array<[string, string, string]> = [
      ['a view outside app that reads a table of app', 'EXTERNAL_DEPENDENCY', 'CREATE VIEW public.ext_view_of_app AS SELECT user_id FROM app.users'],
      ['a foreign key from a table outside app to a table of app', 'EXTERNAL_DEPENDENCY', 'CREATE TABLE public.ext_ref_to_app (user_id uuid REFERENCES app.users (user_id))'],
    ];
    it.each(cases)('%s: dry-run and --apply refuse, no snapshot, the whole database (app and outside) is unchanged', async (_label, code, ddl) => {
      await seed42();
      try {
        await client.query(ddl);
        if (ddl.includes('ext_ref_to_app')) {
          await client.query('INSERT INTO public.ext_ref_to_app SELECT user_id FROM app.users LIMIT 1');
        }
        const before = await wholeState();
        const outside = await externalState();
        const state = await tool.inspect(client, { files: NAMES, historyTable: HISTORY_TABLE, keyring: fixtureKeyring('k1') });
        expect(state.state).toBe('STOP');
        expect(state.problems).toContain(code);
        expect(await run([], env())).toBe(1);
        expect(printed()).toContain(code);
        const file = snapshotFile(`external-${code}.snapshot`);
        expect(await run(['--apply'], applyEnv(file))).toBe(1);
        expect(printed()).toContain(code);
        expect(existsSync(file)).toBe(false);
        expect(await wholeState()).toBe(before);
        expect(await externalState()).toBe(outside);
      } finally {
        await cleanup();
      }
    });

    it('the database itself is the backstop: a dependency the early check does not know (a function body in another schema) makes rebuild() fail with EXTERNAL_DEPENDENCY, and the transaction rolls back', async () => {
      await seed42();
      try {
        await client.query('CREATE FUNCTION public.ext_fn_of_app() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM app.users; END');
        const before = await wholeState();
        const outside = await externalState();
        await expect(
          tool.rebuild(client, { identity, files: NAMES, dir: MIGRATIONS_DIR, historyTable: HISTORY_TABLE, keyring: fixtureKeyring('k1') }),
        ).rejects.toMatchObject({ code: 'EXTERNAL_DEPENDENCY' });
        expect(await wholeState()).toBe(before);
        expect(await externalState()).toBe(outside);
        expect((await client.query('SELECT public.ext_fn_of_app() AS n')).rows[0]).toEqual({ n: '2' });
      } finally {
        await cleanup();
      }
    });

    it('objects outside app that do NOT depend on app survive a successful upgrade untouched', async () => {
      await seed42();
      try {
        await client.query('CREATE TABLE public.ext_ref_to_app (user_id uuid)');
        await client.query('INSERT INTO public.ext_ref_to_app VALUES (gen_random_uuid())');
        await client.query('CREATE VIEW public.ext_view_of_app AS SELECT user_id FROM public.ext_ref_to_app');
        const outside = await externalState();
        expect(await run(['--apply'], applyEnv(snapshotFile('independent.snapshot')))).toBe(0);
        expect(await externalState()).toBe(outside);
        expect(await schemaFingerprint()).toBe(freshSchema);
      } finally {
        await cleanup();
      }
    });
  });

  describe('stop conditions: nothing is changed, no snapshot is written, --apply is refused too', () => {
    const cases: Array<[string, string, (() => Promise<void>) | undefined, Parameters<typeof deps>[0] | undefined]> = [];
    const add = (label: string, code: string, mutate?: () => Promise<void>, options?: Parameters<typeof deps>[0]): void => {
      cases.push([label, code, mutate, options]);
    };
    add('the D2-only migration row is missing from the history', 'HISTORY_UNKNOWN', async () => {
      await client.query('DELETE FROM public.pgmigrations WHERE name = $1', [D2_ORIGIN_NAME]);
    });
    add('the history has an unknown extra migration', 'HISTORY_NOT_42', async () => {
      await client.query(`INSERT INTO public.pgmigrations (name, run_on) VALUES ('1799999999999_something-else', now())`);
    });
    add('a second ADMIN_PROVISIONED user exists', 'SYSTEM_USER', async () => {
      await client.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
        [randomUUID(), randomPhone().normalized],
      );
    });
    add('the SYSTEM has no membership', 'SYSTEM_MEMBERSHIP', async () => {
      await client.query('DELETE FROM app.admin_totp_factors');
      await client.query('DELETE FROM app.admin_memberships');
    });
    add('the SYSTEM has no TOTP factor', 'SYSTEM_FACTOR', async () => {
      await client.query('DELETE FROM app.admin_totp_factors');
    });
    add('the SYSTEM owns application data that the rebuild would drop', 'SYSTEM_LINKED', async () => {
      await client.query(`INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'CUSTOMER', now())`, [system.userId]);
    });
    add('schema app holds an object that the PR #42 history does not create', 'UNEXPECTED_OBJECTS', async () => {
      await client.query('CREATE TABLE app.stray (x integer)');
    });
    add('a table of the PR #42 history is missing', 'MISSING_OBJECTS', async () => {
      await client.query('DROP TABLE app.shop_business_hours');
    });
    add('the stored factor does not decrypt (tampered tag)', 'KEYRING_CANNOT_DECRYPT', async () => {
      await client.query(`UPDATE app.admin_totp_factors SET tag = decode(repeat('ab', 16), 'hex')`);
    });
    add('the keyring lacks the key the factor was sealed with', 'KEYRING_KEY_MISSING', undefined, {
      keyring: new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2'),
    });
    add('the keyring has that key id but another key', 'KEYRING_CANNOT_DECRYPT', undefined, {
      keyring: new Keyring([{ id: 'k1', master: FIXTURE_MASTER_K2 }], 'k1'),
    });

    it.each(cases)('%s → %s', async (_label, code, mutate, options) => {
      await seed42();
      if (mutate !== undefined) {
        await mutate();
      }
      const before = await wholeState();
      const state = await tool.inspect(client, { files: NAMES, historyTable: HISTORY_TABLE, keyring: options?.keyring ?? fixtureKeyring('k1') });
      expect(state.state).toBe('STOP');
      expect(state.problems).toContain(code);

      expect(await run([], env(), options)).toBe(1);
      expect(printed()).toContain(code);
      const file = snapshotFile(`stop-${code}.snapshot`);
      expect(await run(['--apply'], applyEnv(file), options)).toBe(1);
      expect(printed()).toContain(code);
      expect(existsSync(file)).toBe(false);
      expect(await wholeState()).toBe(before);
    });

    it('a database on the history of main minus its newest migration is not touched (it is for the normal runner)', async () => {
      await reset();
      expect(migrate([String(NAMES.length - 1)]).status).toBe(0);
      const before = await wholeState();
      const state = await tool.inspect(client, { files: NAMES, historyTable: HISTORY_TABLE, keyring: fixtureKeyring('k1') });
      expect(state.state).toBe('STOP');
      expect(await run(['--apply'], applyEnv(snapshotFile('main-minus-one.snapshot')))).toBe(1);
      expect(await wholeState()).toBe(before);
    });
  });

  it('the source tree contains no credential material of this task (no snapshot, no key, no hash)', () => {
    const tracked = [path.join(REPO_ROOT, 'scripts', 'staging-db-upgrade-from-42.js')];
    for (const file of tracked) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\$argon2id\$v=/);
      expect(text).not.toMatch(/postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/);
    }
  });
});
