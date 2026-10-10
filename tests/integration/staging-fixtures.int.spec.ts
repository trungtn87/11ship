import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { createAccountOriginPolicy } from '../../apps/backend/src/auth/account-origin';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { StagingFixtureSeeder, StagingSeedConflictError } from '../../apps/backend/src/auth/staging-fixture-seeder';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { PhoneAllowlist } from '../../apps/backend/src/config/staging-fixtures-config';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually } from './support/async-helpers';
import {
  ApiResponse,
  AuthApp,
  dataOf,
  driverBody,
  errorCode,
  loginUser,
  PASSWORD,
  Phone,
  purgePhone,
  randomPhone,
  registerUser,
  rowLockWaitersRunning,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M00-D2 — staging fixture accounts, end to end through the REAL Nest pipeline and the REAL seeder on a REAL
// PostgreSQL: the seed (idempotent, concurrent, atomic, never overwriting), fixture login and onboarding, the
// closed OTP/register path, and the policy that production, a switched-off mode and a removed allowlist entry all
// apply to accounts and to sessions that already exist.

const AUDIT_SEEDED = 'auth.staging_fixture_created.v1';

function allowlistOf(phones: readonly Phone[]): PhoneAllowlist {
  return new PhoneAllowlist(phones.map((phone) => phone.normalized));
}

describe('M00-D2 — staging fixture accounts', () => {
  let staging: AuthApp; // APP_ENV=staging, fixture mode ON, Disabled OTP
  let standard: AuthApp; // no fixture mode: the policy of every other environment
  let production: AuthApp; // a policy built for APP_ENV=production WITH the flag set: it must still refuse
  let narrowed: AuthApp; // staging, fixture mode ON, but an allowlist without the phones under test
  let pool: Pool;
  // Every fixture phone a test creates comes from this pool, and the staging process allows exactly these 20 (the
  // product limit of the allowlist). Verified accounts use plain random phones: they are not in any allowlist.
  const POOL_OF_PHONES: Phone[] = Array.from({ length: 20 }, () => randomPhone());
  let nextPhone = 0;
  const allowed = (): Phone => {
    const phone = POOL_OF_PHONES[nextPhone];
    nextPhone += 1;
    if (phone === undefined) {
      throw new Error('test phone pool exhausted');
    }
    return phone;
  };

  beforeAll(async () => {
    const staged = POOL_OF_PHONES;
    const other = [randomPhone()];
    staging = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        disabledOtp: true,
        accountOriginPolicy: createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: allowlistOf(staged) }),
      },
    );
    standard = await startAuthApp({}, { relaxTimeouts: true });
    production = await startAuthApp(
      {},
      {
        accountOriginPolicy: createAccountOriginPolicy({ appEnv: 'production', fixtureModeEnabled: true, allowedPhones: allowlistOf(staged) }),
      },
    );
    narrowed = await startAuthApp(
      {},
      {
        disabledOtp: true,
        accountOriginPolicy: createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: allowlistOf(other) }),
      },
    );
    pool = staging.pool;
    for (const phone of POOL_OF_PHONES) {
      staging.track(phone.normalized);
    }
  });

  afterAll(async () => {
    for (const phone of POOL_OF_PHONES) {
      await purgePhone(pool, phone.normalized);
    }
    await narrowed.close();
    await production.close();
    await standard.close();
    await staging.close();
  });

  // ---- the seed ---------------------------------------------------------------------------------------------------

  function seedWith(audit: AuditWriter = new AuditWriter()) {
    const manager = managerFor(poolClientSource(pool));
    const seeder = new StagingFixtureSeeder(new UserRepository(), audit, new Argon2idPasswordHasher());
    return async (list: readonly Phone[], password: string = PASSWORD) => {
      const prepared = await seeder.prepare(list.map((phone) => ({ phoneNormalized: phone.normalized, password })));
      return manager.withTransaction((context) => seeder.seed(context, prepared, randomUUID()));
    };
  }

  async function userRows(list: readonly Phone[]): Promise<Array<Record<string, unknown>>> {
    const result = await pool.query(
      `SELECT user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at
         FROM app.users WHERE phone_normalized = ANY($1::text[]) ORDER BY phone_normalized`,
      [list.map((phone) => phone.normalized)],
    );
    return result.rows;
  }

  async function count(sql: string, values: unknown[]): Promise<number> {
    const result = await pool.query<{ n: number }>(sql, values);
    return result.rows[0]?.n ?? 0;
  }

  describe('seed', () => {
    it('creates ACTIVE STAGING_FIXTURE users with no proof time and NOTHING else: no role, session, profile, proof, OTP or outbox event', async () => {
      const list = [allowed(), allowed()];
      const result = await seedWith()(list);
      expect(result).toEqual({ created: 2, skipped: 0 });
      const rows = await userRows(list);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({ account_origin: 'STAGING_FIXTURE', phone_verified_at: null, status: 'ACTIVE' });
        expect(String(row.password_hash)).toMatch(/^\$argon2id\$/);
        expect(String(row.version)).toBe('1');
        const id = String(row.user_id);
        for (const table of ['user_roles', 'sessions', 'drivers', 'shop_members']) {
          expect([table, await count(`SELECT count(*)::int AS n FROM app.${table} WHERE user_id = $1::uuid`, [id])]).toEqual([table, 0]);
        }
        expect(await count("SELECT count(*)::int AS n FROM app.outbox_events WHERE resource_type = 'user' AND resource_id = $1", [id])).toBe(0);
        // Exactly one audit row, the seed one, by the operator actor; never a registration audit.
        const audit = await pool.query<{ action: string; actor_type: string; actor_id: string; outcome: string }>(
          'SELECT action, actor_type, actor_id, outcome FROM app.audit_logs WHERE resource_type = $1 AND resource_id = $2',
          ['user', id],
        );
        expect(audit.rows).toEqual([{ action: AUDIT_SEEDED, actor_type: 'OPERATOR', actor_id: 'staging-seed-cli', outcome: 'SUCCESS' }]);
      }
      for (const phone of list) {
        expect(await count('SELECT count(*)::int AS n FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
        expect(await count('SELECT count(*)::int AS n FROM app.verification_proofs WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
      }
    });

    it('a re-run is a no-op: nothing is overwritten (password, status, version, timestamps) and no second audit row is written', async () => {
      const list = [allowed()];
      await seedWith()(list, PASSWORD);
      // The operator changed the state by hand since: disabled, bumped version. A re-run must not undo it.
      await pool.query(
        "UPDATE app.users SET status = 'DISABLED', version = version + 1, updated_at = clock_timestamp() WHERE phone_normalized = $1",
        [list[0]?.normalized],
      );
      const before = await userRows(list);
      const again = await seedWith()(list, 'Totally-Different-Passw0rd-1');
      expect(again).toEqual({ created: 0, skipped: 1 });
      expect(await userRows(list)).toEqual(before);
      const id = String(before[0]?.user_id);
      expect(await count('SELECT count(*)::int AS n FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [id, AUDIT_SEEDED])).toBe(1);
    });

    it('simultaneous seed runs over the same phones: every phone exists once, the totals add up, nobody fails', async () => {
      const list = [allowed(), allowed(), allowed()];
      const runs = await Promise.all([seedWith()(list), seedWith()(list), seedWith()(list)]);
      expect(runs.reduce((sum, run) => sum + run.created, 0)).toBe(3);
      expect(runs.reduce((sum, run) => sum + run.skipped, 0)).toBe(6);
      const rows = await userRows(list);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(await count('SELECT count(*)::int AS n FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [String(row.user_id), AUDIT_SEEDED])).toBe(1);
      }
    });

    it('a phone that already belongs to a VERIFIED account aborts the WHOLE batch: nothing is written, the verified account is untouched', async () => {
      const verified = await registerUser(standard);
      const other = allowed();
      const before = await userRows([verified.phone]);
      await expect(seedWith()([other, verified.phone])).rejects.toBeInstanceOf(StagingSeedConflictError);
      // Rolled back as a whole: the new phone of the same batch was not created either.
      expect(await userRows([other])).toEqual([]);
      expect(await userRows([verified.phone])).toEqual(before);
      expect(before[0]).toMatchObject({ account_origin: 'PHONE_VERIFIED' });
      expect(await count("SELECT count(*)::int AS n FROM app.audit_logs WHERE action = $1 AND resource_id = $2", [AUDIT_SEEDED, String(before[0]?.user_id)])).toBe(0);
    });

    it('an audit failure rolls the user back with it: no user without its audit row', async () => {
      const list = [allowed(), allowed()];
      const failing = { append: () => Promise.reject(new Error('audit unavailable')) } as unknown as AuditWriter;
      await expect(seedWith(failing)(list)).rejects.toThrow('audit unavailable');
      expect(await userRows(list)).toEqual([]);
    });

    it('a fixture is never promoted: the seed CANNOT make a PHONE_VERIFIED row, and the database refuses the pairing anyway', async () => {
      const list = [allowed()];
      await seedWith()(list);
      await expect(
        pool.query("UPDATE app.users SET account_origin = 'PHONE_VERIFIED' WHERE phone_normalized = $1", [list[0]?.normalized]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ---- fixture accounts in the staging process --------------------------------------------------------------------

  async function seedAndLogin(app: AuthApp): Promise<{ phone: Phone; token: string; userId: string; login: ApiResponse }> {
    const phone = allowed();
    await seedWith()([phone]);
    const login = await loginUser(app, { phone, password: PASSWORD });
    expect(login.status).toBe(200);
    const data = dataOf(login);
    return { phone, token: String(data.access_token), userId: String(data.user_id), login };
  }

  describe('login and /me', () => {
    it('login and /me answer phone_verification_status UNVERIFIED_TEST; a verified account would answer VERIFIED', async () => {
      const fixture = await seedAndLogin(staging);
      expect(dataOf(fixture.login).phone_verification_status).toBe('UNVERIFIED_TEST');
      const me = await staging.call('GET', '/auth/me', { bearer: fixture.token });
      expect(me.status).toBe(200);
      expect(dataOf(me)).toMatchObject({ phone_verification_status: 'UNVERIFIED_TEST', active_role: null, available_roles: [] });

      const verified = await registerUser(standard);
      const meVerified = await standard.call('GET', '/auth/me', { bearer: verified.accessToken });
      expect(dataOf(meVerified).phone_verification_status).toBe('VERIFIED');
      const loginVerified = await loginUser(standard, verified);
      expect(dataOf(loginVerified).phone_verification_status).toBe('VERIFIED');
    });

    it('a wrong password is INVALID_CREDENTIALS and a fixture phone looks exactly like an unknown one', async () => {
      const phone = allowed();
      await seedWith()([phone]);
      const wrong = await loginUser(staging, { phone, password: 'Wrong-Password-Entirely-1' });
      const unknown = await loginUser(staging, { phone: randomPhone(), password: 'Wrong-Password-Entirely-1' });
      expect([wrong.status, errorCode(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect([unknown.status, errorCode(unknown)]).toEqual([401, 'INVALID_CREDENTIALS']);
    });

    it('fixture mode is closed to REGISTERED accounts: a verified account cannot log in on the staging process', async () => {
      const verified = await registerUser(standard);
      const login = await loginUser(staging, verified);
      expect([login.status, errorCode(login)]).toEqual([401, 'INVALID_CREDENTIALS']);
      const bearer = await staging.call('GET', '/auth/me', { bearer: verified.accessToken });
      expect([bearer.status, errorCode(bearer)]).toEqual([401, 'SESSION_INVALID']);
    });
  });

  describe('onboarding keeps working for a fixture through the existing flow', () => {
    it('driver onboarding creates the profile, DRIVER becomes selectable, and nothing grants a role or profile by itself', async () => {
      const fixture = await seedAndLogin(staging);
      expect(await count('SELECT count(*)::int AS n FROM app.drivers WHERE user_id = $1::uuid', [fixture.userId])).toBe(0);
      const created = await staging.call('POST', '/onboarding/driver', {
        bearer: fixture.token,
        body: driverBody(),
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(created.status).toBe(201);
      const selected = await staging.call('POST', '/auth/role/select', { bearer: fixture.token, body: { role: 'DRIVER' } });
      expect(selected.status).toBe(200);
      const me = await staging.call('GET', '/auth/me', { bearer: fixture.token });
      expect(dataOf(me)).toMatchObject({ active_role: 'DRIVER', phone_verification_status: 'UNVERIFIED_TEST' });
    });

    it('shop onboarding accepts the first profile save of a fixture', async () => {
      const fixture = await seedAndLogin(staging);
      const response = await staging.call('PUT', '/onboarding/shop/profile', {
        bearer: fixture.token,
        body: shopProfileBody(),
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(response.status).toBe(201);
      expect(dataOf(response)).toMatchObject({ status: 'INCOMPLETE', role_granted: false });
      expect(await count('SELECT count(*)::int AS n FROM app.user_roles WHERE user_id = $1::uuid', [fixture.userId])).toBe(0);
    });
  });

  describe('OTP and registration are closed in fixture mode, before any mutation', () => {
    it('OTP request, OTP verify and register all answer 503 AUTH_REGISTRATION_UNAVAILABLE and write nothing', async () => {
      const phone = randomPhone();
      staging.track(phone.normalized);
      const request = await staging.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
      expect([request.status, errorCode(request)]).toEqual([503, 'AUTH_REGISTRATION_UNAVAILABLE']);
      const verify = await staging.call('POST', `/auth/phone-verifications/${randomUUID()}/verify`, { body: { otp: '123456' } });
      expect([verify.status, errorCode(verify)]).toEqual([503, 'AUTH_REGISTRATION_UNAVAILABLE']);
      const register = await staging.call('POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: phone.local, password: PASSWORD, verification_token: 'x'.repeat(43), device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect([register.status, errorCode(register)]).toEqual([503, 'AUTH_REGISTRATION_UNAVAILABLE']);

      expect(await count('SELECT count(*)::int AS n FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM app.verification_proofs WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
      expect(await count('SELECT count(*)::int AS n FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
      // The fake provider is not bound there, and nothing it could have recorded exists.
      expect(staging.provider.lastOtpFor(phone.normalized)).toBeUndefined();
    });

    it('the error body carries no phone number and no internals', async () => {
      const phone = randomPhone();
      const request = await staging.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
      expect(request.text).not.toContain(phone.local);
      expect(request.text).not.toContain(phone.normalized);
      expect(request.text).not.toMatch(/stack|disabled|fixture|allowlist/i);
    });
  });

  // ---- production, switched-off mode, removed allowlist entry: accounts AND sessions ----------------------------------

  describe('a process that does not allow the fixture rejects it and its OLD sessions', () => {
    for (const [name, pick] of [
      ['a process without fixture mode', () => standard],
      ['a production-policy process even with the flag set', () => production],
      ['a staging process whose allowlist no longer holds the phone', () => narrowed],
    ] as const) {
      it(`${name}: login with the right password is INVALID_CREDENTIALS, the old bearer is SESSION_INVALID, no command runs`, async () => {
        const fixture = await seedAndLogin(staging);
        const app = pick();

        const login = await loginUser(app, { phone: fixture.phone, password: PASSWORD });
        expect([login.status, errorCode(login)]).toEqual([401, 'INVALID_CREDENTIALS']);

        const me = await app.call('GET', '/auth/me', { bearer: fixture.token });
        expect([me.status, errorCode(me)]).toEqual([401, 'SESSION_INVALID']);

        const onboarding = await app.call('POST', '/onboarding/driver', {
          bearer: fixture.token,
          body: driverBody(),
          headers: { 'idempotency-key': randomUUID() },
        });
        expect([onboarding.status, errorCode(onboarding)]).toEqual([401, 'SESSION_INVALID']);
        expect(await count('SELECT count(*)::int AS n FROM app.drivers WHERE user_id = $1::uuid', [fixture.userId])).toBe(0);

        const select = await app.call('POST', '/auth/role/select', { bearer: fixture.token, body: { role: 'DRIVER' } });
        expect([select.status, errorCode(select)]).toEqual([401, 'SESSION_INVALID']);

        // The rejection is policy, not revocation: nothing was written to the session, and the staging process that
        // allows the fixture still accepts it.
        const session = await pool.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM app.sessions WHERE user_id = $1::uuid', [fixture.userId]);
        expect(session.rows.every((row) => row.revoked_at === null)).toBe(true);
        const stillThere = await staging.call('GET', '/auth/me', { bearer: fixture.token });
        expect(stillThere.status).toBe(200);
      });
    }

    it('a process without fixture mode keeps registration open (the standard policy)', async () => {
      const user = await registerUser(standard);
      expect(user.response.status).toBe(201);
    });
  });

  // ---- the policy is applied again UNDER THE LOCK, not only in the guard --------------------------------------------

  describe('the authorization inside the transaction decides, not only the guard', () => {
    it('/me that passed the guard and waits for the user lock answers SESSION_INVALID when the row changes origin meanwhile', async () => {
      const fixture = await seedAndLogin(staging);
      const holder = await LockHolder.begin(pool);
      let released = false;
      try {
        await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [fixture.userId]);
        // Committed later, this makes the row a PHONE_VERIFIED one: not accepted by a process in fixture mode.
        await holder.query(
          "UPDATE app.users SET account_origin = 'PHONE_VERIFIED', phone_verified_at = clock_timestamp(), updated_at = clock_timestamp() WHERE user_id = $1::uuid",
          [fixture.userId],
        );
        const pending = staging.call('GET', '/auth/me', { bearer: fixture.token });
        await eventually(
          async () => (await rowLockWaitersRunning(pool, '%FROM app.users WHERE user_id = $1::uuid FOR SHARE%')) >= 1,
          '/me business transaction waits for the user lock',
        );
        await holder.commit();
        released = true;
        const response = await pending;
        expect([response.status, errorCode(response)]).toEqual([401, 'SESSION_INVALID']);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });
  });
});
