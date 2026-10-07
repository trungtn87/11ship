import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { FakeOutboxPublisher } from '../../apps/backend/src/outbox/fake-outbox-publisher.fixture';
import { dbClockMs } from './support/audit-outbox-fixtures';
import {
  ageLease,
  composeStore,
  CountingRunner,
  createDispatchHarness,
  DispatchHarness,
  envelopeOf,
  first,
  GatedRunner,
  leaseOf,
  makeDue,
  only,
  rowOf,
  seedEvents,
  statusCounts,
  waitForCalls,
} from './support/outbox-dispatch-fixtures';
import { loadIntegrationConfig, startApp, UUID_PATTERN } from './support/test-helpers';

// M00-C1C — C13: outbox claim, lease and fencing on a REAL PostgreSQL. Every ordering of two competing
// dispatchers is decided by a barrier held inside a real, uncommitted claim transaction, never by timing.
describe('M00-C1C C13 — outbox concurrency and lease', () => {
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

  describe('claim', () => {
    it('turns due PENDING events into PROCESSING: attempt 1, a fresh token per event, locked_at from the DB clock', async () => {
      const ids = await seedEvents(h, 3);
      const before = await dbClockMs(h.pool);
      const { events, deadCount } = await h.store().claim(3);
      const after = await dbClockMs(h.pool);

      expect(deadCount).toBe(0);
      expect(events.map((event) => event.eventId).sort()).toEqual([...ids].sort());
      const tokens = new Set<string>();
      for (const event of events) {
        const row = await rowOf(h, event.eventId);
        expect(row.status).toBe('PROCESSING');
        expect(row.attempt_count).toBe(1);
        expect(event.attemptCount).toBe(1);
        expect(row.lock_token).toBe(event.lockToken);
        expect(event.lockToken).toMatch(UUID_PATTERN);
        tokens.add(event.lockToken);
        const lockedAt = (row.locked_at as Date).getTime();
        expect(lockedAt).toBeGreaterThanOrEqual(before - 1);
        expect(lockedAt).toBeLessThanOrEqual(after + 1);
        expect(row.published_at).toBeNull();
        expect(row.last_error_code).toBeNull();
        expect(event.payload).toEqual(row.payload);
        expect(event.eventType).toBe('fixture.created');
        expect(event.resourceVersion).toBe(1);
      }
      expect(tokens.size).toBe(3);
    });

    it('never claims more than the limit and leaves the rest PENDING and untouched', async () => {
      const ids = await seedEvents(h, 5);
      const firstBatch = await h.store().claim(2);
      expect(firstBatch.events).toHaveLength(2);
      expect(await statusCounts(h)).toEqual({ PROCESSING: 2, PENDING: 3 });

      const second = await h.store().claim(10);
      expect(second.events).toHaveLength(3);
      const claimedIds = [...firstBatch.events, ...second.events].map((event) => event.eventId);
      expect(new Set(claimedIds).size).toBe(5);
      expect([...claimedIds].sort()).toEqual([...ids].sort());
      expect(await statusCounts(h)).toEqual({ PROCESSING: 5 });
    });

    it('does not claim an event whose available_at is still in the future by the DATABASE clock, and claims it once it is due', async () => {
      const [id] = await seedEvents(h, 1);
      await h.pool.query(
        "UPDATE app.outbox_events SET available_at = occurred_at + interval '1 hour' WHERE event_id = $1",
        [id],
      );
      expect((await h.store().claim(5)).events).toHaveLength(0);
      expect((await rowOf(h, id as string)).status).toBe('PENDING');

      await makeDue(h, id as string);
      const { events } = await h.store().claim(5);
      expect(events.map((event) => event.eventId)).toEqual([id]);
    });

    it('does not take an ACTIVE lease: the second claim finds nothing and the row keeps its token', async () => {
      const [id] = await seedEvents(h, 1);
      const holder = only((await h.store().claim(1)).events);
      const second = await h.store().claim(10);

      expect(second.events).toHaveLength(0);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PROCESSING');
      expect(row.attempt_count).toBe(1);
      expect(row.lock_token).toBe(holder.lockToken);
    });

    it('reclaims a STALE lease: attempt + 1, a new token, a new locked_at', async () => {
      const [id] = await seedEvents(h, 1);
      const tokenA = only((await h.store().claim(1)).events).lockToken;
      await ageLease(h, id as string);

      const before = await dbClockMs(h.pool);
      const second = await h.store().claim(1);
      const after = await dbClockMs(h.pool);

      expect(second.events).toHaveLength(1);
      const reclaimed = second.events[0];
      expect(reclaimed?.eventId).toBe(id);
      expect(reclaimed?.attemptCount).toBe(2);
      expect(reclaimed?.lockToken).not.toBe(tokenA);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PROCESSING');
      expect(row.attempt_count).toBe(2);
      expect(row.lock_token).toBe(reclaimed?.lockToken);
      const lockedAt = (row.locked_at as Date).getTime();
      expect(lockedAt).toBeGreaterThanOrEqual(before - 1);
      expect(lockedAt).toBeLessThanOrEqual(after + 1);
    });

    it('judges staleness by PostgreSQL time against the configured lease: a lease just inside it is kept, one just past it is taken', async () => {
      const [fresh, stale] = await seedEvents(h, 2);
      await h.store().claim(2);
      // leaseMs is 30000: put one lease 25 s old and the other 35 s old, all by DB clock arithmetic.
      for (const [id, ageMs] of [
        [fresh, 25_000],
        [stale, 35_000],
      ] as const) {
        await h.pool.query(
          `UPDATE app.outbox_events
              SET occurred_at = t.at, available_at = t.at, locked_at = t.at
             FROM (SELECT date_trunc('milliseconds', clock_timestamp()) - $2::int * interval '1 millisecond' AS at) t
            WHERE event_id = $1`,
          [id, ageMs],
        );
      }

      const { events } = await h.store({ leaseMs: 30_000 }).claim(5);
      expect(events.map((event) => event.eventId)).toEqual([stale]);
      expect((await rowOf(h, fresh as string)).attempt_count).toBe(1);
      expect((await rowOf(h, stale as string)).attempt_count).toBe(2);
    });

    it('reads the lease length from the configuration of the claiming store (a shorter lease makes the same row stale)', async () => {
      const [id] = await seedEvents(h, 1);
      await h.store().claim(1);
      await h.pool.query(
        `UPDATE app.outbox_events
            SET occurred_at = t.at, available_at = t.at, locked_at = t.at
           FROM (SELECT date_trunc('milliseconds', clock_timestamp()) - interval '10 seconds' AS at) t
          WHERE event_id = $1`,
        [id],
      );
      expect((await h.store({ leaseMs: 30_000 }).claim(1)).events).toHaveLength(0);
      expect((await h.store({ leaseMs: 5000, publishTimeoutMs: 100 }).claim(1)).events).toHaveLength(1);
    });
  });

  describe('ack and fail fencing', () => {
    it('a stale worker cannot ack or fail after another worker reclaimed the lease: both are quiet no-ops that overwrite nothing', async () => {
      const [id] = await seedEvents(h, 1);
      const a = only((await h.store().claim(1)).events);
      await ageLease(h, id as string);
      const b = only((await h.store().claim(1)).events);
      expect(a.lockToken).not.toBe(b.lockToken);
      const beforeStale = await rowOf(h, id as string);

      const store = h.store();
      expect(await store.ack(leaseOf(a))).toBe(false);
      expect(await store.fail(leaseOf(a), 'PUBLISH_FAILED')).toBe('NOOP');
      expect(await store.fail(leaseOf(a), 'PUBLISH_TIMEOUT')).toBe('NOOP');

      const afterStale = await rowOf(h, id as string);
      expect(afterStale).toEqual(beforeStale);
      expect(afterStale.status).toBe('PROCESSING');
      expect(afterStale.attempt_count).toBe(2);
      expect(afterStale.lock_token).toBe(b.lockToken);
      expect(afterStale.last_error_code).toBeNull();
      expect(afterStale.published_at).toBeNull();

      // The current holder still can.
      const before = await dbClockMs(h.pool);
      expect(await store.ack(leaseOf(b))).toBe(true);
      const after = await dbClockMs(h.pool);
      const published = await rowOf(h, id as string);
      expect(published.status).toBe('PUBLISHED');
      expect(published.lock_token).toBeNull();
      expect(published.locked_at).toBeNull();
      const publishedAt = (published.published_at as Date).getTime();
      expect(publishedAt).toBeGreaterThanOrEqual(before - 1);
      expect(publishedAt).toBeLessThanOrEqual(after + 1);
    });

    it('a duplicate ack, an ack/fail after PUBLISHED, and an ack/fail after DEAD are no-ops', async () => {
      const [id] = await seedEvents(h, 1);
      const event = only((await h.store().claim(1)).events);
      const store = h.store();
      expect(await store.ack(leaseOf(event))).toBe(true);
      const published = await rowOf(h, id as string);

      expect(await store.ack(leaseOf(event))).toBe(false);
      expect(await store.fail(leaseOf(event), 'PUBLISH_FAILED')).toBe('NOOP');
      expect(await rowOf(h, id as string)).toEqual(published);

      // DEAD: one attempt allowed, claimed and failed.
      const [deadId] = await seedEvents(h, 1, 'dead');
      const oneShot = h.store({ maxAttempts: 1 });
      const claimed = only((await oneShot.claim(1)).events);
      expect(await oneShot.fail(leaseOf(claimed), 'PUBLISH_FAILED')).toBe('DEAD');
      const dead = await rowOf(h, deadId as string);
      expect(dead.status).toBe('DEAD');
      expect(await oneShot.fail(leaseOf(claimed), 'PUBLISH_TIMEOUT')).toBe('NOOP');
      expect(await oneShot.ack(leaseOf(claimed))).toBe(false);
      expect(await rowOf(h, deadId as string)).toEqual(dead);
    });

    it('ack and fail need the exact (event id, token) pair: a right token for another event, or a random token, matches nothing', async () => {
      const [firstId, secondId] = await seedEvents(h, 2);
      const events = (await h.store().claim(2)).events;
      const a = first(events.filter((event) => event.eventId === firstId));
      const b = first(events.filter((event) => event.eventId === secondId));
      const store = h.store();

      expect(await store.ack({ eventId: a.eventId, lockToken: b.lockToken, attemptCount: 1 })).toBe(false);
      expect(await store.fail({ eventId: b.eventId, lockToken: a.lockToken, attemptCount: 1 }, 'PUBLISH_FAILED')).toBe('NOOP');
      expect(
        await store.ack({ eventId: a.eventId, lockToken: '99999999-9999-4999-8999-999999999999', attemptCount: 1 }),
      ).toBe(false);
      expect((await rowOf(h, firstId as string)).status).toBe('PROCESSING');
      expect((await rowOf(h, secondId as string)).status).toBe('PROCESSING');
    });

    it('never rewrites the immutable envelope: claim, fail, reclaim and ack leave it byte-for-byte unchanged', async () => {
      const [id] = await seedEvents(h, 1);
      const envelope = await envelopeOf(h, id as string);
      const store = h.store();

      const firstClaim = only((await store.claim(1)).events);
      await store.fail(leaseOf(firstClaim), 'PUBLISH_FAILED');
      expect(await envelopeOf(h, id as string)).toBe(envelope);
      await makeDue(h, id as string);
      const secondClaim = only((await store.claim(1)).events);
      expect(await envelopeOf(h, id as string)).toBe(envelope);
      await store.ack(leaseOf(secondClaim));
      expect(await envelopeOf(h, id as string)).toBe(envelope);
      expect((await rowOf(h, id as string)).status).toBe('PUBLISHED');
    });
  });

  describe('two dispatchers', () => {
    it('claim DISJOINT batches while one claim transaction is still open (SKIP LOCKED), proven with a barrier', async () => {
      const ids = await seedEvents(h, 6);
      const gatedRunner = new GatedRunner(h.manager);
      const storeA = h.store({ batchSize: 3 }, gatedRunner);
      const storeB = h.store({ batchSize: 3 });

      const gate = gatedRunner.arm();
      const claimA = storeA.claim(3);
      await gate.reached; // A has marked three rows and holds their row locks; nothing is committed

      // If B waited for A's locks this await could never finish: it finishes because B skips locked rows.
      const resultB = await storeB.claim(3);
      expect(resultB.events).toHaveLength(3);
      const midway = await statusCounts(h);
      expect(midway).toEqual({ PROCESSING: 3, PENDING: 3 }); // only B's rows are committed so far

      gate.release();
      const resultA = await claimA;
      expect(resultA.events).toHaveLength(3);

      const aIds = resultA.events.map((event) => event.eventId);
      const bIds = resultB.events.map((event) => event.eventId);
      expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
      expect([...aIds, ...bIds].sort()).toEqual([...ids].sort());
      const tokens = new Set([...resultA.events, ...resultB.events].map((event) => event.lockToken));
      expect(tokens.size).toBe(6);
      expect(await statusCounts(h)).toEqual({ PROCESSING: 6 });
    });

    it('two dispatcher instances publish every event exactly once between them in that interleaving', async () => {
      const ids = await seedEvents(h, 6);
      const gatedRunner = new GatedRunner(h.manager);
      const publisherA = new FakeOutboxPublisher('resolve');
      const publisherB = new FakeOutboxPublisher('resolve');
      const dispatcherA = h.dispatcher({
        publisher: publisherA,
        config: { batchSize: 3 },
        store: h.store({ batchSize: 3 }, gatedRunner),
      });
      const dispatcherB = h.dispatcher({ publisher: publisherB, config: { batchSize: 3 } });

      const gate = gatedRunner.arm();
      const cycleA = dispatcherA.dispatchOnce();
      await gate.reached;
      const summaryB = await dispatcherB.dispatchOnce();
      gate.release();
      const summaryA = await cycleA;

      expect(summaryA.claimed).toBe(3);
      expect(summaryB.claimed).toBe(3);
      expect(summaryA.published + summaryB.published).toBe(6);
      const delivered = [...publisherA.eventIds, ...publisherB.eventIds];
      expect([...delivered].sort()).toEqual([...ids].sort());
      expect(new Set(delivered).size).toBe(6);
      expect(await statusCounts(h)).toEqual({ PUBLISHED: 6 });
    });

    it('while one dispatcher holds active leases the other claims nothing for them', async () => {
      const ids = await seedEvents(h, 4);
      const publisherA = new FakeOutboxPublisher('manual');
      const publisherB = new FakeOutboxPublisher('resolve');
      const dispatcherA = h.dispatcher({ publisher: publisherA, config: { publishTimeoutMs: 5000 } });
      const dispatcherB = h.dispatcher({ publisher: publisherB });

      const cycleA = dispatcherA.dispatchOnce();
      // A has committed its claim of all four and is waiting on its publisher (external state, polled).
      await waitForCalls(publisherA, 4);

      const summaryB = await dispatcherB.dispatchOnce();
      expect(summaryB.claimed).toBe(0);
      expect(publisherB.calls).toHaveLength(0);

      publisherA.releaseAll();
      const summaryA = await cycleA;
      expect(summaryA.published).toBe(4);
      expect([...publisherA.eventIds].sort()).toEqual([...ids].sort());
    });
  });

  describe('one dispatcher instance', () => {
    it('never runs two claim cycles at once: concurrent dispatchOnce() calls coalesce into one claim', async () => {
      const ids = await seedEvents(h, 4);
      const gatedRunner = new GatedRunner(h.manager);
      const counting = new CountingRunner(gatedRunner);
      const publisher = new FakeOutboxPublisher('resolve');
      const dispatcher = h.dispatcher({ publisher, store: h.store({}, counting) });

      const gate = gatedRunner.arm();
      const firstCycle = dispatcher.dispatchOnce();
      const secondCycle = dispatcher.dispatchOnce();
      const thirdCycle = dispatcher.dispatchOnce();
      expect(secondCycle).toBe(firstCycle);
      expect(thirdCycle).toBe(firstCycle);
      await gate.reached;
      expect(counting.transactions).toBe(1); // exactly one claim transaction is open
      gate.release();

      const summary = await firstCycle;
      expect(summary.claimed).toBe(4);
      expect([...publisher.eventIds].sort()).toEqual([...ids].sort());
      for (const id of ids) {
        expect((await rowOf(h, id)).attempt_count).toBe(1);
      }
    });

    it('does not claim twice for work the first cycle already holds: a second cycle after completion finds nothing', async () => {
      await seedEvents(h, 2);
      const publisher = new FakeOutboxPublisher('resolve');
      const dispatcher = h.dispatcher({ publisher });
      expect((await dispatcher.dispatchOnce()).published).toBe(2);
      expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
      expect(publisher.calls).toHaveLength(2);
    });
  });

  describe('a stale lease of one dispatcher and the ack of another', () => {
    it('composes: a dispatcher whose ack arrives after another reclaimed the lease gets a counted no-op', async () => {
      const [id] = await seedEvents(h, 1);
      const manualA = new FakeOutboxPublisher('manual');
      const dispatcherA = h.dispatcher({ publisher: manualA, config: { publishTimeoutMs: 5000 } });
      const cycleA = dispatcherA.dispatchOnce();
      await waitForCalls(manualA, 1);

      await ageLease(h, id as string);
      const publisherB = new FakeOutboxPublisher('resolve');
      const summaryB = await h.dispatcher({ publisher: publisherB }).dispatchOnce();
      expect(summaryB.published).toBe(1);
      const published = await rowOf(h, id as string);
      expect(published.status).toBe('PUBLISHED');
      expect(published.attempt_count).toBe(2);

      manualA.calls[0]?.resolve(); // A's publisher succeeds late; its token is long gone
      const summaryA = await cycleA;
      expect(summaryA.published).toBe(0);
      expect(summaryA.staleNoop).toBe(1);
      expect(await rowOf(h, id as string)).toEqual(published);
    });
  });

  describe('nothing starts by itself', () => {
    it('booting the real application does not claim, publish or touch a due event', async () => {
      const [id] = await seedEvents(h, 1);
      const before = await rowOf(h, id as string);
      const running = await startApp(loadIntegrationConfig());
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        expect(await rowOf(h, id as string)).toEqual(before);
        expect(before.status).toBe('PENDING');
        expect(before.attempt_count).toBe(0);
      } finally {
        await running.app.close();
      }
      expect(await rowOf(h, id as string)).toEqual(before);
    });
  });

  it('composeStore routes each operation to its own store (fixture self-check)', async () => {
    const calls: string[] = [];
    const tag = (name: string) => ({
      claim: () => {
        calls.push(`${name}.claim`);
        return Promise.resolve({ events: [], deadCount: 0 });
      },
      ack: () => {
        calls.push(`${name}.ack`);
        return Promise.resolve(true);
      },
      fail: () => {
        calls.push(`${name}.fail`);
        return Promise.resolve('NOOP' as const);
      },
    });
    const store = composeStore({ claim: tag('a'), ack: tag('b'), fail: tag('c') });
    await store.claim(1);
    await store.ack({ eventId: 'x', lockToken: 'y', attemptCount: 1 });
    await store.fail({ eventId: 'x', lockToken: 'y', attemptCount: 1 }, 'PUBLISH_FAILED');
    expect(calls).toEqual(['a.claim', 'b.ack', 'c.fail']);
  });
});
