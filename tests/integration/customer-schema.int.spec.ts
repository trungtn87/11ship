import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { CustomerProfileRepository } from '../../apps/backend/src/auth/customer-profile-repository';
import { CustomerProvisioningParticipant } from '../../apps/backend/src/auth/customer-provisioning-participant';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { TechnicalError } from '../../apps/backend/src/common/app-errors';
import { QueryRows, TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { eventually } from './support/async-helpers';
import { purgePhone, randomPhone, rowLockWaitersRunning } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// M01.02 — the database enforces the customer invariants on its own (foreign keys, CHECKs, version bounds, immutable
// consents), and the CUSTOMER participant works on the CALLER's transaction: a rollback leaves no role, profile or
// consent behind, a repeat adds and overwrites nothing, ineligible accounts are refused before any write, and it takes
// the root user row lock. (The clean-install / upgrade / backfill mechanics are in customer-schema-migration.int.spec.ts.)
describe('M01.02 — customer tables and CUSTOMER participant', () => {
  const HASH = '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA';
  const CONSENT = { termsVersion: 'terms-2026.10', privacyVersion: 'privacy_1.0', clientApp: 'FOOD' } as const;
  const participant = new CustomerProvisioningParticipant(new UserRepository(), new CustomerProfileRepository());
  const phones: string[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 6 });
  });

  afterAll(async () => {
    for (const phone of phones) {
      await purgePhone(pool, phone);
    }
    await pool.end();
  });

  async function createUser(origin: 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED' = 'PHONE_VERIFIED'): Promise<string> {
    const phone = randomPhone();
    phones.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
                              created_at, updated_at)
       VALUES ($1::uuid, $2, $3, ${origin === 'PHONE_VERIFIED' ? 'clock_timestamp()' : 'NULL'}, $4, 'ACTIVE', 1,
               clock_timestamp(), clock_timestamp())`,
      [userId, phone.normalized, HASH, origin],
    );
    return userId;
  }

  /** The SQLSTATE of a failing statement, or undefined when it succeeded. Each call is its own implicit transaction. */
  async function failureCode(sql: string, values: unknown[] = []): Promise<string | undefined> {
    try {
      await pool.query(sql, values);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  const insertProfile = (userId: string, extra = '', value: unknown = undefined): Promise<string | undefined> =>
    extra === ''
      ? failureCode('INSERT INTO app.customer_profiles (user_id) VALUES ($1::uuid)', [userId])
      : failureCode(`INSERT INTO app.customer_profiles (user_id, ${extra}) VALUES ($1::uuid, $2)`, [userId, value]);

  const insertConsent = (
    userId: string,
    terms = 'terms-1',
    privacy = 'privacy-1',
    app = 'FOOD',
    consentId: string = randomUUID(),
  ): Promise<string | undefined> =>
    failureCode(
      `INSERT INTO app.user_consents (id, user_id, terms_version, privacy_version, accepted_at, client_app)
       VALUES ($1::uuid, $2::uuid, $3, $4, clock_timestamp(), $5)`,
      [consentId, userId, terms, privacy, app],
    );

  function contextOf(client: PoolClient): TransactionContext {
    return {
      isActive: true,
      query: async <R extends object = Record<string, unknown>>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryRows<R>> => {
        const result = await client.query(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows as R[], rowCount: result.rowCount, command: result.command };
      },
    };
  }

  /** One caller transaction that the TEST controls: the participant under test can only query inside it. */
  async function inTransaction<T>(
    work: (client: PoolClient, context: TransactionContext) => Promise<T>,
    end: 'COMMIT' | 'ROLLBACK' = 'COMMIT',
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client, contextOf(client));
      await client.query(end);
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function rowsFor(userId: string): Promise<{ roles: string[]; profiles: number; consents: number }> {
    const roles = await pool.query<{ role: string }>(
      "SELECT role FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'",
      [userId],
    );
    const profiles = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.customer_profiles WHERE user_id = $1::uuid',
      [userId],
    );
    const consents = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.user_consents WHERE user_id = $1::uuid',
      [userId],
    );
    return { roles: roles.rows.map((row) => row.role), profiles: profiles.rows[0]?.n ?? -1, consents: consents.rows[0]?.n ?? -1 };
  }

  describe('app.customer_profiles', () => {
    it('has exactly the designed columns and defaults an empty profile to NULL name, version 1, equal timestamps', async () => {
      const columns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'customer_profiles' ORDER BY column_name",
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(['created_at', 'full_name', 'updated_at', 'user_id', 'version']);

      const userId = await createUser();
      expect(await insertProfile(userId)).toBeUndefined();
      const row = await pool.query<{ full_name: string | null; version: string; same_time: boolean }>(
        'SELECT full_name, version::text AS version, (created_at = updated_at) AS same_time FROM app.customer_profiles WHERE user_id = $1::uuid',
        [userId],
      );
      expect(row.rows).toEqual([{ full_name: null, version: '1', same_time: true }]);
    });

    it('refuses a profile for a user that does not exist (foreign key) and a second profile for one user (primary key)', async () => {
      expect(await insertProfile(randomUUID())).toBe('23503');
      const userId = await createUser();
      expect(await insertProfile(userId)).toBeUndefined();
      expect(await insertProfile(userId)).toBe('23505');
    });

    it('bounds the version to 1 .. Number.MAX_SAFE_INTEGER', async () => {
      for (const bad of ['0', '-1', '9007199254740992']) {
        expect([bad, await insertProfile(await createUser(), 'version', bad)]).toEqual([bad, '23514']);
      }
      for (const good of ['1', '9007199254740991']) {
        expect([good, await insertProfile(await createUser(), 'version', good)]).toEqual([good, undefined]);
      }
    });

    it('bounds full_name to 1 .. 120 characters (NULL allowed); the limit counts characters, not bytes', async () => {
      expect(await insertProfile(await createUser(), 'full_name', '')).toBe('23514');
      expect(await insertProfile(await createUser(), 'full_name', 'a'.repeat(121))).toBe('22001');
      expect(await insertProfile(await createUser(), 'full_name', 'a'.repeat(120))).toBeUndefined();
      expect(await insertProfile(await createUser(), 'full_name', 'é'.repeat(120))).toBeUndefined();
      expect(await insertProfile(await createUser(), 'full_name', null)).toBeUndefined();
    });

    it('refuses updated_at earlier than created_at', async () => {
      const userId = await createUser();
      expect(
        await failureCode(
          "INSERT INTO app.customer_profiles (user_id, created_at, updated_at) VALUES ($1::uuid, clock_timestamp(), clock_timestamp() - interval '1 second')",
          [userId],
        ),
      ).toBe('23514');
    });

    it('RESTRICTs deleting a user that still has a profile', async () => {
      const userId = await createUser();
      expect(await insertProfile(userId)).toBeUndefined();
      expect(await failureCode('DELETE FROM app.users WHERE user_id = $1::uuid', [userId])).toBe('23503');
    });
  });

  describe('app.user_consents', () => {
    it('has exactly the designed columns: no OTP, password, token, IP address or name can live here', async () => {
      const columns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'user_consents' ORDER BY column_name",
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'accepted_at',
        'client_app',
        'id',
        'privacy_version',
        'terms_version',
        'user_id',
      ]);
      const index = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'user_consents_user_accepted_idx'",
      );
      expect(index.rows[0]?.indexdef).toContain('(user_id, accepted_at, id)');
    });

    it('accepts a valid acceptance, refuses a user that does not exist, and RESTRICTs deleting a user with a consent', async () => {
      const userId = await createUser();
      expect(await insertConsent(userId)).toBeUndefined();
      expect(await insertConsent(randomUUID())).toBe('23503');
      expect(await failureCode('DELETE FROM app.users WHERE user_id = $1::uuid', [userId])).toBe('23503');
    });

    it('bounds the version tokens to [A-Za-z0-9._-]{1,64}', async () => {
      const userId = await createUser();
      for (const bad of ['', 'bad version', 'a/b', '1.0\n', 'phiên-bản', 'a+b', 'a:b', 'a,b']) {
        expect([JSON.stringify(bad), await insertConsent(userId, bad, 'p1')]).toEqual([JSON.stringify(bad), '23514']);
        expect([JSON.stringify(bad), await insertConsent(userId, 't1', bad)]).toEqual([JSON.stringify(bad), '23514']);
      }
      expect(await insertConsent(userId, 'a'.repeat(65), 'p1')).toBe('22001');
      expect(await insertConsent(userId, 'a'.repeat(64), 'p1')).toBeUndefined();
      expect(await insertConsent(userId, 'Terms.2026-10_final', 'Privacy.1_0-x')).toBeUndefined();
    });

    it('allows only the FOOD and SHIP client apps', async () => {
      const userId = await createUser();
      // (PostgreSQL silently drops trailing SPACES that overflow a varchar(n), so 'SHIP ' is stored as 'SHIP'; the
      // participant refuses it earlier, see its unit spec.)
      for (const bad of ['WEB', 'food', 'Ship', '']) {
        expect([bad, await insertConsent(userId, 't1', 'p1', bad)]).toEqual([bad, '23514']);
      }
      expect(await insertConsent(userId, 't1', 'p1', 'FOODX')).toBe('22001');
      expect(await insertConsent(userId, 't1', 'p1', 'FOOD')).toBeUndefined();
      expect(await insertConsent(userId, 't2', 'p1', 'SHIP')).toBeUndefined();
    });

    it('keeps one acceptance per (user, terms, privacy) pair; a changed pair, or another user, is a new row', async () => {
      const userId = await createUser();
      const other = await createUser();
      expect(await insertConsent(userId, 'terms-1', 'privacy-1')).toBeUndefined();
      expect(await insertConsent(userId, 'terms-1', 'privacy-1', 'SHIP')).toBe('23505');
      expect(await insertConsent(userId, 'terms-2', 'privacy-1')).toBeUndefined();
      expect(await insertConsent(userId, 'terms-1', 'privacy-2')).toBeUndefined();
      expect(await insertConsent(other, 'terms-1', 'privacy-1')).toBeUndefined();
      expect((await rowsFor(userId)).consents).toBe(3);
    });

    it('is append-only: UPDATE and DELETE are refused by a trigger, even for the owner and even when nothing would change', async () => {
      const userId = await createUser();
      const consentId = randomUUID();
      expect(await insertConsent(userId, 'terms-1', 'privacy-1', 'FOOD', consentId)).toBeUndefined();
      expect(await failureCode("UPDATE app.user_consents SET client_app = 'SHIP' WHERE id = $1::uuid", [consentId])).toBe('23001');
      expect(await failureCode('UPDATE app.user_consents SET client_app = client_app WHERE id = $1::uuid', [consentId])).toBe('23001');
      expect(await failureCode("UPDATE app.user_consents SET terms_version = 'terms-9' WHERE user_id = $1::uuid", [userId])).toBe('23001');
      expect(await failureCode('DELETE FROM app.user_consents WHERE id = $1::uuid', [consentId])).toBe('23001');
      const row = await pool.query<{ client_app: string; terms_version: string }>(
        'SELECT client_app, terms_version FROM app.user_consents WHERE id = $1::uuid',
        [consentId],
      );
      expect(row.rows).toEqual([{ client_app: 'FOOD', terms_version: 'terms-1' }]);
    });
  });

  describe('CustomerProvisioningParticipant on a real caller transaction', () => {
    it('gives the role, an EMPTY profile and the consent together, and only when the caller commits', async () => {
      const userId = await createUser();
      const result = await inTransaction(async (_client, context) => {
        const created = await participant.provision(context, userId, CONSENT);
        // Visible to the caller before it ends the transaction...
        const inside = await context.query<{ n: number }>('SELECT count(*)::int AS n FROM app.customer_profiles WHERE user_id = $1::uuid', [userId]);
        expect(inside.rows[0]?.n).toBe(1);
        return created;
      }, 'ROLLBACK');
      expect(result).toEqual({ roleGranted: true, profileCreated: true, consentRecorded: true });
      // ...and gone after the caller rolls back: nothing dangling.
      expect(await rowsFor(userId)).toEqual({ roles: [], profiles: 0, consents: 0 });

      const committed = await inTransaction((_client, context) => participant.provision(context, userId, CONSENT));
      expect(committed).toEqual({ roleGranted: true, profileCreated: true, consentRecorded: true });
      expect(await rowsFor(userId)).toEqual({ roles: ['CUSTOMER'], profiles: 1, consents: 1 });
      const stored = await pool.query<{ full_name: string | null; version: string; terms_version: string; privacy_version: string; client_app: string; accepted: boolean }>(
        `SELECT p.full_name, p.version::text AS version, c.terms_version, c.privacy_version, c.client_app,
                (c.accepted_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute') AS accepted
           FROM app.customer_profiles p JOIN app.user_consents c ON c.user_id = p.user_id WHERE p.user_id = $1::uuid`,
        [userId],
      );
      expect(stored.rows).toEqual([
        { full_name: null, version: '1', terms_version: 'terms-2026.10', privacy_version: 'privacy_1.0', client_app: 'FOOD', accepted: true },
      ]);
    });

    it('writes no consent when none is given (no invented acceptance) and keeps the role row free of SHOP/DRIVER', async () => {
      const userId = await createUser();
      const result = await inTransaction((_client, context) => participant.provision(context, userId));
      expect(result).toEqual({ roleGranted: true, profileCreated: true, consentRecorded: false });
      expect(await rowsFor(userId)).toEqual({ roles: ['CUSTOMER'], profiles: 1, consents: 0 });
      const roles = await pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid', [userId]);
      expect(roles.rows).toEqual([{ role: 'CUSTOMER' }]);
    });

    it('is idempotent and overwrites nothing: name, version and the first consent survive a repeat', async () => {
      const userId = await createUser();
      await inTransaction((_client, context) => participant.provision(context, userId, CONSENT));
      await pool.query(
        "UPDATE app.customer_profiles SET full_name = 'Kept Name', version = 3, updated_at = clock_timestamp() WHERE user_id = $1::uuid",
        [userId],
      );
      const before = await pool.query('SELECT id::text, accepted_at::text AS accepted_at FROM app.user_consents WHERE user_id = $1::uuid', [userId]);

      const again = await inTransaction((_client, context) => participant.provision(context, userId, CONSENT));
      expect(again).toEqual({ roleGranted: false, profileCreated: false, consentRecorded: false });
      expect(await rowsFor(userId)).toEqual({ roles: ['CUSTOMER'], profiles: 1, consents: 1 });
      const profile = await pool.query<{ full_name: string; version: string }>(
        'SELECT full_name, version::text AS version FROM app.customer_profiles WHERE user_id = $1::uuid',
        [userId],
      );
      expect(profile.rows).toEqual([{ full_name: 'Kept Name', version: '3' }]);
      expect((await pool.query('SELECT id::text, accepted_at::text AS accepted_at FROM app.user_consents WHERE user_id = $1::uuid', [userId])).rows).toEqual(
        before.rows,
      );

      // A NEW pair of versions is a new acceptance; the profile and role are still untouched.
      const changed = await inTransaction((_client, context) =>
        participant.provision(context, userId, { termsVersion: 'terms-2026.11', privacyVersion: 'privacy_1.0', clientApp: 'SHIP' }),
      );
      expect(changed).toEqual({ roleGranted: false, profileCreated: false, consentRecorded: true });
      expect(await rowsFor(userId)).toEqual({ roles: ['CUSTOMER'], profiles: 1, consents: 2 });
    });

    it('rolls back EVERYTHING of a failed unit of work: user, role, profile and consent leave no remainder', async () => {
      const phone = randomPhone();
      phones.push(phone.normalized);
      const userId = randomUUID();
      await expect(
        inTransaction(async (client, context) => {
          // A register-shaped unit: the user is created in the same transaction as its customer rows.
          await client.query(
            `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version,
                                    created_at, updated_at)
             VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
            [userId, phone.normalized, HASH],
          );
          await participant.provision(context, userId, CONSENT);
          // A later step of the caller fails: the whole transaction must go.
          await client.query('SELECT 1 / 0');
        }),
      ).rejects.toMatchObject({ code: '22012' });
      expect(await rowsFor(userId)).toEqual({ roles: [], profiles: 0, consents: 0 });
      const user = await pool.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid', [userId]);
      expect(user.rowCount).toBe(0);
    });

    it('refuses accounts that must never become customers, as a TechnicalError, before any write', async () => {
      const adminId = await createUser('ADMIN_PROVISIONED');
      await pool.query(
        `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
         VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
        [adminId],
      );
      const adminWithoutMembership = await createUser('ADMIN_PROVISIONED');
      const abnormal = await createUser('PHONE_VERIFIED');

      for (const userId of [adminId, adminWithoutMembership, randomUUID()]) {
        await expect(inTransaction((_client, context) => participant.provision(context, userId, CONSENT))).rejects.toBeInstanceOf(TechnicalError);
        expect(await rowsFor(userId)).toEqual({ roles: [], profiles: 0, consents: 0 });
      }

      // A phone-verified account that nevertheless holds a membership (an abnormal state the origin guard would refuse
      // today): the guard is switched off inside this one transaction, which is always rolled back.
      await expect(
        inTransaction(async (client, context) => {
          await client.query('ALTER TABLE app.admin_memberships DISABLE TRIGGER admin_membership_origin_guard');
          await client.query(
            `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
             VALUES ($1::uuid, 'ADMIN', 'DISABLED', 1, clock_timestamp(), clock_timestamp())`,
            [abnormal],
          );
          await participant.provision(context, abnormal, CONSENT);
        }),
      ).rejects.toBeInstanceOf(TechnicalError);
      expect(await rowsFor(abnormal)).toEqual({ roles: [], profiles: 0, consents: 0 });
      const membership = await pool.query('SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [abnormal]);
      expect(membership.rowCount).toBe(0);
      const guard = await pool.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgname = 'admin_membership_origin_guard'",
      );
      expect(guard.rows).toEqual([{ tgenabled: 'O' }]);

      // The administration accounts also got nothing in app.user_roles (CUSTOMER was never granted to them).
      const roles = await pool.query("SELECT 1 FROM app.user_roles WHERE role = 'CUSTOMER' AND user_id = ANY ($1::uuid[])", [[adminId, adminWithoutMembership]]);
      expect(roles.rowCount).toBe(0);
    });

    it('takes the ROOT user row lock on the caller transaction, so no other writer can slip in until it ends', async () => {
      const userId = await createUser();
      const holder = await pool.connect();
      const other = await pool.connect();
      try {
        await holder.query('BEGIN');
        await participant.provision(contextOf(holder), userId);
        await other.query('BEGIN');
        await expect(
          other.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE NOWAIT', [userId]),
        ).rejects.toMatchObject({ code: '55P03' });
        await other.query('ROLLBACK');
        await holder.query('ROLLBACK');
        // Released with the transaction.
        await other.query('BEGIN');
        await other.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE NOWAIT', [userId]);
        await other.query('ROLLBACK');
      } finally {
        holder.release();
        other.release();
      }
    });

    it('two callers provisioning the same user serialize on that lock: exactly one creates, the other reports nothing created', async () => {
      const userId = await createUser();
      const first = await pool.connect();
      const second = await pool.connect();
      try {
        await first.query('BEGIN');
        const created = await participant.provision(contextOf(first), userId, CONSENT);
        await second.query('BEGIN');
        const waiting = participant.provision(contextOf(second), userId, CONSENT);
        // The second call is observably blocked on the participant's own FOR UPDATE, not merely "slow".
        await eventually(
          async () => (await rowLockWaitersRunning(pool, '%FOR UPDATE OF u%')) >= 1,
          'the second provisioning waits for the first one to release the user row lock',
        );
        await first.query('COMMIT');
        const repeated = await waiting;
        await second.query('COMMIT');

        expect(created).toEqual({ roleGranted: true, profileCreated: true, consentRecorded: true });
        expect(repeated).toEqual({ roleGranted: false, profileCreated: false, consentRecorded: false });
        expect(await rowsFor(userId)).toEqual({ roles: ['CUSTOMER'], profiles: 1, consents: 1 });
      } finally {
        await first.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
        first.release();
        second.release();
      }
    });
  });
});
