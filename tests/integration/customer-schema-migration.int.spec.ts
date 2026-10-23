import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import {
  CUSTOMER_BACKFILL_SQL,
  CUSTOMER_DOWN_SQL,
  CUSTOMER_MIGRATION_FILE,
  CUSTOMER_MIGRATION_SQL,
  CUSTOMER_UP_SQL,
} from './support/customer-migration-sql';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M01.02 — the customer migration (app.customer_profiles, app.user_consents, CUSTOMER backfill): the repository rules, a
// clean install, a REAL upgrade over data, an idempotent backfill that overwrites nothing, drift that fails loudly and
// atomically, and a down/up that is safe to run on a disposable database.
//
// Like auth-migration.int.spec.ts this suite RESETS the guarded test database (after the target guard passed) and always
// leaves it fully migrated for the specs that follow.
describe('M01.02 — customer schema migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const names = files.map((file) => file.replace(/\.sql$/, ''));
  const NEW_NAME = CUSTOMER_MIGRATION_FILE.replace(/\.sql$/, '');
  const BEFORE = names.slice(0, names.indexOf(NEW_NAME)); // issue #49: the fixture-origin migration follows this one
  const TABLES = ['customer_profiles', 'user_consents'] as const;
  const HASH = '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA';
  const id = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  const code = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

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

  async function presentTables(): Promise<string[]> {
    const result = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [[...TABLES]],
    );
    return result.rows.map((row) => row.relname);
  }

  async function count(sql: string, values: unknown[] = []): Promise<number> {
    const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) AS counted`, values);
    return result.rows[0]?.n ?? -1;
  }

  async function insertUser(
    n: number,
    origin: 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED',
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
                              created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, 1, clock_timestamp(), clock_timestamp())`,
      [id(n), `+8490000000${n}`, HASH, origin === 'PHONE_VERIFIED' ? new Date().toISOString() : null, origin, status],
    );
  }

  async function insertRole(n: number, role: string): Promise<void> {
    await client.query('INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, $2, clock_timestamp())', [
      id(n),
      role,
    ]);
  }

  async function insertMembership(n: number, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'): Promise<void> {
    await client.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       VALUES ($1::uuid, 'ADMIN', $2, 1, clock_timestamp(), clock_timestamp())`,
      [id(n), status],
    );
  }

  /**
   * Six users with the shapes the backfill must tell apart. Numbers are kept as stable suffixes:
   *   1 ordinary, no role              -> CUSTOMER + profile
   *   2 ordinary with SHOP and DRIVER   -> keeps both, gains CUSTOMER + profile
   *   3 ordinary but DISABLED           -> CUSTOMER + profile (the role does not mean ACTIVE)
   *   4 administration account + membership           -> excluded
   *   5 ordinary account with an ABNORMAL membership    -> excluded (membership wins over origin)
   *   6 administration-origin account, no membership    -> excluded (origin is never CUSTOMER)
   */
  async function seedMixedUsers(): Promise<void> {
    await insertUser(1, 'PHONE_VERIFIED');
    await insertUser(2, 'PHONE_VERIFIED');
    await insertUser(3, 'PHONE_VERIFIED', 'DISABLED');
    await insertUser(4, 'ADMIN_PROVISIONED');
    await insertUser(5, 'PHONE_VERIFIED');
    await insertUser(6, 'ADMIN_PROVISIONED');
    await insertRole(2, 'SHOP');
    await insertRole(2, 'DRIVER');
    await insertMembership(4);
    // The origin guard refuses a membership for a phone-verified account, so the abnormal row needs the guard off for
    // one statement. It is switched back on in finally; nothing else in this suite runs without it.
    await client.query('ALTER TABLE app.admin_memberships DISABLE TRIGGER admin_membership_origin_guard');
    try {
      await insertMembership(5, 'DISABLED');
    } finally {
      await client.query('ALTER TABLE app.admin_memberships ENABLE TRIGGER admin_membership_origin_guard');
    }
  }

  /** The numbers (stable suffixes) of the users that hold the CUSTOMER role / have a profile. */
  async function customerNumbers(): Promise<string[]> {
    const result = await client.query<{ n: string }>(
      "SELECT right(user_id::text, 1) AS n FROM app.user_roles WHERE role = 'CUSTOMER' ORDER BY user_id",
    );
    return result.rows.map((row) => row.n);
  }
  async function profileNumbers(): Promise<string[]> {
    const result = await client.query<{ n: string }>(
      'SELECT right(user_id::text, 1) AS n FROM app.customer_profiles ORDER BY user_id',
    );
    return result.rows.map((row) => row.n);
  }

  /** Everything the backfill could touch, as text, so "unchanged" is a byte comparison. Holds ids and counters only. */
  async function fingerprint(): Promise<{ roles: unknown[]; profiles: unknown[] }> {
    const roles = await client.query(
      'SELECT user_id::text, role, created_at::text AS created_at FROM app.user_roles ORDER BY user_id, role',
    );
    const profiles = await client.query(
      `SELECT user_id::text, full_name, version::text AS version, created_at::text AS created_at, updated_at::text AS updated_at
         FROM app.customer_profiles ORDER BY user_id`,
    );
    return { roles: roles.rows, profiles: profiles.rows };
  }

  /** Runs SQL and returns the NOTICE messages it raised (the backfill prints counts only, never an id or a phone). */
  async function noticesOf(sql: string): Promise<string[]> {
    const notices: string[] = [];
    const listener = (notice: { message?: string }): void => {
      notices.push(notice.message ?? '');
    };
    client.on('notice', listener);
    try {
      await client.query(sql);
    } finally {
      client.off('notice', listener);
    }
    return notices.filter((message) => message.startsWith('M01.02 backfill:'));
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      // The upgrade tests switch the origin guard off for one statement; make sure a failed run never leaves it off.
      await client
        .query('ALTER TABLE app.admin_memberships ENABLE TRIGGER admin_membership_origin_guard')
        .catch(() => undefined);
      const result = migrate();
      if (result.status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
    } finally {
      await client.end();
    }
  });

  it('is the newest M01.02 migration, a NEW file after every applied one, and obeys the repository rules', () => {
    expect(NEW_NAME).toBe('1792540800000_create-customer-profiles-consents');
    // Issue #49: the staging-fixture origin migration (1792627200000) was moved AFTER this one; only the test-unverified origin migration follows it.
    expect(names.slice(names.indexOf(NEW_NAME))).toEqual([NEW_NAME, '1792627200000_allow-staging-fixture-account-origin', '1792713600000_allow-test-unverified-account-origin', '1792800000000_add-admin-activation-phone-verification-mode', '1792886400000_create-client-device-binding', '1792972800000_create-sms-gateway', '1793059200000_account-scope-lifecycle-settings', '1793145600000_create-menu', '1793232000000_menu-category-admin', '1793318400000_create-shipper-management', '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core', '1793491200000_create-wallet-holds', '1793577600000_create-wallet-topup-sources', '1793664000000_create-shipping-eligibility-parameters', '1793750400000_create-shipping-fee-policy', '1793836800000_m06-v1-1-three-tiers-agreement', '1793923200000_create-admin-finance-grants', '1794009600000_open-topup-ledger-gate', '1794096000000_create-m07-delivery', '1794182400000_create-m08-notifications', '1794268800000_create-m10-orders', '1794355200000_create-m11-reviews-complaints', '1794441600000_open-adjustment-ledger-gate', '1795046400000_add-shop-logo', '1795132800000_create-wallet-withdrawals', '1795219200000_simplify-shipper-onboarding', '1795305600000_service-area-coverage', '1795392000000_order-stage-timeouts', '1795478400000_bootstrap-cao-bang-gps-coverage', '1795564800000_shop-display-order-codes', '1795651200000_password-client-sessions', '1795737600000_m07-creator-cancel-after-pickup']);
    expect(names.filter((name) => name === NEW_NAME)).toHaveLength(1);
    expect(Number(NEW_NAME.split('_')[0])).toBeGreaterThan(Number((BEFORE[BEFORE.length - 1] as string).split('_')[0]));
    expect(CUSTOMER_MIGRATION_SQL).toContain('-- Up Migration');
    expect(CUSTOMER_MIGRATION_SQL).toContain('-- Down Migration');

    const statements = code(CUSTOMER_MIGRATION_SQL);
    expect(statements).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\bIF\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\bCASCADE\b/i);
    // Grants live in the runbook and are verified under a restricted role; the migration never grants.
    expect(statements).not.toMatch(/\bGRANT\b/i);
    // Neither users, roles nor admin tables are altered: the new objects only reference them.
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b/i);
    // The Up section never updates or deletes a row (the trigger statement says UPDATE OR DELETE, so match statements).
    expect(code(CUSTOMER_UP_SQL)).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code(CUSTOMER_UP_SQL)).not.toMatch(/^\s*UPDATE\s/im);

    const created = [...code(CUSTOMER_UP_SQL).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual(['app.customer_profiles', 'app.user_consents']);
    // The only rows the migration writes are the backfill ones: the CUSTOMER role and the empty profile. No consent.
    const inserted = [...code(CUSTOMER_UP_SQL).matchAll(/\bINSERT\s+INTO\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(inserted).toEqual(['app.user_roles', 'app.customer_profiles']);
    // Both foreign keys point at the REAL key of app.users (user_id), not at "id" as the contract text says.
    expect([...statements.matchAll(/REFERENCES\s+app\.users\s+\(user_id\)\s+ON DELETE RESTRICT/g)]).toHaveLength(2);
    expect(statements).not.toMatch(/app\.users\s+\(id\)/);
  });

  it('the down migration refuses non-backfill data first, then drops in reverse dependency order without CASCADE', () => {
    const down = code(CUSTOMER_DOWN_SQL);
    const withoutGuard = down.slice(0, down.indexOf('DO $$')) + down.slice(down.indexOf('$$;') + 3);
    const statements = withoutGuard
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toEqual([
      "DELETE FROM app.user_roles WHERE role = 'CUSTOMER'",
      'DROP TABLE app.user_consents',
      'DROP FUNCTION app.user_consents_immutable()',
      'DROP TABLE app.customer_profiles',
    ]);
    expect(down).toContain('cannot roll back M01.02: consent rows exist');
  });

  it('clean install records every migration, creates both tables EMPTY, and a second up is a no-op', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await presentTables()).toEqual([...TABLES]);
    for (const table of TABLES) {
      expect([table, await count(`SELECT 1 FROM app.${table}`)]).toEqual([table, 0]);
    }
    expect(await count("SELECT 1 FROM app.user_roles WHERE role = 'CUSTOMER'")).toBe(0);
    const owners = await client.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
        WHERE c.oid = ANY (ARRAY['app.customer_profiles'::regclass, 'app.user_consents'::regclass])`,
    );
    expect(owners.rows).toEqual([{ owner: 'ship11_test' }]);
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
  });

  it('a REAL upgrade over data backfills exactly the ordinary verified accounts and touches nothing else', async () => {
    await reset();
    expect(migrate([String(BEFORE.length)]).status).toBe(0);
    expect(await historyNames()).toEqual(BEFORE);
    expect(await presentTables()).toEqual([]);
    await seedMixedUsers();
    const usersBefore = await client.query('SELECT user_id::text, status, version::text AS version FROM app.users ORDER BY user_id');
    const legacyRolesBefore = await client.query(
      "SELECT user_id::text, role, created_at::text AS created_at FROM app.user_roles WHERE role IN ('SHOP', 'DRIVER') ORDER BY user_id, role",
    );

    // The migration's own counts, from a dry run that is rolled back (nothing of it survives).
    await client.query('BEGIN');
    const dryRun = await noticesOf(CUSTOMER_UP_SQL).finally(async () => {
      await client.query('ROLLBACK');
    });
    expect(dryRun).toEqual([
      'M01.02 backfill: users=6 eligible=3 excluded=3 customer_roles_inserted=3 customer_profiles_inserted=3',
    ]);
    expect(await presentTables()).toEqual([]);

    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);

    expect(await customerNumbers()).toEqual(['1', '2', '3']);
    expect(await profileNumbers()).toEqual(['1', '2', '3']);
    // Empty profiles only: no name copied from anywhere, version 1, and not a single consent row invented.
    expect(await count('SELECT 1 FROM app.customer_profiles WHERE full_name IS NULL AND version = 1 AND updated_at >= created_at')).toBe(3);
    expect(await count('SELECT 1 FROM app.user_consents')).toBe(0);
    // The excluded shapes got neither role nor profile.
    expect(await count("SELECT 1 FROM app.user_roles WHERE role = 'CUSTOMER' AND user_id = ANY ($1::uuid[])", [[id(4), id(5), id(6)]])).toBe(0);
    expect(await count('SELECT 1 FROM app.customer_profiles WHERE user_id = ANY ($1::uuid[])', [[id(4), id(5), id(6)]])).toBe(0);
    // Existing roles and the users themselves are untouched.
    const roles = await client.query<{ role: string }>(
      'SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role',
      [id(2)],
    );
    expect(roles.rows.map((row) => row.role)).toEqual(['CUSTOMER', 'DRIVER', 'SHOP']);
    expect(
      (
        await client.query(
          "SELECT user_id::text, role, created_at::text AS created_at FROM app.user_roles WHERE role IN ('SHOP', 'DRIVER') ORDER BY user_id, role",
        )
      ).rows,
    ).toEqual(legacyRolesBefore.rows);
    expect((await client.query('SELECT user_id::text, status, version::text AS version FROM app.users ORDER BY user_id')).rows).toEqual(
      usersBefore.rows,
    );
  });

  it('re-running the backfill adds no duplicate, overwrites no name or version, and heals only what is missing', async () => {
    // State left by the upgrade test: users 1..6, CUSTOMER + profile for 1, 2, 3.
    expect(await customerNumbers()).toEqual(['1', '2', '3']);
    await client.query(
      "UPDATE app.customer_profiles SET full_name = 'Existing Name', version = 5, updated_at = clock_timestamp() WHERE user_id = $1::uuid",
      [id(1)],
    );
    const before = await fingerprint();

    expect(await noticesOf(CUSTOMER_BACKFILL_SQL)).toEqual([
      'M01.02 backfill: users=6 eligible=3 excluded=3 customer_roles_inserted=0 customer_profiles_inserted=0',
    ]);
    expect(await fingerprint()).toEqual(before);
    expect((await client.query('SELECT full_name, version::text AS version FROM app.customer_profiles WHERE user_id = $1::uuid', [id(1)])).rows).toEqual([
      { full_name: 'Existing Name', version: '5' },
    ]);

    // A half-done state heals without touching the rest: user 2 lost its role, user 3 lost its profile.
    await client.query("DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'", [id(2)]);
    await client.query('DELETE FROM app.customer_profiles WHERE user_id = $1::uuid', [id(3)]);
    const partial = await fingerprint();
    expect(await noticesOf(CUSTOMER_BACKFILL_SQL)).toEqual([
      'M01.02 backfill: users=6 eligible=3 excluded=3 customer_roles_inserted=1 customer_profiles_inserted=1',
    ]);
    expect(await customerNumbers()).toEqual(['1', '2', '3']);
    expect(await profileNumbers()).toEqual(['1', '2', '3']);
    const after = await fingerprint();
    // Users 1 (named, version 5) is byte-identical; only the two restored rows differ from the partial state.
    expect(after.profiles.filter((row) => (row as { user_id: string }).user_id === id(1))).toEqual(
      partial.profiles.filter((row) => (row as { user_id: string }).user_id === id(1)),
    );
    expect(after.roles.filter((row) => (row as { role: string }).role !== 'CUSTOMER')).toEqual(
      partial.roles.filter((row) => (row as { role: string }).role !== 'CUSTOMER'),
    );

    // A phone-verified user created after the migration (so far without role or profile) is picked up by a repeat.
    await insertUser(7, 'PHONE_VERIFIED');
    expect(await noticesOf(CUSTOMER_BACKFILL_SQL)).toEqual([
      'M01.02 backfill: users=7 eligible=4 excluded=3 customer_roles_inserted=1 customer_profiles_inserted=1',
    ]);
    expect(await count('SELECT 1 FROM app.user_consents')).toBe(0);
  });

  const driftCases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'users_account_origin_ck that does not allow ADMIN_PROVISIONED',
      "ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck; ALTER TABLE app.users ADD CONSTRAINT users_account_origin_ck CHECK (account_origin IN ('PHONE_VERIFIED', 'STAGING_FIXTURE'))",
      'users_account_origin_ck must allow PHONE_VERIFIED and ADMIN_PROVISIONED',
    ],
    [
      'a missing users_origin_verified_ck',
      'ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck',
      'app.users is missing users_pkey, users_account_origin_ck or users_origin_verified_ck',
    ],
    [
      'a user_roles_role_ck narrowed to SHOP and DRIVER',
      "ALTER TABLE app.user_roles DROP CONSTRAINT user_roles_role_ck; ALTER TABLE app.user_roles ADD CONSTRAINT user_roles_role_ck CHECK (role IN ('SHOP', 'DRIVER'))",
      'user_roles_role_ck is not the bounded token constraint created by Auth Core',
    ],
    [
      'a missing app.admin_memberships',
      'ALTER TABLE app.admin_memberships RENAME TO admin_memberships_drifted',
      'app.users, app.user_roles and app.admin_memberships must exist',
    ],
  ];

  for (const [label, ddl, expectedMessage] of driftCases) {
    it(`drift is NOT hidden: ${label} fails the whole migration atomically, with no history row and no partial table`, async () => {
      await reset();
      expect(migrate([String(BEFORE.length)]).status).toBe(0);
      await client.query(ddl);

      const result = migrate();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('M01.02 prerequisite failed');
      expect(`${result.stdout}${result.stderr}`).toContain(expectedMessage);
      expect(await historyNames()).toEqual(BEFORE);
      expect(await presentTables()).toEqual([]);
      const leftovers = await client.query("SELECT 1 FROM pg_proc WHERE proname = 'user_consents_immutable'");
      expect(leftovers.rowCount).toBe(0);
    });
  }

  it('down then up (as SQL in a transaction that is rolled back) is safe on a populated schema and restores the backfill', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    await client.query('BEGIN');
    try {
      await insertUser(1, 'PHONE_VERIFIED');
      await client.query(CUSTOMER_DOWN_SQL);
      expect(await presentTables()).toEqual([]);
      expect(await count("SELECT 1 FROM app.user_roles WHERE role = 'CUSTOMER'")).toBe(0);
      expect(await count("SELECT 1 FROM pg_proc WHERE proname = 'user_consents_immutable'")).toBe(0);
      await client.query(CUSTOMER_UP_SQL);
      expect(await presentTables()).toEqual([...TABLES]);
      expect(await customerNumbers()).toEqual(['1']);
      expect(await profileNumbers()).toEqual(['1']);
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await presentTables()).toEqual([...TABLES]);
    expect(await count('SELECT 1 FROM app.users')).toBe(0);
    expect(await historyNames()).toEqual(names);
  });

  it('the down migration refuses to destroy customer data: a consent row, or a profile with a name or version beyond the backfill', async () => {
    await reset();
    expect(migrate().status).toBe(0);

    await client.query('BEGIN');
    try {
      await insertUser(1, 'PHONE_VERIFIED');
      await client.query(CUSTOMER_BACKFILL_SQL);
      await client.query(
        `INSERT INTO app.user_consents (id, user_id, terms_version, privacy_version, accepted_at, client_app)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1::uuid, 'terms-1', 'privacy-1', clock_timestamp(), 'FOOD')`,
        [id(1)],
      );
      await expect(client.query(CUSTOMER_DOWN_SQL)).rejects.toThrow('cannot roll back M01.02: consent rows exist');
    } finally {
      await client.query('ROLLBACK');
    }

    await client.query('BEGIN');
    try {
      await insertUser(1, 'PHONE_VERIFIED');
      await client.query(CUSTOMER_BACKFILL_SQL);
      await client.query(
        "UPDATE app.customer_profiles SET full_name = 'Named', version = 2, updated_at = clock_timestamp() WHERE user_id = $1::uuid",
        [id(1)],
      );
      await expect(client.query(CUSTOMER_DOWN_SQL)).rejects.toThrow('cannot roll back M01.02: customer profiles hold names');
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await presentTables()).toEqual([...TABLES]);
  });
});
