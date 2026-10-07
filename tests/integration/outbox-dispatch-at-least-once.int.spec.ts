import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { FakeOutboxPublisher } from '../../apps/backend/src/outbox/fake-outbox-publisher.fixture';
import { OutboxDispatchStore } from '../../apps/backend/src/outbox/outbox-dispatch-store';
import { eventually } from './support/async-helpers';
import {
  ageLease,
  composeStore,
  createDispatchHarness,
  crashingStore,
  DispatchHarness,
  envelopeOf,
  only,
  rowOf,
  seedEvents,
  statusCounts,
  testOutboxConfig,
} from './support/outbox-dispatch-fixtures';

// M00-C1C — C15: AT-LEAST-ONCE, not exactly-once. When the publisher succeeded but the acknowledgement was lost
// (the process died before the ack), the lease goes stale, the event is claimed again and published AGAIN with
// the SAME event_id. A future consumer must therefore dedupe by event_id. Real PostgreSQL throughout.
describe('M00-C1C C15 — at-least-once: publish succeeded, ack lost, event published again', () => {
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

  function crashBeforeAckDispatcher(publisher: FakeOutboxPublisher, config = {}) {
    const cfg = testOutboxConfig(config);
    const real = new OutboxDispatchStore(h.manager, cfg);
    return h.dispatcher({ publisher, config, store: crashingStore(real, 'ack') });
  }

  it('the publish succeeded and was recorded by the publisher, the ack never happened: the row is still PROCESSING', async () => {
    const [id] = await seedEvents(h, 1);
    const publisher = new FakeOutboxPublisher('resolve');
    const summary = await crashBeforeAckDispatcher(publisher).dispatchOnce();

    expect(publisher.eventIds).toEqual([id]); // delivered once so far
    expect(summary.published).toBe(0); // but never acknowledged
    expect(summary.transitionErrors).toBe(1);
    const row = await rowOf(h, id as string);
    expect(row.status).toBe('PROCESSING');
    expect(row.attempt_count).toBe(1);
    expect(row.published_at).toBeNull();
    expect(row.lock_token).not.toBeNull();
  });

  it('once the lease is stale the event is delivered AGAIN, with the same event_id and the next attempt number, then acked', async () => {
    const [id] = await seedEvents(h, 1);
    const publisher = new FakeOutboxPublisher('resolve');

    await crashBeforeAckDispatcher(publisher).dispatchOnce();
    const lostToken = (await rowOf(h, id as string)).lock_token;
    await ageLease(h, id as string);

    const second = await h.dispatcher({ publisher }).dispatchOnce();
    expect(second.claimed).toBe(1);
    expect(second.published).toBe(1);

    // The same event reached the publisher twice: at-least-once, and visibly not exactly-once.
    expect(publisher.eventIds).toEqual([id, id]);
    expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2]);
    expect(publisher.calls[0]?.event.payload).toEqual(publisher.calls[1]?.event.payload);

    const row = await rowOf(h, id as string);
    expect(row.status).toBe('PUBLISHED');
    expect(row.attempt_count).toBe(2);
    expect(row.lock_token).toBeNull();
    expect(lostToken).not.toBeNull(); // the first claim's token is gone with the second claim and the ack
  });

  it('keeps delivering the same event_id for as long as acks keep getting lost, each time with a higher attempt number', async () => {
    const [id] = await seedEvents(h, 1);
    const publisher = new FakeOutboxPublisher('resolve');

    for (let delivery = 1; delivery <= 3; delivery += 1) {
      await crashBeforeAckDispatcher(publisher).dispatchOnce();
      expect((await rowOf(h, id as string)).attempt_count).toBe(delivery);
      await ageLease(h, id as string);
    }
    const last = await h.dispatcher({ publisher }).dispatchOnce();
    expect(last.published).toBe(1);

    expect(publisher.eventIds).toEqual([id, id, id, id]);
    expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2, 3, 4]);
    expect((await rowOf(h, id as string)).status).toBe('PUBLISHED');
  });

  it('works on the real clock too: with no help, the lease of the lost ack expires by PostgreSQL time and the event is redelivered', async () => {
    const [id] = await seedEvents(h, 1);
    const envelope = await envelopeOf(h, id as string);
    const publisher = new FakeOutboxPublisher('resolve');
    // 2101 ms is the shortest lease the configuration allows (> publish timeout 100 ms + 2000 ms).
    const config = { publishTimeoutMs: 100, leaseMs: 2101 };
    const dispatcherB = h.dispatcher({ publisher, config });

    const startedAt = Date.now();
    await crashBeforeAckDispatcher(publisher, config).dispatchOnce();
    expect(publisher.eventIds).toEqual([id]);

    // While the lease is active nobody else gets the event.
    const early = await dispatcherB.dispatchOnce();
    expect(early.claimed).toBe(0);
    expect(publisher.eventIds).toEqual([id]);

    let redelivery: { claimed: number; published: number } | undefined;
    await eventually(
      async () => {
        const summary = await dispatcherB.dispatchOnce();
        if (summary.claimed === 1) {
          redelivery = summary;
          return true;
        }
        return false;
      },
      'the lease expires and the event is claimed again',
      12_000,
      100,
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2000);
    expect(redelivery?.published).toBe(1);
    expect(publisher.eventIds).toEqual([id, id]);
    expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2]);
    const row = await rowOf(h, id as string);
    expect(row.status).toBe('PUBLISHED');
    expect(row.attempt_count).toBe(2);
    expect(await envelopeOf(h, id as string)).toBe(envelope); // the envelope is identical in both deliveries
  });

  it('is only a retry of the SAME event: other events are delivered once and are not repeated', async () => {
    const ids = await seedEvents(h, 2);
    const publisher = new FakeOutboxPublisher('resolve');
    // Only the first ack is lost.
    const cfg = testOutboxConfig();
    const real = new OutboxDispatchStore(h.manager, cfg);
    let acks = 0;
    const lossyAck = {
      claim: (limit: number) => real.claim(limit),
      fail: real.fail.bind(real),
      ack: (lease: Parameters<typeof real.ack>[0]) => {
        acks += 1;
        return acks === 1 ? Promise.reject(new Error('SIMULATED_PROCESS_CRASH')) : real.ack(lease);
      },
    };
    const store = composeStore({ claim: real, fail: real, ack: lossyAck });
    const firstCycle = await h.dispatcher({ publisher, store }).dispatchOnce();
    expect(firstCycle.claimed).toBe(2);
    expect(firstCycle.published).toBe(1);
    expect(firstCycle.transitionErrors).toBe(1);

    const rows = await Promise.all(ids.map((id) => rowOf(h, id)));
    const processing = rows.filter((row) => row.status === 'PROCESSING');
    expect(processing).toHaveLength(1);
    await ageLease(h, only(processing).event_id);

    await h.dispatcher({ publisher }).dispatchOnce();
    const counts = new Map<string, number>();
    for (const id of publisher.eventIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(2);
    expect([...counts.values()].sort()).toEqual([1, 2]); // one event delivered twice, the other once
    expect((await statusCounts(h))).toEqual({ PUBLISHED: 2 });
  });
});
