import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { CryptoError } from '../../apps/backend/src/crypto/crypto-error';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { FIXTURE_MASTER_K1, FIXTURE_MASTER_K2, fixtureKeyring } from '../../apps/backend/src/crypto/test-keys.fixture';
import { TransactionError } from '../../apps/backend/src/transaction/transaction-error';
import { deferred } from './support/async-helpers';
import {
  appCodeOf,
  countItems,
  createHarness,
  createItemWork,
  errorOf,
  IdempotencyHarness,
  insertItem,
  LockHolder,
  lockPairOf,
  newKey,
  newScopeId,
  onlyRecord,
  recordsOf,
  requestOf,
  SECRET_PASSWORD,
  SECRET_TOKEN,
  waitForAdvisoryWaiter,
  wholeTableText,
} from './support/idempotency-fixtures';

// M00-C1A1 — executor against a REAL PostgreSQL: C02, C03, C04, C05, C06, C07, C08 (storage, size,
// missing key), C09 and C29. Concurrency order is decided by barriers on the server (pg_locks) and by
// deferred promises, never by sleeping or a bare Promise.all.
describe('M00-C1A1 — idempotency executor on real PostgreSQL', () => {
  let h: IdempotencyHarness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  describe('C02 — sequential idempotency', () => {
    it('runs the callback once and replays the same logical result on the second call', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const executor = h.executor();

      const first = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      const second = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));

      expect(first.replayed).toBe(false);
      expect(first.persisted).toBe(true);
      expect(second.replayed).toBe(true);
      expect(second.status).toBe(201);
      expect(second.payload).toEqual(first.payload);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });
  });

  describe('C03 — concurrent idempotency', () => {
    it('serializes two concurrent requests with the same key: one business insert, the other replays', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const entered = deferred();
      const release = deferred();
      // Long advisory wait: the test, not the timeout, decides when the owner finishes.
      const executor = h.executor({ config: { advisoryWaitMs: 4000 } });

      const owner = executor.execute(requestOf({ harness: h, scopeId, key }), async (context) => {
        calls.n += 1;
        const id = await insertItem(h, context, scopeId);
        entered.resolve();
        await release.promise;
        return { status: 201, replayGuard: { grant_id: scopeId }, payload: { item_id: id, access_token: SECRET_TOKEN } };
      });
      await entered.promise;

      const second = executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      // The second request is provably blocked on the advisory lock of the deterministic two-int32 pair.
      await waitForAdvisoryWaiter(h.pool, lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key));
      release.resolve();

      const [ownerOutcome, secondOutcome] = await Promise.all([owner, second]);
      expect(ownerOutcome.replayed).toBe(false);
      expect(secondOutcome.replayed).toBe(true);
      expect(secondOutcome.payload).toEqual(ownerOutcome.payload);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });
  });

  describe('C04 — key reuse conflict', () => {
    it('answers IDEMPOTENCY_KEY_REUSED (409) for a different body and does not mutate again', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const executor = h.executor();
      await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));

      const error = await errorOf(() =>
        executor.execute(
          requestOf({ harness: h, scopeId, key, logicalRequest: { label: 'two', password: SECRET_PASSWORD } }),
          createItemWork(h, scopeId, calls),
        ),
      );
      expect(appCodeOf(error)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((error as AppError).status).toBe(409);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
    });
  });

  describe('C05 — rollback and retry', () => {
    it('a callback failure leaves no record and no business row; the retry then runs exactly once', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const executor = h.executor();

      const failure = await errorOf(() =>
        executor.execute(requestOf({ harness: h, scopeId, key }), async (context) => {
          calls.n += 1;
          await insertItem(h, context, scopeId);
          throw new Error('business failure before commit');
        }),
      );
      expect((failure as Error).message).toBe('business failure before commit');
      expect(await recordsOf(h, scopeId, key)).toHaveLength(0);
      expect(await countItems(h, scopeId)).toBe(0);

      const retry = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(retry.replayed).toBe(false);
      expect(calls.n).toBe(2); // the failed attempt was rolled back; one committed execution
      expect(await countItems(h, scopeId)).toBe(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });

    it('a non-2xx result is rolled back and not persisted: the key is not consumed', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const executor = h.executor();

      const outcome = await executor.execute(requestOf({ harness: h, scopeId, key }), async (context) => {
        await insertItem(h, context, scopeId);
        return { status: 422, replayGuard: {}, payload: { rejected: true } };
      });
      expect(outcome).toEqual({ status: 422, payload: { rejected: true }, replayed: false, persisted: false });
      expect(await countItems(h, scopeId)).toBe(0);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(0);

      const calls = { n: 0 };
      const retry = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(retry.persisted).toBe(true);
      expect(await countItems(h, scopeId)).toBe(1);
    });
  });

  describe('C06 — scope and operation isolation', () => {
    it('the same key under another scope or operation does not collide', async () => {
      const key = newKey();
      const scopeA = newScopeId();
      const scopeB = newScopeId();
      const calls = { n: 0 };
      const executor = h.executor();

      const a = await executor.execute(requestOf({ harness: h, scopeId: scopeA, key }), createItemWork(h, scopeA, calls));
      const b = await executor.execute(requestOf({ harness: h, scopeId: scopeB, key }), createItemWork(h, scopeB, calls));
      const c = await executor.execute(
        requestOf({ harness: h, scopeId: scopeA, key, operationId: 'fixture.other.v1' }),
        createItemWork(h, scopeA, calls),
      );

      expect([a.replayed, b.replayed, c.replayed]).toEqual([false, false, false]);
      expect(calls.n).toBe(3);
      expect(await countItems(h, scopeA)).toBe(2);
      expect(await countItems(h, scopeB)).toBe(1);

      // and each one still replays independently
      const again = await executor.execute(requestOf({ harness: h, scopeId: scopeB, key }), createItemWork(h, scopeB, calls));
      expect(again.replayed).toBe(true);
      expect(calls.n).toBe(3);
    });
  });

  describe('C07 — fingerprint privacy and rotation', () => {
    it('stores no plaintext password or token anywhere in the record', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, { n: 0 }));
      const dump = await wholeTableText(h, scopeId);
      expect(dump).not.toContain(SECRET_PASSWORD);
      expect(dump).not.toContain(SECRET_TOKEN);
      expect(dump).not.toContain('access_token');
    });

    it('same normalized request -> same fingerprint under one key version; changed request -> different; no trimming or Unicode normalization', async () => {
      async function fingerprintOf(logicalRequest: unknown): Promise<string> {
        const scopeId = newScopeId();
        const key = newKey();
        await h.executor().execute(requestOf({ harness: h, scopeId, key, logicalRequest }), createItemWork(h, scopeId, { n: 0 }));
        return (await onlyRecord(h, scopeId, key)).request_fingerprint;
      }
      const base = await fingerprintOf({ name: 'a', password: SECRET_PASSWORD });
      expect(base).toMatch(/^[0-9a-f]{64}$/);
      expect(await fingerprintOf({ password: SECRET_PASSWORD, name: 'a' })).toBe(base); // key order
      expect(await fingerprintOf({ name: 'a', password: `${SECRET_PASSWORD}x` })).not.toBe(base);
      expect(await fingerprintOf({ name: 'a ', password: SECRET_PASSWORD })).not.toBe(base); // no trim
      const composed = await fingerprintOf({ name: 'é' });
      const decomposed = await fingerprintOf({ name: 'é' });
      expect(composed).not.toBe(decomposed); // no NFC/NFD normalization
    });

    it('a record made under key k1 is still recognized after the active key becomes k2 (record key is used)', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await h.executor({ keyring: fixtureKeyring('k1') }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));

      const afterRotation = h.executor({ keyring: fixtureKeyring('k2') });
      const same = await afterRotation.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(same.replayed).toBe(true);
      const different = await errorOf(() =>
        afterRotation.execute(
          requestOf({ harness: h, scopeId, key, logicalRequest: { label: 'other' } }),
          createItemWork(h, scopeId, calls),
        ),
      );
      expect(appCodeOf(different)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(calls.n).toBe(1);
    });
  });

  describe('C08 — encrypted replay storage', () => {
    it('the decrypted replay equals the original logical payload and the row holds only ciphertext', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const executor = h.executor();
      const first = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      const replay = await executor.execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(replay.payload).toEqual(first.payload);
      expect((replay.payload as { access_token: string }).access_token).toBe(SECRET_TOKEN);

      const record = await onlyRecord(h, scopeId, key);
      expect(record.replay_ciphertext?.length).toBeGreaterThan(0);
      expect(record.replay_iv?.length).toBe(12);
      expect(record.replay_tag?.length).toBe(16);
      expect(record.replay_ciphertext?.toString('utf8')).not.toContain(SECRET_TOKEN);
    });

    it('a replay payload above 64 KiB is rejected BEFORE anything is persisted, and the business insert rolls back', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const error = await errorOf(() =>
        h.executor().execute(requestOf({ harness: h, scopeId, key }), async (context) => {
          await insertItem(h, context, scopeId);
          return { status: 201, replayGuard: { grant_id: scopeId }, payload: { blob: 'x'.repeat(70_000) } };
        }),
      );
      expect(error).toBeInstanceOf(Error);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(0);
      expect(await countItems(h, scopeId)).toBe(0);
    });

    it('a live record whose historical key was removed answers 503 IDEMPOTENCY_KEY_UNAVAILABLE: no callback, no write, record kept', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await h.executor({ keyring: fixtureKeyring('k1') }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      const before = await onlyRecord(h, scopeId, key);

      const k2Only = new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2');
      const error = await errorOf(() =>
        h.executor({ keyring: k2Only }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)),
      );
      expect(appCodeOf(error)).toBe('IDEMPOTENCY_KEY_UNAVAILABLE');
      expect((error as AppError).status).toBe(503);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
      const after = await onlyRecord(h, scopeId, key);
      expect(after).toEqual(before);
    });
  });

  describe('C09 — key rotation', () => {
    it('replays a k1 record after the active key moves to k2, and new records use k2', async () => {
      const scopeId = newScopeId();
      const oldKey = newKey();
      const newerKey = newKey();
      const calls = { n: 0 };

      await h.executor({ keyring: fixtureKeyring('k1') }).execute(requestOf({ harness: h, scopeId, key: oldKey }), createItemWork(h, scopeId, calls));
      expect((await onlyRecord(h, scopeId, oldKey)).crypto_key_id).toBe('k1');

      const rotated = h.executor({ keyring: fixtureKeyring('k2') });
      const replay = await rotated.execute(requestOf({ harness: h, scopeId, key: oldKey }), createItemWork(h, scopeId, calls));
      expect(replay.replayed).toBe(true);
      expect((replay.payload as { access_token: string }).access_token).toBe(SECRET_TOKEN);
      expect((await onlyRecord(h, scopeId, oldKey)).crypto_key_id).toBe('k1');

      await rotated.execute(requestOf({ harness: h, scopeId, key: newerKey }), createItemWork(h, scopeId, calls));
      expect((await onlyRecord(h, scopeId, newerKey)).crypto_key_id).toBe('k2');
      expect(calls.n).toBe(2);
    });

    it('a keyring built independently from the same material (a "new process") replays the old record', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const processOne = new Keyring([{ id: 'k1', master: Buffer.from(FIXTURE_MASTER_K1) }], 'k1');
      await h.executor({ keyring: processOne }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      const processTwo = new Keyring(
        [
          { id: 'k1', master: Buffer.from(FIXTURE_MASTER_K1) },
          { id: 'k2', master: Buffer.from(FIXTURE_MASTER_K2) },
        ],
        'k2',
      );
      const replay = await h.executor({ keyring: processTwo }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(replay.replayed).toBe(true);
      expect(calls.n).toBe(1);
    });
  });

  describe('C29 — advisory lock, BUSY, collisions and lock_timeout', () => {
    it('an advisory wait timeout answers IDEMPOTENCY_BUSY (409) while the key is held; nothing runs; the key is not consumed', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.advisory(lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key));
        const error = await errorOf(() =>
          h.executor({ config: { advisoryWaitMs: 50 } }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)),
        );
        expect(appCodeOf(error)).toBe('IDEMPOTENCY_BUSY');
        expect((error as AppError).status).toBe(409);
        expect(calls.n).toBe(0);
      } finally {
        await holder.rollback();
      }
      const retry = await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(retry.replayed).toBe(false);
      expect(calls.n).toBe(1);
    });

    it('a row-lock timeout (55P03) is NOT mapped to BUSY; it surfaces as the raw SQL error and nothing runs', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));

      const holder = await LockHolder.begin(h.pool);
      let error: unknown;
      try {
        // Only the ROW lock is held; the advisory lock is free, so the executor passes it.
        await holder.lockRecordRow(h, scopeId, key);
        error = await errorOf(() =>
          h.executor({ config: { businessLockTimeoutMs: 100 } }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls)),
        );
      } finally {
        await holder.rollback();
      }
      expect(error).not.toBeInstanceOf(AppError);
      expect((error as { code?: string }).code).toBe('55P03');
      expect(calls.n).toBe(1);

      const replay = await h.executor().execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, calls));
      expect(replay.replayed).toBe(true);
    });

    it('a server-side statement timeout while waiting for the advisory lock is not BUSY', async () => {
      const local = await createHarness({ statementTimeoutMs: 300, queryTimeoutMs: 6000 });
      try {
        const scopeId = newScopeId();
        const key = newKey();
        const holder = await LockHolder.begin(local.pool);
        try {
          await holder.advisory(lockPairOf(local.scopeType, scopeId, 'fixture.create.v1', key));
          // lock_timeout (4 s) is longer than statement_timeout (300 ms): the statement timeout wins.
          const error = await errorOf(() =>
            local.executor({ config: { advisoryWaitMs: 4000 } }).execute(requestOf({ harness: local, scopeId, key }), createItemWork(local, scopeId, { n: 0 })),
          );
          expect(error).not.toBeInstanceOf(AppError);
          expect((error as { code?: string }).code).not.toBe('55P03');
        } finally {
          await holder.rollback();
        }
      } finally {
        await local.close();
      }
    });

    it('a backend that dies while waiting for the advisory lock (outage) is not BUSY', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const pair = lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key);
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.advisory(pair);
        const waiting = errorOf(() =>
          h.executor({ config: { advisoryWaitMs: 4000 } }).execute(requestOf({ harness: h, scopeId, key }), createItemWork(h, scopeId, { n: 0 })),
        );
        await waitForAdvisoryWaiter(h.pool, pair);
        await h.pool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
              AND classid::bigint = $1::bigint AND objid::bigint = $2::bigint`,
          [pair.first >>> 0, pair.second >>> 0],
        );
        const error = await waiting;
        expect(error).toBeInstanceOf(TransactionError);
        expect(error).not.toBeInstanceOf(AppError);
      } finally {
        await holder.rollback();
      }
    });

    it('FORCED hash collision: two different keys on the same advisory pair are serialized, and each gets only its OWN record', async () => {
      const scopeId = newScopeId();
      const keyA = newKey();
      const keyB = newKey();
      const calls = { n: 0 };
      const entered = deferred();
      const release = deferred();
      const collide = { lockKey: () => [123_456, -654_321] as const };
      const executor = h.executor({ ...collide, config: { advisoryWaitMs: 4000 } });

      const first = executor.execute(requestOf({ harness: h, scopeId, key: keyA }), async (context) => {
        calls.n += 1;
        const id = await insertItem(h, context, scopeId, 'A');
        entered.resolve();
        await release.promise;
        return { status: 201, replayGuard: { grant_id: scopeId }, payload: { item_id: id, who: 'A' } };
      });
      await entered.promise;
      const second = executor.execute(requestOf({ harness: h, scopeId, key: keyB }), async (context) => {
        calls.n += 1;
        const id = await insertItem(h, context, scopeId, 'B');
        return { status: 201, replayGuard: { grant_id: scopeId }, payload: { item_id: id, who: 'B' } };
      });
      // B is blocked on the SAME advisory pair although its key is different (redundant serialization).
      await waitForAdvisoryWaiter(h.pool, { first: 123_456, second: -654_321 });
      release.resolve();

      const [a, b] = await Promise.all([first, second]);
      expect((a.payload as { who: string }).who).toBe('A');
      expect((b.payload as { who: string }).who).toBe('B');
      expect(b.replayed).toBe(false);
      expect(calls.n).toBe(2);
      expect(await countItems(h, scopeId)).toBe(2);
      expect(await recordsOf(h, scopeId)).toHaveLength(2);

      // Each key still replays its own result, never the other's.
      const replayA = await executor.execute(requestOf({ harness: h, scopeId, key: keyA }), createItemWork(h, scopeId, calls));
      const replayB = await executor.execute(requestOf({ harness: h, scopeId, key: keyB }), createItemWork(h, scopeId, calls));
      expect((replayA.payload as { who: string }).who).toBe('A');
      expect((replayB.payload as { who: string }).who).toBe('B');
      expect(calls.n).toBe(2);
    });

    it('lock_timeout: the business budget is active inside the callback, and the advisory budget never leaks to the connection', async () => {
      const single = await createHarness({ poolMax: 1 });
      try {
        const baseline = (await single.pool.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]?.lock_timeout;
        const scopeId = newScopeId();
        let inside: string | undefined;
        await single.executor({ config: { advisoryWaitMs: 37, businessLockTimeoutMs: 612 } }).execute(
          requestOf({ harness: single, scopeId, key: newKey() }),
          async (context) => {
            inside = (await context.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]?.lock_timeout;
            return { status: 200, replayGuard: {}, payload: {} };
          },
        );
        expect(inside).toBe('612ms');
        // Same (only) pooled connection afterwards: SET LOCAL semantics left no trace.
        const after = (await single.pool.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]?.lock_timeout;
        expect(after).toBe(baseline);
      } finally {
        await single.close();
      }
    });

    it('a CryptoError class is never confused with BUSY (sanity of the classification)', () => {
      expect(new CryptoError('authentication_failed')).not.toBeInstanceOf(AppError);
    });
  });
});
