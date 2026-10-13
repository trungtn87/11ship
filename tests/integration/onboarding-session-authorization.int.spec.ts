import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { SessionAuthorizationParticipant } from '../../apps/backend/src/auth/session-authorization-participant';
import { SessionRepository } from '../../apps/backend/src/auth/session-repository';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually, failureOf } from './support/async-helpers';
import {
  ApiResponse,
  AuthApp,
  createServiceArea,
  dataOf,
  driverBody,
  errorCode,
  grantRole,
  loginUser,
  registerUser,
  Registered,
  rowLockWaitersRunning,
  sessionIdOfToken,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';
import { managerFor } from './support/transaction-fixtures';

// Post-merge repair, section 1 — the caller is authorized AGAIN inside the onboarding transaction.
//
// SessionAuthGuard reads the session with a plain SELECT, which never waits for a row lock. So a test that holds
// a row lock on app.sessions (or app.users) lets the guard pass, stalls ONLY the business transaction, and changes
// the state while it waits. The barrier is observed on the BUSINESS transaction's own waiting statement
// (rowLockWaitersRunning names the statement text), never on the guard, and nothing here sleeps.

const GPS = { pickup_lat: 21.03, pickup_lng: 105.85 } as const;
// Statement texts of the two authorization locks (UserRepository.lockById / SessionRepository.lockById).
const USER_LOCK = '%FROM app.users WHERE user_id = $1::uuid FOR UPDATE%';
const SESSION_LOCK = '%FROM app.sessions WHERE session_id = $1::uuid FOR UPDATE%';
// The shared variants the GET shop profile read takes (UserRepository.lockByIdForShare / SessionRepository.lockByIdForShare).
const USER_SHARE = '%FROM app.users WHERE user_id = $1::uuid FOR SHARE%';
const SESSION_SHARE = '%FROM app.sessions WHERE session_id = $1::uuid FOR SHARE%';

type Change = 'revoke' | 'expire';

interface Prepared {
  send(token: string, key: string): Promise<ApiResponse>;
  readonly successStatus: number;
  /** A key of the stored payload: it must never appear in a refused replay. */
  readonly payloadKey: string;
}

interface Operation {
  readonly name: string;
  prepare(user: Registered): Promise<Prepared>;
}

describe('M00/M01 repair §1 — session authorization inside onboarding transactions', () => {
  let app: AuthApp;

  beforeAll(async () => {
    // The tests hold locks on purpose: roomier lock budgets than the production defaults.
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (token: string, body: unknown, key: string): Promise<ApiResponse> =>
    app.call('PUT', '/onboarding/shop/profile', { bearer: token, body, headers: { 'idempotency-key': key } });
  const post = (path: string, token: string, body: unknown, key: string): Promise<ApiResponse> =>
    app.call('POST', path, { bearer: token, body, headers: { 'idempotency-key': key } });
  const select = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });

  const OPERATIONS: Operation[] = [
    {
      name: 'Shop profile save (create)',
      prepare: (): Promise<Prepared> => {
        const body = shopProfileBody({ name: 'Create' });
        return Promise.resolve({
          send: (token, key) => put(token, body, key),
          successStatus: 201,
          payloadKey: 'shop_id',
        });
      },
    },
    {
      name: 'Shop profile save (update)',
      prepare: async (user): Promise<Prepared> => {
        const areaId = await createServiceArea(app.pool);
        const draft = await put(
          user.accessToken,
          shopProfileBody({ name: 'Draft', ...GPS, service_area_id: areaId }),
          randomUUID(),
        );
        expect(draft.status).toBe(201);
        const body = shopProfileBody({ name: 'Updated', ...GPS, service_area_id: areaId, expected_version: 1 });
        return { send: (token, key) => put(token, body, key), successStatus: 200, payloadKey: 'shop_id' };
      },
    },
    {
      name: 'Shop complete',
      prepare: async (user): Promise<Prepared> => {
        const areaId = await createServiceArea(app.pool);
        const draft = await put(
          user.accessToken,
          shopProfileBody({ name: 'Draft', ...GPS, service_area_id: areaId }),
          randomUUID(),
        );
        expect(draft.status).toBe(201);
        return {
          send: (token, key) => post('/onboarding/shop/complete', token, { expected_version: 1 }, key),
          successStatus: 200,
          payloadKey: 'shop_id',
        };
      },
    },
    {
      name: 'Driver create',
      prepare: (): Promise<Prepared> => {
        const body = driverBody();
        return Promise.resolve({
          send: (token, key) => post('/onboarding/driver', token, body, key),
          successStatus: 201,
          payloadKey: 'driver_id',
        });
      },
    },
  ];

  /** Everything a refused command must leave untouched, as one comparable value. */
  async function snapshot(userId: string): Promise<Record<string, unknown>> {
    const rows = async (sql: string): Promise<unknown[]> => (await app.pool.query(sql, [userId])).rows;
    return {
      shops: await rows(
        `SELECT s.shop_id, s.name, s.status, s.version, s.accepting_orders
           FROM app.shops s JOIN app.shop_members m USING (shop_id)
          WHERE m.user_id = $1::uuid ORDER BY s.shop_id`,
      ),
      drivers: await rows('SELECT driver_id, status, version FROM app.drivers WHERE user_id = $1::uuid ORDER BY driver_id'),
      roles: await rows('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role'),
      successAudits: await rows(
        `SELECT count(*)::int AS n FROM app.audit_logs
          WHERE actor_id = $1 AND outcome = 'SUCCESS' AND action LIKE 'onboarding.%'`,
      ),
      outbox: await rows("SELECT count(*)::int AS n FROM app.outbox_events WHERE payload->>'user_id' = $1"),
      idempotencyRecords: await rows(
        "SELECT count(*)::int AS n FROM app.idempotency_records WHERE scope_type = 'user' AND scope_id = $1",
      ),
    };
  }

  async function secondSession(user: Registered): Promise<{ token: string; sessionId: string }> {
    const login = await loginUser(app, user);
    expect(login.status).toBe(200);
    const token = String(dataOf(login).access_token);
    return { token, sessionId: await sessionIdOfToken(app.pool, token) };
  }

  async function holdSession(sessionId: string, change: Change): Promise<LockHolder> {
    const holder = await LockHolder.begin(app.pool);
    if (change === 'revoke') {
      await holder.query(
        `UPDATE app.sessions
            SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
                updated_at = date_trunc('milliseconds', clock_timestamp())
          WHERE session_id = $1::uuid`,
        [sessionId],
      );
    } else {
      // The same CHECK-safe move as expireSession: the expiry has already elapsed once this commits.
      await holder.query(
        `UPDATE app.sessions
            SET created_at = created_at - interval '2 days',
                updated_at = updated_at - interval '2 days',
                expires_at = clock_timestamp() - interval '1 second'
          WHERE session_id = $1::uuid`,
        [sessionId],
      );
    }
    return holder;
  }

  const waiterOn = (pattern: string, atLeast = 1) => async (): Promise<boolean> =>
    (await rowLockWaitersRunning(app.pool, pattern)) >= atLeast;

  /**
   * Sends the command while a held, uncommitted change sits on the session row, proves from pg_locks that the
   * BUSINESS transaction is waiting on that row, then commits the change and returns the response.
   */
  async function sendDuringSessionChange(
    send: () => Promise<ApiResponse>,
    sessionId: string,
    change: Change,
  ): Promise<ApiResponse> {
    const holder = await holdSession(sessionId, change);
    let released = false;
    try {
      const pending = send();
      await eventually(waiterOn(SESSION_LOCK), 'the business transaction waits for the session row lock');
      await holder.commit();
      released = true;
      return await pending;
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  }

  const EXPECTED: Record<Change, string> = { revoke: 'SESSION_REVOKED', expire: 'SESSION_EXPIRED' };

  for (const operation of OPERATIONS) {
    describe(operation.name, () => {
      for (const change of ['revoke', 'expire'] as const) {
        it(`a session authenticated before the wait but ${change}d during it is refused with no business effect`, async () => {
          const user = await registerUser(app);
          const prepared = await operation.prepare(user);
          const second = await secondSession(user);
          const before = await snapshot(user.userId);

          const response = await sendDuringSessionChange(
            () => prepared.send(second.token, randomUUID()),
            second.sessionId,
            change,
          );

          expect([response.status, errorCode(response)]).toEqual([401, EXPECTED[change]]);
          // No business row, role, success audit, outbox event or idempotency record appeared.
          expect(await snapshot(user.userId)).toEqual(before);
        });
      }

      it('an account disabled during the user-lock wait is refused with ACCOUNT_DISABLED and no effect', async () => {
        const user = await registerUser(app);
        const prepared = await operation.prepare(user);
        const before = await snapshot(user.userId);

        const holder = await LockHolder.begin(app.pool);
        let released = false;
        try {
          await holder.query(
            "UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid",
            [user.userId],
          );
          const pending = prepared.send(user.accessToken, randomUUID());
          await eventually(waiterOn(USER_LOCK), 'the business transaction waits for the user row lock');
          await holder.commit();
          released = true;
          const response = await pending;
          expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
          expect(await snapshot(user.userId)).toEqual(before);
        } finally {
          if (!released) {
            await holder.rollback();
          }
        }
      });

      for (const change of ['revoke', 'expire'] as const) {
        it(`a sensitive replay whose session is ${change}d during the authorization wait returns no payload and keeps the record`, async () => {
          const user = await registerUser(app);
          const prepared = await operation.prepare(user);
          const key = randomUUID();
          const first = await prepared.send(user.accessToken, key);
          expect(first.status).toBe(prepared.successStatus);
          const second = await secondSession(user);
          const stored = await snapshot(user.userId);

          const denied = await sendDuringSessionChange(() => prepared.send(second.token, key), second.sessionId, change);

          expect([denied.status, errorCode(denied)]).toEqual([401, EXPECTED[change]]);
          expect(denied.body.data).toBeUndefined();
          expect(denied.text).not.toContain(prepared.payloadKey);
          // The successful record is preserved and nothing new was written ...
          expect(await snapshot(user.userId)).toEqual(stored);
          // ... so a session that is still valid gets the very same stored result afterwards.
          const replayed = await prepared.send(user.accessToken, key);
          expect(replayed.status).toBe(first.status);
          expect(dataOf(replayed)).toEqual(dataOf(first));
        });
      }

      it('a valid NEW session of the same user replays the once-stored result unchanged, with no extra effect', async () => {
        const user = await registerUser(app);
        const prepared = await operation.prepare(user);
        const key = randomUUID();
        const first = await prepared.send(user.accessToken, key);
        expect(first.status).toBe(prepared.successStatus);
        const stored = await snapshot(user.userId);

        const second = await secondSession(user);
        const replayed = await prepared.send(second.token, key);

        expect(replayed.status).toBe(first.status);
        expect(dataOf(replayed)).toEqual(dataOf(first));
        expect(await snapshot(user.userId)).toEqual(stored);
      });
    });
  }

  describe('GET /onboarding/shop/profile (F5) — the read is authorized again inside its transaction', () => {
    const read = (token: string): Promise<ApiResponse> => app.call('GET', '/onboarding/shop/profile', { bearer: token });

    it('a roleless draft owner with a valid session still reads their own draft', async () => {
      const user = await registerUser(app);
      expect((await put(user.accessToken, shopProfileBody({ name: 'Roleless draft' }), randomUUID())).status).toBe(201);
      const response = await read(user.accessToken);
      expect(response.status).toBe(200);
      expect(dataOf(response).name).toBe('Roleless draft');
    });

    for (const change of ['revoke', 'expire'] as const) {
      it(`a session ${change}d AFTER the guard passed and while the read waits returns no profile (revoke/reset/replace all end here)`, async () => {
        const user = await registerUser(app);
        expect((await put(user.accessToken, shopProfileBody({ name: 'Private draft' }), randomUUID())).status).toBe(201);
        const second = await secondSession(user);

        const holder = await holdSession(second.sessionId, change);
        let released = false;
        try {
          const pending = read(second.token);
          await eventually(waiterOn(SESSION_SHARE), 'the read transaction waits for the session row lock');
          await holder.commit();
          released = true;
          const response = await pending;
          expect([response.status, errorCode(response)]).toEqual([401, EXPECTED[change]]);
          expect(response.body.data).toBeUndefined();
          expect(response.text).not.toContain('Private draft');
        } finally {
          if (!released) {
            await holder.rollback();
          }
        }
        // The owner's other, still valid session reads the same draft.
        expect((await read(user.accessToken)).status).toBe(200);
      });
    }

    it('an account disabled while the read waits for the user row returns no profile', async () => {
      const user = await registerUser(app);
      expect((await put(user.accessToken, shopProfileBody({ name: 'Private draft' }), randomUUID())).status).toBe(201);
      const holder = await LockHolder.begin(app.pool);
      let released = false;
      try {
        await holder.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [user.userId]);
        const pending = read(user.accessToken);
        await eventually(waiterOn(USER_SHARE), 'the read transaction waits for the user row lock');
        await holder.commit();
        released = true;
        const response = await pending;
        expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
        expect(response.text).not.toContain('Private draft');
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });
  });

  it('an actual SHOP replacement revokes the old SHOP session, and a Driver command pending from it is refused', async () => {
    const user = await registerUser(app);
    await grantRole(app.pool, user.userId, 'SHOP'); // an ACTIVE owned shop and the SHOP role
    const oldToken = user.accessToken;
    const oldSessionId = await sessionIdOfToken(app.pool, oldToken);
    expect((await select(oldToken, 'SHOP')).status).toBe(200);
    const replacement = await secondSession(user);
    const before = await snapshot(user.userId);

    // Stall both commands at the user lock. The replacement queues FIRST, so it is granted the lock first.
    const holder = await LockHolder.begin(app.pool);
    let released = false;
    try {
      await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [user.userId]);
      const selecting = select(replacement.token, 'SHOP');
      await eventually(waiterOn(USER_LOCK, 1), 'the SHOP replacement waits for the user row lock');
      // The old session is still valid, so the guard lets this Driver command in; it queues behind the replacement.
      const driver = post('/onboarding/driver', oldToken, driverBody(), randomUUID());
      await eventually(waiterOn(USER_LOCK, 2), 'the pending Driver command waits for the user row lock too');
      await holder.commit();
      released = true;

      const [selected, refused] = await Promise.all([selecting, driver]);
      expect(selected.status).toBe(200);
      expect(dataOf(selected).active_role).toBe('SHOP');
      expect([refused.status, errorCode(refused)]).toEqual([401, 'SESSION_REVOKED']);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }

    const revoked = await app.pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM app.sessions WHERE session_id = $1::uuid',
      [oldSessionId],
    );
    expect(revoked.rows[0]?.revoked).toBe(true);
    // No Driver, no DRIVER role, no Driver event: the refused command changed nothing.
    expect(await snapshot(user.userId)).toEqual(before);
  });

  describe('the participant against real rows', () => {
    const participant = new SessionAuthorizationParticipant(new UserRepository(), new SessionRepository());
    const run = (actor: { userId: string; sessionId: string }): Promise<void> =>
      managerFor(poolClientSource(app.pool)).withTransaction((context) => participant.lockAuthorizedActor(context, actor));
    const codeOf = async (actor: { userId: string; sessionId: string }): Promise<string> => {
      const error = await failureOf(() => run(actor)).catch(() => undefined);
      return error instanceof AppError ? error.code : 'OK';
    };

    it('a valid actor passes; a missing session, a session of ANOTHER user and a missing user are all SESSION_INVALID', async () => {
      const alice = await registerUser(app);
      const bob = await registerUser(app);
      const aliceSession = await sessionIdOfToken(app.pool, alice.accessToken);
      const bobSession = await sessionIdOfToken(app.pool, bob.accessToken);

      await expect(run({ userId: alice.userId, sessionId: aliceSession })).resolves.toBeUndefined();
      expect(await codeOf({ userId: alice.userId, sessionId: randomUUID() })).toBe('SESSION_INVALID');
      // Bob's real session presented for Alice: the same answer as a session that does not exist.
      expect(await codeOf({ userId: alice.userId, sessionId: bobSession })).toBe('SESSION_INVALID');
      expect(await codeOf({ userId: randomUUID(), sessionId: aliceSession })).toBe('SESSION_INVALID');
    });

    it('revoked, expired and disabled follow the precedence SESSION_REVOKED, SESSION_EXPIRED, ACCOUNT_DISABLED', async () => {
      const revokedUser = await registerUser(app);
      const revokedSession = await sessionIdOfToken(app.pool, revokedUser.accessToken);
      await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE session_id = $1::uuid', [revokedSession]);
      expect(await codeOf({ userId: revokedUser.userId, sessionId: revokedSession })).toBe('SESSION_REVOKED');

      const expiredUser = await registerUser(app);
      const expiredSession = await sessionIdOfToken(app.pool, expiredUser.accessToken);
      await app.pool.query(
        `UPDATE app.sessions
            SET created_at = created_at - interval '2 days', updated_at = updated_at - interval '2 days',
                expires_at = clock_timestamp() - interval '1 second'
          WHERE session_id = $1::uuid`,
        [expiredSession],
      );
      expect(await codeOf({ userId: expiredUser.userId, sessionId: expiredSession })).toBe('SESSION_EXPIRED');

      // Disabled AND expired: the session error wins. Disabled alone: ACCOUNT_DISABLED.
      await app.pool.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [expiredUser.userId]);
      expect(await codeOf({ userId: expiredUser.userId, sessionId: expiredSession })).toBe('SESSION_EXPIRED');

      const disabledUser = await registerUser(app);
      const disabledSession = await sessionIdOfToken(app.pool, disabledUser.accessToken);
      await app.pool.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [disabledUser.userId]);
      expect(await codeOf({ userId: disabledUser.userId, sessionId: disabledSession })).toBe('ACCOUNT_DISABLED');
    });
  });

  it('simultaneous role selection and onboarding never take the locks in reverse order: no deadlock, invariants hold', async () => {
    const user = await registerUser(app);
    await grantRole(app.pool, user.userId, 'SHOP');
    const secondOne = await secondSession(user);
    const thirdOne = await secondSession(user);

    const results = await Promise.all([
      select(secondOne.token, 'SHOP'),
      select(thirdOne.token, 'SHOP'),
      post('/onboarding/driver', user.accessToken, driverBody(), randomUUID()),
    ]);

    // A deadlock would surface as a 503 (DEADLOCK_DETECTED); every ordering of these commands is a success.
    for (const result of results) {
      expect(result.text).not.toContain('DEADLOCK');
      expect([200, 201]).toContain(result.status);
    }
    const shopSessions = await app.pool.query<{ revoked: boolean }>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM app.sessions WHERE user_id = $1::uuid AND active_role = 'SHOP'",
      [user.userId],
    );
    expect(shopSessions.rows.filter((row) => !row.revoked)).toHaveLength(1); // A1 SHOP device-switch rule
    const drivers = await app.pool.query('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [user.userId]);
    const driverRole = await app.pool.query("SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = 'DRIVER'", [user.userId]);
    // A2 coexistence: the same user holds SHOP and DRIVER together, and the role never exists without its profile.
    expect([drivers.rowCount, driverRole.rowCount]).toEqual([1, 1]);
  });
});
