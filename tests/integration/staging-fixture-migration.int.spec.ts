import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { randomPhone } from './support/auth-fixtures';
import { D2_ORIGIN_NAME, D2_ORIGIN_UP_SQL, S42_ORIGIN_UP_SQL } from './support/account-origin-histories';
import { ACCOUNT_SCOPE_DOWN_SQL } from './support/account-scope-migration-sql';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// Issue #49 — the STAGING_FIXTURE account origin and the migration-history matrix of account_origin.
//
// Two earlier branches (PR #27 and PR #42) added the same column under another timestamp (1791849600000). The current
// main owns 1791936000000_add-users-account-origin, and ONE new forward-only migration (1792627200000) replaces the two
// CHECK constraints. This suite builds every database history that matters and states what happens on each:
//   fresh            -> applies cleanly, the column exists exactly once;
//   main history     -> upgrades in place, every existing row keeps its origin and its verification time;
//   D2 history       -> the runner REFUSES (an applied migration the repository does not have), atomically, nothing changes;
//   #42 history      -> the runner REFUSES likewise; the new migration's SQL converges that structure to the same constraints.
// Like the other migration suites it RESETS the guarded test database and always leaves it fully migrated.

const FILES = readdirSync(path.join(REPO_ROOT, 'database', 'migrations')).filter((file) => file.endsWith('.sql')).sort();
const NAMES = FILES.map((file) => file.replace(/\.sql$/, ''));
const NEW = '1792627200000_allow-staging-fixture-account-origin';
// The test-unverified origin migration (DISABLED_TEST registration) is the next, newest one; it keeps every origin of NEW.
const TEST_ORIGIN = '1792713600000_allow-test-unverified-account-origin';
const ORIGIN = '1791936000000_add-users-account-origin';
const sqlOf = (name: string): { up: string; down: string } => {
  const text = readFileSync(path.join(REPO_ROOT, 'database', 'migrations', `${name}.sql`), 'utf8');
  return { up: (text.split('-- Down Migration')[0] as string).replace('-- Up Migration', ''), down: text.split('-- Down Migration')[1] as string };
};
const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

describe('issue #49 — staging fixture origin migration and account_origin history matrix', () => {
  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  const migrate = (extra: string[] = []): ReturnType<typeof runNpmScript> =>
    runNpmScript('db:migrate', extra, minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }));

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client);
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations');
  }
  async function history(): Promise<string[]> {
    const result = await client.query<{ name: string }>('SELECT name FROM public.pgmigrations ORDER BY id');
    return result.rows.map((row) => row.name);
  }
  async function originConstraints(): Promise<Record<string, string>> {
    const result = await client.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'app.users'::regclass AND conname IN ('users_account_origin_ck', 'users_origin_verified_ck') ORDER BY conname`,
    );
    return Object.fromEntries(result.rows.map((row) => [row.conname, row.def]));
  }
  async function originColumns(): Promise<number> {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'users' AND column_name = 'account_origin'`,
    );
    return result.rows[0]?.n ?? 0;
  }
  // The accounts THIS suite inserted: removed again in afterAll (by id, nothing else), because a left-over test-unverified account would make the Down
  // guard of the account-scope migration ("test-unverified accounts exist") refuse in whatever suite runs next.
  const inserted: string[] = [];
  async function insertUser(origin: string, verified: boolean): Promise<string> {
    const userId = randomUUID();
    await client.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', ${verified ? 'now()' : 'NULL'}, $3, 'ACTIVE', 1, now(), now())`,
      [userId, randomPhone().normalized, origin],
    );
    inserted.push(userId);
    return userId;
  }
  /** Runs the first `count` migration files through the real runner. */
  const migrateFirst = (count: number): void => {
    expect(migrate([String(count)]).status).toBe(0);
  };

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      if (migrate().status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
      if (inserted.length > 0) {
        await client.query('DELETE FROM app.users WHERE user_id = ANY($1::uuid[])', [inserted]);
      }
    } finally {
      await client.end();
    }
  });

  describe('the file', () => {
    it('is a NEW file after the applied ones (only the test-unverified origin and the activation phone-mode migrations follow it), and the repository has exactly ONE account_origin column migration', () => {
      expect(NAMES.slice(NAMES.indexOf(NEW))).toEqual([NEW, TEST_ORIGIN, '1792800000000_add-admin-activation-phone-verification-mode', '1792886400000_create-client-device-binding', '1792972800000_create-sms-gateway', '1793059200000_account-scope-lifecycle-settings', '1793145600000_create-menu', '1793232000000_menu-category-admin', '1793318400000_create-shipper-management', '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core', '1793491200000_create-wallet-holds', '1793577600000_create-wallet-topup-sources', '1793664000000_create-shipping-eligibility-parameters', '1793750400000_create-shipping-fee-policy', '1793836800000_m06-v1-1-three-tiers-agreement', '1793923200000_create-admin-finance-grants', '1794009600000_open-topup-ledger-gate', '1794096000000_create-m07-delivery', '1794182400000_create-m08-notifications', '1794268800000_create-m10-orders', '1794355200000_create-m11-reviews-complaints', '1794441600000_open-adjustment-ledger-gate', '1795046400000_add-shop-logo', '1795132800000_create-wallet-withdrawals', '1795219200000_simplify-shipper-onboarding', '1795305600000_service-area-coverage', '1795392000000_order-stage-timeouts', '1795478400000_bootstrap-cao-bang-gps-coverage', '1795564800000_shop-display-order-codes', '1795651200000_password-client-sessions', '1795737600000_create-m13-ops', '1795910400000_create-m12-report-exports', '1795996800000_create-m12-backup-restore', '1796083200000_m07-creator-cancel-after-pickup', '1796169600000_m07-fee-answer-deadline', '1796256000000_admin-shop-manage-right', '1796342400000_m07-fee-revision', '1796428800000_create-otp-policy', '1796515200000_shop-setup-readiness', '1796601600000_create-order-chat', '1796688000000_business-dashboard']);
      expect(NAMES.filter((name) => name.endsWith('add-users-account-origin'))).toEqual([ORIGIN]);
      expect(NAMES).not.toContain(D2_ORIGIN_NAME);
    });

    it('only replaces the two CHECK constraints: no column, no IF [NOT] EXISTS, no CASCADE, no data change', () => {
      const { up, down } = sqlOf(NEW);
      for (const text of [up, down]) {
        const code = stripComments(text);
        expect(code).not.toMatch(/IF\s+NOT\s+EXISTS|DROP\s+\w+\s+IF\s+EXISTS|CASCADE/i);
        expect(code).not.toMatch(/ADD\s+COLUMN|DROP\s+COLUMN|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
      }
      // The only IF EXISTS in the file is the PL/pgSQL guard of the down migration (a SELECT, not DDL).
      expect(stripComments(up)).not.toMatch(/IF\s+EXISTS/i);
      expect(stripComments(down).match(/IF\s+EXISTS/gi)).toHaveLength(1);
      expect(stripComments(up)).toContain("'STAGING_FIXTURE'");
    });

    it('is not a rewrite of the applied origin migration (its content still adds the column once)', () => {
      expect(stripComments(sqlOf(ORIGIN).up)).toMatch(/ADD\s+COLUMN\s+account_origin/);
      expect(stripComments(sqlOf(ORIGIN).up)).not.toContain('STAGING_FIXTURE');
    });
  });

  describe('fresh database', () => {
    it('applies every migration, the column exists once and the three origins are accepted with the right pairing', async () => {
      await reset();
      expect(migrate().status).toBe(0);
      expect(await history()).toEqual(NAMES);
      expect(await originColumns()).toBe(1);
      const constraints = await originConstraints();
      expect(constraints.users_account_origin_ck).toContain('STAGING_FIXTURE');
      expect(constraints.users_account_origin_ck).toContain('ADMIN_PROVISIONED');
      expect(constraints.users_account_origin_ck).toContain('PHONE_VERIFIED');
      await insertUser('PHONE_VERIFIED', true);
      await insertUser('ADMIN_PROVISIONED', false);
      await insertUser('STAGING_FIXTURE', false);
    });

    it('refuses a wrong pairing, an unknown origin and a verified fixture (database-level, 23514)', async () => {
      await expect(insertUser('PHONE_VERIFIED', false)).rejects.toMatchObject({ code: '23514' });
      await expect(insertUser('STAGING_FIXTURE', true)).rejects.toMatchObject({ code: '23514' });
      await expect(insertUser('ADMIN_PROVISIONED', true)).rejects.toMatchObject({ code: '23514' });
      await expect(insertUser('SOMETHING_ELSE', false)).rejects.toMatchObject({ code: '23514' });
    });

    it('a fixture can never become an administration member (the origin guard of 1792454400000 still holds)', async () => {
      const userId = await insertUser('STAGING_FIXTURE', false);
      for (const kind of ['ADMIN', 'SYSTEM']) {
        await expect(
          client.query(
            `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES ($1::uuid, $2, 'ACTIVE', 1, now(), now())`,
            [userId, kind],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
      const members = await client.query('SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [userId]);
      expect(members.rowCount).toBe(0);
    });

    it('up twice is a no-op for the runner and the down refuses while a fixture exists (nothing is deleted or rewritten)', async () => {
      expect(migrate().status).toBe(0);
      const { down } = sqlOf(NEW);
      await client.query('BEGIN');
      try {
        await expect(client.query(down)).rejects.toThrow(/staging fixture accounts exist/);
      } finally {
        await client.query('ROLLBACK');
      }
      const fixtures = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.users WHERE account_origin = 'STAGING_FIXTURE'`);
      expect(fixtures.rows[0]?.n).toBeGreaterThan(0);
    });

    it('down then up (rolled back) works on a database without fixtures and restores the same constraints', async () => {
      // Taken at the state this migration produced (the newer test-unverified migration is not applied yet).
      await reset();
      migrateFirst(NAMES.indexOf(NEW) + 1);
      const before = await originConstraints();
      const { up, down } = sqlOf(NEW);
      await client.query('BEGIN');
      try {
        await client.query(down);
        expect((await originConstraints()).users_account_origin_ck).not.toContain('STAGING_FIXTURE');
        await client.query(up);
        expect(await originConstraints()).toEqual(before);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  describe('main history (the history of the current main, upgraded in place)', () => {
    it('keeps every existing row, its origin and its verification time, and activates the fixture origin', async () => {
      await reset();
      migrateFirst(NAMES.indexOf(NEW));
      expect(await history()).toEqual(NAMES.slice(0, NAMES.indexOf(NEW)));
      const verified = await insertUser('PHONE_VERIFIED', true);
      const provisioned = await insertUser('ADMIN_PROVISIONED', false);
      await expect(insertUser('STAGING_FIXTURE', false)).rejects.toMatchObject({ code: '23514' });
      const snapshot = await client.query(`SELECT user_id, account_origin, phone_verified_at FROM app.users ORDER BY user_id`);

      expect(migrate().status).toBe(0);
      expect(await history()).toEqual(NAMES);
      const after = await client.query(`SELECT user_id, account_origin, phone_verified_at FROM app.users ORDER BY user_id`);
      expect(after.rows).toEqual(snapshot.rows);
      expect(after.rows.find((row) => row.user_id === verified)?.account_origin).toBe('PHONE_VERIFIED');
      expect(after.rows.find((row) => row.user_id === provisioned)?.account_origin).toBe('ADMIN_PROVISIONED');
      await insertUser('STAGING_FIXTURE', false);
    });

    it('schema drift is NOT hidden: a missing constraint fails the new migration atomically', async () => {
      await reset();
      migrateFirst(NAMES.indexOf(NEW));
      await client.query('ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck');
      const before = await originConstraints();
      expect(migrate().status).not.toBe(0);
      expect(await history()).toEqual(NAMES.slice(0, NAMES.indexOf(NEW)));
      expect(await originConstraints()).toEqual(before);
    });
  });

  describe('D2 history (PR #27: 1791849600000 applied, current 1791936000000 never applied)', () => {
    it('the runner refuses, loudly and without changing anything', async () => {
      await reset();
      migrateFirst(NAMES.indexOf(ORIGIN));
      await client.query(D2_ORIGIN_UP_SQL);
      await client.query('INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())', [D2_ORIGIN_NAME]);
      const historyBefore = await history();
      const constraintsBefore = await originConstraints();

      expect(migrate().status).not.toBe(0);
      expect(await history()).toEqual(historyBefore);
      expect(await originConstraints()).toEqual(constraintsBefore);
      expect(await originColumns()).toBe(1);
      const admin = await client.query(`SELECT to_regclass('app.admin_memberships') AS t`);
      expect(admin.rows[0]?.t).toBeNull();
    });
  });

  describe('#42 history (PR #42: 1791849600000 and its own 1791936000000 applied)', () => {
    it('the runner refuses, and the new migration SQL converges that structure to the fresh constraints', async () => {
      await reset();
      migrateFirst(NAMES.indexOf(NEW) + 1);
      const fresh = await originConstraints();

      await reset();
      migrateFirst(NAMES.indexOf(ORIGIN));
      await client.query(D2_ORIGIN_UP_SQL);
      await client.query(S42_ORIGIN_UP_SQL);
      await client.query('INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())', [D2_ORIGIN_NAME]);
      await client.query('INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())', [ORIGIN]);
      const historyBefore = await history();

      expect(migrate().status).not.toBe(0);
      expect(await history()).toEqual(historyBefore);
      expect(await originColumns()).toBe(1);

      // The structure already holds all three origins; the new migration's SQL replaces the constraints with the same text.
      await client.query(sqlOf(NEW).up);
      expect(await originConstraints()).toEqual(fresh);
      await reset();
    });
  });

  describe('TEST_UNVERIFIED (DISABLED_TEST registration, migration 1792713600000)', () => {
    it('is accepted only without a verification time, is not a fixture, and can never become an administration member', async () => {
      await reset();
      expect(migrate().status).toBe(0);
      expect((await originConstraints()).users_account_origin_ck).toContain('TEST_UNVERIFIED');
      const userId = await insertUser('TEST_UNVERIFIED', false);
      await expect(insertUser('TEST_UNVERIFIED', true)).rejects.toMatchObject({ code: '23514' });
      for (const kind of ['ADMIN', 'SYSTEM']) {
        await expect(
          client.query(
            `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at) VALUES ($1::uuid, $2, 'ACTIVE', 1, now(), now())`,
            [userId, kind],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
    });

    it('the down refuses while a test-unverified account exists and, without one, restores the previous constraints (rolled back)', async () => {
      const { up, down } = sqlOf(TEST_ORIGIN);
      // The newest migration (account scope, PHONE_UNVERIFIED) sits on top of these constraints: it is taken down first, in the same
      // rolled-back transaction, so that this migration is compared with its own state.
      await client.query('BEGIN');
      let withTest: Awaited<ReturnType<typeof originConstraints>>;
      try {
        await client.query(ACCOUNT_SCOPE_DOWN_SQL);
        withTest = await originConstraints();
        await client.query('SAVEPOINT refusal');
        await client.query(`INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
          VALUES (gen_random_uuid(), '${randomPhone().normalized}', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', NULL, 'TEST_UNVERIFIED', 'ACTIVE', 1, now(), now())`);
        await expect(client.query(down)).rejects.toThrow(/test-unverified accounts exist/);
        await client.query('ROLLBACK TO SAVEPOINT refusal');
        await client.query(`DELETE FROM app.users WHERE account_origin = 'TEST_UNVERIFIED'`);
        await client.query(down);
        expect((await originConstraints()).users_account_origin_ck).not.toContain('TEST_UNVERIFIED');
        await client.query(up);
        expect(await originConstraints()).toEqual(withTest);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
