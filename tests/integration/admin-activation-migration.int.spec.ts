import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { REPO_ROOT } from './support/test-helpers';

// M01-D-ADMIN-1C - migrations A (activation tables), B (limiter kinds), C (membership origin guard). The files obey the
// repository rules, are byte-equal to the DDL verified in docs/verification/m01-d-admin-1c-ddl, and Down -> Up works.
// Everything that mutates the schema runs inside a transaction that is ALWAYS rolled back, on the guarded test DB only.

const FILES = {
  A: '1792281600000_create-admin-activation.sql',
  B: '1792368000000_extend-admin-auth-limits-activation.sql',
  C: '1792454400000_create-admin-membership-origin-guard.sql',
} as const;

describe('M01-D-ADMIN-1C - activation migrations', () => {
  const dir = path.join(REPO_ROOT, 'database', 'migrations');
  const verified = path.join(REPO_ROOT, 'docs', 'verification', 'm01-d-admin-1c-ddl', 'sql');
  const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');
  const up = (sql: string): string => (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
  const down = (sql: string): string => sql.split('-- Down Migration')[1] as string;
  const code = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });
  afterAll(async () => {
    await client.end();
  });

  async function tables(): Promise<string[]> {
    const result = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r'
          AND c.relname IN ('admin_activation_attempts','admin_activation_otp_challenges','admin_profiles','admin_app_permissions')
        ORDER BY 1`,
    );
    return result.rows.map((row) => row.relname);
  }

  it.each(Object.entries(FILES))('migration %s obeys the repository rules', (_name, file) => {
    const sql = read(file);
    expect(sql).toContain('-- Up Migration');
    expect(sql).toContain('-- Down Migration');
    expect(sql).toContain('M01-D-ADMIN-1C');
    const statements = code(sql);
    expect(statements).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\b(?:CREATE|DROP|ALTER)\b[^;]*\bIF\s+EXISTS\b/i);
    expect(statements).not.toMatch(/\bCASCADE\b/i);
    expect(code(up(sql))).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it.each([
    ['A', 'A'],
    ['B', 'B'],
    ['C', 'C'],
  ] as const)('migration %s is byte-equal to the verified DDL (no drift)', (name) => {
    const sql = read(FILES[name]);
    expect(up(sql).trim().endsWith(readFileSync(path.join(verified, `${name}-up.sql`), 'utf8').trim())).toBe(true);
    expect(down(sql).trim()).toBe(readFileSync(path.join(verified, `${name}-down.sql`), 'utf8').trim());
  });

  it('creates the four activation tables and the origin guard trigger', async () => {
    expect(await tables()).toEqual([
      'admin_activation_attempts',
      'admin_activation_otp_challenges',
      'admin_app_permissions',
      'admin_profiles',
    ]);
    const trigger = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'admin_membership_origin_guard' AND NOT tgisinternal",
    );
    expect(trigger.rowCount).toBe(1);
  });

  it('limiter kinds accept the four activation kinds, refuse unknown ones (23514); Down B refuses while buckets exist', async () => {
    const insert = (kind: string): Promise<unknown> =>
      client.query(
        `INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, updated_at)
         VALUES (repeat('a', 64), $1, now(), 0, now())`,
        [kind],
      );
    for (const kind of ['ACTIVATION_REQUEST_IP', 'ACTIVATION_LINK_IP', 'ACTIVATION_OTP_SEND', 'ACTIVATION_TOTP']) {
      await client.query('BEGIN');
      try {
        await insert(kind);
      } finally {
        await client.query('ROLLBACK');
      }
    }
    await client.query('BEGIN');
    let state: string | undefined;
    try {
      await insert('ACTIVATION_RESET');
    } catch (error) {
      state = (error as { code?: string }).code;
    } finally {
      await client.query('ROLLBACK');
    }
    expect(state).toBe('23514');

    await client.query('BEGIN');
    let downState: string | undefined;
    try {
      await insert('ACTIVATION_TOTP');
      await client.query(down(read(FILES.B)));
    } catch (error) {
      downState = (error as { code?: string }).code;
    } finally {
      await client.query('ROLLBACK');
    }
    expect(downState).toBe('P0001');
  });

  it('Down (C, B, A) then Up (A, B, C) restores the schema; always rolled back', async () => {
    await assertTestDatabaseTarget(client);
    await client.query('BEGIN');
    try {
      await client.query(down(read(FILES.C)));
      await client.query(down(read(FILES.B)));
      await client.query(down(read(FILES.A)));
      expect(await tables()).toEqual([]);
      await client.query(up(read(FILES.A)));
      await client.query(up(read(FILES.B)));
      await client.query(up(read(FILES.C)));
      expect(await tables()).toHaveLength(4);
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await tables()).toHaveLength(4);
  });
});
