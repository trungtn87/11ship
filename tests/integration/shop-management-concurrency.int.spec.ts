import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ShopAvailabilityReader } from '../../apps/backend/src/shop/shop-availability-reader';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ApiResponse,
  AuthApp,
  dataOf,
  errorCode,
  grantRole,
  loginUser,
  rowLockWaiters,
  rowLockWaitersRunning,
  sessionIdOfToken,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';
import {
  createShopOwner,
  getShop,
  hoursBody,
  hoursOf,
  installHoursInsertStall,
  interval,
  profileBody,
  putHours,
  putProfile,
  removeHoursInsertStall,
  ShopOwner,
  shopState,
} from './support/shop-management-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M02-A — deterministic race proofs for A10, A11, A12 and A17. No sleeps: every overlap is forced with a PostgreSQL
// barrier (a held row lock or advisory lock) and observed in pg_locks before it is released.
describe('M02-A — Shop management concurrency', () => {
  let app: AuthApp;
  const STALL_KEY = [910_301, 910_302] as const;
  const USER_LOCK = '%FROM app.users WHERE user_id = $1::uuid FOR UPDATE%';
  const SESSION_LOCK = '%FROM app.sessions WHERE session_id = $1::uuid FOR UPDATE%';
  const SESSION_SHARE = '%FROM app.sessions WHERE session_id = $1::uuid FOR SHARE%';
  const USER_SHARE = '%FROM app.users WHERE user_id = $1::uuid FOR SHARE%';

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await removeHoursInsertStall(app.pool);
    await app.close();
  });

  const waiters = (atLeast: number) => async (): Promise<boolean> => (await rowLockWaiters(app.pool)) >= atLeast;
  const waiterOn = (pattern: string, atLeast = 1) => async (): Promise<boolean> =>
    (await rowLockWaitersRunning(app.pool, pattern)) >= atLeast;

  async function holdUserRow(userId: string): Promise<LockHolder> {
    const holder = await LockHolder.begin(app.pool);
    await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
    return holder;
  }

  async function secondSession(owner: ShopOwner): Promise<{ token: string; sessionId: string }> {
    const login = await loginUser(app, owner.user);
    expect(login.status).toBe(200);
    const token = String(dataOf(login).access_token);
    return { token, sessionId: await sessionIdOfToken(app.pool, token) };
  }

  const select = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });

  describe('A10 — one writer per version', () => {
    it('a profile update and an hours replacement at the same version: exactly one succeeds, the other is VERSION_CONFLICT', async () => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      const holder = await holdUserRow(owner.userId);
      let released = false;
      try {
        const profile = putProfile(app, owner.token, profileBody(owner));
        const hours = putHours(app, owner.token, hoursBody([interval(1, 0, 600)]));
        await eventually(waiters(2), 'both writers blocked on the user row lock');
        await holder.commit();
        released = true;

        const results = await Promise.all([profile, hours]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(results.filter((r) => r.status === 409).map(errorCode)).toEqual(['VERSION_CONFLICT']);
        const after = await shopState(app.pool, owner);
        expect(after.version).toBe(before.version + 1);
        expect([after.audits - before.audits, after.events - before.events, after.records - before.records]).toEqual([1, 1, 1]);
        // Whichever won, the loser left no trace: the profile and the schedule belong to ONE winner.
        const profileWon = results[0]?.status === 200;
        expect(after.name === 'Quán Mới').toBe(profileWon);
        expect(after.hours.length).toBe(profileWon ? 0 : 1);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });

    it('two hours replacements at the same version with different keys: one winner, the final schedule is the winner\'s', async () => {
      const owner = await createShopOwner(app);
      const a = [interval(1, 0, 600)];
      const b = [interval(2, 0, 600)];
      const holder = await holdUserRow(owner.userId);
      let released = false;
      try {
        const first = putHours(app, owner.token, hoursBody(a));
        const second = putHours(app, owner.token, hoursBody(b));
        await eventually(waiters(2), 'both replacements blocked on the user row lock');
        await holder.commit();
        released = true;
        const results = await Promise.all([first, second]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const winner = results[0]?.status === 200 ? a : b;
        expect(await hoursOf(app.pool, owner.shopId)).toEqual(winner);
        expect((await shopState(app.pool, owner)).version).toBe(3);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });

    it('the same key sent twice at once executes once', async () => {
      const owner = await createShopOwner(app);
      const key = randomUUID();
      const body = hoursBody([interval(3, 100, 700)]);
      const before = await shopState(app.pool, owner);
      const holder = await holdUserRow(owner.userId);
      let released = false;
      try {
        const first = putHours(app, owner.token, body, key);
        await eventually(waiters(1), 'the first request blocked on the user row lock');
        const second = putHours(app, owner.token, body, key);
        await eventually(async () => (await rowLockWaiters(app.pool)) >= 2 || (await advisoryAnyWaiter()), 'the second waits behind the first');
        await holder.commit();
        released = true;
        const results = await Promise.all([first, second]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(dataOf(results[0] as ApiResponse)).toEqual(dataOf(results[1] as ApiResponse));
        const after = await shopState(app.pool, owner);
        expect([after.version - before.version, after.audits - before.audits, after.events - before.events, after.records - before.records]).toEqual([1, 1, 1, 1]);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });

    async function advisoryAnyWaiter(): Promise<boolean> {
      const result = await app.pool.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      return (result.rowCount ?? 0) > 0;
    }
  });

  describe('A11 — a mutation racing a SHOP session replacement', () => {
    it('replacement first: the pending mutation of the replaced session is refused with SESSION_REVOKED and writes nothing', async () => {
      const owner = await createShopOwner(app);
      const replacement = await secondSession(owner);
      const before = await shopState(app.pool, owner);
      const holder = await holdUserRow(owner.userId);
      let released = false;
      try {
        const selecting = select(replacement.token, 'SHOP');
        await eventually(waiterOn(USER_LOCK, 1), 'the SHOP replacement waits for the user row lock');
        // The old session is still valid, so the guard lets this command in; it queues behind the replacement.
        const pending = putHours(app, owner.token, hoursBody([interval(1, 0, 600)]));
        await eventually(waiterOn(USER_LOCK, 2), 'the pending mutation waits for the user row lock too');
        await holder.commit();
        released = true;
        const [selected, refused] = await Promise.all([selecting, pending]);
        expect(selected.status).toBe(200);
        expect([refused.status, errorCode(refused)]).toEqual([401, 'SESSION_REVOKED']);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
      expect(await shopState(app.pool, owner)).toEqual(before);
    });

    it('mutation first: it commits, and the replacement then revokes the old session', async () => {
      const owner = await createShopOwner(app);
      const replacement = await secondSession(owner);
      const holder = await holdUserRow(owner.userId);
      let released = false;
      try {
        const pending = putHours(app, owner.token, hoursBody([interval(1, 0, 600)]));
        await eventually(waiterOn(USER_LOCK, 1), 'the mutation waits for the user row lock');
        const selecting = select(replacement.token, 'SHOP');
        await eventually(waiterOn(USER_LOCK, 2), 'the replacement waits behind it');
        await holder.commit();
        released = true;
        const [done, selected] = await Promise.all([pending, selecting]);
        expect(done.status).toBe(200);
        expect(selected.status).toBe(200);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
      expect((await shopState(app.pool, owner)).version).toBe(3);
      const old = await putHours(app, owner.token, hoursBody([interval(2, 0, 60)], 3));
      expect([old.status, errorCode(old)]).toEqual([401, 'SESSION_REVOKED']);
    });

    for (const mutation of ['profile', 'hours'] as const) {
      for (const change of ['revoke', 'expire'] as const) {
        it(`${mutation}: a session ${change}d while the mutation waits for its row is refused; the guard outside the transaction is not enough`, async () => {
          const owner = await createShopOwner(app);
          const second = await secondSession(owner);
          expect((await select(second.token, 'SHOP')).status).toBe(200);
          const before = await shopState(app.pool, owner);
          const holder = await LockHolder.begin(app.pool);
          let released = false;
          try {
            await holder.query(
              change === 'revoke'
                ? `UPDATE app.sessions SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
                          updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE session_id = $1::uuid`
                : `UPDATE app.sessions SET created_at = created_at - interval '2 days', updated_at = updated_at - interval '2 days',
                          expires_at = clock_timestamp() - interval '1 second' WHERE session_id = $1::uuid`,
              [second.sessionId],
            );
            const pending =
              mutation === 'profile'
                ? putProfile(app, second.token, profileBody(owner))
                : putHours(app, second.token, hoursBody([interval(1, 0, 600)]));
            await eventually(waiterOn(SESSION_LOCK), 'the business transaction waits for the session row lock');
            await holder.commit();
            released = true;
            const response = await pending;
            expect([response.status, errorCode(response)]).toEqual([401, change === 'revoke' ? 'SESSION_REVOKED' : 'SESSION_EXPIRED']);
          } finally {
            if (!released) {
              await holder.rollback();
            }
          }
          expect(await shopState(app.pool, owner)).toEqual(before);
        });
      }
    }
  });

  describe('A17 — the shared GET authorizes under its own locks', () => {
    async function holdSession(sessionId: string, statement: string): Promise<LockHolder> {
      const holder = await LockHolder.begin(app.pool);
      await holder.query(statement, [sessionId]);
      return holder;
    }

    it('a role switch SHOP -> DRIVER committed while the GET waits: the GET is refused with SHOP_ROLE_REQUIRED', async () => {
      const owner = await createShopOwner(app);
      await grantRole(app.pool, owner.userId, 'DRIVER');
      const holder = await holdSession(owner.sessionId, "UPDATE app.sessions SET active_role = 'DRIVER' WHERE session_id = $1::uuid");
      let released = false;
      try {
        const reading = getShop(app, owner.token);
        await eventually(waiterOn(SESSION_SHARE), 'the GET waits for the session row (FOR SHARE)');
        await holder.commit();
        released = true;
        const response = await reading;
        expect([response.status, errorCode(response)]).toEqual([403, 'SHOP_ROLE_REQUIRED']);
        expect(response.body.data).toBeUndefined();
        expect(response.text).not.toContain(owner.shopId);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });

    for (const change of ['revoke', 'expire'] as const) {
      it(`a session ${change}d while the GET waits: refused, the principal read by the guard is not reused`, async () => {
        const owner = await createShopOwner(app);
        const holder = await holdSession(
          owner.sessionId,
          change === 'revoke'
            ? `UPDATE app.sessions SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
                      updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE session_id = $1::uuid`
            : `UPDATE app.sessions SET created_at = created_at - interval '2 days', updated_at = updated_at - interval '2 days',
                      expires_at = clock_timestamp() - interval '1 second' WHERE session_id = $1::uuid`,
        );
        let released = false;
        try {
          const reading = getShop(app, owner.token);
          await eventually(waiterOn(SESSION_SHARE), 'the GET waits for the session row (FOR SHARE)');
          await holder.commit();
          released = true;
          const response = await reading;
          expect([response.status, errorCode(response)]).toEqual([401, change === 'revoke' ? 'SESSION_REVOKED' : 'SESSION_EXPIRED']);
          expect(response.body.data).toBeUndefined();
        } finally {
          if (!released) {
            await holder.rollback();
          }
        }
      });
    }

    it('an account disabled while the GET waits for the user row is refused with ACCOUNT_DISABLED', async () => {
      const owner = await createShopOwner(app);
      const holder = await LockHolder.begin(app.pool);
      await holder.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [owner.userId]);
      let released = false;
      try {
        const reading = getShop(app, owner.token);
        await eventually(waiterOn(USER_SHARE), 'the GET waits for the user row (FOR SHARE)');
        await holder.commit();
        released = true;
        const response = await reading;
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('ACCOUNT_DISABLED');
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });

    it('readers do not block each other: two concurrent GETs of one user both answer while a third holds a shared lock', async () => {
      const owner = await createShopOwner(app);
      const holder = await LockHolder.begin(app.pool);
      await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR SHARE', [owner.userId]);
      try {
        const [a, b] = await Promise.all([getShop(app, owner.token), getShop(app, owner.token)]);
        expect([a.status, b.status]).toEqual([200, 200]);
      } finally {
        await holder.rollback();
      }
    });
  });

  describe('A12 — a replacement racing a GET: one snapshot, never a mix', () => {
    it('a GET started while a replacement is mid-transaction waits and then sees the new schedule WITH the new version', async () => {
      const owner = await createShopOwner(app);
      const oldSchedule = [interval(1, 0, 600)];
      const newSchedule = [interval(2, 60, 120), interval(3, 60, 120)];
      expect((await putHours(app, owner.token, hoursBody(oldSchedule))).status).toBe(200);
      const beforeRead = dataOf(await getShop(app, owner.token));
      expect([beforeRead.version, beforeRead.hours]).toEqual([3, oldSchedule]);

      await installHoursInsertStall(app.pool, owner.shopId, STALL_KEY);
      const gate = await LockHolder.begin(app.pool);
      let released = false;
      try {
        await gate.advisory({ first: STALL_KEY[0], second: STALL_KEY[1] });
        const replacing = putHours(app, owner.token, hoursBody(newSchedule, 3));
        // The replacement is inside its transaction: old rows deleted (uncommitted), blocked on the first insert.
        await eventually(() => advisoryWaiterExists(app.pool, STALL_KEY), 'the replacement is blocked mid-transaction');
        const state = await shopState(app.pool, owner);
        expect(state.hours).toEqual(oldSchedule); // nothing of it is visible yet
        const reading = getShop(app, owner.token);
        await eventually(waiterOn(USER_SHARE), 'the GET waits for the writer (user row)');
        await gate.commit();
        released = true;
        const [written, read] = await Promise.all([replacing, reading]);
        expect(written.status).toBe(200);
        expect(read.status).toBe(200);
        const data = dataOf(read);
        expect([data.version, data.hours]).toEqual([4, newSchedule]);
      } finally {
        await removeHoursInsertStall(app.pool);
        if (!released) {
          await gate.rollback();
        }
      }
    });

    it('one statement, one snapshot: an uncommitted replacement is invisible to the reader, a committed one is entirely visible', async () => {
      const owner = await createShopOwner(app);
      expect((await putHours(app, owner.token, hoursBody([interval(1, 0, 600)]))).status).toBe(200);
      const reader = new ShopAvailabilityReader();
      const manager = managerFor(poolClientSource(app.pool));
      const snapshot = () => manager.withTransaction((context) => reader.snapshotOfOwner(context, owner.userId));

      const writer = await LockHolder.begin(app.pool);
      let committed = false;
      try {
        await writer.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [owner.shopId]);
        await writer.query(
          'INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) VALUES ($1::uuid, 4, 0, 60, 0)',
          [owner.shopId],
        );
        await writer.query('UPDATE app.shops SET version = version + 1 WHERE shop_id = $1::uuid', [owner.shopId]);
        const during = await snapshot();
        expect([during?.version, during?.hours.map((h) => h.weekday)]).toEqual([3, [1]]);
        await writer.commit();
        committed = true;
        const after = await snapshot();
        expect([after?.version, after?.hours.map((h) => h.weekday)]).toEqual([4, [4]]);
      } finally {
        if (!committed) {
          await writer.rollback();
        }
      }
    });

    it('reads never mutate: repeated GETs leave version, schedule, audit, outbox and idempotency untouched', async () => {
      const owner = await createShopOwner(app);
      await putHours(app, owner.token, hoursBody([interval(5, 0, 600)]));
      const before = await shopState(app.pool, owner);
      await Promise.all([getShop(app, owner.token), getShop(app, owner.token), getShop(app, owner.token)]);
      expect(await shopState(app.pool, owner)).toEqual(before);
    });
  });
});
