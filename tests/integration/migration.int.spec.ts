import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget, assertTestTarget } from './support/assert-test-target';
import { minimalChildEnv, REPO_ROOT, runNpmScript } from './support/test-helpers';

// F03 (B1) and C23 (M00-C1A1): clean install, second `up` as a no-op, a REAL upgrade from the previous
// slice, drift that is not hidden, and the guard that keeps all of this on the test database only.
//
// The guarded database is the one place these migrations may run, so the tests RESET it (drop schema
// "app" and the default history table) after the target guard has verified database and user. The
// suite always leaves the database fully migrated, because later specs use app.idempotency_records.
describe('F03 / C23 — migrations on the guarded test database', () => {
  const migrationsDir = path.join(REPO_ROOT, 'database', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const expectedNames = files.map((file) => file.replace(/\.sql$/, ''));
  const B1 = expectedNames.find((name) => name.endsWith('create-app-schema')) as string;
  const C1A1 = expectedNames.find((name) => name.endsWith('create-idempotency-records')) as string;
  const idempotencySql = readFileSync(path.join(migrationsDir, `${C1A1}.sql`), 'utf8');

  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  function migrate(extra: string[] = []): ReturnType<typeof runNpmScript> {
    // Exactly what a developer has in local mode: APP_ENV and DATABASE_URL, no admin credential.
    return runNpmScript('db:migrate', extra, minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl }));
  }

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client); // never DDL before the guard has passed
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations');
  }

  async function historyNames(): Promise<string[]> {
    const result = await client.query<{ name: string }>('SELECT name FROM public.pgmigrations ORDER BY id');
    return result.rows.map((row) => row.name);
  }

  async function tableExists(): Promise<boolean> {
    const result = await client.query("SELECT to_regclass('app.idempotency_records') IS NOT NULL AS present");
    return (result.rows[0] as { present: boolean }).present;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      // Leave the database migrated to the latest slice for every other spec.
      const result = migrate();
      if (result.status !== 0) {
        throw new Error('could not restore the migrated test database');
      }
    } finally {
      await client.end();
    }
  });

  it('has the B1 and C1A1 migrations, in order', () => {
    expect(expectedNames.length).toBeGreaterThanOrEqual(2);
    expect(expectedNames.indexOf(B1)).toBeLessThan(expectedNames.indexOf(C1A1));
  });

  it('C23: clean install applies B1 + C1A1 and records both in the history', async () => {
    await reset();
    const first = migrate();
    expect(first.status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
    expect(await tableExists()).toBe(true);
  });

  it('C23: a second up with the same history is a no-op (nothing re-applied, history untouched)', async () => {
    const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    const second = migrate();
    expect(second.status).toBe(0);
    const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
    expect(await historyNames()).toEqual(expectedNames);
  });

  it('C23: a REAL upgrade from B1 to C1A1 (history holds only B1, then the next up adds the table)', async () => {
    await reset();
    const baseOnly = migrate(['1']);
    expect(baseOnly.status).toBe(0);
    expect(await historyNames()).toEqual([B1]);
    expect(await tableExists()).toBe(false);
    const schema = await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'");
    expect(schema.rowCount).toBe(1);

    const upgrade = migrate();
    expect(upgrade.status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
    expect(await tableExists()).toBe(true);
  });

  it('C23: schema drift is NOT hidden: a pre-existing conflicting table makes the migration fail and stay unrecorded', async () => {
    await reset();
    expect(migrate(['1']).status).toBe(0);
    await client.query('CREATE TABLE app.idempotency_records (drifted integer)');

    const failing = migrate();
    expect(failing.status).not.toBe(0);
    expect(await historyNames()).toEqual([B1]);
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'idempotency_records'`,
    );
    expect(columns.rows).toEqual([{ column_name: 'drifted' }]); // the drifted table was left alone

    await client.query('DROP TABLE app.idempotency_records');
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(expectedNames);
  });

  it('C23: the migration has no blanket IF NOT EXISTS / IF EXISTS and the down migration is explicit', () => {
    const statements = idempotencySql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(statements).not.toMatch(/IF\s+EXISTS/i);
    expect(idempotencySql).toMatch(/--\s*Down Migration[\s\S]*DROP TABLE app\.idempotency_records;/);
    // nothing outside the idempotency scope is created
    expect(statements).not.toMatch(/audit_logs|outbox_events|\busers\b|\bsessions\b/i);
  });

  it('C23: local mode needs only DATABASE_URL (no admin credential reaches the migration process)', () => {
    const env = minimalChildEnv({ APP_ENV: 'test', DATABASE_URL: databaseUrl });
    expect(env.PGPASSWORD).toBeUndefined();
    expect(env.TEST_WRONG_USER_DATABASE_URL).toBeUndefined();
    expect(migrate().status).toBe(0);
  });

  it('C23: the test target guard still passes after the migrations, and the table belongs to the test role', async () => {
    await assertTestTarget(process.env);
    const owner = await client.query<{ owner: string }>(
      `SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = 'idempotency_records'`,
    );
    expect(owner.rows[0]?.owner).toBe('ship11_test');
  });

  describe('the migrated table matches the contract (drift detection)', () => {
    it('has exactly the documented constraints and indexes', async () => {
      const constraints = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'app.idempotency_records'::regclass AND contype IN ('p', 'u', 'c')
          ORDER BY conname`,
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual(
        [
          'idempotency_records_ciphertext_size_ck',
          'idempotency_records_fingerprint_ck',
          'idempotency_records_format_ck',
          'idempotency_records_guard_ck',
          'idempotency_records_identity_bounds_ck',
          'idempotency_records_iv_length_ck',
          'idempotency_records_key_format_ck',
          'idempotency_records_key_id_ck',
          'idempotency_records_ms_precision_ck',
          'idempotency_records_pkey',
          'idempotency_records_replay_all_or_none_ck',
          'idempotency_records_scope_key_uq',
          'idempotency_records_status_ck',
          'idempotency_records_tag_length_ck',
          'idempotency_records_ttl_ck',
        ].sort(),
      );
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'idempotency_records' ORDER BY indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'idempotency_records_dedupe_cleanup_idx',
        'idempotency_records_pkey',
        'idempotency_records_replay_cleanup_idx',
        'idempotency_records_scope_key_uq',
      ]);
    });

    const VALID: Record<string, string> = {
      record_id: 'gen_random_uuid()',
      scope_type: "'mig_test'",
      scope_id: "'s1'",
      operation_id: "'op'",
      idempotency_key: "'3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34'",
      request_fingerprint: "repeat('a', 64)",
      crypto_key_id: "'k1'",
      response_status: '201',
      replay_format_version: '1',
      replay_guard: "'{}'::jsonb",
      replay_ciphertext: "'\\x01'::bytea",
      replay_iv: "decode(repeat('00', 12), 'hex')",
      replay_tag: "decode(repeat('00', 16), 'hex')",
      created_at: "timestamptz '2030-01-01 00:00:00+00'",
      replay_expires_at: "timestamptz '2030-01-01 00:15:00+00'",
      dedupe_expires_at: "timestamptz '2030-01-08 00:00:00+00'",
    };

    async function attempt(overrides: Record<string, string>): Promise<{ code?: string; constraint?: string }> {
      const row = { ...VALID, ...overrides };
      const columns = Object.keys(row);
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO app.idempotency_records (${columns.join(', ')}) VALUES (${columns.map((column) => row[column]).join(', ')})`);
        return {};
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        return { code: failure.code, constraint: failure.constraint };
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('accepts a valid record and a valid tombstone', async () => {
      expect(await attempt({})).toEqual({});
      expect(await attempt({ replay_ciphertext: 'NULL', replay_iv: 'NULL', replay_tag: 'NULL' })).toEqual({});
    });

    const violations: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ['uppercase key', { idempotency_key: "'3F2B8C1E-9D4A-4B6F-8A21-5C7E0D9F1A34'" }, 'idempotency_records_key_format_ck'],
      ['nil UUID key', { idempotency_key: "'00000000-0000-0000-0000-000000000000'" }, 'idempotency_records_key_format_ck'],
      ['empty scope id', { scope_id: "''" }, 'idempotency_records_identity_bounds_ck'],
      ['short fingerprint', { request_fingerprint: "repeat('a', 63) || ' '" }, 'idempotency_records_fingerprint_ck'],
      ['bad key id', { crypto_key_id: "'bad key'" }, 'idempotency_records_key_id_ck'],
      ['status 500', { response_status: '500' }, 'idempotency_records_status_ck'],
      ['format version 2', { replay_format_version: '2' }, 'idempotency_records_format_ck'],
      ['guard is an array', { replay_guard: "'[]'::jsonb" }, 'idempotency_records_guard_ck'],
      ['only the tag NULL', { replay_tag: 'NULL' }, 'idempotency_records_replay_all_or_none_ck'],
      ['11-byte IV', { replay_iv: "decode(repeat('00', 11), 'hex')" }, 'idempotency_records_iv_length_ck'],
      ['15-byte tag', { replay_tag: "decode(repeat('00', 15), 'hex')" }, 'idempotency_records_tag_length_ck'],
      ['empty ciphertext', { replay_ciphertext: "''::bytea" }, 'idempotency_records_ciphertext_size_ck'],
      ['microsecond precision', { replay_expires_at: "timestamptz '2030-01-01 00:15:00.000001+00'" }, 'idempotency_records_ms_precision_ck'],
      ['replay TTL below 1 s', { replay_expires_at: "timestamptz '2030-01-01 00:00:00.999+00'" }, 'idempotency_records_ttl_ck'],
      ['replay after dedupe', { dedupe_expires_at: "timestamptz '2030-01-01 00:10:00+00'" }, 'idempotency_records_ttl_ck'],
      ['dedupe above 7 days', { dedupe_expires_at: "timestamptz '2030-01-08 00:00:01+00'" }, 'idempotency_records_ttl_ck'],
    ];
    for (const [label, overrides, constraint] of violations) {
      it(`refuses ${label} (${constraint})`, async () => {
        const outcome = await attempt(overrides);
        expect(outcome.code).toBe('23514');
        expect(outcome.constraint).toBe(constraint);
      });
    }

    it('refuses a duplicate of the exact tuple (UNIQUE) and a NULL in any identity column', async () => {
      await client.query('BEGIN');
      try {
        const columns = Object.keys(VALID);
        const insert = `INSERT INTO app.idempotency_records (${columns.join(', ')}) VALUES (${columns.map((column) => VALID[column]).join(', ')})`;
        await client.query(insert);
        await client.query('SAVEPOINT duplicate');
        let code: string | undefined;
        try {
          await client.query(insert);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe('23505');
        await client.query('ROLLBACK TO SAVEPOINT duplicate');
      } finally {
        await client.query('ROLLBACK');
      }
      expect((await attempt({ scope_id: 'NULL' })).code).toBe('23502');
    });
  });

  // ---------------------------------------------------------------------------------------------------
  // M00-C1B (C23 extension): audit_logs / outbox_events. Same rules as C1A1: clean install, no-op second
  // up, a REAL upgrade, drift that fails atomically, an explicit down in dependency order.
  // ---------------------------------------------------------------------------------------------------
  describe('C23 (C1B) — audit_logs and outbox_events migration', () => {
    const C1B = expectedNames.find((name) => name.endsWith('create-audit-outbox')) as string;
    const c1bSql = readFileSync(path.join(migrationsDir, `${C1B}.sql`), 'utf8');
    const upSql = (c1bSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
    const downSql = c1bSql.split('-- Down Migration')[1] as string;
    const AUDIT = 'audit_logs';
    const OUTBOX = 'outbox_events';

    async function present(name: string): Promise<boolean> {
      const result = await client.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`app.${name}`]);
      return (result.rows[0] as { present: boolean }).present;
    }

    async function functionPresent(): Promise<boolean> {
      const result = await client.query<{ present: boolean }>(
        "SELECT to_regprocedure('app.audit_logs_reject_mutation()') IS NOT NULL AS present",
      );
      return (result.rows[0] as { present: boolean }).present;
    }

    async function triggerCount(): Promise<number> {
      const result = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement|ops_events_)' AND t.tgname NOT IN ('timeout_policy_changes_immutable', 'timeout_snapshot_orders', 'timeout_snapshot_deliveries', 'timeout_snapshot_assignments', 'cancellation_transition_orders', 'cancellation_transition_deliveries', 'cancellation_transition_assignments', 'cancellation_transitions_immutable', 'sessions_auth_method_immutable_trg', 'sessions_release_binding_trg', 'sessions_invalidate_push_tokens_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg', 'shop_display_new_shop', 'shop_order_display_insert', 'shop_delivery_display_insert', 'report_export_jobs_no_delete', 'backup_records_no_delete', 'restore_requests_no_delete') AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard'`,
      );
      return (result.rows[0] as { n: number }).n;
    }

    async function c1bObjects(): Promise<{ audit: boolean; outbox: boolean; fn: boolean; triggers: number }> {
      return { audit: await present(AUDIT), outbox: await present(OUTBOX), fn: await functionPresent(), triggers: await triggerCount() };
    }

    it('is the last migration, after B1 and C1A1', () => {
      expect(C1B).toBeDefined();
      expect(expectedNames.indexOf(C1B)).toBeGreaterThan(expectedNames.indexOf(C1A1));
      expect(expectedNames.indexOf(C1B)).toBeGreaterThan(expectedNames.indexOf(B1));
    });

    it('clean install applies B1 → A1 → C1B in order and records all three', async () => {
      await reset();
      expect(migrate().status).toBe(0);
      expect(await historyNames()).toEqual(expectedNames);
      expect(await c1bObjects()).toEqual({ audit: true, outbox: true, fn: true, triggers: 1 });
    });

    it('a second up is a no-op (history rows untouched)', async () => {
      const before = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
      expect(migrate().status).toBe(0);
      const after = await client.query('SELECT id, name, run_on FROM public.pgmigrations ORDER BY id');
      expect(after.rows).toEqual(before.rows);
    });

    it('a REAL upgrade: history holds B1 and A1 only, then the next up adds C1B', async () => {
      await reset();
      expect(migrate(['2']).status).toBe(0);
      expect(await historyNames()).toEqual([B1, C1A1]);
      expect(await tableExists()).toBe(true);
      expect(await c1bObjects()).toEqual({ audit: false, outbox: false, fn: false, triggers: 0 });

      expect(migrate().status).toBe(0);
      expect(await historyNames()).toEqual(expectedNames);
      expect(await c1bObjects()).toEqual({ audit: true, outbox: true, fn: true, triggers: 1 });
    });

    const drifts: ReadonlyArray<readonly [string, string, { audit: boolean; outbox: boolean; fn: boolean }]> = [
      ['a conflicting app.audit_logs', 'CREATE TABLE app.audit_logs (drifted integer)', { audit: true, outbox: false, fn: false }],
      ['a conflicting app.outbox_events', 'CREATE TABLE app.outbox_events (drifted integer)', { audit: false, outbox: true, fn: false }],
      [
        'a conflicting app.audit_logs_reject_mutation()',
        'CREATE FUNCTION app.audit_logs_reject_mutation() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
        { audit: false, outbox: false, fn: true },
      ],
    ];
    for (const [label, ddl, expected] of drifts) {
      it(`drift is NOT hidden: ${label} fails the migration atomically, with no history row and no partial objects`, async () => {
        await reset();
        expect(migrate(['2']).status).toBe(0);
        await client.query(ddl);

        expect(migrate().status).not.toBe(0);
        expect(await historyNames()).toEqual([B1, C1A1]);
        expect(await c1bObjects()).toEqual({ ...expected, triggers: 0 });

        // remove only the drift: the migration then applies cleanly
        if (expected.audit) {
          await client.query('DROP TABLE app.audit_logs');
        }
        if (expected.outbox) {
          await client.query('DROP TABLE app.outbox_events');
        }
        if (expected.fn) {
          await client.query('DROP FUNCTION app.audit_logs_reject_mutation()');
        }
        expect(migrate().status).toBe(0);
        expect(await historyNames()).toEqual(expectedNames);
        expect(await c1bObjects()).toEqual({ audit: true, outbox: true, fn: true, triggers: 1 });
      });
    }

    it('has no IF [NOT] EXISTS outside comments, and down runs in dependency order without CASCADE', () => {
      const statements = c1bSql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
      expect(statements).not.toMatch(/IF\s+EXISTS/i);
      const downStatements = downSql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      expect(downStatements).toEqual([
        'DROP TRIGGER audit_logs_append_only ON app.audit_logs',
        'DROP FUNCTION app.audit_logs_reject_mutation()',
        'DROP TABLE app.outbox_events',
        'DROP TABLE app.audit_logs',
      ]);
      // statements only: the comment above them says "No CASCADE" on purpose
      expect(downStatements.join(';')).not.toMatch(/CASCADE/i);
    });

    it('down then up (executed as SQL in a transaction that is rolled back) leaves no orphan and no change', async () => {
      await reset();
      expect(migrate().status).toBe(0);
      await client.query('BEGIN');
      try {
        await client.query(downSql);
        expect(await c1bObjects()).toEqual({ audit: false, outbox: false, fn: false, triggers: 0 });
        const leftovers = await client.query(
          `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND (c.relname LIKE 'audit_logs%' OR c.relname LIKE 'outbox_events%')`,
        );
        expect(leftovers.rowCount).toBe(0);
        await client.query(upSql);
        expect(await c1bObjects()).toEqual({ audit: true, outbox: true, fn: true, triggers: 1 });
      } finally {
        await client.query('ROLLBACK');
      }
      expect(await c1bObjects()).toEqual({ audit: true, outbox: true, fn: true, triggers: 1 });
      expect(await historyNames()).toEqual(expectedNames);
    });

    it('the target guard is unchanged and still passes after C1B', async () => {
      await assertTestTarget(process.env);
      const owners = await client.query<{ owner: string }>(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname IN ('audit_logs', 'outbox_events')`,
      );
      expect(owners.rows).toEqual([{ owner: 'ship11_test' }]);
    });

    async function constraintNames(table: string): Promise<string[]> {
      const result = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('p', 'u', 'c') ORDER BY conname`,
        [`app.${table}`],
      );
      return result.rows.map((row) => row.conname).sort();
    }

    it('has exactly the documented constraints, indexes and trigger (drift detection)', async () => {
      expect(await constraintNames(AUDIT)).toEqual(
        [
          'audit_logs_pkey',
          'audit_logs_actor_type_ck',
          'audit_logs_actor_id_ck',
          'audit_logs_action_ck',
          'audit_logs_resource_type_ck',
          'audit_logs_resource_id_ck',
          'audit_logs_resource_version_ck',
          'audit_logs_resource_shape_ck',
          'audit_logs_outcome_ck',
          'audit_logs_reason_code_ck',
          'audit_logs_reason_required_ck',
          'audit_logs_metadata_ck',
        ].sort(),
      );
      expect(await constraintNames(OUTBOX)).toEqual(
        [
          'outbox_events_pkey',
          'outbox_events_event_type_ck',
          'outbox_events_schema_version_ck',
          'outbox_events_resource_type_ck',
          'outbox_events_resource_id_ck',
          'outbox_events_resource_version_ck',
          'outbox_events_payload_ck',
          'outbox_events_status_ck',
          'outbox_events_attempt_count_ck',
          'outbox_events_lease_ck',
          'outbox_events_published_ck',
          'outbox_events_time_order_ck',
          'outbox_events_last_error_code_ck',
        ].sort(),
      );
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename IN ('audit_logs', 'outbox_events') ORDER BY indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname).sort()).toEqual(
        ['audit_logs_pkey', 'outbox_events_pending_claim_idx', 'outbox_events_pkey', 'outbox_events_processing_reclaim_idx'].sort(),
      );
      const trigger = await client.query<{ tgname: string; tgtype: number; relname: string }>(
        `SELECT t.tgname, t.tgtype, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement|ops_events_)' AND t.tgname NOT IN ('timeout_policy_changes_immutable', 'timeout_snapshot_orders', 'timeout_snapshot_deliveries', 'timeout_snapshot_assignments', 'cancellation_transition_orders', 'cancellation_transition_deliveries', 'cancellation_transition_assignments', 'cancellation_transitions_immutable', 'sessions_auth_method_immutable_trg', 'sessions_release_binding_trg', 'sessions_invalidate_push_tokens_trg', 'client_device_key_links_guard_trg', 'client_session_bindings_guard_trg', 'client_device_bindings_guard_trg', 'client_device_keys_guard_trg', 'shop_display_new_shop', 'shop_order_display_insert', 'shop_delivery_display_insert', 'report_export_jobs_no_delete', 'backup_records_no_delete', 'restore_requests_no_delete') AND c.relname NOT IN ('admin_invitations', 'admin_invitation_permissions', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'admin_profiles', 'user_consents') AND t.tgname <> 'admin_membership_origin_guard'`,
      );
      expect(trigger.rows).toHaveLength(1);
      expect(trigger.rows[0]?.tgname).toBe('audit_logs_append_only');
      expect(trigger.rows[0]?.relname).toBe('audit_logs');
      // tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE -> statement + before + D/U/T
      expect(trigger.rows[0]?.tgtype).toBe(2 | 8 | 16 | 32);
    });

    const AUDIT_VALID: Record<string, string> = {
      audit_id: 'gen_random_uuid()',
      occurred_at: 'clock_timestamp()',
      request_id: 'gen_random_uuid()',
      actor_type: "'USER'",
      actor_id: "'u-1'",
      action: "'auth.register.v1'",
      resource_type: "'user'",
      resource_id: "'u-1'",
      resource_version: '1',
      outcome: "'SUCCESS'",
      reason_code: 'NULL',
      metadata: "'{}'::jsonb",
    };

    const OUTBOX_VALID: Record<string, string> = {
      event_id: 'gen_random_uuid()',
      event_type: "'order.created'",
      event_schema_version: '1',
      resource_type: "'order'",
      resource_id: "'o-1'",
      resource_version: '1',
      occurred_at: "timestamptz '2030-01-01 00:00:00+00'",
      payload: "'{}'::jsonb",
      status: "'PENDING'",
      attempt_count: '0',
      available_at: "timestamptz '2030-01-01 00:00:00+00'",
      locked_at: 'NULL',
      lock_token: 'NULL',
      published_at: 'NULL',
      last_error_code: 'NULL',
    };

    async function attemptInsert(
      table: string,
      valid: Record<string, string>,
      overrides: Record<string, string>,
    ): Promise<{ code?: string; constraint?: string }> {
      const row = { ...valid, ...overrides };
      const columns = Object.keys(row);
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO app.${table} (${columns.join(', ')}) VALUES (${columns.map((column) => row[column]).join(', ')})`);
        return {};
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        return { code: failure.code, constraint: failure.constraint };
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('accepts a valid audit row, an anonymous DENIED row without actor/resource, and a valid outbox row', async () => {
      expect(await attemptInsert(AUDIT, AUDIT_VALID, {})).toEqual({});
      expect(
        await attemptInsert(AUDIT, AUDIT_VALID, {
          actor_type: "'ANONYMOUS'",
          actor_id: 'NULL',
          resource_type: 'NULL',
          resource_id: 'NULL',
          resource_version: 'NULL',
          outcome: "'DENIED'",
          reason_code: "'INVALID_CREDENTIALS'",
        }),
      ).toEqual({});
      expect(await attemptInsert(OUTBOX, OUTBOX_VALID, {})).toEqual({});
    });

    const auditViolations: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ['lower-case actor type', { actor_type: "'user'" }, 'audit_logs_actor_type_ck'],
      ['actor id with a space', { actor_id: "'a b'" }, 'audit_logs_actor_id_ck'],
      ['a URL as action', { action: "'/api/register'" }, 'audit_logs_action_ck'],
      ['an action without a version segment', { action: "'register'" }, 'audit_logs_action_ck'],
      ['upper-case resource type', { resource_type: "'User'" }, 'audit_logs_resource_type_ck'],
      ['resource id with a slash', { resource_id: "'a/b'" }, 'audit_logs_resource_id_ck'],
      ['resource version 0', { resource_version: '0' }, 'audit_logs_resource_version_ck'],
      [
        'a resource id without a resource type',
        { resource_type: 'NULL', resource_version: 'NULL' },
        'audit_logs_resource_shape_ck',
      ],
      ['a resource version without a resource id', { resource_id: 'NULL' }, 'audit_logs_resource_shape_ck'],
      ['an unknown outcome', { outcome: "'MAYBE'" }, 'audit_logs_outcome_ck'],
      ['a lower-case reason code', { outcome: "'DENIED'", reason_code: "'bad'" }, 'audit_logs_reason_code_ck'],
      ['a DENIED row without a reason', { outcome: "'DENIED'" }, 'audit_logs_reason_required_ck'],
      ['a FAILURE row without a reason', { outcome: "'FAILURE'" }, 'audit_logs_reason_required_ck'],
      ['array metadata', { metadata: "'[]'::jsonb" }, 'audit_logs_metadata_ck'],
      ['metadata over 32 KiB', { metadata: "jsonb_build_object('a', repeat('x', 40000))" }, 'audit_logs_metadata_ck'],
    ];
    for (const [label, overrides, constraint] of auditViolations) {
      it(`audit_logs refuses ${label} (${constraint})`, async () => {
        const outcome = await attemptInsert(AUDIT, AUDIT_VALID, overrides);
        expect(outcome.code).toBe('23514');
        expect(outcome.constraint).toBe(constraint);
      });
    }

    const outboxViolations: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ['an event type without a dot', { event_type: "'created'" }, 'outbox_events_event_type_ck'],
      ['schema version 0', { event_schema_version: '0' }, 'outbox_events_schema_version_ck'],
      ['upper-case resource type', { resource_type: "'Order'" }, 'outbox_events_resource_type_ck'],
      ['resource id with a space', { resource_id: "'a b'" }, 'outbox_events_resource_id_ck'],
      ['resource version 0', { resource_version: '0' }, 'outbox_events_resource_version_ck'],
      ['array payload', { payload: "'[]'::jsonb" }, 'outbox_events_payload_ck'],
      ['payload over 256 KiB', { payload: "jsonb_build_object('a', repeat('x', 270000))" }, 'outbox_events_payload_ck'],
      ['an unknown status', { status: "'DONE'" }, 'outbox_events_status_ck'],
      ['a negative attempt count', { attempt_count: '-1' }, 'outbox_events_attempt_count_ck'],
      ['PROCESSING without a lease', { status: "'PROCESSING'" }, 'outbox_events_lease_ck'],
      [
        'a lease on a PENDING event',
        { locked_at: "timestamptz '2030-01-01 00:00:01+00'", lock_token: 'gen_random_uuid()' },
        'outbox_events_lease_ck',
      ],
      ['only a lock token', { lock_token: 'gen_random_uuid()' }, 'outbox_events_lease_ck'],
      ['PUBLISHED without published_at', { status: "'PUBLISHED'" }, 'outbox_events_published_ck'],
      ['published_at on a PENDING event', { published_at: "timestamptz '2030-01-01 00:00:01+00'" }, 'outbox_events_published_ck'],
      ['available_at before occurred_at', { available_at: "timestamptz '2029-12-31 23:59:59+00'" }, 'outbox_events_time_order_ck'],
      ['a lower-case last error code', { last_error_code: "'boom'" }, 'outbox_events_last_error_code_ck'],
    ];
    for (const [label, overrides, constraint] of outboxViolations) {
      it(`outbox_events refuses ${label} (${constraint})`, async () => {
        const outcome = await attemptInsert(OUTBOX, OUTBOX_VALID, overrides);
        expect(outcome.code).toBe('23514');
        expect(outcome.constraint).toBe(constraint);
      });
    }

    it('outbox_events allows two events of different types on the same resource version, and refuses a duplicate id', async () => {
      await client.query('BEGIN');
      try {
        const columns = Object.keys(OUTBOX_VALID);
        const insert = (overrides: Record<string, string>): string => {
          const row = { ...OUTBOX_VALID, ...overrides };
          return `INSERT INTO app.outbox_events (${columns.join(', ')}) VALUES (${columns.map((column) => row[column]).join(', ')})`;
        };
        await client.query(insert({ event_id: "'11111111-1111-4111-8111-111111111111'" }));
        await client.query(insert({ event_id: "'22222222-2222-4222-8222-222222222222'", event_type: "'order.paid'" }));
        await client.query('SAVEPOINT duplicate');
        let code: string | undefined;
        try {
          await client.query(insert({ event_id: "'11111111-1111-4111-8111-111111111111'" }));
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe('23505');
        await client.query('ROLLBACK TO SAVEPOINT duplicate');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('audit_logs is append-only: UPDATE, DELETE and TRUNCATE are rejected with restrict_violation, even on zero rows', async () => {
      const auditId = '33333333-3333-4333-8333-333333333333';
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO app.audit_logs (audit_id, occurred_at, request_id, actor_type, action, outcome, reason_code, metadata)
           VALUES ($1, clock_timestamp(), gen_random_uuid(), 'ANONYMOUS', 'auth.login.v1', 'DENIED', 'INVALID_CREDENTIALS', '{}')`,
          [auditId],
        );
        const statements = [
          `UPDATE app.audit_logs SET reason_code = 'CHANGED' WHERE audit_id = '${auditId}'`,
          "UPDATE app.audit_logs SET reason_code = 'CHANGED' WHERE false",
          `DELETE FROM app.audit_logs WHERE audit_id = '${auditId}'`,
          'DELETE FROM app.audit_logs WHERE false',
          'TRUNCATE app.audit_logs',
          'TRUNCATE app.audit_logs, app.outbox_events',
        ];
        for (const statement of statements) {
          await client.query('SAVEPOINT attempt');
          let code: string | undefined;
          try {
            await client.query(statement);
          } catch (error) {
            code = (error as { code?: string }).code;
          }
          expect(code).toBe('23001');
          await client.query('ROLLBACK TO SAVEPOINT attempt');
        }
        const untouched = await client.query<{ reason_code: string }>('SELECT reason_code FROM app.audit_logs WHERE audit_id = $1', [auditId]);
        expect(untouched.rows).toEqual([{ reason_code: 'INVALID_CREDENTIALS' }]);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('outbox_events is NOT append-only: the C1C dispatcher will update delivery state (no trigger on it)', async () => {
      const result = await client.query(
        `SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'app.outbox_events'::regclass AND NOT t.tgisinternal AND t.tgname !~ '^(orders?_|wallet_|driver_wallets_|admin_finance_grants_|deliver(y|ies)_|reviews_|review_|complaints_|complaint_|shipping_fee_policy_|shipping_eligibility_|shipping_fee_agreement|ops_events_)'`,
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
