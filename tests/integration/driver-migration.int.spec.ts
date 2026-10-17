import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { SHIPPER_DOWN_SQL, SHIPPER_UP_SQL } from './support/shipper-migration-sql';
import { WALLET_DOWN_SQL, WALLET_UP_SQL } from './support/wallet-migration-sql';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// M01-A2D — the Driver onboarding migration (app.drivers only; Driver operating areas were removed by the Owner, task section 22), with the same rules as the M00,
// Auth and Shop migrations: clean install, a no-op second up, a REAL upgrade from the Shop-onboarding schema,
// drift that fails loudly and atomically, an explicit down, and a database that enforces the invariants on its
// own.
//
// Like the other migration suites this one RESETS the guarded test database (after the target guard passed)
// and always leaves it fully migrated for the specs that follow.
describe('M01-A2D — Driver onboarding migration', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const names = files.map((file) => file.replace(/\.sql$/, ''));
  const DRIVER = names.find((name) => name.endsWith('create-driver-onboarding')) as string;
  const BEFORE = names.slice(0, names.indexOf(DRIVER));
  const driverSql = readFileSync(path.join(migrationsDir, `${DRIVER}.sql`), 'utf8');
  const upSql = (driverSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = driverSql.split('-- Down Migration')[1] as string;
  const TABLES = ['drivers'] as const;

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

  it('is a NEW migration after M00, Auth Core and Shop onboarding, followed only by the M02-A one (applied migrations are never edited)', () => {
    expect(DRIVER).toBeDefined();
    expect(names.slice(names.indexOf(DRIVER))).toEqual([
      DRIVER,
      '1791763200000_create-shop-business-hours',
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
      '1792800000000_add-admin-activation-phone-verification-mode',
      '1792886400000_create-client-device-binding',
      '1792972800000_create-sms-gateway',
      '1793059200000_account-scope-lifecycle-settings',
      '1793145600000_create-menu',
      '1793232000000_menu-category-admin',
      '1793318400000_create-shipper-management',
      '1793404800000_create-customer-addresses',
      '1793404800000_create-driver-wallet-core',
    ]);
    expect(BEFORE.some((name) => name.endsWith('create-auth-core'))).toBe(true);
    expect(BEFORE[BEFORE.length - 1]?.endsWith('create-shop-onboarding')).toBe(true);
    expect(names.filter((name) => name.endsWith('create-driver-onboarding'))).toHaveLength(1);
    expect(DRIVER).toBe('1791676800000_create-driver-onboarding');
    expect(Number(DRIVER.split('_')[0])).toBeGreaterThan(Number((BEFORE[BEFORE.length - 1] as string).split('_')[0]));
  });

  it('clean install records every migration and creates the drivers table with NO seed data', async () => {
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

  it('a REAL upgrade from the current main schema (history holds M00, Auth and Shop onboarding)', async () => {
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

  it('has no IF [NOT] EXISTS or CASCADE outside comments; the down migration drops exactly its one table', () => {
    const strip = (text: string): string =>
      text
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
    const statements = strip(driverSql);
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(statements).not.toMatch(/CASCADE/i);
    expect(strip(downSql).split(';').map((s) => s.trim()).filter((s) => s.length > 0)).toEqual(['DROP TABLE app.drivers']);
    const created = [...strip(upSql).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual(['app.drivers']);
    // Scope: no bank, wallet, approval, order, delivery table; no seed INSERT; no trigger or function.
    expect(statements).not.toMatch(/\b(bank|wallet|approval|order|delivery|assignment|closure)\w*/i);
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(statements).not.toMatch(/\bCREATE\s+(TRIGGER|FUNCTION)\b/i);
  });

  it('down then up (as SQL in a transaction that is rolled back) leaves no orphan and no change', async () => {
    await reset();
    expect(migrate().status).toBe(0);
    await client.query('BEGIN');
    try {
      // The M03 migration references app.drivers: it goes down first and comes back up last.
      await client.query(WALLET_DOWN_SQL); // M04-A1 references app.drivers: the very newest
      await client.query(SHIPPER_DOWN_SQL);
      await client.query(downSql);
      expect(await presentTables()).toEqual([]);
      const leftovers = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname LIKE 'drivers%'`,
      );
      expect(leftovers.rowCount).toBe(0);
      await client.query(upSql);
      await client.query(SHIPPER_UP_SQL);
      await client.query(WALLET_UP_SQL);
      expect(await presentTables()).toEqual([...TABLES]);
    } finally {
      await client.query('ROLLBACK');
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
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(wallet_|driver_wallets_)' AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard' AND t.tgname NOT IN ('sessions_release_binding_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg')`,
    );
    expect(triggers.rows[0]?.n).toBe(1);
  });

  describe('the database enforces the invariants on its own', () => {
    const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
    const users: string[] = [];

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
      users.push(id);
      return id;
    }

    interface DriverOverrides {
      userId?: string;
      fullName?: string;
      plate?: string | null;
      type?: string;
      status?: string;
      accepting?: boolean;
      version?: number;
      createdAt?: string;
      updatedAt?: string;
    }

    async function insertDriver(o: DriverOverrides = {}): Promise<string> {
      const id = randomUUID();
      const userId = o.userId ?? (await insertUser());
      await client.query(
        `INSERT INTO app.drivers (driver_id, user_id, full_name, plate_number, driver_type, status, accepting_deliveries,
                                  version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
        [
          id,
          userId,
          o.fullName ?? 'Driver',
          o.plate === undefined ? null : o.plate,
          o.type ?? 'EXTERNAL',
          o.status ?? 'PENDING',
          o.accepting ?? false,
          o.version ?? 1,
          o.createdAt ?? '2026-01-01T00:00:00Z',
          o.updatedAt ?? '2026-01-01T00:00:00Z',
        ],
      );
      return id;
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
      await client.query('DELETE FROM app.drivers');
      if (users.length > 0) {
        await client.query('DELETE FROM app.users WHERE user_id = ANY($1::uuid[])', [users.splice(0)]);
      }
    }

    beforeAll(async () => {
      await wipe();
    });

    afterAll(async () => {
      await wipe();
    });

    it('has exactly the documented constraints and indexes', async () => {
      expect(await constraintNames('drivers')).toEqual(
        [
          'drivers_pkey',
          'drivers_user_uq',
          'drivers_user_fk',
          'drivers_full_name_ck',
          'drivers_plate_number_ck',
          'drivers_type_ck',
          'drivers_status_ck',
          'drivers_version_ck',
          'drivers_time_order_ck',
          'drivers_not_active_not_accepting_ck',
          // M03 (Shipper management): review state, reasons, the Shipper code and who reviewed.
          'drivers_shipper_code_uq',
          'drivers_shipper_code_ck',
          'drivers_reviewed_by_fk',
          'drivers_review_state_ck',
          'drivers_rejection_reason_ck',
          'drivers_suspension_reason_ck',
          'drivers_status_before_closing_ck',
        ].sort(),
      );
      expect(await indexNames('drivers')).toEqual(['drivers_full_name_idx', 'drivers_pkey', 'drivers_shipper_code_uq', 'drivers_status_idx', 'drivers_user_uq']);
    });

    it('defaults: EXTERNAL, not accepting, version 1; a driver must say its status and its name', async () => {
      const userId = await insertUser();
      const id = randomUUID();
      await client.query(
        `INSERT INTO app.drivers (driver_id, user_id, full_name, status, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'D', 'PENDING', now(), now())`,
        [id, userId],
      );
      const row = await client.query<{ driver_type: string; accepting_deliveries: boolean; version: string; plate_number: string | null }>(
        'SELECT driver_type, accepting_deliveries, version, plate_number FROM app.drivers WHERE driver_id = $1::uuid',
        [id],
      );
      expect(row.rows[0]).toMatchObject({ driver_type: 'EXTERNAL', accepting_deliveries: false, plate_number: null });
      expect(Number(row.rows[0]?.version)).toBe(1);
      expect(
        (
          await failureCode(async () =>
            client.query(
              `INSERT INTO app.drivers (driver_id, user_id, full_name, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, 'D', now(), now())`,
              [randomUUID(), await insertUser()],
            ),
          )
        ).code,
      ).toBe('23502');
      expect(
        (
          await failureCode(async () =>
            client.query(
              `INSERT INTO app.drivers (driver_id, user_id, status, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, 'PENDING', now(), now())`,
              [randomUUID(), await insertUser()],
            ),
          )
        ).code,
      ).toBe('23502');
    });

    it('one Driver per user; the user must exist', async () => {
      const userId = await insertUser();
      await insertDriver({ userId });
      expect(await failureCode(() => insertDriver({ userId }))).toMatchObject({ code: '23505', constraint: 'drivers_user_uq' });
      expect(await failureCode(() => insertDriver({ userId: randomUUID() }))).toMatchObject({
        code: '23503',
        constraint: 'drivers_user_fk',
      });
    });

    it('name and plate: trimmed non-blank, bounded', async () => {
      expect((await failureCode(() => insertDriver({ fullName: '   ' }))).constraint).toBe('drivers_full_name_ck');
      expect((await failureCode(() => insertDriver({ fullName: '' }))).constraint).toBe('drivers_full_name_ck');
      expect((await failureCode(() => insertDriver({ fullName: 'x'.repeat(121) }))).code).toBe('22001');
      expect((await failureCode(() => insertDriver({ plate: '  ' }))).constraint).toBe('drivers_plate_number_ck');
      expect((await failureCode(() => insertDriver({ plate: 'p'.repeat(33) }))).code).toBe('22001');
      await insertDriver({ plate: null });
      await insertDriver({ plate: '29A-123.45', fullName: 'x'.repeat(120) });
    });

    it('driver_type is EXTERNAL or PLATFORM; status is the five-value set; version >= 1; updated_at >= created_at', async () => {
      await insertDriver({ type: 'PLATFORM' });
      expect((await failureCode(() => insertDriver({ type: 'SYSTEM' }))).constraint).toBe('drivers_type_ck');
      expect((await failureCode(() => insertDriver({ type: 'external' }))).constraint).toBe('drivers_type_ck');
      for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']) {
        await insertDriver({ status });
      }
      for (const status of ['REJECTED', 'pending', '']) {
        expect([status, (await failureCode(() => insertDriver({ status }))).constraint]).toEqual([status, 'drivers_status_ck']);
      }
      // Longer than the column (varchar(16)): refused by the type, before any CHECK.
      expect((await failureCode(() => insertDriver({ status: 'PENDING_BALANCE_RESOLUTION' }))).code).toBe('22001');
      expect((await failureCode(() => insertDriver({ version: 0 }))).constraint).toBe('drivers_version_ck');
      expect(
        (await failureCode(() => insertDriver({ createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }))).constraint,
      ).toBe('drivers_time_order_ck');
    });

    it('only an ACTIVE driver may accept deliveries', async () => {
      await insertDriver({ status: 'ACTIVE', accepting: true });
      for (const status of ['PENDING', 'SUSPENDED', 'CLOSING', 'CLOSED']) {
        expect([status, (await failureCode(() => insertDriver({ status, accepting: true }))).constraint]).toEqual([
          status,
          'drivers_not_active_not_accepting_ck',
        ]);
      }
      // And an ACTIVE driver cannot be left accepting when it stops being ACTIVE.
      const id = await insertDriver({ status: 'ACTIVE', accepting: true });
      expect(
        (await failureCode(() => client.query("UPDATE app.drivers SET status = 'SUSPENDED' WHERE driver_id = $1::uuid", [id]))).constraint,
      ).toBe('drivers_not_active_not_accepting_ck');
    });

    it('a user that still has a Driver cannot be deleted: nothing cascades', async () => {
      const driver = await insertDriver();
      const owner = (await client.query<{ user_id: string }>('SELECT user_id FROM app.drivers WHERE driver_id = $1::uuid', [driver])).rows[0]
        ?.user_id as string;
      expect(await failureCode(() => client.query('DELETE FROM app.users WHERE user_id = $1::uuid', [owner]))).toMatchObject({
        code: '23503',
        constraint: 'drivers_user_fk',
      });
    });

    it('a Driver can be created by direct SQL without any area row, and no area table or index exists (task section 22)', async () => {
      const id = await insertDriver();
      const row = await client.query('SELECT 1 FROM app.drivers WHERE driver_id = $1::uuid', [id]);
      expect(row.rowCount).toBe(1);
      const leftovers = await client.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND (c.relname LIKE 'driver_service_areas%' OR c.relname LIKE 'driver_area%')`,
      );
      expect(leftovers.rows).toEqual([]);
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'drivers' ORDER BY column_name`,
      );
      expect(columns.rows.map((r) => r.column_name)).toEqual(
        // The A2D columns plus the M03 ones (review, suspension, closure, Shipper code). Still no area column.
        [
          'accepting_deliveries', 'created_at', 'driver_id', 'driver_type', 'full_name', 'plate_number', 'status', 'updated_at', 'user_id', 'version',
          'shipper_code', 'review_state', 'submitted_at', 'reviewed_at', 'reviewed_by', 'rejection_reason', 'suspension_reason', 'suspended_at',
          'status_before_closing', 'closure_requested_at', 'closure_note',
        ].sort(),
      );
    });
  });
});
