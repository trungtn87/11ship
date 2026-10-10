import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { REPO_ROOT } from './support/test-helpers';

// M01-D-ADMIN-1B - app.admin_sensitive_operations. The file obeys the repository rules and creates exactly the object
// the contract (section 5) defines; the CHECKs and the trigger enforce the stored state machine with the documented
// SQLSTATEs. Every data case runs inside a transaction that is ALWAYS rolled back, on the guarded test database only.

describe('M01-D-ADMIN-1B - admin_sensitive_operations migration', () => {
  const dir = path.join(REPO_ROOT, 'database', 'migrations');
  const FILE = '1792195200000_create-admin-sensitive-operations.sql';
  const sql = readFileSync(path.join(dir, FILE), 'utf8');
  const upSql = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = sql.split('-- Down Migration')[1] as string;
  let client: Client;

  const code = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    await client.end();
  });

  async function inventory(): Promise<string[]> {
    const result = await client.query<{ item: string }>(
      `SELECT 'relation:' || c.relname || ':' || c.relkind::text AS item
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname LIKE 'admin\\_sensitive\\_operation%'
       UNION ALL
       SELECT 'trigger:' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname = 'admin_sensitive_operations'
       UNION ALL
       SELECT 'function:' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname LIKE 'admin\\_sensitive\\_operation%'
       UNION ALL
       SELECT 'constraint:' || k.conname FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname = 'admin_sensitive_operations'
       ORDER BY 1`,
    );
    return result.rows.map((row) => row.item);
  }

  /** Runs `work` in a transaction that is always rolled back; returns the SQLSTATE of the first failure, if any. */
  async function inRollback(work: () => Promise<void>): Promise<string | undefined> {
    await assertTestDatabaseTarget(client);
    await client.query('BEGIN');
    try {
      await work();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** Inserts the minimal SYSTEM user, membership and session the foreign keys need, inside the current transaction. */
  async function actor(): Promise<{ userId: string; sessionId: string }> {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const phone = `+849${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await client.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [userId, phone],
    );
    await client.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
      [userId],
    );
    await client.query(
      `INSERT INTO app.admin_sessions (session_id, user_id, token_digest, csrf_nonce, csrf_key_id, password_binding, password_key_id,
         membership_version, factor_id, factor_version, device_id, mfa_completed_at, expires_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3, decode(repeat('00', 32), 'hex'), 'k1', repeat('b', 64), 'k1', 1, $4::uuid, 1, 'dev', now(),
               now() + interval '1 hour', now())`,
      [sessionId, userId, randomUUID().replace(/-/g, '').padEnd(64, 'c'), randomUUID()],
    );
    return { userId, sessionId };
  }

  async function insertOperation(
    who: { userId: string; sessionId: string },
    overrides: { status?: string; lifeSeconds?: number; action?: string; targetSql?: string; extra?: string } = {},
  ): Promise<string> {
    const operationId = randomUUID();
    const status = overrides.status ?? 'PENDING';
    await client.query(
      `INSERT INTO app.admin_sensitive_operations (operation_id, actor_user_id, actor_session_id, factor_id, factor_version,
         membership_version, action, target_id, expected_version, payload_fingerprint, fingerprint_key_id, status,
         created_at, expires_at, verified_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, gen_random_uuid(), 1, 1, $4::text, ${overrides.targetSql ?? 'NULL::uuid'},
              ${overrides.targetSql === undefined ? 'NULL' : '1'}, repeat('a', 64), 'k1', $5::text,
              c.t, c.t + make_interval(secs => $6::int), CASE WHEN $5::text <> 'PENDING' THEN c.t END
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) c`,
      [operationId, who.userId, who.sessionId, overrides.action ?? 'CREATE_INVITATION', status, overrides.lifeSeconds ?? 120],
    );
    return operationId;
  }

  it('is a NEW file that states the contract it implements, with no IF [NOT] EXISTS, no CASCADE and no seed', () => {
    expect(sql).toContain('-- Up Migration');
    expect(sql).toContain('-- Down Migration');
    expect(sql).toContain('M01-D-ADMIN-1B');
    const statements = code(sql);
    expect(statements).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\b(?:CREATE|DROP|ALTER)\b[^;]*\bIF\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\bCASCADE\b/i);
    expect(code(upSql)).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect([...code(upSql).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1])).toEqual([
      'app.admin_sensitive_operations',
    ]);
  });

  it('creates the table, the live-operation partial unique index, the guard function and its trigger', async () => {
    const items = await inventory();
    expect(items).toContain('relation:admin_sensitive_operations:r');
    expect(items).toContain('relation:admin_sensitive_operations_live_uq:i');
    expect(items).toContain('function:admin_sensitive_operation_transition_guard');
    expect(items).toContain('trigger:admin_sensitive_operation_transition_guard');
    const index = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'admin_sensitive_operations_live_uq'",
    );
    expect(index.rows[0]?.indexdef).toMatch(/UNIQUE INDEX .* \(actor_user_id\) WHERE .*PENDING.*VERIFIED/);
  });

  it('references memberships, sessions and invitations with plain NO ACTION foreign keys', async () => {
    const fks = await client.query<{ target: string; deferrable: boolean; on_delete: string }>(
      `SELECT confrelid::regclass::text AS target, condeferrable AS deferrable, confdeltype::text AS on_delete
         FROM pg_constraint WHERE conrelid = 'app.admin_sensitive_operations'::regclass AND contype = 'f' ORDER BY 1`,
    );
    expect(fks.rows).toEqual([
      { target: 'app.admin_invitations', deferrable: false, on_delete: 'a' },
      { target: 'app.admin_memberships', deferrable: false, on_delete: 'a' },
      { target: 'app.admin_sessions', deferrable: false, on_delete: 'a' },
    ]);
  });

  it.each([
    ['a life longer than 120 seconds', { lifeSeconds: 121 }, '23514'],
    ['a zero life', { lifeSeconds: 0 }, '23514'],
    ['a reissue without target', { action: 'REISSUE_INVITATION' }, '23514'],
    ['an unknown action', { action: 'DELETE_INVITATION' }, '23514'],
    ['an unknown status', { status: 'EXPIRED' }, '23514'],
  ])('CHECK refuses %s (23514)', async (_case, overrides, state) => {
    expect(
      await inRollback(async () => {
        await insertOperation(await actor(), overrides);
      }),
    ).toBe(state);
  });

  it('allows ONE live operation per actor (23505 for a second live one), any number of terminal ones', async () => {
    expect(
      await inRollback(async () => {
        const who = await actor();
        await insertOperation(who);
        await insertOperation(who);
      }),
    ).toBe('23505');
    expect(
      await inRollback(async () => {
        const who = await actor();
        const first = await insertOperation(who);
        await client.query(
          "UPDATE app.admin_sensitive_operations SET status = 'INVALIDATED', invalidated_at = clock_timestamp(), invalidated_reason = 'REPLACED' WHERE operation_id = $1::uuid",
          [first],
        );
        await insertOperation(who);
      }),
    ).toBeUndefined();
  });

  it('the trigger allows exactly the documented transitions and refuses the rest with 23001', async () => {
    const run = (statements: (id: string) => string[]): Promise<string | undefined> =>
      inRollback(async () => {
        const id = await insertOperation(await actor());
        for (const statement of statements(id)) {
          await client.query(statement);
        }
      });
    const set = (id: string, assignments: string): string =>
      `UPDATE app.admin_sensitive_operations SET ${assignments} WHERE operation_id = '${id}'::uuid`;

    // allowed
    expect(await run((id) => [set(id, 'attempt_count = 1'), set(id, 'attempt_count = 2')])).toBeUndefined();
    expect(await run((id) => [set(id, "status = 'VERIFIED', verified_at = clock_timestamp()"), set(id, "status = 'CONSUMED', consumed_at = clock_timestamp()")])).toBeUndefined();
    expect(await run((id) => [set(id, "status = 'INVALIDATED', invalidated_at = clock_timestamp(), invalidated_reason = 'REPLACED'")])).toBeUndefined();
    expect(
      await run((id) => [
        set(id, 'attempt_count = 1'),
        set(id, 'attempt_count = 2'),
        set(id, 'attempt_count = 3'),
        set(id, 'attempt_count = 4'),
        set(id, "attempt_count = 5, status = 'INVALIDATED', invalidated_at = clock_timestamp(), invalidated_reason = 'ATTEMPTS_EXHAUSTED'"),
      ]),
    ).toBeUndefined();
    // refused
    expect(await run((id) => [set(id, 'attempt_count = 2')])).toBe('23001');
    expect(await run((id) => [set(id, "payload_fingerprint = repeat('b', 64)")])).toBe('23001');
    expect(await run((id) => [set(id, "expires_at = expires_at + interval '1 second'")])).toBe('23001');
    expect(await run((id) => [set(id, "status = 'CONSUMED', verified_at = clock_timestamp(), consumed_at = clock_timestamp()")])).toBe('23001');
    expect(await run((id) => [set(id, "status = 'INVALIDATED', invalidated_at = clock_timestamp(), invalidated_reason = 'REPLACED'"), set(id, "status = 'PENDING', invalidated_at = NULL, invalidated_reason = NULL")])).toBe('23001');
    expect(await run((id) => [`DELETE FROM app.admin_sensitive_operations WHERE operation_id = '${id}'::uuid`])).toBe('23001');
    expect(await run((id) => [set(id, "status = 'INVALIDATED', invalidated_at = clock_timestamp(), invalidated_reason = 'ATTEMPTS_EXHAUSTED'")])).toBe('23001');
    // a fifth attempt without INVALIDATED violates the trigger (and the CHECK)
    expect(await run((id) => [set(id, 'attempt_count = 1'), set(id, 'attempt_count = 2'), set(id, 'attempt_count = 3'), set(id, 'attempt_count = 4'), set(id, 'attempt_count = 5')])).toBe('23001');
  });

  it('CHECK refuses a verification or a consumption at or after expires_at (23514)', async () => {
    expect(
      await inRollback(async () => {
        const id = await insertOperation(await actor());
        await client.query(
          "UPDATE app.admin_sensitive_operations SET status = 'VERIFIED', verified_at = expires_at WHERE operation_id = $1::uuid",
          [id],
        );
      }),
    ).toBe('23514');
  });

  it('the down migration drops in reverse order without CASCADE', () => {
    const statements = code(downSql)
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toEqual([
      'DROP TRIGGER admin_sensitive_operation_transition_guard ON app.admin_sensitive_operations',
      'DROP FUNCTION app.admin_sensitive_operation_transition_guard()',
      'DROP INDEX app.admin_sensitive_operations_live_uq',
      'DROP TABLE app.admin_sensitive_operations',
    ]);
  });

  it('up -> down -> up (rolled back) leaves no orphan and restores the exact object inventory', async () => {
    await assertTestDatabaseTarget(client);
    const before = await inventory();
    expect(before.length).toBeGreaterThan(0);
    await client.query('BEGIN');
    try {
      await client.query(downSql);
      expect(await inventory()).toEqual([]);
      await client.query(upSql);
      expect(await inventory()).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await inventory()).toEqual(before);
  });
});
