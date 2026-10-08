import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  ApiResponse,
  AuthApp,
  createServiceArea,
  dataOf,
  errorCode,
  loginUser,
  rowLockWaitersRunning,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';
import {
  createShopOwner,
  hoursBody,
  interval,
  profileBody,
  putHours,
  putProfile,
  ShopOwner,
  shopState,
} from './support/shop-management-fixtures';

// M02-A acceptance A14 — a stored result is replayed only while the CURRENT session is valid in the SHOP context and
// the user still OWNS the same ACTIVE shop. The check runs BEFORE the stored payload is decrypted: the tests corrupt
// the stored ciphertext, so a denial that decrypted first would surface as a 500 instead of the typed refusal.
describe('M02-A — replay authorization', () => {
  let app: AuthApp;
  const SESSION_LOCK = '%FROM app.sessions WHERE session_id = $1::uuid FOR UPDATE%';

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await app.close();
  });

  interface Operation {
    readonly name: string;
    send(owner: ShopOwner, token: string, key: string): Promise<ApiResponse>;
    readonly payloadKey: string;
  }

  const OPERATIONS: Operation[] = [
    {
      name: 'business hours',
      send: (owner, token, key) => putHours(app, token, hoursBody([interval(1, 480, 1020)]), key),
      payloadKey: 'intervals',
    },
    {
      name: 'profile',
      send: (owner, token, key) => putProfile(app, token, profileBody(owner), key),
      payloadKey: 'profile',
    },
  ];

  const flipCiphertext = (key: string): Promise<unknown> =>
    app.pool.query(
      `UPDATE app.idempotency_records
          SET replay_ciphertext = set_byte(replay_ciphertext, 0, (get_byte(replay_ciphertext, 0)::int # 1))
        WHERE idempotency_key = $1`,
      [key],
    );

  async function replacementSession(owner: ShopOwner): Promise<string> {
    const login = await loginUser(app, owner.user);
    expect(login.status).toBe(200);
    const token = String(dataOf(login).access_token);
    expect((await app.call('POST', '/auth/role/select', { bearer: token, body: { role: 'SHOP' } })).status).toBe(200);
    return token;
  }

  for (const operation of OPERATIONS) {
    describe(operation.name, () => {
      async function stored(): Promise<{ owner: ShopOwner; key: string; first: ApiResponse }> {
        const owner = await createShopOwner(app);
        const key = randomUUID();
        const first = await operation.send(owner, owner.token, key);
        expect(first.status).toBe(200);
        return { owner, key, first };
      }

      it('the same session replays the exact stored result without a second effect', async () => {
        const { owner, key, first } = await stored();
        const after = await shopState(app.pool, owner);
        const replay = await operation.send(owner, owner.token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
        expect(await shopState(app.pool, owner)).toEqual(after);
      });

      it('a valid REPLACEMENT session of the same user and shop replays it too', async () => {
        const { owner, key, first } = await stored();
        const after = await shopState(app.pool, owner);
        const token = await replacementSession(owner);
        const replay = await operation.send(owner, token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
        expect(await shopState(app.pool, owner)).toEqual(after);
      });

      it('replay does not require the current version: later mutations do not stop the owner reading the stored result', async () => {
        const { owner, key, first } = await stored();
        expect((await putHours(app, owner.token, hoursBody([interval(6, 0, 60)], 3))).status).toBe(200);
        const replay = await operation.send(owner, owner.token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      });

      it('replay does not re-check the service area', async () => {
        const { owner, key, first } = await stored();
        await app.pool.query("UPDATE app.service_areas SET status = 'INACTIVE' WHERE service_area_id = $1::uuid", [owner.areaId]);
        const replay = await operation.send(owner, owner.token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      });

      it('a revoked session is refused BEFORE decrypt and the record is kept for a valid session', async () => {
        const { owner, key, first } = await stored();
        const token = await replacementSession(owner); // revokes the first SHOP session
        await flipCiphertext(key);
        const denied = await operation.send(owner, owner.token, key);
        expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_REVOKED']);
        expect(denied.text).not.toContain(operation.payloadKey);
        await flipCiphertext(key); // restore
        const replay = await operation.send(owner, token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      });

      it('a session revoked while the replay waits for its row is refused and returns no payload', async () => {
        const { owner, key } = await stored();
        const token = await replacementSession(owner);
        const sessionId = await sessionIdOfToken(app.pool, token);
        const holder = await LockHolder.begin(app.pool);
        let released = false;
        try {
          await holder.query(
            `UPDATE app.sessions SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
                    updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE session_id = $1::uuid`,
            [sessionId],
          );
          const pending = operation.send(owner, token, key);
          await eventually(async () => (await rowLockWaitersRunning(app.pool, SESSION_LOCK)) >= 1, 'the replay waits for the session row');
          await holder.commit();
          released = true;
          const denied = await pending;
          expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_REVOKED']);
          expect(denied.body.data).toBeUndefined();
        } finally {
          if (!released) {
            await holder.rollback();
          }
        }
      });

      it('a disabled account is refused BEFORE decrypt', async () => {
        const { owner, key } = await stored();
        await flipCiphertext(key);
        await setUserStatus(app.pool, owner.userId, 'DISABLED');
        const denied = await operation.send(owner, owner.token, key);
        expect(denied.status).toBe(403);
        expect(errorCode(denied)).toBe('ACCOUNT_DISABLED');
        expect(denied.text).not.toContain(operation.payloadKey);
      });

      it('a lost OWNER membership is refused BEFORE decrypt with SHOP_NOT_FOUND', async () => {
        const { owner, key } = await stored();
        await flipCiphertext(key);
        await app.pool.query('DELETE FROM app.shop_members WHERE user_id = $1::uuid', [owner.userId]);
        const denied = await operation.send(owner, owner.token, key);
        expect([denied.status, errorCode(denied)]).toEqual([404, 'SHOP_NOT_FOUND']);
        expect(denied.text).not.toContain(operation.payloadKey);
      });

      it('a DISABLED shop is refused BEFORE decrypt with SHOP_DISABLED, and the record survives a re-enable', async () => {
        const { owner, key, first } = await stored();
        await flipCiphertext(key);
        await app.pool.query("UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid", [owner.shopId]);
        const denied = await operation.send(owner, owner.token, key);
        expect([denied.status, errorCode(denied)]).toEqual([403, 'SHOP_DISABLED']);
        expect(denied.text).not.toContain(operation.payloadKey);
        await app.pool.query("UPDATE app.shops SET status = 'ACTIVE' WHERE shop_id = $1::uuid", [owner.shopId]);
        await flipCiphertext(key);
        const replay = await operation.send(owner, owner.token, key);
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      });

      it('another user cannot replay the key (the scope is the authenticated user)', async () => {
        const { key } = await stored();
        const other = await createShopOwner(app);
        const response = await operation.send(other, other.token, key);
        // The other user's scope has no such record: it is a NEW execution, never the stored payload of the first.
        expect(response.status).toBe(200);
        expect(await shopState(app.pool, other)).toMatchObject({ records: 1 });
      });
    });
  }

  it('a replay never runs the callback again after the area changes (no new area check, no new version)', async () => {
    const owner = await createShopOwner(app);
    const area = await createServiceArea(app.pool);
    const key = randomUUID();
    const first = await putProfile(app, owner.token, profileBody(owner, { service_area_id: area }), key);
    expect(first.status).toBe(200);
    const after = await shopState(app.pool, owner);
    const replay = await putProfile(app, owner.token, profileBody(owner, { service_area_id: area }), key);
    expect(dataOf(replay)).toEqual(dataOf(first));
    expect(await shopState(app.pool, owner)).toEqual(after);
  });
});
