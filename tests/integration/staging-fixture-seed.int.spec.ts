import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { StagingFixtureSeeder, StagingSeedConflictError } from '../../apps/backend/src/auth/staging-fixture-seeder';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { assertTestDatabaseTarget } from './support/assert-test-target';
import { purgePhone, randomPhone } from './support/auth-fixtures';
import { testPool } from './support/transaction-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';

// Issue #49 — the operator seed of staging fixtures against PostgreSQL: atomic batch, re-run safe, no privilege, no
// session, an audit row in the same transaction, other accounts never touched. It uses the same class and the same
// transaction shape as scripts/staging-seed-fixtures.js, on the guarded test database only (never staging).
describe('issue #49 — staging fixture seed (PostgreSQL)', () => {
  const config = loadIntegrationConfig();
  const pool = testPool(config.database);
  const seeder = new StagingFixtureSeeder(new UserRepository(), new AuditWriter(), new Argon2idPasswordHasher());
  const phones: string[] = [];
  let client: Client;

  const fresh = (): string => {
    const phone = randomPhone().normalized;
    phones.push(phone);
    return phone;
  };

  /** One transaction exactly as the CLI runs it: BEGIN, seed, COMMIT; ROLLBACK when the seed throws. */
  async function run(batch: Array<{ phoneNormalized: string; password: string }>): Promise<{ created: number; skipped: number }> {
    const prepared = await seeder.prepare(batch);
    const context: TransactionContext = { isActive: true, query: (text, values) => client.query(text, values as unknown[]) as never };
    await client.query('BEGIN');
    try {
      const result = await seeder.seed(context, prepared, randomUUID());
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const rowOf = async (phone: string): Promise<Record<string, unknown> | undefined> =>
    (await pool.query('SELECT * FROM app.users WHERE phone_normalized = $1', [phone])).rows[0];

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    await client.end();
    for (const phone of phones) {
      await purgePhone(pool, phone);
    }
    await pool.end();
  });

  it('creates ACTIVE roleless STAGING_FIXTURE users with no verification time, no role, no session and an audit row', async () => {
    const [a, b] = [fresh(), fresh()];
    expect(await run([{ phoneNormalized: a, password: 'Fixture-Pass-1' }, { phoneNormalized: b, password: 'Fixture-Pass-2' }])).toEqual({ created: 2, skipped: 0 });
    for (const phone of [a, b]) {
      const user = await rowOf(phone);
      expect(user).toMatchObject({ account_origin: 'STAGING_FIXTURE', status: 'ACTIVE', phone_verified_at: null });
      expect(String(user?.password_hash)).toMatch(/^\$argon2id\$/);
      const id = String(user?.user_id);
      const roles = await pool.query('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [id]);
      const sessions = await pool.query('SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [id]);
      const members = await pool.query('SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [id]);
      const proofs = await pool.query('SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1', [phone]);
      expect([roles.rowCount, sessions.rowCount, members.rowCount, proofs.rowCount]).toEqual([0, 0, 0, 0]);
      const audit = await pool.query(
        `SELECT actor_type, actor_id, outcome FROM app.audit_logs WHERE action = 'auth.staging_fixture_created.v1' AND resource_id = $1`,
        [id],
      );
      expect(audit.rows).toEqual([{ actor_type: 'OPERATOR', actor_id: 'staging-seed-cli', outcome: 'SUCCESS' }]);
    }
  });

  it('a re-run leaves existing fixtures untouched (password, version, update time) and writes no second audit row', async () => {
    const phone = fresh();
    await run([{ phoneNormalized: phone, password: 'Fixture-Pass-1' }]);
    const before = await rowOf(phone);
    expect(await run([{ phoneNormalized: phone, password: 'Another-Pass-9' }])).toEqual({ created: 0, skipped: 1 });
    expect(await rowOf(phone)).toEqual(before);
    const audit = await pool.query(`SELECT 1 FROM app.audit_logs WHERE action = 'auth.staging_fixture_created.v1' AND resource_id = $1`, [String(before?.user_id)]);
    expect(audit.rowCount).toBe(1);
  });

  it('is atomic: a batch that meets a verified or an administration account writes NOTHING, and never changes that account', async () => {
    for (const [origin, verified] of [['PHONE_VERIFIED', true], ['ADMIN_PROVISIONED', false]] as const) {
      const taken = fresh();
      const newcomer = fresh();
      const id = randomUUID();
      await pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', ${verified ? 'now()' : 'NULL'}, $3, 'ACTIVE', 1, now(), now())`,
        [id, taken, origin],
      );
      const before = await rowOf(taken);
      await expect(
        run([{ phoneNormalized: newcomer, password: 'Fixture-Pass-1' }, { phoneNormalized: taken, password: 'Fixture-Pass-1' }]),
      ).rejects.toBeInstanceOf(StagingSeedConflictError);
      expect(await rowOf(taken)).toEqual(before);
      expect(await rowOf(newcomer)).toBeUndefined();
    }
  });

  it('a failing audit write rolls the user back too (same transaction)', async () => {
    const phone = fresh();
    const failing = new StagingFixtureSeeder(
      new UserRepository(),
      { append: () => Promise.reject(new Error('audit down')) } as unknown as AuditWriter,
      new Argon2idPasswordHasher(),
    );
    const prepared = await failing.prepare([{ phoneNormalized: phone, password: 'Fixture-Pass-1' }]);
    const context: TransactionContext = { isActive: true, query: (text, values) => client.query(text, values as unknown[]) as never };
    await client.query('BEGIN');
    await expect(failing.seed(context, prepared, randomUUID())).rejects.toThrow('audit down');
    await client.query('ROLLBACK');
    expect(await rowOf(phone)).toBeUndefined();
  });

  it('two concurrent runs of the same batch create each fixture exactly once', async () => {
    const phone = fresh();
    const other = new Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      const prepared = await seeder.prepare([{ phoneNormalized: phone, password: 'Fixture-Pass-1' }]);
      const runOn = async (c: Client): Promise<{ created: number; skipped: number }> => {
        const context: TransactionContext = { isActive: true, query: (text, values) => c.query(text, values as unknown[]) as never };
        await c.query('BEGIN');
        try {
          const result = await seeder.seed(context, prepared, randomUUID());
          await c.query('COMMIT');
          return result;
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      };
      const results = await Promise.all([runOn(client), runOn(other)]);
      expect(results.map((r) => r.created).sort()).toEqual([0, 1]);
      expect(results.map((r) => r.skipped).sort()).toEqual([0, 1]);
      const count = await pool.query('SELECT count(*)::int AS n FROM app.users WHERE phone_normalized = $1', [phone]);
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      await other.end();
    }
  });
});
