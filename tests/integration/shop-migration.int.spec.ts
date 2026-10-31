import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { PRE_TIMEOUT_MIGRATION_ARGS } from './support/timeout-migration-sql';
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
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M01-A2S — the Shop onboarding migration (service_areas, shops, shop_members), with the same rules as the M00
// and Auth migrations: clean install, a no-op second up, a REAL upgrade from the Auth-only schema, drift that
// fails loudly and atomically, an explicit down, and a database that enforces the invariants on its own.
//
// Like the other migration suites this one RESETS the guarded test database (after the target guard passed)
// and always leaves it fully migrated for the specs that follow.
describe('M01-A2S — Shop onboarding migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const names = files.map((file) => file.replace(/\.sql$/, ''));
  const SHOP = names.find((name) => name.endsWith('create-shop-onboarding')) as string;
  const BEFORE = names.slice(0, names.indexOf(SHOP));
  const shopSql = readFileSync(path.join(migrationsDir, `${SHOP}.sql`), 'utf8');
  const upSql = (shopSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = shopSql.split('-- Down Migration')[1] as string;
  // M01-A2D adds a migration AFTER this one (drivers reference app.service_areas): it goes down first, up last.
  const DRIVER = names.find((name) => name.endsWith('create-driver-onboarding')) as string;
  const HOURS = names.find((name) => name.endsWith('create-shop-business-hours')) as string;
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
  const TABLES = ['service_areas', 'shop_members', 'shops'] as const;

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

  it('is a NEW migration after M00 and Auth Core, followed by the Driver, business-hours, account-origin and admin ones (applied migrations are never edited)', () => {
    expect(SHOP).toBeDefined();
    expect(names.slice(names.indexOf(SHOP))).toEqual([SHOP, DRIVER, HOURS, '1791936000000_add-users-account-origin', '1792022400000_create-admin-auth', '1792108800000_create-admin-invitations', '1792195200000_create-admin-sensitive-operations', '1792281600000_create-admin-activation', '1792368000000_extend-admin-auth-limits-activation', '1792454400000_create-admin-membership-origin-guard', '1792540800000_create-customer-profiles-consents', '1792627200000_allow-staging-fixture-account-origin', '1792713600000_allow-test-unverified-account-origin', '1792800000000_add-admin-activation-phone-verification-mode', '1792886400000_create-client-device-binding', '1792972800000_create-sms-gateway', '1793059200000_account-scope-lifecycle-settings', '1793145600000_create-menu', '1793232000000_menu-category-admin', '1793318400000_create-shipper-management', '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core', '1793491200000_create-wallet-holds', '1793577600000_create-wallet-topup-sources', '1793664000000_create-shipping-eligibility-parameters', '1793750400000_create-shipping-fee-policy', '1793836800000_m06-v1-1-three-tiers-agreement', '1793923200000_create-admin-finance-grants', '1794009600000_open-topup-ledger-gate', '1794096000000_create-m07-delivery', '1794182400000_create-m08-notifications', '1794268800000_create-m10-orders', '1794355200000_create-m11-reviews-complaints', '1794441600000_open-adjustment-ledger-gate', '1795046400000_add-shop-logo', '1795132800000_create-wallet-withdrawals', '1795219200000_simplify-shipper-onboarding', '1795305600000_service-area-coverage', '1795392000000_order-stage-timeouts', '1795478400000_bootstrap-cao-bang-gps-coverage', '1795564800000_shop-display-order-codes', '1795651200000_password-client-sessions', '1795737600000_create-m13-ops', '1795910400000_create-m12-report-exports', '1795996800000_create-m12-backup-restore', '1796083200000_m07-creator-cancel-after-pickup', '1796169600000_m07-fee-answer-deadline', '1796256000000_admin-shop-manage-right', '1796342400000_m07-fee-revision', '1796428800000_create-otp-policy', '1796515200000_shop-setup-readiness', '1796601600000_create-order-chat', '1796688000000_business-dashboard', '1796774400000_menu-item-description', '1796860800000_shop-finance-entitlements', '1796947200000_shared-address-book', '1797033600000_customer-courier-cod', '1797120000000_customer-courier-agreements-reviews', '1797206400000_order-address-change-guidance', '1797292800000_suspended-closure-keeps-suspension']);
    expect(BEFORE.some((name) => name.endsWith('create-auth-core'))).toBe(true);
    expect(names.filter((name) => name.endsWith('create-shop-onboarding'))).toHaveLength(1);
    expect(Number(SHOP.split('_')[0])).toBeGreaterThan(Number((BEFORE[BEFORE.length - 1] as string).split('_')[0]));
  });

  it('clean install records every migration and creates the three tables with NO seed data', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await presentTables()).toEqual([...TABLES]);
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

  it('a REAL upgrade from the current main schema (history holds M00 and Auth only)', async () => {
    await reset();
    expect(migrate([String(BEFORE.length)]).status).toBe(0);
    expect(await historyNames()).toEqual(BEFORE);
    expect(await presentTables()).toEqual([]);

    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await presentTables()).toEqual([...TABLES]);
  });

  for (const table of TABLES) {
    it(`drift is NOT hidden: a conflicting app.${table} fails the whole migration atomically (no history row, no partial tables)`, async () => {
      await reset();
      expect(migrate([String(BEFORE.length)]).status).toBe(0);
      await client.query(`CREATE TABLE app.${table} (drifted integer)`);

      expect(migrate().status).not.toBe(0);
      expect(await historyNames()).toEqual(BEFORE);
      expect(await presentTables()).toEqual([table]);
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = $1`,
        [table],
      );
      expect(columns.rows).toEqual([{ column_name: 'drifted' }]);

      await client.query(`DROP TABLE app.${table}`);
      expect(migrate().status).toBe(0);
      expect(await historyNames()).toEqual(names);
      expect(await presentTables()).toEqual([...TABLES]);
    });
  }

  it('has no IF [NOT] EXISTS or CASCADE outside comments; the down migration drops exactly its three tables in dependency order', () => {
    const strip = (text: string): string =>
      text
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
    const statements = strip(shopSql);
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(statements).not.toMatch(/CASCADE/i);
    expect(strip(downSql).split(';').map((s) => s.trim()).filter((s) => s.length > 0)).toEqual([
      'DROP TABLE app.shop_members',
      'DROP TABLE app.shops',
      'DROP TABLE app.service_areas',
    ]);
    const created = [...strip(upSql).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual(['app.service_areas', 'app.shops', 'app.shop_members']);
    // Scope: no Driver, Wallet, Order, Delivery, business-hours or menu table, no seed INSERT, no trigger.
    expect(statements).not.toMatch(/\b(driver|wallet|bank|order|delivery|business_hours|menu)\w*/i);
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+(TRIGGER|FUNCTION)\b/i);
  });

  it('down then up (as SQL in a transaction that is rolled back) leaves no orphan and no change', async () => {
    await reset();
    expect(migrate(PRE_TIMEOUT_MIGRATION_ARGS).status).toBe(0);
    await client.query('BEGIN');
    try {
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
      await client.query(WALLET_DOWN_SQL); // M04-A1 references app.drivers: the very newest, down first, up last
      await client.query(SHIPPER_DOWN_SQL); // M03 references app.drivers: down first, up last
      await client.query(menuDownSql);
      await client.query(hoursDownSql);
      await client.query(driverDownSql);
      await client.query(downSql);
      expect(await presentTables()).toEqual([]);
      const leftovers = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND (c.relname LIKE 'shops%' OR c.relname LIKE 'shop_members%' OR c.relname LIKE 'service_areas%')`,
      );
      expect(leftovers.rowCount).toBe(0);
      await client.query(upSql);
      await client.query(driverUpSql);
      await client.query(hoursUpSql);
      await client.query(menuUpSql);
      await client.query(SHIPPER_UP_SQL);
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
      expect(await presentTables()).toEqual([...TABLES]);
    } finally {
      await client.query('ROLLBACK');
      expect(migrate().status).toBe(0);
    }
    expect(await presentTables()).toEqual([...TABLES]);
    expect(await historyNames()).toEqual(names);
  });

  it('the tables belong to the test role and the trigger inventory is unchanged (only audit_logs_append_only)', async () => {
    const owners = await client.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = ANY($1::text[])`,
      [[...TABLES]],
    );
    expect(owners.rows).toEqual([{ owner: 'ship11_test' }]);
    const triggers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement|ops_events_)' AND t.tgname NOT IN ('timeout_policy_changes_immutable', 'timeout_snapshot_orders', 'timeout_snapshot_deliveries', 'timeout_snapshot_assignments', 'cancellation_transition_orders', 'cancellation_transition_deliveries', 'cancellation_transition_assignments', 'cancellation_transitions_immutable', 'sessions_auth_method_immutable_trg', 'sessions_release_binding_trg', 'sessions_invalidate_push_tokens_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg', 'shop_display_new_shop', 'shop_order_display_insert', 'shop_delivery_display_insert', 'report_export_jobs_no_delete', 'backup_records_no_delete', 'restore_requests_no_delete', 'backup_jobs_no_delete', 'business_finance_state_event', 'business_finance_message_event', 'business_finance_messages_immutable', 'business_bank_receipts_immutable', 'business_topup_sync', 'business_wallet_receipt', 'shop_entitlement_grants_guard', 'shop_entitlement_grants_immutable', 'shop_entitlement_grants_no_truncate') AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard'`,
    );
    expect(triggers.rows[0]?.n).toBe(1);
  });

  describe('the database enforces the invariants on its own', () => {
    const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
    const created: string[] = [];

    function phone(): string {
      return `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
    }

    async function insertUser(): Promise<string> {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, now(), 'ACTIVE', 1, now(), now())`,
        [id, phone(), HASH],
      );
      created.push(id);
      return id;
    }

    async function insertArea(overrides: { code?: string; name?: string; status?: string; version?: number } = {}): Promise<string> {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, now(), now())`,
        [id, overrides.code ?? `AREA-${id}`, overrides.name ?? 'Area', overrides.status ?? 'ACTIVE', overrides.version ?? 1],
      );
      return id;
    }

    interface ShopOverrides {
      name?: string;
      contact?: string;
      address?: string;
      lat?: number | null;
      lng?: number | null;
      area?: string | null;
      status?: string;
      accepting?: boolean;
      version?: number;
    }

    async function insertShop(o: ShopOverrides = {}): Promise<string> {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, pickup_lat, pickup_lng,
                                service_area_id, status, accepting_orders, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::double precision, $6::double precision, $7::uuid, $8, $9, $10, now(), now())`,
        [
          id,
          o.name ?? 'Shop',
          o.contact ?? '+84900000001',
          o.address ?? 'Address',
          o.lat === undefined ? null : o.lat,
          o.lng === undefined ? null : o.lng,
          o.area === undefined ? null : o.area,
          o.status ?? 'INCOMPLETE',
          o.accepting ?? false,
          o.version ?? 1,
        ],
      );
      return id;
    }

    async function insertMember(shopId: string, userId: string, role = 'OWNER'): Promise<void> {
      await client.query(
        `INSERT INTO app.shop_members (shop_id, user_id, member_role, created_at) VALUES ($1::uuid, $2::uuid, $3, now())`,
        [shopId, userId, role],
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

    async function wipe(): Promise<void> {
      await client.query('DELETE FROM app.shop_members');
      const shops = await client.query<{ shop_id: string }>('SELECT shop_id FROM app.shops');
      await purgeShopDisplayCodes(client, shops.rows.map((row) => row.shop_id));
      await client.query('DELETE FROM app.shops');
      await client.query('DELETE FROM app.service_areas');
      if (created.length > 0) {
        await client.query('DELETE FROM app.users WHERE user_id = ANY($1::uuid[])', [created.splice(0)]);
      }
    }

    beforeAll(async () => {
      await wipe();
    });

    afterAll(async () => {
      await wipe();
    });

    it('has exactly the documented constraints and indexes', async () => {
      expect(await constraintNames('service_areas')).toEqual(
        [
          'service_areas_pkey',
          'service_areas_code_uq',
          'service_areas_code_ck',
          'service_areas_name_ck',
          'service_areas_status_ck',
          'service_areas_version_ck',
          'service_areas_time_order_ck',
          'service_area_coverage_valid',
        ].sort(),
      );
      expect(await constraintNames('shops')).toEqual(
        [
          'shops_pkey',
          'shops_service_area_fk',
          'shops_name_ck', 'shops_logo_shape', 'shops_setup_request_pair_ck', 'shops_setup_request_note_ck',
          'shops_address_ck',
          'shops_contact_phone_ck',
          'shops_status_ck',
          'shops_version_ck',
          'shops_time_order_ck',
          'shops_pickup_gps_pair_ck',
          'shops_pickup_lat_ck',
          'shops_pickup_lng_ck',
          'shops_active_complete_ck',
          'shops_incomplete_not_accepting_ck',
        ].sort(),
      );
      expect(await constraintNames('shop_members')).toEqual(
        ['shop_members_pkey', 'shop_members_shop_fk', 'shop_members_user_fk', 'shop_members_role_ck'].sort(),
      );
      expect(await indexNames('service_areas')).toEqual(['service_areas_code_uq', 'service_areas_pkey']);
      expect(await indexNames('shops')).toEqual(['shops_pkey']);
      expect(await indexNames('shop_members')).toEqual([
        'shop_members_one_owner_per_shop_uq',
        'shop_members_one_owner_shop_per_user_uq',
        'shop_members_pkey',
      ]);
    });

    it('defaults: accepting_orders false, version 1; a shop must say its status', async () => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, status, created_at, updated_at)
         VALUES ($1::uuid, 'S', '+84900000002', 'A', 'INCOMPLETE', now(), now())`,
        [id],
      );
      const row = await client.query<{ accepting_orders: boolean; version: string }>(
        'SELECT accepting_orders, version FROM app.shops WHERE shop_id = $1::uuid',
        [id],
      );
      expect(row.rows[0]?.accepting_orders).toBe(false);
      expect(Number(row.rows[0]?.version)).toBe(1);
      expect(
        (
          await failureCode(() =>
            client.query(
              `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, created_at, updated_at)
               VALUES ($1::uuid, 'S', '+84900000002', 'A', now(), now())`,
              [randomUUID()],
            ),
          )
        ).code,
      ).toBe('23502');
    });

    it('service areas: unique code, trimmed non-blank code and name, ACTIVE|INACTIVE, version >= 1, time order', async () => {
      const code = `UNIQ-${randomUUID()}`;
      await insertArea({ code });
      expect(await failureCode(() => insertArea({ code }))).toEqual({ code: '23505', constraint: 'service_areas_code_uq' });
      expect((await failureCode(() => insertArea({ code: ' padded ' }))).constraint).toBe('service_areas_code_ck');
      expect((await failureCode(() => insertArea({ code: '' }))).constraint).toBe('service_areas_code_ck');
      expect((await failureCode(() => insertArea({ name: ' ' }))).constraint).toBe('service_areas_name_ck');
      expect((await failureCode(() => insertArea({ status: 'active' }))).constraint).toBe('service_areas_status_ck');
      expect((await failureCode(() => insertArea({ version: 0 }))).constraint).toBe('service_areas_version_ck');
      expect(
        (
          await failureCode(() =>
            client.query(
              `INSERT INTO app.service_areas (service_area_id, code, name, status, created_at, updated_at)
               VALUES ($1::uuid, $2, 'A', 'ACTIVE', now(), now() - interval '1 second')`,
              [randomUUID(), `T-${randomUUID()}`],
            ),
          )
        ).constraint,
      ).toBe('service_areas_time_order_ck');
    });

    it('shops: bounded contact phone, status set, version, GPS pair and ranges, NaN refused', async () => {
      for (const contact of ['0987654321', '+0123456789', '+8412', 'abc', '+84 987654321']) {
        expect((await failureCode(() => insertShop({ contact }))).constraint).toBe('shops_contact_phone_ck');
      }
      expect((await failureCode(() => insertShop({ name: '  ' }))).constraint).toBe('shops_name_ck');
      expect((await failureCode(() => insertShop({ address: '  ' }))).constraint).toBe('shops_address_ck');
      expect((await failureCode(() => insertShop({ status: 'PENDING' }))).constraint).toBe('shops_status_ck');
      expect((await failureCode(() => insertShop({ version: 0 }))).constraint).toBe('shops_version_ck');
      expect((await failureCode(() => insertShop({ lat: 10, lng: null }))).constraint).toBe('shops_pickup_gps_pair_ck');
      expect((await failureCode(() => insertShop({ lat: null, lng: 10 }))).constraint).toBe('shops_pickup_gps_pair_ck');
      expect((await failureCode(() => insertShop({ lat: 90.1, lng: 0 }))).constraint).toBe('shops_pickup_lat_ck');
      expect((await failureCode(() => insertShop({ lat: 0, lng: -180.1 }))).constraint).toBe('shops_pickup_lng_ck');
      expect((await failureCode(() => insertShop({ lat: Number.NaN, lng: 0 }))).constraint).toBe('shops_pickup_lat_ck');
      await insertShop({ lat: 90, lng: -180 });
    });

    it('an ACTIVE shop needs GPS and a service area; an INCOMPLETE one can never accept orders', async () => {
      const area = await insertArea();
      expect((await failureCode(() => insertShop({ status: 'ACTIVE', lat: 1, lng: 1 }))).constraint).toBe('shops_active_complete_ck');
      expect((await failureCode(() => insertShop({ status: 'ACTIVE', area }))).constraint).toBe('shops_active_complete_ck');
      await insertShop({ status: 'ACTIVE', lat: 1, lng: 1, area });
      expect((await failureCode(() => insertShop({ status: 'INCOMPLETE', accepting: true }))).constraint).toBe(
        'shops_incomplete_not_accepting_ck',
      );
      await insertShop({ status: 'ACTIVE', lat: 1, lng: 1, area, accepting: true }); // the later hours slice may flip it
    });

    it('a shop points only at an existing service area', async () => {
      expect((await failureCode(() => insertShop({ area: randomUUID() }))).constraint).toBe('shops_service_area_fk');
    });

    it('membership: only OWNER, one OWNER per shop, one owned shop per user, real shop and user', async () => {
      const owner = await insertUser();
      const other = await insertUser();
      const shop = await insertShop();
      const second = await insertShop();
      expect((await failureCode(() => insertMember(shop, owner, 'STAFF'))).constraint).toBe('shop_members_role_ck');
      await insertMember(shop, owner);
      expect(await failureCode(() => insertMember(shop, owner))).toEqual({ code: '23505', constraint: 'shop_members_pkey' });
      // A second OWNER of the same shop.
      expect((await failureCode(() => insertMember(shop, other))).constraint).toBe('shop_members_one_owner_per_shop_uq');
      // The same user owning a second shop.
      expect((await failureCode(() => insertMember(second, owner))).constraint).toBe('shop_members_one_owner_shop_per_user_uq');
      // Unknown shop / user: use a user that owns nothing and a shop without an owner, so only the FK can fail.
      expect((await failureCode(() => insertMember(randomUUID(), other))).constraint).toBe('shop_members_shop_fk');
      expect((await failureCode(() => insertMember(second, randomUUID()))).constraint).toBe('shop_members_user_fk');
      await insertMember(second, other);
    });

    it('nothing cascades: a user, a shop or a service area that is still referenced cannot be deleted', async () => {
      const user = await insertUser();
      const area = await insertArea();
      const shop = await insertShop({ status: 'ACTIVE', lat: 1, lng: 1, area });
      await insertMember(shop, user);
      expect(await failureCode(() => client.query('DELETE FROM app.users WHERE user_id = $1::uuid', [user]))).toMatchObject({
        code: '23503',
        constraint: 'shop_members_user_fk',
      });
      expect(await failureCode(() => client.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shop]))).toMatchObject({
        code: '23503',
        constraint: 'shop_members_shop_fk',
      });
      expect(await failureCode(() => client.query('DELETE FROM app.service_areas WHERE service_area_id = $1::uuid', [area]))).toMatchObject({
        code: '23503',
        constraint: 'shops_service_area_fk',
      });
    });
  });
});
