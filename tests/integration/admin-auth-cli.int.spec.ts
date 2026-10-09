import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { loadIntegrationConfig } from './support/test-helpers';
import { purgePhone, randomPhone } from './support/auth-fixtures';
import { testPool } from './support/transaction-fixtures';
import {
  ADMIN_PASSWORD,
  adminTestEnv,
  bootstrapSystem,
  count,
  initLimitConfig,
  purgeSystem,
  runCli,
} from './support/admin-fixtures';

// M01-D-LOGIN - the two operator commands, run in process against the guarded test database.
describe('M01-D-LOGIN - operator commands', () => {
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

  beforeEach(async () => {
    await purgeSystem(pool);
  });

  const everything = (result: { out: string[]; err: string[] }): string => [...result.out, ...result.err].join('\n');

  it('init-limit-config is idempotent and prints only a fixed word', async () => {
    await pool.query('DELETE FROM app.admin_auth_limit_config');
    const first = await initLimitConfig();
    expect(first.code).toBe(0);
    expect(first.out).toEqual(['admin-auth:init-limit-config: created']);
    const second = await initLimitConfig();
    expect(second.code).toBe(0);
    expect(second.out).toEqual(['admin-auth:init-limit-config: unchanged']);
    expect(await count(pool, 'SELECT 1 FROM app.admin_auth_limit_config')).toBe(1);
  });

  it('refuses a different limiter key id or key against the stored configuration', async () => {
    await initLimitConfig();
    const otherId = await runCli('init-limit-config', adminTestEnv({ ADMIN_RATE_LIMIT_KEY_ID: 'limiter-other' }));
    expect(otherId.code).toBe(1);
    const otherKey = await runCli(
      'init-limit-config',
      adminTestEnv({ ADMIN_RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 99).toString('base64') }),
    );
    expect(otherKey.code).toBe(1);
    expect(everything(otherKey)).not.toContain(Buffer.alloc(32, 99).toString('base64'));
  });

  it('bootstrap-system creates the single SYSTEM account once, then reports unchanged', async () => {
    await initLimitConfig();
    const phone = randomPhone();
    phones.push(phone.normalized);
    const created = await bootstrapSystem(phone.local);
    expect(created.code).toBe(0);
    expect(created.out).toEqual(['admin-auth:bootstrap-system: created']);
    expect(everything(created)).not.toContain(phone.local);
    expect(everything(created)).not.toContain(ADMIN_PASSWORD);

    const again = await bootstrapSystem(phone.local);
    expect(again.code).toBe(0);
    expect(again.out).toEqual(['admin-auth:bootstrap-system: unchanged']);

    const row = await pool.query<{ account_origin: string; phone_verified_at: Date | null; password_hash: string }>(
      'SELECT account_origin, phone_verified_at, password_hash FROM app.users WHERE phone_normalized = $1',
      [phone.normalized],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.account_origin).toBe('ADMIN_PROVISIONED');
    expect(row.rows[0]?.phone_verified_at).toBeNull();
    expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(
      await count(pool, `SELECT 1 FROM app.admin_memberships WHERE admin_role = 'SYSTEM' AND status = 'ACTIVE'`),
    ).toBe(1);
    const audit = await pool.query(`SELECT 1 FROM app.audit_logs WHERE action = 'admin_auth.system_bootstrapped.v1' AND actor_type = 'SYSTEM'`);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('refuses a second, different SYSTEM account and a phone that is already a registered application user', async () => {
    await initLimitConfig();
    const first = randomPhone();
    phones.push(first.normalized);
    expect((await bootstrapSystem(first.local)).code).toBe(0);

    const second = randomPhone();
    phones.push(second.normalized);
    const different = await bootstrapSystem(second.local);
    expect(different.code).toBe(1);
    expect(everything(different)).toContain('SYSTEM_ACCOUNT_DIFFERENT');
    expect(await count(pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [second.normalized])).toBe(0);

    await purgeSystem(pool);
    const registered = randomPhone();
    phones.push(registered.normalized);
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, 'not-a-real-hash', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), registered.normalized],
    );
    const clash = await bootstrapSystem(registered.local);
    expect(clash.code).toBe(1);
    expect(everything(clash)).toContain('PHONE_ALREADY_REGISTERED');
    expect(await count(pool, 'SELECT 1 FROM app.admin_memberships')).toBe(0);
  });

  it('refuses to bootstrap without the limiter configuration row', async () => {
    await initLimitConfig();
    await pool.query('DELETE FROM app.admin_auth_limit_config');
    const phone = randomPhone();
    phones.push(phone.normalized);
    const result = await bootstrapSystem(phone.local);
    expect(result.code).toBe(1);
    expect(everything(result)).toContain('LIMIT_CONFIG_MISSING');
    expect(await count(pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
    await initLimitConfig();
  });

  it('runs concurrent bootstraps of the same account to exactly one SYSTEM account', async () => {
    await initLimitConfig();
    const phone = randomPhone();
    phones.push(phone.normalized);
    const results = await Promise.all([1, 2, 3].map(() => bootstrapSystem(phone.local)));
    expect(results.every((result) => result.code === 0)).toBe(true);
    expect(results.filter((result) => result.out[0]?.endsWith('created'))).toHaveLength(1);
    expect(await count(pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
  });

  it('rejects malformed input and an unknown command without touching the database', async () => {
    await initLimitConfig();
    const noInput = await runCli('bootstrap-system', adminTestEnv(), '');
    expect(noInput.code).toBe(1);
    const extra = await runCli('bootstrap-system', adminTestEnv(), JSON.stringify({ phone: '0912345678', password: ADMIN_PASSWORD, role: 'x' }));
    expect(extra.code).toBe(1);
    const weak = await runCli('bootstrap-system', adminTestEnv(), JSON.stringify({ phone: randomPhone().local, password: 'short' }));
    expect(weak.code).toBe(1);
    expect(everything(weak)).not.toContain('short');
    const unknown = await runCli('explode', adminTestEnv());
    expect(unknown.code).toBe(2);
    expect(await count(pool, 'SELECT 1 FROM app.admin_memberships')).toBe(0);
  });

  it('refuses a target that is not the guarded test database', async () => {
    const result = await runCli('init-limit-config', adminTestEnv({ DATABASE_URL: 'postgres://u:secret-pass@db.example.test:5432/prod' }));
    expect(result.code).toBe(1);
    expect(everything(result)).not.toContain('secret-pass');
    expect(everything(result)).not.toContain('db.example.test');
  });
});
