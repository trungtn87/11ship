import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M02-A acceptance A15 — the business-hours migration on a REAL PostgreSQL: clean install, a no-op second up, a
// real upgrade from the previous history, drift that fails loudly and atomically, an explicit down/up, and CHECK,
// primary key and foreign key constraints that hold on their own. Like the other migration suites it RESETS the
// guarded test database and leaves it fully migrated for the specs that follow.
describe('M02-A — Shop business-hours migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const names = files.map((file) => file.replace(/\.sql$/, ''));
  const HOURS = names.find((name) => name.endsWith('create-shop-business-hours')) as string;
  const BEFORE = names.slice(0, names.indexOf(HOURS));
  const hoursSql = readFileSync(path.join(migrationsDir, `${HOURS}.sql`), 'utf8');
  const upSql = (hoursSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = hoursSql.split('-- Down Migration')[1] as string;
  const TABLE = 'shop_business_hours';

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

  async function tablePresent(): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname = $1`,
      [TABLE],
    );
    return (result.rowCount ?? 0) === 1;
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

  it('is a NEW last migration after M00, Auth, Shop and Driver onboarding (applied migrations are never edited)', () => {
    expect(HOURS).toBeDefined();
    // M01-D-LOGIN adds the account-origin and the admin migrations after it (applied migrations are never edited).
    expect(names.slice(names.indexOf(HOURS))).toEqual([
      HOURS,
      '1791936000000_add-users-account-origin',
      '1792022400000_create-admin-auth',
      '1792108800000_create-admin-invitations',
      '1792195200000_create-admin-sensitive-operations',
      '1792281600000_create-admin-activation',
      '1792368000000_extend-admin-auth-limits-activation',
      '1792454400000_create-admin-membership-origin-guard',
      '1792540800000_create-customer-profiles-consents',
      '1792627200000_allow-staging-fixture-account-origin',
      '1792713600000_allow-test-unverified-account-origin',
      '1792800000000_add-admin-activation-phone-verification-mode', '1792886400000_create-client-device-binding', '1792972800000_create-sms-gateway', '1793059200000_account-scope-lifecycle-settings', '1793145600000_create-menu', '1793232000000_menu-category-admin', '1793318400000_create-shipper-management', '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core', '1793491200000_create-wallet-holds', '1793577600000_create-wallet-topup-sources', '1793664000000_create-shipping-eligibility-parameters', '1793750400000_create-shipping-fee-policy', '1793836800000_m06-v1-1-three-tiers-agreement', '1793923200000_create-admin-finance-grants', '1794009600000_open-topup-ledger-gate', '1794096000000_create-m07-delivery', '1794182400000_create-m08-notifications', '1794268800000_create-m10-orders', '1794355200000_create-m11-reviews-complaints', '1794441600000_open-adjustment-ledger-gate', '1795046400000_add-shop-logo', '1795132800000_create-wallet-withdrawals', '1795219200000_simplify-shipper-onboarding'
    ]);
    expect(HOURS).toBe('1791763200000_create-shop-business-hours');
    expect(BEFORE[BEFORE.length - 1]?.endsWith('create-driver-onboarding')).toBe(true);
    expect(names.filter((name) => name.endsWith('create-shop-business-hours'))).toHaveLength(1);
    expect(Number(HOURS.split('_')[0])).toBeGreaterThan(Number((BEFORE[BEFORE.length - 1] as string).split('_')[0]));
  });

  it('clean install records every migration and creates the table with NO seed data', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await tablePresent()).toBe(true);
    const count = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.${TABLE}`);
    expect(count.rows[0]?.n).toBe(0);
  });

  it('a second up is a no-op (history rows untouched)', async () => {
    const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(migrate().status).toBe(0);
    const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  it('a REAL upgrade from the previous schema (history holds everything before this migration)', async () => {
    await reset();
    expect(migrate([String(BEFORE.length)]).status).toBe(0);
    expect(await historyNames()).toEqual(BEFORE);
    expect(await tablePresent()).toBe(false);
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    expect(await tablePresent()).toBe(true);
  });

  it('upgrading keeps the existing shops and their accepting_orders column untouched', async () => {
    await reset();
    expect(migrate([String(BEFORE.length)]).status).toBe(0);
    const areaId = randomUUID();
    const shopId = randomUUID();
    await client.query(
      `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, 'Area', 'ACTIVE', 1, now(), now())`,
      [areaId, `MH-${areaId}`],
    );
    await client.query(
      `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, pickup_lat, pickup_lng,
                              service_area_id, status, accepting_orders, version, created_at, updated_at)
       VALUES ($1::uuid, 'Old shop', '+84900000002', 'Addr', 21, 105, $2::uuid, 'ACTIVE', true, 2, now(), now())`,
      [shopId, areaId],
    );
    expect(migrate().status).toBe(0);
    const row = await client.query('SELECT accepting_orders, version, status FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
    expect(row.rows.map((r) => [r.accepting_orders, Number(r.version), r.status])).toEqual([[true, 2, 'ACTIVE']]);
    const hours = await client.query(`SELECT 1 FROM app.${TABLE} WHERE shop_id = $1::uuid`, [shopId]);
    expect(hours.rowCount).toBe(0);
    await client.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
    await client.query('DELETE FROM app.service_areas WHERE service_area_id = $1::uuid', [areaId]);
  });

  it('drift is NOT hidden: a conflicting app table fails the whole migration atomically (no history row)', async () => {
    await reset();
    expect(migrate([String(BEFORE.length)]).status).toBe(0);
    await client.query(`CREATE TABLE app.${TABLE} (drifted integer)`);

    expect(migrate().status).not.toBe(0);
    expect(await historyNames()).toEqual(BEFORE);
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = $1`,
      [TABLE],
    );
    expect(columns.rows).toEqual([{ column_name: 'drifted' }]);

    await client.query(`DROP TABLE app.${TABLE}`);
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
  });

  it('has no IF [NOT] EXISTS or CASCADE outside comments; the down migration drops exactly its one table', () => {
    const strip = (text: string): string =>
      text
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
    const statements = strip(hoursSql);
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(statements).not.toMatch(/CASCADE/i);
    expect(strip(downSql).split(';').map((s) => s.trim()).filter((s) => s.length > 0)).toEqual([
      'DROP TABLE app.shop_business_hours',
    ]);
    const created = [...strip(upSql).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual(['app.shop_business_hours']);
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+(TRIGGER|FUNCTION)\b/i);
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(statements).not.toMatch(/accepting_orders|weekday\s*(=|BETWEEN)\s*0/i);
  });

  it('down then up (as SQL in a transaction that is rolled back) leaves no orphan and no change', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    await client.query('BEGIN');
    try {
      await client.query(downSql);
      expect(await tablePresent()).toBe(false);
      const leftovers = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname LIKE 'shop_business_hours%'`,
      );
      expect(leftovers.rowCount).toBe(0);
      // The legacy column of app.shops is not touched by the down migration.
      const column = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'shops' AND column_name = 'accepting_orders'`,
      );
      expect(column.rowCount).toBe(1);
      await client.query(upSql);
      expect(await tablePresent()).toBe(true);
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await tablePresent()).toBe(true);
    expect(await historyNames()).toEqual(names);
  });

  it('the table belongs to the test role and the trigger inventory is unchanged (only audit_logs_append_only)', async () => {
    const owners = await client.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = $1`,
      [TABLE],
    );
    expect(owners.rows).toEqual([{ owner: 'ship11_test' }]);
    const triggers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement)' AND t.tgname NOT IN ('sessions_release_binding_trg', 'sessions_invalidate_push_tokens_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg') AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard'`,
    );
    expect(triggers.rows[0]?.n).toBe(1);
  });

  describe('the database enforces the invariants on its own', () => {
    let areaId: string;
    let shopId: string;

    async function failure(run: () => Promise<unknown>): Promise<{ code: string; constraint: string | undefined }> {
      try {
        await run();
      } catch (error) {
        const { code, constraint } = error as { code: string; constraint?: string };
        return { code, constraint };
      }
      throw new Error('expected the statement to fail');
    }

    const insert = (weekday: number, start: number, end: number, offset: number, shop: string = shopId) =>
      client.query(
        `INSERT INTO app.${TABLE} (shop_id, weekday, start_minute, end_minute, end_day_offset)
         VALUES ($1::uuid, $2, $3, $4, $5)`,
        [shop, weekday, start, end, offset],
      );

    beforeAll(async () => {
      await reset();
      expect(migrate().status).toBe(0);
      areaId = randomUUID();
      shopId = randomUUID();
      await client.query(
        `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, 'Area', 'ACTIVE', 1, now(), now())`,
        [areaId, `MH-${areaId}`],
      );
      await client.query(
        `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, pickup_lat, pickup_lng,
                                service_area_id, status, accepting_orders, version, created_at, updated_at)
         VALUES ($1::uuid, 'Shop', '+84900000003', 'Addr', 21, 105, $2::uuid, 'ACTIVE', false, 2, now(), now())`,
        [shopId, areaId],
      );
    });

    afterAll(async () => {
      await client.query(`DELETE FROM app.${TABLE}`);
      await client.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
      await client.query('DELETE FROM app.service_areas WHERE service_area_id = $1::uuid', [areaId]);
    });

    it('has exactly the documented constraints', async () => {
      const result = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'app.shop_business_hours'::regclass ORDER BY conname`,
      );
      expect(result.rows.map((row) => row.conname)).toEqual([
        'shop_business_hours_end_ck',
        'shop_business_hours_offset_ck',
        'shop_business_hours_pkey',
        'shop_business_hours_shop_fk',
        'shop_business_hours_span_ck',
        'shop_business_hours_start_ck',
        'shop_business_hours_weekday_ck',
      ]);
    });

    it.each([
      ['plain interval', 1, 480, 1020, 0],
      ['midnight to midnight', 2, 0, 1440, 0],
      ['overnight', 3, 1080, 120, 1],
      ['exactly 24 hours from noon', 4, 720, 720, 1],
      ['24 hours from midnight spelled 0-0 +1', 5, 0, 0, 1],
      ['last minute of the day', 6, 1439, 1440, 0],
      ['Sunday overnight', 7, 1320, 60, 1],
    ])('accepts %s', async (_label, weekday, start, end, offset) => {
      await client.query(`DELETE FROM app.${TABLE}`);
      await insert(weekday, start, end, offset);
      const rows = await client.query(`SELECT 1 FROM app.${TABLE}`);
      expect(rows.rowCount).toBe(1);
    });

    it.each([
      ['weekday 0 (there is no all-week value in the database)', 0, 0, 60, 0, 'shop_business_hours_weekday_ck'],
      ['weekday 8', 8, 0, 60, 0, 'shop_business_hours_weekday_ck'],
      ['start 1440', 1, 1440, 0, 1, 'shop_business_hours_start_ck'],
      ['negative start', 1, -1, 60, 0, 'shop_business_hours_start_ck'],
      ['end 1441', 1, 0, 1441, 0, 'shop_business_hours_end_ck'],
      ['offset 2', 1, 60, 30, 2, 'shop_business_hours_offset_ck'],
      ['same day, end = start', 1, 60, 60, 0, 'shop_business_hours_span_ck'],
      ['same day, end < start', 1, 120, 60, 0, 'shop_business_hours_span_ck'],
      ['next day, end > start (more than 24h)', 1, 60, 120, 1, 'shop_business_hours_span_ck'],
      ['next day, end 1440', 1, 600, 1440, 1, 'shop_business_hours_span_ck'],
    ])('rejects %s', async (_label, weekday, start, end, offset, constraint) => {
      await client.query(`DELETE FROM app.${TABLE}`);
      expect(await failure(() => insert(weekday, start, end, offset))).toEqual({ code: '23514', constraint });
    });

    it('rejects a duplicate (shop, weekday, start) and an unknown shop', async () => {
      await client.query(`DELETE FROM app.${TABLE}`);
      await insert(1, 60, 120, 0);
      expect(await failure(() => insert(1, 60, 200, 0))).toEqual({ code: '23505', constraint: 'shop_business_hours_pkey' });
      expect(await failure(() => insert(1, 300, 400, 0, randomUUID()))).toEqual({
        code: '23503',
        constraint: 'shop_business_hours_shop_fk',
      });
    });

    it('a shop with hours cannot be deleted (no CASCADE)', async () => {
      await client.query(`DELETE FROM app.${TABLE}`);
      await insert(1, 60, 120, 0);
      expect((await failure(() => client.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shopId]))).code).toBe('23503');
    });
  });
});
