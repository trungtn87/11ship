import { PRE_TIMEOUT_MIGRATION_ARGS } from './support/timeout-migration-sql';
import { ACTIVATION_DOWN_SQL, ACTIVATION_UP_SQL } from './support/activation-migration-sql';
import { CLIENT_DEVICE_DOWN_SQL, CLIENT_DEVICE_UP_SQL } from './support/client-device-migration-sql';
import { ACCOUNT_SCOPE_DOWN_SQL, ACCOUNT_SCOPE_UP_SQL } from './support/account-scope-migration-sql';
import { SHIPPER_DOWN_SQL, SHIPPER_UP_SQL } from './support/shipper-migration-sql';
import { V11_DOWN_SQL, V11_UP_SQL } from './support/shipping-v11-migration-sql';
import { ELIGIBILITY_DOWN_SQL, ELIGIBILITY_UP_SQL } from './support/shipping-eligibility-migration-sql';
import { FEE_POLICY_DOWN_SQL, FEE_POLICY_UP_SQL } from './support/shipping-fee-policy-migration-sql';
import { WALLET_DOWN_SQL, WALLET_UP_SQL, FINANCE_DOWN_SQL, FINANCE_UP_SQL, POSTING_DOWN_SQL, POSTING_UP_SQL, TOPUP_DOWN_SQL, TOPUP_UP_SQL } from './support/wallet-migration-sql';
import { M07_DOWN_SQL, M07_UP_SQL } from './support/m07-migration-sql';
import { WITHDRAWAL_DOWN_SQL, WITHDRAWAL_UP_SQL } from './support/withdrawal-migration-sql';
import { M08_DOWN_SQL, M08_UP_SQL } from './support/m08-migration-sql';
import { M10_DOWN_SQL, M10_UP_SQL } from './support/m10-migration-sql';
import { M11_DOWN_SQL, M11_UP_SQL } from './support/m11-migration-sql';
import { ADJUSTMENT_DOWN_SQL, ADJUSTMENT_UP_SQL } from './support/adjustment-migration-sql';
import { WALLET_HOLD_DOWN_SQL, WALLET_HOLD_UP_SQL } from './support/wallet-hold-migration-sql';
import { SMS_GATEWAY_DOWN_SQL, SMS_GATEWAY_UP_SQL } from './support/sms-gateway-migration-sql';
import { CUSTOMER_ADDRESS_DOWN_SQL, CUSTOMER_ADDRESS_UP_SQL } from './support/customer-address-migration-sql';
import { CUSTOMER_DOWN_SQL, CUSTOMER_UP_SQL } from './support/customer-migration-sql';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M01-A1 — the Auth Core migration, with the same rules as the M00 migrations: clean install, a no-op second
// up, a REAL upgrade from the current main schema, drift that fails loudly and atomically, an explicit down,
// and a database that enforces the contract's invariants on its own.
//
// Like migration.int.spec.ts this suite RESETS the guarded test database (after the target guard passed) and
// always leaves it fully migrated for the specs that follow.
describe('M01-A1 — Auth Core migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const names = files.map((file) => file.replace(/\.sql$/, ''));
  const AUTH = names.find((name) => name.endsWith('create-auth-core')) as string;
  // M01-A2S adds a migration AFTER the Auth one (it references app.users); this suite owns the Auth one only.
  const SHOP = names.find((name) => name.endsWith('create-shop-onboarding')) as string;
  // M01-A2D adds one more migration after the Shop one (it references app.service_areas and app.users).
  const DRIVER = names.find((name) => name.endsWith('create-driver-onboarding')) as string;
  const M00 = names.slice(0, names.indexOf(AUTH));
  const HOURS = names.find((name) => name.endsWith('create-shop-business-hours')) as string;
  // M01-D-LOGIN adds two more migrations after the business-hours one: the account origin of app.users, then the admin tables.
  const ORIGIN = names.find((name) => name.endsWith('add-users-account-origin')) as string;
  const ADMIN = names.find((name) => name.endsWith('create-admin-auth')) as string;
  const originSql = readFileSync(path.join(migrationsDir, `${ORIGIN}.sql`), 'utf8');
  const originUpSql = (originSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const originDownSql = originSql.split('-- Down Migration')[1] as string;
  // M01-D-ADMIN-1A adds the invitation tables after the admin ones (they reference app.admin_memberships and app.users).
  const INVITATIONS = names.find((name) => name.endsWith('create-admin-invitations')) as string;
  const invitationsSql = readFileSync(path.join(migrationsDir, `${INVITATIONS}.sql`), 'utf8');
  const invitationsUpSql = (invitationsSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const invitationsDownSql = invitationsSql.split('-- Down Migration')[1] as string;
  // M01-D-ADMIN-1B adds the step-up operations after the invitations (they reference admin_memberships, admin_sessions
  // and admin_invitations), so they go down first and come back up last.
  const OPERATIONS = names.find((name) => name.endsWith('create-admin-sensitive-operations')) as string;
  const operationsSql = readFileSync(path.join(migrationsDir, `${OPERATIONS}.sql`), 'utf8');
  const operationsUpSql = (operationsSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const operationsDownSql = operationsSql.split('-- Down Migration')[1] as string;
  const adminSql = readFileSync(path.join(migrationsDir, `${ADMIN}.sql`), 'utf8');
  const adminUpSql = (adminSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const adminDownSql = adminSql.split('-- Down Migration')[1] as string;
  const hoursSql = readFileSync(path.join(migrationsDir, `${HOURS}.sql`), 'utf8');
  const hoursUpSql = (hoursSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const hoursDownSql = hoursSql.split('-- Down Migration')[1] as string;
  const MENU = names.find((name) => name.endsWith('create-menu')) as string;
  const menuSql = readFileSync(path.join(migrationsDir, `${MENU}.sql`), 'utf8');
  const menuUpSql = (menuSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const menuDownSql = menuSql.split('-- Down Migration')[1] as string;
  const driverSql = readFileSync(path.join(migrationsDir, `${DRIVER}.sql`), 'utf8');
  const driverUpSql = (driverSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const driverDownSql = driverSql.split('-- Down Migration')[1] as string;
  const shopSql = readFileSync(path.join(migrationsDir, `${SHOP}.sql`), 'utf8');
  const shopUpSql = (shopSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const shopDownSql = shopSql.split('-- Down Migration')[1] as string;
  const authSql = readFileSync(path.join(migrationsDir, `${AUTH}.sql`), 'utf8');
  const upSql = (authSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = authSql.split('-- Down Migration')[1] as string;
  const TABLES = ['users', 'user_roles', 'phone_verifications', 'verification_proofs', 'sessions'] as const;

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

  async function presentTables(): Promise<string[]> {
    const result = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [[...TABLES]],
    );
    return result.rows.map((row) => row.relname);
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
    } finally {
      await client.end();
    }
  });

  it('is a NEW migration after every M00 migration (applied migrations are never edited)', () => {
    expect(AUTH).toBeDefined();
    expect(M00.length).toBeGreaterThanOrEqual(3);
    // Auth directly follows M00; the Shop, Driver, hours, origin, admin, invitation, operation and 1C migrations follow it.
    expect(names.slice(M00.length)).toEqual([
      AUTH,
      SHOP,
      DRIVER,
      HOURS,
      ORIGIN,
      ADMIN,
      INVITATIONS,
      OPERATIONS,
      '1792281600000_create-admin-activation',
      '1792368000000_extend-admin-auth-limits-activation',
      '1792454400000_create-admin-membership-origin-guard',
      '1792540800000_create-customer-profiles-consents',
      '1792627200000_allow-staging-fixture-account-origin',
      '1792713600000_allow-test-unverified-account-origin',
      '1792800000000_add-admin-activation-phone-verification-mode',
      '1792886400000_create-client-device-binding',
      '1792972800000_create-sms-gateway',
      '1793059200000_account-scope-lifecycle-settings',
      '1793145600000_create-menu',
      '1793232000000_menu-category-admin',
      '1793318400000_create-shipper-management',
      '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core',
      '1793491200000_create-wallet-holds',
      '1793577600000_create-wallet-topup-sources',
      '1793664000000_create-shipping-eligibility-parameters', '1793750400000_create-shipping-fee-policy', '1793836800000_m06-v1-1-three-tiers-agreement', '1793923200000_create-admin-finance-grants', '1794009600000_open-topup-ledger-gate', '1794096000000_create-m07-delivery', '1794182400000_create-m08-notifications', '1794268800000_create-m10-orders', '1794355200000_create-m11-reviews-complaints', '1794441600000_open-adjustment-ledger-gate', '1795046400000_add-shop-logo', '1795132800000_create-wallet-withdrawals', '1795219200000_simplify-shipper-onboarding', '1795305600000_service-area-coverage', '1795392000000_order-stage-timeouts', '1795478400000_bootstrap-cao-bang-gps-coverage', '1795564800000_shop-display-order-codes', '1795651200000_password-client-sessions', '1795737600000_create-m13-ops', '1795910400000_create-m12-report-exports', '1795996800000_create-m12-backup-restore', '1796083200000_m07-creator-cancel-after-pickup', '1796169600000_m07-fee-answer-deadline', '1796256000000_admin-shop-manage-right', '1796342400000_m07-fee-revision',
    ]);
    expect(names.filter((name) => name.endsWith('create-auth-core'))).toHaveLength(1);
  });

  it('clean install through M00 + Auth records every migration and creates no seed data', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await presentTables()).toEqual([...TABLES].sort());
    for (const table of TABLES) {
      const count = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table}`);
      expect([table, count.rows[0]?.n]).toEqual([table, 0]);
    }
  });

  it('a second up is a no-op (history rows untouched)', async () => {
    const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(migrate().status).toBe(0);
    const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  it('a REAL upgrade from the current main schema (history holds only the M00 migrations)', async () => {
    await reset();
    expect(migrate([String(M00.length)]).status).toBe(0);
    expect(await historyNames()).toEqual(M00);
    expect(await presentTables()).toEqual([]);

    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await presentTables()).toEqual([...TABLES].sort());
  });

  const drifts: ReadonlyArray<readonly [string, string, string]> = [
    ['a conflicting app.users', 'CREATE TABLE app.users (drifted integer)', 'users'],
    ['a conflicting app.sessions', 'CREATE TABLE app.sessions (drifted integer)', 'sessions'],
    ['a conflicting app.verification_proofs', 'CREATE TABLE app.verification_proofs (drifted integer)', 'verification_proofs'],
  ];
  for (const [label, ddl, table] of drifts) {
    it(`drift is NOT hidden: ${label} fails the whole migration atomically, with no history row and no partial tables`, async () => {
      await reset();
      expect(migrate([String(M00.length)]).status).toBe(0);
      await client.query(ddl);

      expect(migrate().status).not.toBe(0);
      expect(await historyNames()).toEqual(M00);
      // Only the drifted table exists: every table the failed migration had created was rolled back.
      expect(await presentTables()).toEqual([table]);
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = $1`,
        [table],
      );
      expect(columns.rows).toEqual([{ column_name: 'drifted' }]);

      await client.query(`DROP TABLE app.${table}`);
      expect(migrate().status).toBe(0);
      expect(await historyNames()).toEqual(names);
      expect(await presentTables()).toEqual([...TABLES].sort());
    });
  }

  it('has no IF [NOT] EXISTS outside comments, and the down migration runs in dependency order without CASCADE', () => {
    const statements = authSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(statements).not.toMatch(/CASCADE/i);
    const downStatements = downSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(downStatements).toEqual([
      'DROP TABLE app.sessions',
      'DROP TABLE app.verification_proofs',
      'DROP TABLE app.phone_verifications',
      'DROP TABLE app.user_roles',
      'DROP TABLE app.users',
    ]);
    // Auth-owned tables only: nothing of Shop, Driver, Wallet or Order. This is a STRUCTURAL assertion on the
    // tables the migration creates, not a word scan: literals such as active_role = 'SHOP' in a constraint or
    // an index are legitimate Auth semantics (the SHOP single-active-session invariant).
    const createdTables = [...statements.matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(createdTables).toEqual(TABLES.map((table) => `app.${table}`));
    // And every dropped table is one of them (the down migration is the exact inverse set).
    const droppedTables = downStatements.map((statement) => /^DROP TABLE (app\.[a-z_]+)$/.exec(statement)?.[1]);
    expect([...droppedTables].sort()).toEqual(TABLES.map((table) => `app.${table}`).sort());
  });

  it('down then up (as SQL in a transaction that is rolled back) leaves no orphan and no change', async () => {
    await reset();
    expect(migrate(PRE_TIMEOUT_MIGRATION_ARGS).status).toBe(0);
    await client.query('BEGIN');
    try {
      // The Shop and Driver migrations reference app.users, so they go down first and come back up last. The invitation
      // tables, the admin tables and the account origin are the newest: they go down before everything else.
      // The M01.02 customer tables reference app.users and are the very newest: they go down first and come back up last.
      await client.query(WITHDRAWAL_DOWN_SQL); // M04 withdrawals: the very newest, down first, up last
      await client.query(ADJUSTMENT_DOWN_SQL); // M04 adjustment gate: replaces the ledger gate of M07 and adds its source: the very newest, down first, up last
      await client.query(M11_DOWN_SQL); // M11: references users, shops, drivers, orders, deliveries and widens an M08 constraint: the very newest, down first, up last
      await client.query(M10_DOWN_SQL); // M10: references users, shops, dishes, addresses and deliveries: the very newest, down first, up last
      await client.query(M08_DOWN_SQL); // M08: references users, sessions and deliveries: the very newest, down first, up last
      await client.query(M07_DOWN_SQL); // M07: references users, shops, drivers, wallets and fee agreements: the very newest, down first, up last
      await client.query(POSTING_DOWN_SQL); // M04-B2.2b: replaces one function and needs the topup tables: newest, down first, up last
      await client.query(FINANCE_DOWN_SQL); // M04-B2.2a: newest, down first, up last
      await client.query(V11_DOWN_SQL); // M06 v1.1: references app.users, the very newest: down first, up last
      await client.query(FEE_POLICY_DOWN_SQL); // M06-A: references app.users: down first, up last
      await client.query(ELIGIBILITY_DOWN_SQL); // M06-B/C: references app.users: down first, up last
      await client.query(TOPUP_DOWN_SQL); // M04-B1 adds a ledger column and references the wallet core: the very newest, down first, up last
      await client.query(WALLET_HOLD_DOWN_SQL); // M04-A2.1 references app.driver_wallets: the very newest, down first, up last
      await client.query(WALLET_DOWN_SQL); // M04-A1: references app.drivers, the very newest: down first, up last
      await client.query(SHIPPER_DOWN_SQL); // M03: references app.drivers and app.users: down first, up last
      await client.query(CUSTOMER_ADDRESS_DOWN_SQL); // M05: references app.users, the very newest: down first, up last
      await client.query(ACCOUNT_SCOPE_DOWN_SQL); // changes app.users: down first, up last
      await client.query(SMS_GATEWAY_DOWN_SQL);
      await client.query(CLIENT_DEVICE_DOWN_SQL);
      await client.query(CUSTOMER_DOWN_SQL);
      for (const statement of ACTIVATION_DOWN_SQL) {
        await client.query(statement);
      }
      await client.query(operationsDownSql);
      await client.query(invitationsDownSql);
      await client.query(adminDownSql);
      await client.query(originDownSql);
      await client.query(menuDownSql);
      await client.query(hoursDownSql);
      await client.query(driverDownSql);
      await client.query(shopDownSql);
      await client.query(downSql);
      expect(await presentTables()).toEqual([]);
      const leftovers = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND (c.relname LIKE 'users%' OR c.relname LIKE 'sessions%'
             OR c.relname LIKE 'user_roles%' OR c.relname LIKE 'phone_verifications%' OR c.relname LIKE 'verification_proofs%')`,
      );
      expect(leftovers.rowCount).toBe(0);
      await client.query(upSql);
      await client.query(shopUpSql);
      await client.query(driverUpSql);
      await client.query(hoursUpSql);
      await client.query(originUpSql);
      await client.query(adminUpSql);
      await client.query(invitationsUpSql);
      await client.query(operationsUpSql);
      for (const statement of ACTIVATION_UP_SQL) {
        await client.query(statement);
      }
      await client.query(CUSTOMER_UP_SQL);
      await client.query(CLIENT_DEVICE_UP_SQL);
      await client.query(SMS_GATEWAY_UP_SQL);
      await client.query(ACCOUNT_SCOPE_UP_SQL);
      await client.query(menuUpSql);
      await client.query(SHIPPER_UP_SQL);
      await client.query(CUSTOMER_ADDRESS_UP_SQL);
      await client.query(WALLET_UP_SQL);
      await client.query(WALLET_HOLD_UP_SQL);
      await client.query(TOPUP_UP_SQL);
      await client.query(ELIGIBILITY_UP_SQL);
      await client.query(FEE_POLICY_UP_SQL);
      await client.query(V11_UP_SQL);
      await client.query(FINANCE_UP_SQL);
      await client.query(POSTING_UP_SQL);
      await client.query(M07_UP_SQL);
      await client.query(M08_UP_SQL);
      await client.query(M10_UP_SQL);
      await client.query(M11_UP_SQL);
      await client.query(ADJUSTMENT_UP_SQL);
      await client.query(WITHDRAWAL_UP_SQL);
      expect(await presentTables()).toEqual([...TABLES].sort());
    } finally {
      await client.query('ROLLBACK');
      expect(migrate().status).toBe(0);
    }
    expect(await presentTables()).toEqual([...TABLES].sort());
    expect(await historyNames()).toEqual(names);
  });

  it('the tables belong to the test role and the M00 trigger inventory is unchanged', async () => {
    const owners = await client.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(owners.rows).toEqual([{ owner: 'ship11_test' }]);
    const triggers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement|ops_events_)' AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard' AND t.tgname NOT IN ('timeout_policy_changes_immutable', 'timeout_snapshot_orders', 'timeout_snapshot_deliveries', 'timeout_snapshot_assignments', 'cancellation_transition_orders', 'cancellation_transition_deliveries', 'cancellation_transition_assignments', 'cancellation_transitions_immutable', 'sessions_auth_method_immutable_trg', 'sessions_release_binding_trg', 'sessions_invalidate_push_tokens_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg', 'shop_display_new_shop', 'shop_order_display_insert', 'shop_delivery_display_insert', 'report_export_jobs_no_delete', 'backup_records_no_delete', 'restore_requests_no_delete', 'backup_jobs_no_delete')`,
    );
    expect(triggers.rows[0]?.n).toBe(1); // only audit_logs_append_only
  });

  describe('the migrated schema matches the contract (drift detection)', () => {
    async function constraintNames(table: string): Promise<string[]> {
      const result = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('p', 'u', 'c', 'f') ORDER BY conname`,
        [`app.${table}`],
      );
      return result.rows.map((row) => row.conname).sort();
    }

    async function indexNames(table: string): Promise<string[]> {
      const result = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = $1 ORDER BY indexname`,
        [table],
      );
      return result.rows.map((row) => row.indexname);
    }

    it('has exactly the documented constraints and indexes', async () => {
      expect(await constraintNames('users')).toEqual(
        [
          'users_pkey',
          'users_scope_phone_uq',
          'users_lock_reason_ck',
          'users_lock_state_ck',
          'users_locked_at_ck',
          'users_phone_normalized_ck',
          'users_password_hash_ck',
          'users_status_ck',
          'users_version_ck',
          'users_time_order_ck',
          // M01-D-LOGIN: account origin (added by its own migration after this one).
          'users_account_origin_ck',
          'users_origin_verified_ck',
        ].sort(),
      );
      expect(await constraintNames('user_roles')).toEqual(['user_roles_pkey', 'user_roles_role_ck', 'user_roles_user_fk']);
      expect(await constraintNames('phone_verifications')).toEqual(
        [
          'phone_verifications_pkey',
          'phone_verifications_phone_ck',
          'phone_verifications_purpose_ck',
          'phone_verifications_otp_digest_ck',
          'phone_verifications_status_ck',
          'phone_verifications_attempt_count_ck',
          'phone_verifications_expiry_ck',
          'phone_verifications_resend_ck',
          'phone_verifications_verified_ck',
          'phone_verifications_invalidated_ck',
        ].sort(),
      );
      expect(await constraintNames('verification_proofs')).toEqual(
        [
          'verification_proofs_pkey',
          'verification_proofs_verification_uq',
          'verification_proofs_token_digest_uq',
          'verification_proofs_verification_fk',
          'verification_proofs_phone_ck',
          'verification_proofs_purpose_ck',
          'verification_proofs_token_digest_ck',
          'verification_proofs_expiry_ck',
          'verification_proofs_consumed_ck',
          'verification_proofs_invalidated_ck',
        ].sort(),
      );
      expect(await constraintNames('sessions')).toEqual(
        [
          'sessions_pkey',
          'sessions_token_digest_uq',
          'sessions_user_fk',
          'sessions_token_digest_ck',
          'sessions_device_id_ck',
          'sessions_platform_ck',
          'sessions_auth_method_ck',
          'sessions_password_client_ck',
          'sessions_app_ck',
          'sessions_active_role_ck',
          'sessions_expiry_ck',
          'sessions_revoked_ck',
          'sessions_time_order_ck',
        ].sort(),
      );
      expect(await indexNames('phone_verifications')).toEqual(['phone_verifications_lane_idx', 'phone_verifications_pkey']);
      expect(await indexNames('sessions')).toEqual([
        'sessions_active_shop_per_user_uq',
        'sessions_pkey',
        'sessions_token_digest_uq',
        'sessions_user_idx',
      ]);
    });

    it('the SHOP index is partial on (user_id) WHERE active_role = SHOP AND revoked_at IS NULL, with no expiry in it', async () => {
      const result = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'sessions_active_shop_per_user_uq'`,
      );
      const definition = (result.rows[0] as { indexdef: string }).indexdef;
      expect(definition).toMatch(/CREATE UNIQUE INDEX/);
      expect(definition).toMatch(/\(user_id\)/);
      expect(definition).toMatch(/active_role\)::text = 'SHOP'::text/);
      expect(definition).toMatch(/revoked_at IS NULL/);
      expect(definition).not.toMatch(/expires_at/);
    });
  });

  describe('the database enforces the invariants by itself', () => {
    const PHONE_SEED = String(Date.now()).slice(-8);
    let counter = 0;
    const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
    const DIGEST = 'a'.repeat(64);

    function phone(): string {
      counter += 1;
      // +84 9 then eight digits: unique per call inside this run.
      return `+849${String((Number(PHONE_SEED) + counter) % 100_000_000).padStart(8, '0')}`;
    }

    async function insertUser(options: { phone?: string; hash?: string; status?: string; version?: number } = {}): Promise<string> {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, now(), $4, $5, now(), now())`,
        [id, options.phone ?? phone(), options.hash ?? HASH, options.status ?? 'ACTIVE', options.version ?? 1],
      );
      return id;
    }

    async function insertSession(
      userId: string,
      overrides: { role?: string | null; revoked?: boolean; digest?: string; expiresInterval?: string } = {},
    ): Promise<void> {
      await client.query(
        `INSERT INTO app.sessions (session_id, user_id, token_digest, device_id, platform, app, active_role, expires_at, revoked_at, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, 'dev-1', 'ANDROID', 'SHIP11', $4,
                 clock_timestamp() + $5::interval, CASE WHEN $6::boolean THEN clock_timestamp() END,
                 clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours')`,
        [
          randomUUID(),
          userId,
          overrides.digest ?? randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
          overrides.role === undefined ? null : overrides.role,
          overrides.expiresInterval ?? '1 day',
          overrides.revoked === true,
        ],
      );
    }

    async function failureCode(run: () => Promise<unknown>): Promise<{ code: string; constraint: string | undefined }> {
      try {
        await run();
      } catch (error) {
        const { code, constraint } = error as { code: string; constraint?: string };
        return { code, constraint };
      }
      throw new Error('expected the statement to fail');
    }

    beforeAll(async () => {
      await client.query('DELETE FROM app.sessions');
      await client.query('DELETE FROM app.user_roles');
      await client.query('DELETE FROM app.users');
    });

    afterAll(async () => {
      await client.query('DELETE FROM app.sessions');
      await client.query('DELETE FROM app.user_roles');
      await client.query('DELETE FROM app.users');
    });

    it('one phone, one account (UNIQUE) and a bounded E.164 shape', async () => {
      const number = phone();
      await insertUser({ phone: number });
      expect(await failureCode(() => insertUser({ phone: number }))).toEqual({ code: '23505', constraint: 'users_scope_phone_uq' });
      for (const bad of ['0987654321', '+0123456789', '+84', 'abc']) {
        expect((await failureCode(() => insertUser({ phone: bad }))).constraint).toBe('users_phone_normalized_ck');
      }
    });

    it('refuses a plaintext-looking password, a bad status and a non-positive version', async () => {
      expect((await failureCode(() => insertUser({ hash: 'plaintext-password' }))).constraint).toBe('users_password_hash_ck');
      expect((await failureCode(() => insertUser({ hash: '$argon2i$v=19$x' }))).constraint).toBe('users_password_hash_ck');
      expect((await failureCode(() => insertUser({ status: 'BANNED' }))).constraint).toBe('users_status_ck');
      expect((await failureCode(() => insertUser({ version: 0 }))).constraint).toBe('users_version_ck');
    });

    it('user_roles is unique per (user, role), bounded UPPER_SNAKE and tied to a user', async () => {
      const userId = await insertUser();
      await client.query("INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'SHOP', now())", [userId]);
      expect(
        await failureCode(() => client.query("INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'SHOP', now())", [userId])),
      ).toEqual({ code: '23505', constraint: 'user_roles_pkey' });
      expect(
        (await failureCode(() => client.query("INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'shop', now())", [userId]))).constraint,
      ).toBe('user_roles_role_ck');
      expect(
        (await failureCode(() => client.query("INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, 'DRIVER', now())", [randomUUID()]))).constraint,
      ).toBe('user_roles_user_fk');
    });

    it('at most ONE unrevoked SHOP session per user; revoked, DRIVER and null-role sessions do not count', async () => {
      const userId = await insertUser();
      await insertSession(userId, { role: 'SHOP' });
      expect((await failureCode(() => insertSession(userId, { role: 'SHOP' }))).constraint).toBe('sessions_active_shop_per_user_uq');

      await insertSession(userId, { role: 'SHOP', revoked: true }); // revoked: allowed (history)
      await insertSession(userId, { role: 'DRIVER' });
      await insertSession(userId, { role: 'DRIVER' }); // many DRIVER sessions are fine
      await insertSession(userId, { role: null });
      await insertSession(userId, { role: null });

      // Another user is independent.
      const other = await insertUser();
      await insertSession(other, { role: 'SHOP' });
    });

    it('an expired but unrevoked SHOP session still occupies the slot (expiry is not part of the index)', async () => {
      const userId = await insertUser();
      await client.query(
        `INSERT INTO app.sessions (session_id, user_id, token_digest, device_id, platform, app, active_role, expires_at, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, 'dev-1', 'ANDROID', 'SHIP11', 'SHOP',
                 clock_timestamp() - interval '1 hour', clock_timestamp() - interval '3 hours', clock_timestamp() - interval '3 hours')`,
        [randomUUID(), userId, 'b'.repeat(64)],
      );
      expect((await failureCode(() => insertSession(userId, { role: 'SHOP' }))).constraint).toBe('sessions_active_shop_per_user_uq');
    });

    it('session digests are unique 64-char lowercase hex, and device labels are bounded', async () => {
      const userId = await insertUser();
      await insertSession(userId, { digest: DIGEST });
      expect((await failureCode(() => insertSession(userId, { digest: DIGEST }))).constraint).toBe('sessions_token_digest_uq');
      expect((await failureCode(() => insertSession(userId, { digest: 'A'.repeat(64) }))).constraint).toBe('sessions_token_digest_ck');
      expect(
        (await failureCode(() =>
          client.query(
            `INSERT INTO app.sessions (session_id, user_id, token_digest, device_id, platform, app, expires_at, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, 'bad device', 'ANDROID', 'SHIP11', now() + interval '1 day', now(), now())`,
            [randomUUID(), userId, 'c'.repeat(64)],
          ),
        )).constraint,
      ).toBe('sessions_device_id_ck');
    });

    it('phone_verifications: status vocabulary, digest shape, and the verified/invalidated markers move with the status', async () => {
      const insert = (status: string, extra = ''): Promise<unknown> =>
        client.query(
          `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, created_at ${extra ? ', ' + extra.split('=')[0] : ''})
           VALUES ($1::uuid, '+84900000001', 'REGISTER', $2, $3, 0, now() + interval '5 minutes', now() + interval '1 minute', now() ${extra ? ', ' + extra.split('=')[1] : ''})`,
          [randomUUID(), DIGEST, status],
        );
      await insert('PENDING_DELIVERY');
      await insert('PENDING');
      await insert('DELIVERY_FAILED');
      await insert('LOCKED');
      expect((await failureCode(() => insert('SENT'))).constraint).toBe('phone_verifications_status_ck');
      expect((await failureCode(() => insert('VERIFIED'))).constraint).toBe('phone_verifications_verified_ck');
      expect((await failureCode(() => insert('INVALIDATED'))).constraint).toBe('phone_verifications_invalidated_ck');
      await insert('VERIFIED', 'verified_at=now()');
      await insert('INVALIDATED', 'invalidated_at=now()');
      expect(
        (await failureCode(() =>
          client.query(
            `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, created_at)
             VALUES ($1::uuid, '+84900000001', 'REGISTER', 'NOT-HEX', 'PENDING', 0, now() + interval '5 minutes', now(), now())`,
            [randomUUID()],
          ),
        )).constraint,
      ).toBe('phone_verifications_otp_digest_ck');
      await client.query("DELETE FROM app.phone_verifications WHERE phone_normalized = '+84900000001'");
    });

    it('verification_proofs: a token digest is unique across proofs of DIFFERENT verifications', async () => {
      // Two valid verifications (A and B), one proof each. Reusing proof A's digest on proof B can only trip the
      // token-digest UNIQUE: B's verification is distinct and exists, so neither the one-proof-per-verification
      // UNIQUE nor the FK is involved.
      const verificationA = randomUUID();
      const verificationB = randomUUID();
      for (const [id, number] of [
        [verificationA, '+84900000003'],
        [verificationB, '+84900000004'],
      ] as const) {
        await client.query(
          `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, created_at, verified_at)
           VALUES ($1::uuid, $2, 'REGISTER', $3, 'VERIFIED', 0, now() + interval '5 minutes', now(), now(), now())`,
          [id, number, DIGEST],
        );
      }
      const insertProofFor = (verification: string, number: string, digest: string): Promise<unknown> =>
        client.query(
          `INSERT INTO app.verification_proofs (proof_id, verification_id, phone_normalized, purpose, token_digest, expires_at, created_at)
           VALUES ($1::uuid, $2::uuid, $3, 'REGISTER', $4, now() + interval '10 minutes', now())`,
          [randomUUID(), verification, number, digest],
        );
      const sharedDigest = '1'.repeat(64);
      await insertProofFor(verificationA, '+84900000003', sharedDigest);
      expect(await failureCode(() => insertProofFor(verificationB, '+84900000004', sharedDigest))).toEqual({
        code: '23505',
        constraint: 'verification_proofs_token_digest_uq',
      });
      // Proof B was not stored; with a different digest it is accepted, so the failure above was the digest alone.
      await insertProofFor(verificationB, '+84900000004', '2'.repeat(64));
      await client.query("DELETE FROM app.verification_proofs WHERE phone_normalized IN ('+84900000003', '+84900000004')");
      await client.query("DELETE FROM app.phone_verifications WHERE phone_normalized IN ('+84900000003', '+84900000004')");
    });

    it('verification_proofs: exactly one proof per verification, and a proof needs an existing verification', async () => {
      const verificationId = randomUUID();
      await client.query(
        `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, created_at, verified_at)
         VALUES ($1::uuid, '+84900000002', 'REGISTER', $2, 'VERIFIED', 0, now() + interval '5 minutes', now(), now(), now())`,
        [verificationId, DIGEST],
      );
      const insertProof = (digest: string, verification = verificationId): Promise<unknown> =>
        client.query(
          `INSERT INTO app.verification_proofs (proof_id, verification_id, phone_normalized, purpose, token_digest, expires_at, created_at)
           VALUES ($1::uuid, $2::uuid, '+84900000002', 'REGISTER', $3, now() + interval '10 minutes', now())`,
          [randomUUID(), verification, digest],
        );
      await insertProof('d'.repeat(64));
      expect((await failureCode(() => insertProof('e'.repeat(64)))).constraint).toBe('verification_proofs_verification_uq');
      // A FRESH digest: reusing 'd'.repeat(64) would trip verification_proofs_token_digest_uq before the FK.
      expect((await failureCode(() => insertProof('f'.repeat(64), randomUUID()))).constraint).toBe('verification_proofs_verification_fk');
      await client.query("DELETE FROM app.verification_proofs WHERE phone_normalized = '+84900000002'");
      await client.query("DELETE FROM app.phone_verifications WHERE phone_normalized = '+84900000002'");
    });
  });
});
