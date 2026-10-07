import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { FakeOutboxPublisher } from '../../apps/backend/src/outbox/fake-outbox-publisher.fixture';
import { OutboxDispatchStore, OutboxTransactionRunner } from '../../apps/backend/src/outbox/outbox-dispatch-store';
import { eventually } from './support/async-helpers';
import {
  ageLease,
  composeStore,
  CountingRunner,
  createDispatchHarness,
  crashBeforeCommitRunner,
  crashingStore,
  DispatchHarness,
  first,
  forceProcessing,
  GatedRunner,
  leaseOf,
  lossyCommitRunner,
  makeDue,
  only,
  rowOf,
  seedEvents,
  statusCounts,
  testOutboxConfig,
  waitForCalls,
} from './support/outbox-dispatch-fixtures';

// M00-C1C — C24: the crash / unknown-outcome matrix of ADR-003 §13.6, on a real PostgreSQL.
// "Crash" means the real thing where PostgreSQL allows it (the claiming backend is terminated before COMMIT) and
// otherwise the state-equivalent (the process never gets to its next step). "COMMIT unknown" is injected at the
// client boundary of the real pool, in BOTH forms the caller cannot tell apart: the server committed and only the
// answer was lost, or the COMMIT never reached the server. The database then shows which one it was.
describe('M00-C1C C24 — crash and unknown-outcome matrix', () => {
  let h: DispatchHarness;

  beforeAll(async () => {
    h = await createDispatchHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.reset();
  });

  /** A healthy dispatcher over the real store; the recovery side of every scenario. */
  function healthy(publisher: FakeOutboxPublisher, config = {}) {
    return h.dispatcher({ publisher, config });
  }

  describe('1. crash before the claim COMMIT', () => {
    it('the claiming backend dies with the rows marked: nothing is committed, nothing is published, the rows stay PENDING at attempt 0', async () => {
      const ids = await seedEvents(h, 3);
      const publisher = new FakeOutboxPublisher('resolve');
      const dispatcher = h.dispatcher({
        publisher,
        store: h.store({}, crashBeforeCommitRunner(h)),
      });

      const summary = await dispatcher.dispatchOnce();

      expect(summary.claimFailure).toBeDefined();
      expect(summary.claimed).toBe(0);
      expect(publisher.calls).toHaveLength(0);
      for (const id of ids) {
        const row = await rowOf(h, id);
        expect(row.status).toBe('PENDING');
        expect(row.attempt_count).toBe(0);
        expect(row.lock_token).toBeNull();
        expect(row.locked_at).toBeNull();
      }

      // Recovery needs nothing special: the next healthy cycle claims them as attempt 1.
      const retry = await healthy(publisher).dispatchOnce();
      expect(retry.claimed).toBe(3);
      expect(retry.published).toBe(3);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 1, 1]);
    });
  });

  describe('2. claim COMMIT succeeded, then the process crashes before publishing', () => {
    it('the rows stay PROCESSING under an active lease, then the lease expires and a new attempt (attempt + 1, new token) publishes them', async () => {
      const ids = await seedEvents(h, 2);
      const doomed = await h.store().claim(2); // committed; "the process dies here": nothing is published or acked
      expect(doomed.events).toHaveLength(2);

      const publisher = new FakeOutboxPublisher('resolve');
      const early = await healthy(publisher).dispatchOnce();
      expect(early.claimed).toBe(0); // the lease is still active
      expect(publisher.calls).toHaveLength(0);

      for (const id of ids) {
        await ageLease(h, id);
      }
      const recovery = await healthy(publisher).dispatchOnce();
      expect(recovery.claimed).toBe(2);
      expect(recovery.published).toBe(2);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([2, 2]);
      expect([...publisher.eventIds].sort()).toEqual([...ids].sort());
      for (const id of ids) {
        const row = await rowOf(h, id);
        expect(row.status).toBe('PUBLISHED');
        expect(row.attempt_count).toBe(2);
      }
    });
  });

  describe('3. claim COMMIT outcome unknown: the batch is NOT published', () => {
    it('COMMIT sent and committed, acknowledgement lost: the rows ARE PROCESSING in the database, nothing was published, lease recovery takes over', async () => {
      const ids = await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('resolve');
      const dispatcher = h.dispatcher({
        publisher,
        store: h.store({}, lossyCommitRunner(h, 'ack-lost-after-commit')),
      });

      const summary = await dispatcher.dispatchOnce();
      expect(summary.claimFailure).toBe('CLAIM_OUTCOME_UNKNOWN');
      expect(summary.claimed).toBe(0);
      expect(publisher.calls).toHaveLength(0); // never published from an unconfirmed claim

      for (const id of ids) {
        const row = await rowOf(h, id);
        expect(row.status).toBe('PROCESSING'); // it did commit
        expect(row.attempt_count).toBe(1);
        expect(row.lock_token).not.toBeNull();
      }
      expect((await healthy(publisher).dispatchOnce()).claimed).toBe(0); // active lease: not taken

      for (const id of ids) {
        await ageLease(h, id);
      }
      const recovery = await healthy(publisher).dispatchOnce();
      expect(recovery.published).toBe(2);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([2, 2]);
    });

    it('COMMIT never reached the server: the rows are still PENDING at attempt 0, nothing was published, and the next cycle claims them at once', async () => {
      const ids = await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('resolve');
      const dispatcher = h.dispatcher({
        publisher,
        store: h.store({}, lossyCommitRunner(h, 'never-reached')),
      });

      const summary = await dispatcher.dispatchOnce();
      expect(summary.claimFailure).toBe('CLAIM_OUTCOME_UNKNOWN');
      expect(publisher.calls).toHaveLength(0);
      await eventually(
        async () => (await statusCounts(h))['PENDING'] === 2,
        'the abandoned session is rolled back by the server',
      );
      for (const id of ids) {
        expect((await rowOf(h, id)).attempt_count).toBe(0);
      }

      const recovery = await healthy(publisher).dispatchOnce();
      expect(recovery.published).toBe(2);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 1]);
    });

    it('the dispatcher survives an unknown claim COMMIT: it does not throw and the same instance works afterwards', async () => {
      await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('resolve');
      let lose = true;
      const flaky: OutboxTransactionRunner = {
        withTransaction: (work) =>
          lose ? lossyCommitRunner(h, 'never-reached').withTransaction(work) : h.manager.withTransaction(work),
      };
      const dispatcher = h.dispatcher({ publisher, store: h.store({}, flaky) });
      expect((await dispatcher.dispatchOnce()).claimFailure).toBe('CLAIM_OUTCOME_UNKNOWN');
      lose = false;
      await eventually(async () => (await statusCounts(h))['PENDING'] === 1, 'rollback of the abandoned session');
      expect((await dispatcher.dispatchOnce()).published).toBe(1);
    });
  });

  describe('4. publish succeeded, then the process crashes before the ack', () => {
    it('the event is published again after lease expiry, with the same event_id (at-least-once)', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('resolve');
      const cfg = testOutboxConfig();
      const crashing = h.dispatcher({ publisher, store: crashingStore(new OutboxDispatchStore(h.manager, cfg), 'ack') });

      const summary = await crashing.dispatchOnce();
      expect(summary.transitionErrors).toBe(1);
      expect(publisher.eventIds).toEqual([id]);
      expect((await rowOf(h, id as string)).status).toBe('PROCESSING');

      await ageLease(h, id as string);
      await healthy(publisher).dispatchOnce();
      expect(publisher.eventIds).toEqual([id, id]);
      expect((await rowOf(h, id as string)).status).toBe('PUBLISHED');
    });
  });

  describe('5. ack COMMIT outcome unknown', () => {
    function ackOverLossy(fault: 'ack-lost-after-commit' | 'never-reached') {
      const real = new OutboxDispatchStore(h.manager, testOutboxConfig());
      const lossy = h.store({}, lossyCommitRunner(h, fault));
      return composeStore({ claim: real, fail: real, ack: lossy });
    }

    it('the ack COMMIT was applied and only its answer lost: the row IS PUBLISHED, so there is no redelivery', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await h.dispatcher({ publisher, store: ackOverLossy('ack-lost-after-commit') }).dispatchOnce();

      expect(summary.transitionErrors).toBe(1);
      expect(summary.published).toBe(0); // the dispatcher cannot know
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PUBLISHED');
      expect(row.published_at).not.toBeNull();
      expect(row.lock_token).toBeNull();

      expect((await healthy(publisher).dispatchOnce()).claimed).toBe(0);
      expect(publisher.eventIds).toEqual([id]); // delivered exactly the one time here
    });

    it('the ack COMMIT never reached the server: the row stays PROCESSING and is published again after lease expiry', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await h.dispatcher({ publisher, store: ackOverLossy('never-reached') }).dispatchOnce();

      expect(summary.transitionErrors).toBe(1);
      await eventually(async () => (await rowOf(h, id as string)).status === 'PROCESSING', 'rollback settles');
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PROCESSING');
      expect(row.published_at).toBeNull();

      await ageLease(h, id as string);
      const recovery = await healthy(publisher).dispatchOnce();
      expect(recovery.published).toBe(1);
      expect(publisher.eventIds).toEqual([id, id]);
    });
  });

  describe('6. fail transition COMMIT outcome unknown', () => {
    function failOverLossy(fault: 'ack-lost-after-commit' | 'never-reached', config = {}) {
      const real = new OutboxDispatchStore(h.manager, testOutboxConfig(config));
      const lossy = h.store(config, lossyCommitRunner(h, fault));
      return composeStore({ claim: real, ack: real, fail: lossy });
    }

    it('the fail COMMIT was applied and its answer lost: the row IS PENDING with a backoff and the fixed error code, retried only when due', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('reject');
      // A long backoff keeps the row not-due for the whole test, however slow the machine is.
      const slow = { backoffBaseMs: 200_000, backoffCapMs: 300_000 };
      const summary = await h
        .dispatcher({ publisher, store: failOverLossy('ack-lost-after-commit', slow), config: slow })
        .dispatchOnce();

      expect(summary.transitionErrors).toBe(1);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PENDING');
      expect(row.attempt_count).toBe(1);
      expect(row.last_error_code).toBe('PUBLISH_FAILED');
      expect(row.lock_token).toBeNull();

      const notYet = await healthy(publisher, slow).dispatchOnce();
      expect(notYet.claimed).toBe(0);
      await makeDue(h, id as string);
      publisher.mode = 'resolve';
      expect((await healthy(publisher).dispatchOnce()).published).toBe(1);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2]);
    });

    it('the fail COMMIT never reached the server: the row stays PROCESSING with no error recorded, and lease expiry reclaims it', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('reject');
      const summary = await h.dispatcher({ publisher, store: failOverLossy('never-reached') }).dispatchOnce();

      expect(summary.transitionErrors).toBe(1);
      await eventually(async () => (await rowOf(h, id as string)).status === 'PROCESSING', 'rollback settles');
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PROCESSING');
      expect(row.last_error_code).toBeNull();

      await ageLease(h, id as string);
      publisher.mode = 'resolve';
      const recovery = await healthy(publisher).dispatchOnce();
      expect(recovery.published).toBe(1);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2]);
    });
  });

  describe('7. stale worker ack/fail after a reclaim', () => {
    it('a stale ack and a stale fail, arriving after the lease was reclaimed, are no-ops and overwrite nothing', async () => {
      const [id] = await seedEvents(h, 1);
      const store = h.store();
      const a = only((await store.claim(1)).events);
      await ageLease(h, id as string);
      const b = only((await store.claim(1)).events);
      const before = await rowOf(h, id as string);

      expect(await store.ack(leaseOf(a))).toBe(false);
      expect(await store.fail(leaseOf(a), 'PUBLISH_FAILED')).toBe('NOOP');
      expect(await store.fail(leaseOf(a), 'PUBLISH_TIMEOUT')).toBe('NOOP');
      expect(await rowOf(h, id as string)).toEqual(before);
      expect(before.lock_token).toBe(b.lockToken);
    });

    it('through two real dispatchers: the stale one fails late while the new holder is still publishing; the new holder then wins', async () => {
      const [id] = await seedEvents(h, 1);
      const publisherA = new FakeOutboxPublisher('manual');
      const publisherB = new FakeOutboxPublisher('manual');
      const dispatcherA = h.dispatcher({ publisher: publisherA, config: { publishTimeoutMs: 5000 } });
      const dispatcherB = h.dispatcher({ publisher: publisherB, config: { publishTimeoutMs: 5000 } });

      const cycleA = dispatcherA.dispatchOnce();
      await waitForCalls(publisherA, 1);
      await ageLease(h, id as string);
      const cycleB = dispatcherB.dispatchOnce();
      await waitForCalls(publisherB, 1);
      const holder = await rowOf(h, id as string);
      expect(holder.attempt_count).toBe(2);

      first(publisherA.calls).reject(new Error('late failure of the stale worker'));
      const summaryA = await cycleA;
      expect(summaryA.staleNoop).toBe(1);
      expect(summaryA.retryScheduled).toBe(0);
      expect(await rowOf(h, id as string)).toEqual(holder); // untouched by the stale fail

      first(publisherB.calls).resolve();
      expect((await cycleB).published).toBe(1);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PUBLISHED');
      expect(row.attempt_count).toBe(2);
    });
  });

  describe('8. last attempt -> DEAD, never stuck in PROCESSING', () => {
    it('the last allowed attempt that fails is DEAD, not PENDING and not PROCESSING', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('reject');
      const dispatcher = h.dispatcher({ publisher, config: { maxAttempts: 2 } });

      await dispatcher.dispatchOnce();
      await makeDue(h, id as string);
      const last = await dispatcher.dispatchOnce();

      expect(last.deadAfterFailure).toBe(1);
      expect(await statusCounts(h)).toEqual({ DEAD: 1 });
      expect((await rowOf(h, id as string)).attempt_count).toBe(2);
    });

    it('the last allowed attempt is claimed and the worker crashes: once the lease is stale the NEXT claim makes it DEAD without publishing', async () => {
      const [id] = await seedEvents(h, 1);
      await forceProcessing(h, id as string, 2);
      await ageLease(h, id as string);
      expect(await statusCounts(h)).toEqual({ PROCESSING: 1 });

      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await healthy(publisher, { maxAttempts: 2 }).dispatchOnce();

      expect(summary.deadMarked).toBe(1);
      expect(publisher.calls).toHaveLength(0);
      expect(await statusCounts(h)).toEqual({ DEAD: 1 });
      const row = await rowOf(h, id as string);
      expect(row.lock_token).toBeNull();
      expect(row.locked_at).toBeNull();
      expect(row.payload).toEqual({ n: 0, note: 'safe-payload' });
    });

    it('crash on the last attempt through the real flow: claim (attempt 2 of 2), publish, crash before ack, then DEAD, never a third publish', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('resolve');
      const cfg = { maxAttempts: 2 };
      const crashing = (): ReturnType<typeof healthy> =>
        h.dispatcher({ publisher, config: cfg, store: crashingStore(new OutboxDispatchStore(h.manager, testOutboxConfig(cfg)), 'ack') });

      await crashing().dispatchOnce(); // attempt 1, ack lost
      await ageLease(h, id as string);
      await crashing().dispatchOnce(); // attempt 2 (the last), ack lost
      expect((await rowOf(h, id as string)).attempt_count).toBe(2);
      await ageLease(h, id as string);

      const summary = await healthy(publisher, cfg).dispatchOnce();
      expect(summary.deadMarked).toBe(1);
      expect(publisher.eventIds).toEqual([id, id]); // delivered twice, never a third time
      expect(await statusCounts(h)).toEqual({ DEAD: 1 });
    });
  });

  describe('9. a publisher that ignores the AbortSignal and never settles', () => {
    it('keeps its slots after the timeout: later cycles claim 0 and create no more hung promises, even with due work waiting', async () => {
      const ids = await seedEvents(h, 5);
      const publisher = new FakeOutboxPublisher('manual'); // never settles, ignores the signal
      const counting = new CountingRunner(h.manager);
      const dispatcher = h.dispatcher({
        publisher,
        store: h.store({}, counting),
        config: { publishConcurrency: 2, batchSize: 10, publishTimeoutMs: 150 },
      });

      const first1 = await dispatcher.dispatchOnce();
      expect(first1.claimed).toBe(2); // min(batch 10, free slots 2): never 10
      expect(first1.timedOut).toBe(2);
      expect(publisher.calls).toHaveLength(2);
      expect(publisher.calls.every((call) => call.signal.aborted)).toBe(true);
      expect(dispatcher.unsettledPublishCount).toBe(2);
      const afterFirst = await statusCounts(h);
      expect(afterFirst).toEqual({ PENDING: 5 }); // 2 timed out back to PENDING, 3 never claimed
      const timedOutRows = (await Promise.all(ids.map((id) => rowOf(h, id)))).filter((row) => row.attempt_count === 1);
      expect(timedOutRows).toHaveLength(2);
      for (const row of timedOutRows) {
        expect(row.last_error_code).toBe('PUBLISH_TIMEOUT');
      }

      const transactionsBefore = counting.transactions;
      for (let i = 0; i < 3; i += 1) {
        const next = await dispatcher.dispatchOnce();
        expect(next.claimLimit).toBe(0);
        expect(next.claimed).toBe(0);
      }
      expect(counting.transactions).toBe(transactionsBefore); // the dispatcher did not even ask the database
      expect(publisher.calls).toHaveLength(2); // and created no further promise
      expect(dispatcher.unsettledPublishCount).toBe(2);
      const untouched = (await Promise.all(ids.map((id) => rowOf(h, id)))).filter((row) => row.attempt_count === 0);
      expect(untouched).toHaveLength(3);

      // One hung publisher finally settles: exactly one slot returns and exactly one row is claimed.
      first(publisher.calls).reject(new Error('finally'));
      await eventually(async () => dispatcher.freePublishSlots === 1, 'a slot is released when the promise settles');
      const resumed = await dispatcher.dispatchOnce();
      expect(resumed.claimLimit).toBe(1);
      expect(resumed.claimed).toBe(1);

      publisher.releaseAll();
    });
  });

  describe('10. shutdown / drain is bounded', () => {
    it('drain returns at its deadline with a hung publisher, aborts its signal, makes no transition, and the row is recovered by the lease', async () => {
      const ids = await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('manual');
      const counting = new CountingRunner(h.manager);
      const dispatcher = h.dispatcher({
        publisher,
        store: h.store({}, counting),
        config: { publishTimeoutMs: 5000 },
      });

      const cycle = dispatcher.dispatchOnce();
      await waitForCalls(publisher, 2);

      const startedAt = Date.now();
      const drained = await dispatcher.drain(150);
      const elapsed = Date.now() - startedAt;

      expect(drained.drained).toBe(false);
      expect(drained.unsettledPublishers).toBe(2);
      expect(elapsed).toBeLessThan(3000); // the deadline, not the 5 s publish timeout
      expect(publisher.calls.every((call) => call.signal.aborted)).toBe(true);

      const summary = await cycle;
      expect(summary.abandoned).toBe(2);
      for (const id of ids) {
        const row = await rowOf(h, id);
        expect(row.status).toBe('PROCESSING'); // uncertain: left to lease recovery, no transition attempted
        expect(row.attempt_count).toBe(1);
      }

      // No claim after shutdown, and no database work at all.
      const transactions = counting.transactions;
      const after = await dispatcher.dispatchOnce();
      expect(after.stopped).toBe(true);
      expect(after.claimed).toBe(0);
      expect(counting.transactions).toBe(transactions);

      // Recovery: another dispatcher reclaims once the leases are stale.
      for (const id of ids) {
        await ageLease(h, id);
      }
      const recoveryPublisher = new FakeOutboxPublisher('resolve');
      const recovery = await healthy(recoveryPublisher).dispatchOnce();
      expect(recovery.published).toBe(2);
      expect(recoveryPublisher.calls.map((call) => call.event.attemptCount)).toEqual([2, 2]);

      publisher.releaseAll();
    });

    it('drain waits for publishers that finish before the deadline and leaves nothing in flight', async () => {
      const ids = await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('manual');
      const dispatcher = h.dispatcher({ publisher, config: { publishTimeoutMs: 5000 } });
      const cycle = dispatcher.dispatchOnce();
      await waitForCalls(publisher, 2);

      const draining = dispatcher.drain(5000);
      publisher.releaseAll();
      const result = await draining;

      expect(result.drained).toBe(true);
      expect((await cycle).published).toBe(2);
      expect(await statusCounts(h)).toEqual({ PUBLISHED: 2 });
      expect(ids).toHaveLength(2);
      expect(dispatcher.unsettledPublishCount).toBe(0);
    });

    it('drain on an idle dispatcher returns at once and the dispatcher no longer claims', async () => {
      await seedEvents(h, 1);
      const dispatcher = h.dispatcher({ publisher: new FakeOutboxPublisher('resolve') });
      const result = await dispatcher.drain(1000);
      expect(result).toEqual({ drained: true, unsettledPublishers: 0, cycleStillRunning: false });
      expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
      expect(await statusCounts(h)).toEqual({ PENDING: 1 });
    });

    it('drain issued while the claim transaction is still open does not publish a batch that commits after the deadline', async () => {
      const ids = await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('resolve');
      const gated = new GatedRunner(h.manager);
      const dispatcher = h.dispatcher({ publisher, store: h.store({}, gated) });

      const gate = gated.arm();
      const cycle = dispatcher.dispatchOnce();
      await gate.reached; // the claim transaction is open with the rows marked
      const result = await dispatcher.drain(100);
      expect(result.drained).toBe(false);
      expect(result.cycleStillRunning).toBe(true);

      gate.release(); // the claim now commits, after the shutdown deadline
      const summary = await cycle;
      expect(summary.claimed).toBe(2);
      expect(summary.abandoned).toBe(2);
      expect(publisher.calls).toHaveLength(0);
      for (const id of ids) {
        expect((await rowOf(h, id)).status).toBe('PROCESSING'); // committed, unpublished: the lease recovers them
      }
    });
  });
});
