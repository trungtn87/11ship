import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { FIXTURE_MASTER_K2, fixtureKeyring } from '../../apps/backend/src/crypto/test-keys.fixture';
import { deferred, eventually } from './support/async-helpers';
import {
  ageRecord,
  appCodeOf,
  countItems,
  createHarness,
  createItemWork,
  dbNowMs,
  errorOf,
  grantHook,
  IdempotencyHarness,
  insertItem,
  LockHolder,
  lockPairOf,
  newKey,
  newScopeId,
  onlyRecord,
  recordsOf,
  requestOf,
  seedGrant,
  waitForAdvisoryWaiter,
  waitForRecordRowWaiter,
  waitUntilDbClockReaches,
} from './support/idempotency-fixtures';

// M00-C1A1 — TTL, tombstone, cleanup and the dedupe window against a REAL PostgreSQL:
// C10, C17 and C30. Expiry is decided by the DATABASE clock; waits are bounded polls of that clock.
describe('M00-C1A1 — replay TTL, cleanup and dedupe window on real PostgreSQL', () => {
  let h: IdempotencyHarness;

  beforeAll(async () => {
    h = await createHarness({ poolMax: 12 });
  });

  afterAll(async () => {
    await h.close();
  });

  const SHORT = { replaySeconds: 1, dedupeSeconds: 3600 } as const;
  const WINDOW = { replaySeconds: 3, dedupeSeconds: 3600 } as const;
  const AGEABLE = { replaySeconds: 60, dedupeSeconds: 86_400 } as const;

  async function seed(
    scopeId: string,
    key: string,
    ttl: { replaySeconds: number; dedupeSeconds: number },
    calls: { n: number },
  ): Promise<void> {
    await h.executor().execute(requestOf({ harness: h, scopeId, key, ttl }), createItemWork(h, scopeId, calls));
  }

  async function ciphertextPresent(scopeId: string, key: string): Promise<boolean> {
    return (await onlyRecord(h, scopeId, key)).replay_ciphertext !== null;
  }

  describe('C10 — replay TTL, tombstone and dedupe', () => {
    it('after the replay TTL but inside the dedupe TTL: 409 IDEMPOTENCY_REPLAY_EXPIRED, no re-execution, ciphertext untouched by the executor', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, SHORT, calls);
      await waitUntilDbClockReaches(h.pool, (await onlyRecord(h, scopeId, key)).replay_expires_at);

      const error = await errorOf(() =>
        h.executor().execute(requestOf({ harness: h, scopeId, key, ttl: SHORT }), createItemWork(h, scopeId, calls)),
      );
      expect(appCodeOf(error)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      expect((error as AppError).status).toBe(409);
      expect(calls.n).toBe(1);
      expect(await countItems(h, scopeId)).toBe(1);
      expect(await ciphertextPresent(scopeId, key)).toBe(true);
    });

    it('cleanup phase 1 removes ciphertext/IV/tag but keeps the tombstone: REPLAY_EXPIRED for the same request, KEY_REUSED for a different one', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, SHORT, calls);
      const before = await onlyRecord(h, scopeId, key);
      await waitUntilDbClockReaches(h.pool, before.replay_expires_at);

      const cleared = await h.cleanup().clearExpiredReplay(1000);
      expect(cleared).toBeGreaterThanOrEqual(1);

      const tombstone = await onlyRecord(h, scopeId, key);
      expect(tombstone.replay_ciphertext).toBeNull();
      expect(tombstone.replay_iv).toBeNull();
      expect(tombstone.replay_tag).toBeNull();
      expect(tombstone.request_fingerprint).toBe(before.request_fingerprint);
      expect(tombstone.dedupe_expires_at).toEqual(before.dedupe_expires_at);

      const same = await errorOf(() =>
        h.executor().execute(requestOf({ harness: h, scopeId, key, ttl: SHORT }), createItemWork(h, scopeId, calls)),
      );
      expect(appCodeOf(same)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      const different = await errorOf(() =>
        h.executor().execute(
          requestOf({ harness: h, scopeId, key, ttl: SHORT, logicalRequest: { label: 'different' } }),
          createItemWork(h, scopeId, calls),
        ),
      );
      expect(appCodeOf(different)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(calls.n).toBe(1);
    });

    it('cleanup claims with SKIP LOCKED: a record locked by someone else is skipped, then cleaned once released', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      await seed(scopeId, key, SHORT, { n: 0 });
      await waitUntilDbClockReaches(h.pool, (await onlyRecord(h, scopeId, key)).replay_expires_at);

      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.lockRecordRow(h, scopeId, key);
        // Returns without waiting for the lock and without touching the locked row.
        await h.cleanup().clearExpiredReplay(1000);
        await h.cleanup().deleteExpiredRecords(1000);
        expect(await ciphertextPresent(scopeId, key)).toBe(true);
      } finally {
        await holder.rollback();
      }
      await h.cleanup().clearExpiredReplay(1000);
      expect(await ciphertextPresent(scopeId, key)).toBe(false);
    });

    it('cleanup is bounded by the batch size', async () => {
      const scopeIds = [newScopeId(), newScopeId(), newScopeId()];
      for (const scopeId of scopeIds) {
        await seed(scopeId, newKey(), SHORT, { n: 0 });
      }
      const latest = (await recordsOf(h, scopeIds[2] as string))[0]?.replay_expires_at as Date;
      await waitUntilDbClockReaches(h.pool, latest);
      const cleared = await h.cleanup().clearExpiredReplay(1);
      expect(cleared).toBe(1);
      await h.cleanup().clearExpiredReplay(1000);
    });

    it('a record past its dedupe TTL that cleanup has NOT removed is deleted by the executor under its locks and a new window opens', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, AGEABLE, calls);
      const old = await onlyRecord(h, scopeId, key);
      await ageRecord(h, old.record_id, 90_000);

      // even a DIFFERENT body is accepted: the old window is gone
      const outcome = await h.executor().execute(
        requestOf({ harness: h, scopeId, key, ttl: AGEABLE, logicalRequest: { label: 'new window' } }),
        createItemWork(h, scopeId, calls),
      );
      expect(outcome.replayed).toBe(false);
      expect(calls.n).toBe(2);
      const fresh = await onlyRecord(h, scopeId, key);
      expect(fresh.record_id).not.toBe(old.record_id);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);

      const replay = await h.executor().execute(
        requestOf({ harness: h, scopeId, key, ttl: AGEABLE, logicalRequest: { label: 'new window' } }),
        createItemWork(h, scopeId, calls),
      );
      expect(replay.replayed).toBe(true);
      expect(calls.n).toBe(2);
    });

    it('cleanup phase 2 deletes records past the dedupe TTL, after which the key opens a new window', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, AGEABLE, calls);
      const old = await onlyRecord(h, scopeId, key);
      await ageRecord(h, old.record_id, 90_000);

      const deleted = await h.cleanup().deleteExpiredRecords(1000);
      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(0);

      const next = await h.executor().execute(requestOf({ harness: h, scopeId, key, ttl: AGEABLE }), createItemWork(h, scopeId, calls));
      expect(next.replayed).toBe(false);
      expect(calls.n).toBe(2);
    });

    it('a record inside its dedupe TTL is never deleted by cleanup', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      await seed(scopeId, key, AGEABLE, { n: 0 });
      await h.cleanup().runOnce(1000);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
      expect(await ciphertextPresent(scopeId, key)).toBe(true);
    });
  });

  describe('C17 — expiry crossed while waiting for a lock (fresh database time, never BEGIN time)', () => {
    async function seedWindow(): Promise<{ scopeId: string; key: string; calls: { n: number }; expiresAt: Date }> {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, WINDOW, calls);
      const expiresAt = (await onlyRecord(h, scopeId, key)).replay_expires_at;
      return { scopeId, key, calls, expiresAt };
    }

    it('crossing the replay expiry while waiting for the ADVISORY lock -> REPLAY_EXPIRED', async () => {
      const { scopeId, key, calls, expiresAt } = await seedWindow();
      const pair = lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key);
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.advisory(pair);
        // The request BEGINs while the window is still open ...
        expect(await dbNowMs(h.pool)).toBeLessThan(expiresAt.getTime());
        const waiting = errorOf(() =>
          h.executor({ config: { advisoryWaitMs: 4500 } }).execute(requestOf({ harness: h, scopeId, key, ttl: WINDOW }), createItemWork(h, scopeId, calls)),
        );
        await waitForAdvisoryWaiter(h.pool, pair);
        // ... and the window closes while it waits.
        await waitUntilDbClockReaches(h.pool, expiresAt);
        await holder.commit();
        expect(appCodeOf(await waiting)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      } finally {
        await holder.rollback();
      }
      expect(calls.n).toBe(1);
    });

    it('crossing the replay expiry while waiting for the ROW lock -> REPLAY_EXPIRED', async () => {
      const { scopeId, key, calls, expiresAt } = await seedWindow();
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.lockRecordRow(h, scopeId, key);
        expect(await dbNowMs(h.pool)).toBeLessThan(expiresAt.getTime());
        const waiting = errorOf(() =>
          h.executor({ config: { businessLockTimeoutMs: 4500 } }).execute(requestOf({ harness: h, scopeId, key, ttl: WINDOW }), createItemWork(h, scopeId, calls)),
        );
        // the executor's SELECT ... FOR UPDATE is provably blocked on the record row (server-side barrier)
        await waitForRecordRowWaiter(h.pool);
        await waitUntilDbClockReaches(h.pool, expiresAt);
        await holder.commit();
        expect(appCodeOf(await waiting)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      } finally {
        await holder.rollback();
      }
      expect(calls.n).toBe(1);
    });

    it('cleanup WINS while the executor waits for the advisory lock: the executor then sees a tombstone and answers REPLAY_EXPIRED (not corruption)', async () => {
      const { scopeId, key, calls, expiresAt } = await seedWindow();
      const pair = lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key);
      const holder = await LockHolder.begin(h.pool);
      try {
        await holder.advisory(pair);
        const waiting = errorOf(() =>
          h.executor({ config: { advisoryWaitMs: 4500 } }).execute(requestOf({ harness: h, scopeId, key, ttl: WINDOW }), createItemWork(h, scopeId, calls)),
        );
        await waitForAdvisoryWaiter(h.pool, pair);
        await waitUntilDbClockReaches(h.pool, expiresAt);
        await h.cleanup().clearExpiredReplay(1000);
        expect(await ciphertextPresent(scopeId, key)).toBe(false);
        await holder.commit();
        expect(appCodeOf(await waiting)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      } finally {
        await holder.rollback();
      }
      expect(calls.n).toBe(1);
    });

    it('cleanup LOSES against an executor that holds the row inside its authorization hook; the final fresh clock then refuses the replay', async () => {
      const { scopeId, key, calls, expiresAt } = await seedWindow();
      await seedGrant(h, scopeId, 'owner-1');
      const entered = deferred();
      const release = deferred();
      const executing = errorOf(() =>
        h.executor().execute(
          requestOf({
            harness: h,
            scopeId,
            key,
            ttl: WINDOW,
            replay: {
              kind: 'sensitive',
              authorize: grantHook(h, 'owner-1', async () => {
                entered.resolve();
                await release.promise;
              }),
            },
          }),
          createItemWork(h, scopeId, calls),
        ),
      );
      await entered.promise; // inside the hook: row locked, replay not yet decrypted
      await waitUntilDbClockReaches(h.pool, expiresAt);

      await h.cleanup().clearExpiredReplay(1000); // SKIP LOCKED: must not null a row being replayed
      expect(await ciphertextPresent(scopeId, key)).toBe(true);

      release.resolve();
      expect(appCodeOf(await executing)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
      expect(calls.n).toBe(1);

      await h.cleanup().clearExpiredReplay(1000);
      expect(await ciphertextPresent(scopeId, key)).toBe(false);
    });
  });

  describe('C30 — dedupe expiry, cleanup and many requests', () => {
    async function waitingAdvisoryCount(): Promise<number> {
      const result = await h.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2`,
      );
      return result.rows[0]?.n ?? 0;
    }

    it('dedupe expired + cleanup + five concurrent requests -> exactly ONE committed effect in the new window', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, AGEABLE, calls);
      await ageRecord(h, (await onlyRecord(h, scopeId, key)).record_id, 90_000);
      expect(await countItems(h, scopeId)).toBe(1);

      const pair = lockPairOf(h.scopeType, scopeId, 'fixture.create.v1', key);
      const holder = await LockHolder.begin(h.pool);
      let outcomes: Array<{ replayed: boolean }> = [];
      try {
        await holder.advisory(pair);
        const executor = h.executor({ config: { advisoryWaitMs: 4500 } });
        const pending = Array.from({ length: 5 }, () =>
          executor.execute(requestOf({ harness: h, scopeId, key, ttl: AGEABLE }), createItemWork(h, scopeId, calls)),
        );
        // all five are provably queued behind the same advisory lock
        await eventually(async () => (await waitingAdvisoryCount()) >= 5, 'five requests wait for the advisory lock');
        // cleanup runs while they wait (it takes no advisory lock)
        await h.cleanup().deleteExpiredRecords(1000);
        await holder.commit();
        outcomes = await Promise.all(pending);
      } finally {
        await holder.rollback();
      }
      expect(outcomes.filter((outcome) => !outcome.replayed)).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.replayed)).toHaveLength(4);
      expect(calls.n).toBe(2); // original window + ONE execution in the new window
      expect(await countItems(h, scopeId)).toBe(2);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });

    it('a live record whose historical key is missing is never re-run, not even by concurrent requests', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, AGEABLE, calls);
      const k2Only = new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2');
      const executor = h.executor({ keyring: k2Only });
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          errorOf(() => executor.execute(requestOf({ harness: h, scopeId, key, ttl: AGEABLE }), createItemWork(h, scopeId, calls))),
        ),
      );
      for (const error of results) {
        expect(appCodeOf(error)).toBe('IDEMPOTENCY_KEY_UNAVAILABLE');
      }
      expect(calls.n).toBe(1);
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
      // with the key back, the record replays as before
      const replay = await h.executor({ keyring: fixtureKeyring('k1') }).execute(
        requestOf({ harness: h, scopeId, key, ttl: AGEABLE }),
        createItemWork(h, scopeId, calls),
      );
      expect(replay.replayed).toBe(true);
    });

    it('a new window is not a free pass: the business invariant is checked again by the callback', async () => {
      const scopeId = newScopeId();
      const key = newKey();
      const calls = { n: 0 };
      await seed(scopeId, key, AGEABLE, calls);
      await ageRecord(h, (await onlyRecord(h, scopeId, key)).record_id, 90_000);

      class InvariantViolation extends Error {}
      const error = await errorOf(() =>
        h.executor().execute(requestOf({ harness: h, scopeId, key, ttl: AGEABLE }), async (context) => {
          calls.n += 1;
          const existing = await context.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${h.items} WHERE scope_id = $1 AND label = 'one'`,
            [scopeId],
          );
          if ((existing.rows[0]?.n ?? 0) > 0) {
            throw new InvariantViolation('already exists');
          }
          await insertItem(h, context, scopeId);
          return { status: 201, replayGuard: {}, payload: {} };
        }),
      );
      expect(error).toBeInstanceOf(InvariantViolation);
      expect(calls.n).toBe(2); // the callback DID run again (new window) and refused by itself
      expect(await countItems(h, scopeId)).toBe(1);
      // the whole attempt rolled back, including the delete of the expired record
      expect(await recordsOf(h, scopeId, key)).toHaveLength(1);
    });
  });
});
