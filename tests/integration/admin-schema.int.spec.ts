import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { purgePhone, randomPhone } from './support/auth-fixtures';
import { purgeSystem } from './support/admin-fixtures';
import { loadIntegrationConfig, REPO_ROOT } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// M01-D-LOGIN - the database enforces the administration invariants on its own, and the two migration files obey the
// repository rules. (The clean-install / upgrade / down-up mechanics of every migration are exercised by
// auth-migration.int.spec.ts, which owns the database reset.)
describe('M01-D-LOGIN - administration schema', () => {
  const dir = path.join(REPO_ROOT, 'database', 'migrations');
  const originSql = readFileSync(path.join(dir, '1791936000000_add-users-account-origin.sql'), 'utf8');
  const adminSql = readFileSync(path.join(dir, '1792022400000_create-admin-auth.sql'), 'utf8');
  const hex64 = 'a'.repeat(64);
  let pool: Pool;
  const phones: string[] = [];

  beforeAll(() => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 4 });
  });

  afterAll(async () => {
    for (const phone of phones) {
      await purgePhone(pool, phone);
    }
    await pool.end();
  });

  async function adminUser(origin: 'ADMIN_PROVISIONED' | 'PHONE_VERIFIED' = 'ADMIN_PROVISIONED'): Promise<string> {
    const phone = randomPhone();
    phones.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', ${origin === 'PHONE_VERIFIED' ? 'now()' : 'NULL'}, $3, 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, origin],
    );
    return userId;
  }

  const stripComments = (sql: string): string =>
    sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

  it('the migration files carry no IF [NOT] EXISTS and no CASCADE outside comments', () => {
    for (const sql of [originSql, adminSql]) {
      const statements = stripComments(sql);
      expect(statements).not.toMatch(/IF\s+NOT\s+EXISTS/i);
      expect(statements).not.toMatch(/\bCASCADE\b/i);
      expect(sql).toContain('-- Up Migration');
      expect(sql).toContain('-- Down Migration');
    }
    // Only the origin down migration may use a guard, and it must not use IF EXISTS either.
    expect(stripComments(adminSql)).not.toMatch(/IF\s+EXISTS/i);
    expect(stripComments(originSql)).not.toMatch(/IF\s+EXISTS/i);
  });

  it('the admin migration seeds nothing and creates exactly its six tables', () => {
    const statements = stripComments((adminSql.split('-- Down Migration')[0] as string));
    expect(statements).not.toMatch(/\bINSERT\s+INTO\b/i);
    const created = [...statements.matchAll(/\bCREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)].map((match) => match[1]);
    expect(created).toEqual([
      'app.admin_memberships',
      'app.admin_auth_challenges',
      'app.admin_totp_factors',
      'app.admin_sessions',
      'app.admin_auth_limit_config',
      'app.admin_auth_limits',
    ]);
  });

  it('the origin down migration refuses to run while an administration-provisioned account exists', () => {
    const down = originSql.split('-- Down Migration')[1] as string;
    expect(down).toMatch(/RAISE\s+EXCEPTION/i);
    expect(down).toMatch(/account_origin\s*=\s*'ADMIN_PROVISIONED'/);
  });

  it('pairs the account origin with the phone verification', async () => {
    await adminUser('ADMIN_PROVISIONED');
    await adminUser('PHONE_VERIFIED');
    const phone = randomPhone();
    phones.push(phone.normalized);
    const insert = (origin: string, verifiedSql: string): Promise<unknown> =>
      pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', ${verifiedSql}, $3, 'ACTIVE', 1, now(), now())`,
        [randomUUID(), phone.normalized, origin],
      );
    await expect(insert('ADMIN_PROVISIONED', 'now()')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('PHONE_VERIFIED', 'NULL')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('MYSTERY', 'NULL')).rejects.toMatchObject({ code: '23514' });
  });

  it('allows a single SYSTEM membership and many ADMIN memberships', async () => {
    await purgeSystem(pool);
    const one = await adminUser();
    const two = await adminUser();
    const add = (user: string, role: string): Promise<unknown> =>
      pool.query(
        `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, 'ACTIVE', 1, now(), now())`,
        [user, role],
      );
    await add(one, 'SYSTEM');
    await expect(add(two, 'SYSTEM')).rejects.toMatchObject({ code: '23505' });
    await add(two, 'ADMIN');
    await expect(add(await adminUser(), 'ROOT')).rejects.toMatchObject({ code: '23514' });
  });

  it('allows one unrevoked session per administrator and refuses malformed digests and nonces', async () => {
    const user = await adminUser();
    await pool.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
      [user],
    );
    const nonce = `decode('${'ab'.repeat(32)}', 'hex')`;
    const insertSession = (digest: string, nonceSql: string = nonce, revoked: string = 'NULL'): Promise<unknown> =>
      pool.query(
        `INSERT INTO app.admin_sessions (session_id, user_id, token_digest, csrf_nonce, csrf_key_id, password_binding,
           password_key_id, membership_version, factor_id, factor_version, device_id, mfa_completed_at, expires_at, revoked_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3, ${nonceSql}, 'k1', '${hex64}', 'k1', 1, $4::uuid, 1, 'dev-1', now(), now() + interval '8 hours', ${revoked}, now())`,
        [randomUUID(), user, digest, randomUUID()],
      );
    await insertSession('1'.repeat(64));
    await expect(insertSession('2'.repeat(64))).rejects.toMatchObject({ code: '23505' });
    await expect(insertSession('NOT-HEX'.padEnd(64, 'x'), nonce, 'now()')).rejects.toMatchObject({ code: '23514' });
    await expect(insertSession('3'.repeat(64), `decode('abcd', 'hex')`, 'now()')).rejects.toMatchObject({ code: '23514' });
    // A revoked one does not block a new active one.
    await pool.query(`UPDATE app.admin_sessions SET revoked_at = now() WHERE user_id = $1::uuid`, [user]);
    await insertSession('4'.repeat(64));
  });

  it('keeps the limiter state shaped: hex bucket keys, known kinds, one configuration row', async () => {
    const insert = (key: string, kind: string): Promise<unknown> =>
      pool.query(
        `INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, updated_at)
         VALUES ($1, $2, now(), 0, now())`,
        [key, kind],
      );
    await expect(insert('0123456789', 'LOGIN_PHONE')).rejects.toMatchObject({ code: '23514' });
    await expect(insert(hex64, 'LOGIN_EMAIL')).rejects.toMatchObject({ code: '23514' });
    await insert('b'.repeat(64), 'TOTP_USER');
    await pool.query(`DELETE FROM app.admin_auth_limits WHERE bucket_key = $1`, ['b'.repeat(64)]);
    await expect(
      pool.query(
        `INSERT INTO app.admin_auth_limit_config (singleton_id, limiter_key_id, key_check, created_at) VALUES (2, 'k', $1, now())`,
        [hex64],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a factor is PENDING with a challenge and no step, or ACTIVE with a step and no challenge - nothing in between', async () => {
    const user = await adminUser();
    await pool.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
      [user],
    );
    const insertFactor = (state: string, step: string, activated: string, challenge: string): Promise<unknown> =>
      pool.query(
        `INSERT INTO app.admin_totp_factors (user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step,
           pending_challenge_id, created_at, activated_at)
         VALUES ($1::uuid, $2::uuid, $3, 1, 'k1', decode('00112233', 'hex'), decode('${'00'.repeat(12)}', 'hex'),
                 decode('${'00'.repeat(16)}', 'hex'), ${step}, ${challenge}, now(), ${activated})`,
        [user, randomUUID(), state],
      );
    await expect(insertFactor('ACTIVE', 'NULL', 'now()', 'NULL')).rejects.toMatchObject({ code: '23514' });
    await expect(insertFactor('PENDING', 'NULL', 'NULL', 'NULL')).rejects.toMatchObject({ code: '23514' });
    await expect(insertFactor('ACTIVE', '5', 'now()', 'NULL')).resolves.toBeDefined();
  });
});
