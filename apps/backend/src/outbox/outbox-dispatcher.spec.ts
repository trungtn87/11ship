import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { DEFAULT_OUTBOX_CONFIG, OutboxConfig } from '../config/outbox-config';
import { JsonLogger } from '../logging/json-logger';
import { codeOf } from '../shared/source-scan.fixture';
import { FakeOutboxPublisher } from './fake-outbox-publisher.fixture';
import {
  ClaimedOutboxEvent,
  ClaimResult,
  FailOutcome,
  OutboxDispatchStorePort,
  OutboxFailureCode,
  OutboxLease,
} from './outbox-dispatch-store';
import { DispatchSummary, OutboxDispatcher } from './outbox-dispatcher';

const SECRET = 'SECRET_MARKER_PUBLISH_ERROR_91be';

function uuid(n: number, prefix = 'e'): string {
  const hex = n.toString(16).padStart(12, '0');
  return `${prefix.repeat(8)}-0000-4000-8000-${hex}`;
}

function claimed(n: number, attemptCount = 1): ClaimedOutboxEvent {
  return {
    eventId: uuid(n),
    eventType: 'fixture.created',
    eventSchemaVersion: 1,
    resourceType: 'fixture_item',
    resourceId: `r-${n}`,
    resourceVersion: 1,
    occurredAt: '2026-10-07T00:00:00.000Z',
    payload: { n },
    attemptCount,
    lockToken: uuid(n, 'a'),
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** An in-memory store: it hands out queued events and records every ack/fail it is asked to apply. */
class FakeStore implements OutboxDispatchStorePort {
  readonly claimLimits: number[] = [];
  readonly acks: OutboxLease[] = [];
  readonly fails: Array<{ lease: OutboxLease; code: OutboxFailureCode }> = [];
  queue: ClaimedOutboxEvent[] = [];
  deadCount = 0;
  claimGate: Promise<void> | undefined;
  claimError: unknown;
  ackResult = true;
  ackError: unknown;
  failResult: FailOutcome = 'RETRY_SCHEDULED';
  failError: unknown;
  /** Called after claim() returned its events (the moment the COMMIT is confirmed). */
  onClaimReturned: (() => void) | undefined;

  async claim(limit: number): Promise<ClaimResult> {
    this.claimLimits.push(limit);
    if (this.claimGate !== undefined) {
      await this.claimGate;
    }
    if (this.claimError !== undefined) {
      throw this.claimError;
    }
    const events = this.queue.splice(0, limit);
    this.onClaimReturned?.();
    return { events, deadCount: this.deadCount };
  }

  ack(lease: OutboxLease): Promise<boolean> {
    this.acks.push(lease);
    return this.ackError === undefined ? Promise.resolve(this.ackResult) : Promise.reject(this.ackError);
  }

  fail(lease: OutboxLease, code: OutboxFailureCode): Promise<FailOutcome> {
    this.fails.push({ lease, code });
    return this.failError === undefined ? Promise.resolve(this.failResult) : Promise.reject(this.failError);
  }
}

function config(overrides: Partial<OutboxConfig> = {}): OutboxConfig {
  return { ...DEFAULT_OUTBOX_CONFIG, publishTimeoutMs: 100, ...overrides };
}

function capture(): { logger: JsonLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: new JsonLogger((line) => {
      lines.push(line);
    }),
  };
}

/** Lets already-settled promises run their continuations. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function ids(from: number, count: number): ClaimedOutboxEvent[] {
  return Array.from({ length: count }, (_value, i) => claimed(from + i));
}

describe('OutboxDispatcher — claim limit and publishing order', () => {
  it('claims min(batch_size, free slots): concurrency 2 and batch 10 claim at most 2, never 10', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 10);
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ batchSize: 10, publishConcurrency: 2 }));

    const first = await dispatcher.dispatchOnce();
    expect(store.claimLimits).toEqual([2]);
    expect(first.freeSlots).toBe(2);
    expect(first.claimLimit).toBe(2);
    expect(first.claimed).toBe(2);
    expect(first.published).toBe(2);
    expect(store.queue).toHaveLength(8); // the other eight were never claimed (no prefetch)

    await dispatcher.dispatchOnce();
    expect(store.claimLimits).toEqual([2, 2]);
  });

  it('is bounded by the batch size when slots are plentiful', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 30);
    const dispatcher = new OutboxDispatcher(
      store,
      new FakeOutboxPublisher('resolve'),
      config({ batchSize: 3, publishConcurrency: 10 }),
    );
    const summary = await dispatcher.dispatchOnce();
    expect(store.claimLimits).toEqual([3]);
    expect(summary.claimed).toBe(3);
  });

  it('calls the publisher only after the claim returned (the COMMIT was confirmed), never inside it', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    const gate = deferred();
    store.claimGate = gate.promise;
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config());

    const cycle = dispatcher.dispatchOnce();
    await flush();
    expect(store.claimLimits).toHaveLength(1);
    expect(publisher.calls).toHaveLength(0); // claim not confirmed yet

    gate.resolve();
    await cycle;
    expect(publisher.calls).toHaveLength(2);
  });

  it('publishes nothing when the claim fails or its COMMIT outcome is unknown, and reports it without throwing', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 3);
    const publisher = new FakeOutboxPublisher('resolve');
    const { logger, lines } = capture();
    const dispatcher = new OutboxDispatcher(store, publisher, config(), { logger });

    store.claimError = new AppError('TRANSACTION_OUTCOME_UNKNOWN');
    const unknown = await dispatcher.dispatchOnce();
    expect(unknown.claimFailure).toBe('CLAIM_OUTCOME_UNKNOWN');
    expect(unknown.claimed).toBe(0);

    store.claimError = Object.assign(new Error(`driver: ${SECRET}`), { code: 'ECONNRESET' });
    const failed = await dispatcher.dispatchOnce();
    expect(failed.claimFailure).toBe('CLAIM_FAILED');

    expect(publisher.calls).toHaveLength(0);
    expect(store.acks).toHaveLength(0);
    expect(store.fails).toHaveLength(0);
    expect(lines.join('\n')).not.toContain(SECRET);
    // The failed claim does not wedge the dispatcher: the next cycle works.
    store.claimError = undefined;
    const recovered = await dispatcher.dispatchOnce();
    expect(recovered.claimFailure).toBeUndefined();
    expect(recovered.claimed).toBe(3);
    expect(publisher.calls).toHaveLength(3);
  });

  it('reports the rows the claim turned DEAD and gives them no publisher call', async () => {
    const store = new FakeStore();
    store.deadCount = 4;
    const publisher = new FakeOutboxPublisher('resolve');
    const summary = await new OutboxDispatcher(store, publisher, config()).dispatchOnce();
    expect(summary.deadMarked).toBe(4);
    expect(summary.claimed).toBe(0);
    expect(publisher.calls).toHaveLength(0);
  });

  it('hands the publisher the immutable envelope and an AbortSignal, but never the lease token', async () => {
    const store = new FakeStore();
    store.queue = [claimed(7, 3)];
    const publisher = new FakeOutboxPublisher('resolve');
    await new OutboxDispatcher(store, publisher, config()).dispatchOnce();

    const call = publisher.calls[0];
    expect(call?.event).toEqual({
      eventId: uuid(7),
      eventType: 'fixture.created',
      eventSchemaVersion: 1,
      resourceType: 'fixture_item',
      resourceId: 'r-7',
      resourceVersion: 1,
      occurredAt: '2026-10-07T00:00:00.000Z',
      payload: { n: 7 },
      attemptCount: 3,
    });
    expect(Object.keys(call?.event ?? {})).not.toContain('lockToken');
    expect(Object.isFrozen(call?.event)).toBe(true);
    expect(call?.signal.aborted).toBe(false);
  });
});

describe('OutboxDispatcher — outcomes and fixed error codes', () => {
  it('acks on success with the claim lease', async () => {
    const store = new FakeStore();
    store.queue = [claimed(1, 2)];
    const summary = await new OutboxDispatcher(store, new FakeOutboxPublisher('resolve'), config()).dispatchOnce();
    expect(store.acks).toEqual([{ eventId: uuid(1), lockToken: uuid(1, 'a'), attemptCount: 2 }]);
    expect(store.fails).toHaveLength(0);
    expect(summary.published).toBe(1);
  });

  it('fails a rejecting publisher with the fixed PUBLISH_FAILED, never storing or logging the raw error', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    const rejection = Object.assign(new Error(`broker said: ${SECRET}`), { code: 'ECONNRESET', stack: SECRET });
    const publisher = new FakeOutboxPublisher('reject', rejection);
    const { logger, lines } = capture();
    const summary = await new OutboxDispatcher(store, publisher, config(), { logger }).dispatchOnce();

    expect(store.fails.map((f) => f.code)).toEqual(['PUBLISH_FAILED', 'PUBLISH_FAILED']);
    expect(JSON.stringify(store.fails)).not.toContain(SECRET);
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain('ECONNRESET');
    expect(summary.retryScheduled).toBe(2);
    expect(summary.published).toBe(0);
    expect(store.acks).toHaveLength(0);
  });

  it('treats a publisher that throws synchronously, or returns a non-promise, like a normal outcome', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    let calls = 0;
    const publisher = {
      publish: (): Promise<void> => {
        calls += 1;
        if (calls === 1) {
          throw new Error(SECRET);
        }
        return undefined as unknown as Promise<void>;
      },
    };
    const summary = await new OutboxDispatcher(store, publisher, config()).dispatchOnce();
    expect(store.fails.map((f) => f.code)).toEqual(['PUBLISH_FAILED']);
    expect(store.acks).toHaveLength(1);
    expect(summary.published).toBe(1);
    expect(summary.retryScheduled).toBe(1);
  });

  it('counts DEAD from the store (last attempt) and fenced no-ops separately', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 3);
    store.failResult = 'DEAD';
    const publisher = new FakeOutboxPublisher('reject');
    const dead = await new OutboxDispatcher(store, publisher, config()).dispatchOnce();
    expect(dead.deadAfterFailure).toBe(3);

    const noopStore = new FakeStore();
    noopStore.queue = ids(10, 2);
    noopStore.failResult = 'NOOP';
    const noop = await new OutboxDispatcher(noopStore, new FakeOutboxPublisher('reject'), config()).dispatchOnce();
    expect(noop.staleNoop).toBe(2);

    const ackNoopStore = new FakeStore();
    ackNoopStore.queue = ids(20, 2);
    ackNoopStore.ackResult = false;
    const ackNoop = await new OutboxDispatcher(ackNoopStore, new FakeOutboxPublisher('resolve'), config()).dispatchOnce();
    expect(ackNoop.staleNoop).toBe(2);
    expect(ackNoop.published).toBe(0);
  });

  it('survives a transition that throws (also an unknown COMMIT): counted, logged by code only, others still processed', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 3);
    let failFirst = true;
    store.ack = (lease: OutboxLease): Promise<boolean> => {
      store.acks.push(lease);
      if (failFirst) {
        failFirst = false;
        return Promise.reject(new AppError('TRANSACTION_OUTCOME_UNKNOWN'));
      }
      return Promise.resolve(true);
    };
    const { logger, lines } = capture();
    const summary = await new OutboxDispatcher(store, new FakeOutboxPublisher('resolve'), config(), { logger }).dispatchOnce();
    expect(summary.transitionErrors).toBe(1);
    expect(summary.published).toBe(2);
    expect(store.acks).toHaveLength(3);
    expect(lines.join('\n')).toContain('TRANSACTION_OUTCOME_UNKNOWN');
    expect(lines.join('\n')).toContain('outbox_transition_failed');
  });
});

describe('OutboxDispatcher — timeouts and the slot registry (hung publishers)', () => {
  it('fails a timed-out attempt with PUBLISH_TIMEOUT, aborts its signal, and ignores the late settle', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 1);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ publishTimeoutMs: 100 }));

    const summary = await dispatcher.dispatchOnce();
    expect(summary.timedOut).toBe(1);
    expect(store.fails.map((f) => f.code)).toEqual(['PUBLISH_TIMEOUT']);
    expect(publisher.calls[0]?.signal.aborted).toBe(true);
    expect(store.acks).toHaveLength(0);

    // The publisher finally succeeds, or fails, long after the timeout: nothing is recorded a second time.
    publisher.calls[0]?.resolve();
    await flush();
    expect(store.acks).toHaveLength(0);
    expect(store.fails).toHaveLength(1);

    const late = new FakeOutboxPublisher('manual');
    const store2 = new FakeStore();
    store2.queue = ids(5, 1);
    await new OutboxDispatcher(store2, late, config({ publishTimeoutMs: 100 })).dispatchOnce();
    late.calls[0]?.reject(new Error(SECRET));
    await flush();
    expect(store2.fails).toHaveLength(1);
    expect(store2.acks).toHaveLength(0);
  });

  it('keeps the slot of a hung publisher after the timeout: it is freed only when the underlying promise settles', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 10);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ batchSize: 5, publishConcurrency: 2 }));

    const first = await dispatcher.dispatchOnce();
    expect(first.claimed).toBe(2);
    expect(first.timedOut).toBe(2);
    // Both attempts are over (failed with PUBLISH_TIMEOUT) but both underlying promises are still pending.
    expect(dispatcher.unsettledPublishCount).toBe(2);
    expect(dispatcher.freePublishSlots).toBe(0);

    const second = await dispatcher.dispatchOnce();
    expect(second.freeSlots).toBe(0);
    expect(second.claimLimit).toBe(0);
    expect(second.claimed).toBe(0);
    expect(store.claimLimits).toEqual([2]); // the second cycle did not even ask the store
    expect(publisher.calls).toHaveLength(2);

    // One hung publisher finally settles: exactly one slot comes back.
    publisher.calls[0]?.reject(new Error('late'));
    await flush();
    expect(dispatcher.unsettledPublishCount).toBe(1);
    expect(dispatcher.freePublishSlots).toBe(1);

    const third = await dispatcher.dispatchOnce();
    expect(third.claimLimit).toBe(1);
    expect(store.claimLimits).toEqual([2, 1]);
    expect(publisher.calls).toHaveLength(3);
  });

  it('with concurrency 10 and 10 hung publishers the next dispatchOnce() claims zero and creates no new promise', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 25);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ batchSize: 10, publishConcurrency: 10 }));

    const first = await dispatcher.dispatchOnce();
    expect(first.claimed).toBe(10);
    expect(dispatcher.unsettledPublishCount).toBe(10);

    for (let i = 0; i < 3; i += 1) {
      const next = await dispatcher.dispatchOnce();
      expect(next.claimed).toBe(0);
      expect(next.claimLimit).toBe(0);
    }
    expect(store.claimLimits).toEqual([10]);
    expect(publisher.calls).toHaveLength(10);
    expect(dispatcher.unsettledPublishCount).toBe(10);
    expect(store.queue).toHaveLength(15);

    publisher.releaseAll();
    await flush();
    expect(dispatcher.unsettledPublishCount).toBe(0);
    const recovered = await dispatcher.dispatchOnce();
    expect(recovered.claimLimit).toBe(10);
  });

  it('a publisher that settles in time releases its slot at once and never touches the timeout path', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 4);
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ publishConcurrency: 4 }));
    const summary = await dispatcher.dispatchOnce();
    await flush();
    expect(summary.timedOut).toBe(0);
    expect(dispatcher.unsettledPublishCount).toBe(0);
    expect(publisher.calls.every((call) => !call.signal.aborted)).toBe(true);
  });
});

describe('OutboxDispatcher — single flight', () => {
  it('coalesces concurrent dispatchOnce() calls into one cycle: one claim, the same result object', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 4);
    const gate = deferred();
    store.claimGate = gate.promise;
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config());

    const a = dispatcher.dispatchOnce();
    const b = dispatcher.dispatchOnce();
    const c = dispatcher.dispatchOnce();
    expect(b).toBe(a);
    expect(c).toBe(a);
    await flush();
    expect(store.claimLimits).toHaveLength(1);

    gate.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toBe(ra);
    expect(store.claimLimits).toHaveLength(1);
    expect(publisher.calls).toHaveLength(4);

    store.claimGate = undefined;
    store.queue = ids(10, 1);
    const next = dispatcher.dispatchOnce();
    expect(next).not.toBe(a); // a finished cycle does not stick: a new one starts
    await next;
    expect(store.claimLimits).toHaveLength(2);
  });

  it('keeps coalescing while attempts are still waiting on publishers', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ publishTimeoutMs: 5000, leaseMs: 30_000 }));

    const a = dispatcher.dispatchOnce();
    await flush();
    expect(publisher.calls).toHaveLength(2);
    expect(dispatcher.dispatchOnce()).toBe(a);
    expect(store.claimLimits).toHaveLength(1);
    publisher.releaseAll();
    await a;
  });
});

describe('OutboxDispatcher — bounded drain', () => {
  it('stops claiming at once and reports drained when nothing is in flight', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 3);
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config());
    await dispatcher.dispatchOnce();

    const drained = await dispatcher.drain(1000);
    expect(drained).toEqual({ drained: true, unsettledPublishers: 0, cycleStillRunning: false });
    expect(dispatcher.isStopped).toBe(true);

    store.queue = ids(10, 3);
    const after = await dispatcher.dispatchOnce();
    expect(after.stopped).toBe(true);
    expect(after.claimed).toBe(0);
    expect(store.claimLimits).toHaveLength(1); // no new claim after drain
  });

  it('waits for in-flight publishers that finish before the deadline', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ publishTimeoutMs: 5000, leaseMs: 30_000 }));
    const cycle = dispatcher.dispatchOnce();
    await flush();

    const draining = dispatcher.drain(5000);
    publisher.releaseAll();
    const result = await draining;
    expect(result.drained).toBe(true);
    const summary = await cycle;
    expect(summary.published).toBe(2);
    expect(store.acks).toHaveLength(2);
  });

  it('returns at the deadline with a hung publisher: aborts its signal, starts no transition, leaves the row to lease recovery', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 2);
    const publisher = new FakeOutboxPublisher('manual');
    const dispatcher = new OutboxDispatcher(store, publisher, config({ publishTimeoutMs: 5000, leaseMs: 30_000 }));
    const cycle = dispatcher.dispatchOnce();
    await flush();
    expect(publisher.calls).toHaveLength(2);

    const startedAt = Date.now();
    const result = await dispatcher.drain(60);
    const elapsed = Date.now() - startedAt;

    expect(result.drained).toBe(false);
    expect(result.unsettledPublishers).toBe(2);
    expect(elapsed).toBeLessThan(1500); // bounded: deadline, not publish timeout
    expect(publisher.calls.every((call) => call.signal.aborted)).toBe(true);

    const summary = await cycle; // the cycle is released too, without waiting for the publishers
    expect(summary.abandoned).toBe(2);
    expect(summary.published + summary.retryScheduled + summary.deadAfterFailure).toBe(0);
    expect(store.acks).toHaveLength(0);
    expect(store.fails).toHaveLength(0);

    // Calling drain again is still bounded and does not start anything.
    const again = await dispatcher.drain(20);
    expect(again.drained).toBe(false);
    expect(store.fails).toHaveLength(0);
    publisher.releaseAll();
  });

  it('does not publish a batch whose claim returns after the drain deadline', async () => {
    const store = new FakeStore();
    store.queue = ids(1, 3);
    const gate = deferred();
    store.claimGate = gate.promise;
    const publisher = new FakeOutboxPublisher('resolve');
    const dispatcher = new OutboxDispatcher(store, publisher, config());
    const cycle = dispatcher.dispatchOnce();
    await flush();

    const result = await dispatcher.drain(30);
    expect(result.drained).toBe(false);
    expect(result.cycleStillRunning).toBe(true);

    gate.resolve();
    const summary = await cycle;
    expect(summary.claimed).toBe(3);
    expect(summary.abandoned).toBe(3);
    expect(publisher.calls).toHaveLength(0);
    expect(store.acks).toHaveLength(0);
    expect(store.fails).toHaveLength(0);
  });

  it('rejects an invalid deadline', async () => {
    const dispatcher = new OutboxDispatcher(new FakeStore(), new FakeOutboxPublisher(), config());
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let error: unknown;
      try {
        await dispatcher.drain(bad);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RangeError);
    }
    expect(dispatcher.isStopped).toBe(false);
  });
});

describe('OutboxDispatcher — construction and structure', () => {
  it('refuses an invalid config at construction (no value in the message)', () => {
    let error: unknown;
    try {
      new OutboxDispatcher(new FakeStore(), new FakeOutboxPublisher(), { ...DEFAULT_OUTBOX_CONFIG, leaseMs: 5000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe('invalid outbox configuration');
  });

  it('is an engine, not a worker: no timers that re-run cycles, no loop, no clock, no database driver', () => {
    const code = codeOf('outbox/outbox-dispatcher.ts');
    expect(code).not.toMatch(/setInterval|setImmediate|while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/);
    expect(code).not.toMatch(/Date\.now|new Date|performance\.now|hrtime/);
    expect(code).not.toMatch(/from 'pg'|TransactionManager|transaction-manager|pg-client-source/);
    // setTimeout is used for the publish timeout and the drain deadline only, and each one is cleared.
    expect((code.match(/setTimeout\(/g) ?? []).length).toBe(2);
    expect((code.match(/clearTimeout\(/g) ?? []).length).toBe(2);
  });

  it('never persists or logs anything from a publisher error: the error value is not even named', () => {
    const code = codeOf('outbox/outbox-dispatcher.ts');
    // The rejection handler of the publisher promise ignores its argument.
    expect(code).toContain("() => 'failed' as const");
    expect(code).not.toMatch(/\.message|\.stack/);
  });
});

// Keeps the summary type honest: a field added to it must be considered by the tests above.
const SUMMARY_FIELDS: ReadonlyArray<keyof DispatchSummary> = [
  'stopped',
  'freeSlots',
  'claimLimit',
  'claimed',
  'deadMarked',
  'published',
  'retryScheduled',
  'deadAfterFailure',
  'timedOut',
  'staleNoop',
  'transitionErrors',
  'abandoned',
  'claimFailure',
];

describe('DispatchSummary', () => {
  it('has exactly the documented counters and is frozen', async () => {
    const summary = await new OutboxDispatcher(new FakeStore(), new FakeOutboxPublisher(), config()).dispatchOnce();
    expect(Object.keys(summary).sort()).toEqual([...SUMMARY_FIELDS].sort());
    expect(Object.isFrozen(summary)).toBe(true);
  });
});
