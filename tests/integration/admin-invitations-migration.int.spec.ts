import { ACTIVATION_DOWN_SQL, ACTIVATION_UP_SQL } from './support/activation-migration-sql';
import { SMS_GATEWAY_DOWN_SQL, SMS_GATEWAY_UP_SQL } from './support/sms-gateway-migration-sql';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { REPO_ROOT } from './support/test-helpers';

// M01-D-ADMIN-1A - the migration file obeys the repository rules and creates exactly the designed objects; down then up
// works. The down/up run happens INSIDE a transaction that is always rolled back, on the guarded test database only
// (assertTestDatabaseTarget runs first), so the database is unchanged afterwards.
describe('M01-D-ADMIN-1A - admin invitations migration', () => {
  const dir = path.join(REPO_ROOT, 'database', 'migrations');
  const FILE = '1792108800000_create-admin-invitations.sql';
  const sql = readFileSync(path.join(dir, FILE), 'utf8');
  const upSql = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const downSql = sql.split('-- Down Migration')[1] as string;
  // M01-D-ADMIN-1B references app.admin_invitations, so its Down runs before ours and its Up after ours.
  const OPERATIONS_FILE = '1792195200000_create-admin-sensitive-operations.sql';
  const operationsSql = readFileSync(path.join(dir, OPERATIONS_FILE), 'utf8');
  const operationsUpSql = (operationsSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const operationsDownSql = operationsSql.split('-- Down Migration')[1] as string;
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
        WHERE n.nspname = 'app' AND c.relname LIKE 'admin\\_invitation%'
       UNION ALL
       SELECT 'trigger:' || t.tgname || ':' || c.relname
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname IN ('admin_invitations', 'admin_invitation_permissions')
       UNION ALL
       SELECT 'function:' || p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname LIKE 'admin\\_invitation%'
       UNION ALL
       SELECT 'constraint:' || c.relname || ':' || k.conname
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname IN ('admin_invitations', 'admin_invitation_permissions')
       ORDER BY 1`,
    );
    return result.rows.map((row) => row.item);
  }

  it('is a NEW file (no applied migration is edited) and states which design it implements', () => {
    expect(sql).toContain('-- Up Migration');
    expect(sql).toContain('-- Down Migration');
    expect(sql).toContain('01-Technical/01-schema-design.sql');
    expect(sql).toContain('M01-D-ADMIN-1A');
  });

  it('has no IF [NOT] EXISTS, no CASCADE and no seed outside comments, and creates exactly its two tables', () => {
    const statements = code(sql);
    // DDL guards only: the PL/pgSQL body legitimately says "IF EXISTS(SELECT ...)" in a condition.
    expect(statements).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\b(?:CREATE|DROP|ALTER)\b[^;]*\bIF\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\bCASCADE\b/i);
    expect(code(upSql)).not.toMatch(/\bINSERT\s+INTO\b/i);
    const created = [...code(upSql).matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual(['app.admin_invitations', 'app.admin_invitation_permissions']);
  });

  it('the pending-phone unique index is partial on status only (no now(), no expiry in the predicate)', async () => {
    const result = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'admin_invitations_pending_phone_uq'",
    );
    const definition = (result.rows[0] as { indexdef: string }).indexdef;
    expect(definition).toMatch(/CREATE UNIQUE INDEX/);
    expect(definition).toMatch(/\(phone_normalized\)/);
    expect(definition).toMatch(/status\)::text = 'PENDING'::text/);
    expect(definition).not.toMatch(/now|expires_at|current_timestamp/i);
  });

  it('successor_id is a DEFERRABLE INITIALLY DEFERRED foreign key; every other foreign key is immediate and NO ACTION', async () => {
    const result = await client.query<{ conname: string; condeferrable: boolean; condeferred: boolean; confdeltype: string; confupdtype: string }>(
      `SELECT conname, condeferrable, condeferred, confdeltype, confupdtype FROM pg_constraint
        WHERE contype = 'f' AND conrelid IN ('app.admin_invitations'::regclass, 'app.admin_invitation_permissions'::regclass)`,
    );
    expect(result.rows.length).toBe(4);
    const deferredOnes = result.rows.filter((row) => row.condeferrable);
    expect(deferredOnes).toHaveLength(1);
    expect(deferredOnes[0]).toMatchObject({ condeferred: true });
    expect(deferredOnes[0]?.conname).toMatch(/successor_id/);
    for (const row of result.rows) {
      expect([row.conname, row.confdeltype, row.confupdtype]).toEqual([row.conname, 'a', 'a']);
    }
  });

  it('installs exactly the designed triggers: transition guard, permissions immutable, permission insert guard, deferred VIEW check', async () => {
    const result = await client.query<{ tgname: string; relname: string; tgdeferrable: boolean; tginitdeferred: boolean }>(
      `SELECT t.tgname, c.relname, t.tgdeferrable, t.tginitdeferred FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname IN ('admin_invitations', 'admin_invitation_permissions') ORDER BY t.tgname`,
    );
    expect(result.rows).toEqual([
      { tgname: 'admin_invitation_permission_insert_guard', relname: 'admin_invitation_permissions', tgdeferrable: false, tginitdeferred: false },
      { tgname: 'admin_invitation_permissions_immutable', relname: 'admin_invitation_permissions', tgdeferrable: false, tginitdeferred: false },
      { tgname: 'admin_invitation_requires_view', relname: 'admin_invitations', tgdeferrable: true, tginitdeferred: true },
      { tgname: 'admin_invitation_transition_guard', relname: 'admin_invitations', tgdeferrable: false, tginitdeferred: false },
    ]);
  });

  it('the down migration drops in reverse dependency order without CASCADE', () => {
    const statements = code(downSql)
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toEqual([
      'DROP TRIGGER admin_invitation_requires_view ON app.admin_invitations',
      'DROP FUNCTION app.admin_invitation_requires_view()',
      'DROP TABLE app.admin_invitation_permissions',
      'DROP FUNCTION app.admin_invitation_permission_insert_guard()',
      'DROP FUNCTION app.admin_invitation_permissions_immutable()',
      'DROP TABLE app.admin_invitations',
      'DROP FUNCTION app.admin_invitation_transition_guard()',
    ]);
  });

  it('up -> down -> up (in a transaction that is rolled back) leaves no orphan and restores the exact object inventory', async () => {
    await assertTestDatabaseTarget(client);
    const before = await inventory();
    expect(before.length).toBeGreaterThan(0);
    await client.query('BEGIN');
    try {
      await client.query(SMS_GATEWAY_DOWN_SQL); // the SMS queue references the activation challenges: newest, down first, up last
      for (const statement of ACTIVATION_DOWN_SQL) {
        await client.query(statement);
      }
      await client.query(operationsDownSql);
      await client.query(downSql);
      expect(await inventory()).toEqual([]);
      await client.query(upSql);
      expect(await inventory()).toEqual(before);
      await client.query(operationsUpSql);
      for (const statement of ACTIVATION_UP_SQL) {
        await client.query(statement);
      }
      await client.query(SMS_GATEWAY_UP_SQL);
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await inventory()).toEqual(before);
  });
});
