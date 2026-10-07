import { AppError } from '../common/app-errors';
import { safeErrorCode } from '../common/safe-error';
import { assertOutboxConfig, OutboxConfig } from '../config/outbox-config';
import { JsonLogger } from '../logging/json-logger';
import {
  ClaimedOutboxEvent,
  OutboxDispatchStorePort,
  OutboxFailureCode,
  OutboxLease,
} from './outbox-dispatch-store';
import { OutboxPublisher, OutboxPublishEvent } from './outbox-publisher';

export type ClaimFailure = 'CLAIM_OUTCOME_UNKNOWN' | 'CLAIM_FAILED';

/** What one dispatch cycle did. Counters only: no event content, no error text. */
export interface DispatchSummary {
  /** The dispatcher was already shut down: nothing was claimed. */
  readonly stopped: boolean;
  /** Free publish slots when the cycle started. */
  readonly freeSlots: number;
  /** min(batch_size, free slots): the most this cycle was allowed to claim. */
  readonly claimLimit: number;
  readonly claimed: number;
  /** Due/stale rows that had no attempts left and were turned DEAD by the claim. */
  readonly deadMarked: number;
  /** Attempts whose ack moved the row to PUBLISHED. */
  readonly published: number;
  readonly retryScheduled: number;
  /** Failed attempts that were the last allowed one: the row became DEAD. */
  readonly deadAfterFailure: number;
  /** Attempts that ended as PUBLISH_TIMEOUT (also counted under retryScheduled/deadAfterFailure/staleNoop). */
  readonly timedOut: number;
  /** Ack/fail that matched nothing (token or status no longer matched): fenced, nothing overwritten. */
  readonly staleNoop: number;
  /** Ack/fail transitions that threw (including an unknown COMMIT): the row is left to lease recovery. */
  readonly transitionErrors: number;
  /** Claimed rows that were not published or not transitioned because of shutdown: left to lease recovery. */
  readonly abandoned: number;
  /** Set when the claim itself failed or its COMMIT outcome is unknown: NO event of that batch was published. */
  readonly claimFailure: ClaimFailure | undefined;
}

export interface DrainResult {
  /** true: everything in flight finished before the deadline. */
  readonly drained: boolean;
  /** Underlying publisher promises still unsettled when drain returned (their signals were aborted). */
  readonly unsettledPublishers: number;
  /** A dispatch cycle (claim or transitions) was still running when the deadline passed. */
  readonly cycleStillRunning: boolean;
}

export interface OutboxDispatcherOptions {
  /** Only fixed codes and event names are ever logged: never an event, payload, error message or value. */
  readonly logger?: JsonLogger;
}

type PublishSettlement = 'ok' | 'failed';
type AttemptOutcome = PublishSettlement | 'timeout' | 'abandoned';

interface MutableCounts {
  claimed: number;
  deadMarked: number;
  published: number;
  retryScheduled: number;
  deadAfterFailure: number;
  timedOut: number;
  staleNoop: number;
  transitionErrors: number;
  abandoned: number;
}

function newCounts(): MutableCounts {
  return {
    claimed: 0,
    deadMarked: 0,
    published: 0,
    retryScheduled: 0,
    deadAfterFailure: 0,
    timedOut: 0,
    staleNoop: 0,
    transitionErrors: 0,
    abandoned: 0,
  };
}

function toPublishEvent(event: ClaimedOutboxEvent): OutboxPublishEvent {
  // The lease token stays inside the dispatcher: a publisher is never handed DB fencing material.
  return Object.freeze({
    eventId: event.eventId,
    eventType: event.eventType,
    eventSchemaVersion: event.eventSchemaVersion,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    resourceVersion: event.resourceVersion,
    occurredAt: event.occurredAt,
    payload: event.payload,
    attemptCount: event.attemptCount,
  });
}

/**
 * The outbox dispatch engine (ADR-003 §8, §13.6). It claims due work through the store, publishes outside any
 * database transaction, and records the outcome with token-fenced ack/fail. It never starts by itself: the
 * caller (a future worker) decides when to call dispatchOnce() and when to drain().
 *
 * Concurrency model:
 * - SLOT REGISTRY. `publishConcurrency` bounds the number of UNDERLYING publisher promises that have not
 *   settled. They are tracked in a registry that lives as long as the dispatcher, across any number of
 *   dispatchOnce() calls. A slot is released only when the underlying promise really settles. A timeout
 *   fails the ATTEMPT (PUBLISH_TIMEOUT) but does NOT free the slot, because a publisher that ignores the
 *   AbortSignal is still running: with `publishConcurrency` hung promises the next cycle claims zero rows,
 *   so unresolved calls can never grow without bound.
 * - NO PREFETCH. A cycle claims at most min(batch_size, free slots), so no row waits in PROCESSING for a slot.
 * - SINGLE FLIGHT. While a cycle runs, further dispatchOnce() calls on the same instance return that same
 *   cycle (coalesced): two claim cycles of one instance never overlap.
 * - Several instances run independently; the database claim (FOR UPDATE SKIP LOCKED) keeps them disjoint.
 *   Each instance has its own slot registry, so the global bound is instances * publishConcurrency.
 *
 * Fencing and uncertainty:
 * - A batch is published only after the claim COMMIT is confirmed. If that outcome is unknown, no event of
 *   the batch is published; the lease expires and a later claim decides.
 * - The ack/fail of an attempt is decided once. A late resolve/reject after a timeout is ignored.
 * - A publish may succeed while its ack is lost: the event is then redelivered with the SAME event_id
 *   (at-least-once, never exactly-once). Consumers must dedupe by event_id.
 */
export class OutboxDispatcher {
  readonly #store: OutboxDispatchStorePort;
  readonly #publisher: OutboxPublisher;
  readonly #config: OutboxConfig;
  readonly #logger: JsonLogger | undefined;

  /** Registry of underlying publisher promises that have not settled, with the signal controller of each. */
  readonly #unsettled = new Map<Promise<PublishSettlement>, AbortController>();
  /** One resolver per attempt that has no outcome yet; drain uses it to stop waiting at the deadline. */
  readonly #undecided = new Set<() => void>();
  #cycle: Promise<DispatchSummary> | undefined;
  #stopped = false;
  #abandoned = false;

  constructor(
    store: OutboxDispatchStorePort,
    publisher: OutboxPublisher,
    config: OutboxConfig,
    options: OutboxDispatcherOptions = {},
  ) {
    assertOutboxConfig(config);
    this.#store = store;
    this.#publisher = publisher;
    this.#config = config;
    this.#logger = options.logger;
  }

  /** Underlying publisher promises that have not settled (hung ones included). */
  get unsettledPublishCount(): number {
    return this.#unsettled.size;
  }

  get freePublishSlots(): number {
    return Math.max(0, this.#config.publishConcurrency - this.#unsettled.size);
  }

  get isStopped(): boolean {
    return this.#stopped;
  }

  /**
   * One claim -> publish -> ack/fail cycle. Never rejects for operational failures (a database error, an
   * unknown COMMIT, a failing publisher): they are reported in the summary. Concurrent calls coalesce.
   */
  dispatchOnce(): Promise<DispatchSummary> {
    if (this.#cycle !== undefined) {
      return this.#cycle;
    }
    if (this.#stopped) {
      return Promise.resolve(this.#summary(newCounts(), 0, 0, undefined));
    }
    const cycle = this.#runCycle().finally(() => {
      this.#cycle = undefined;
    });
    this.#cycle = cycle;
    return cycle;
  }

  /**
   * Bounded shutdown primitive for a future worker: stop claiming, wait for what is in flight until the
   * deadline, then abort the remaining signals and return. It never loops: after the deadline nothing more
   * is awaited, no further transition is started, and rows that stay PROCESSING are left to lease recovery.
   */
  async drain(deadlineMs: number): Promise<DrainResult> {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
      throw new RangeError('drain deadline must be a non-negative integer');
    }
    this.#stopped = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs);
    });
    const idle = this.#whenIdle().then(() => 'idle' as const);
    const verdict = await Promise.race([idle, deadline]);
    clearTimeout(timer);

    if (verdict === 'idle') {
      return { drained: true, unsettledPublishers: 0, cycleStillRunning: false };
    }

    this.#abandoned = true;
    const unsettledPublishers = this.#unsettled.size;
    for (const controller of this.#unsettled.values()) {
      controller.abort();
    }
    for (const abandon of [...this.#undecided]) {
      abandon();
    }
    return { drained: false, unsettledPublishers, cycleStillRunning: this.#cycle !== undefined };
  }

  async #whenIdle(): Promise<void> {
    // Neither the cycle nor a settlement promise ever rejects, so Promise.all cannot throw here.
    while (this.#cycle !== undefined || this.#unsettled.size > 0) {
      const waiting: Promise<unknown>[] = [...this.#unsettled.keys()];
      if (this.#cycle !== undefined) {
        waiting.push(this.#cycle);
      }
      await Promise.all(waiting);
    }
  }

  async #runCycle(): Promise<DispatchSummary> {
    const counts = newCounts();
    const freeSlots = this.freePublishSlots;
    const claimLimit = Math.min(this.#config.batchSize, freeSlots);
    if (claimLimit === 0) {
      return this.#summary(counts, freeSlots, claimLimit, undefined);
    }

    let claimedEvents: readonly ClaimedOutboxEvent[];
    try {
      const result = await this.#store.claim(claimLimit);
      claimedEvents = result.events;
      counts.deadMarked = result.deadCount;
    } catch (error) {
      // Includes an unknown COMMIT: nothing of this batch was confirmed, so nothing is published.
      const unknown = error instanceof AppError && error.code === 'TRANSACTION_OUTCOME_UNKNOWN';
      this.#logger?.log('warn', 'outbox_claim_failed', { code: safeErrorCode(error) });
      return this.#summary(
        counts,
        freeSlots,
        claimLimit,
        unknown ? 'CLAIM_OUTCOME_UNKNOWN' : 'CLAIM_FAILED',
      );
    }

    counts.claimed = claimedEvents.length;
    if (this.#abandoned) {
      // Shutdown passed its deadline while the claim was running: do not start publishing. The rows stay
      // PROCESSING and are recovered when their lease goes stale.
      counts.abandoned = claimedEvents.length;
      return this.#summary(counts, freeSlots, claimLimit, undefined);
    }

    await Promise.all(claimedEvents.map((event) => this.#attempt(event, counts)));
    return this.#summary(counts, freeSlots, claimLimit, undefined);
  }

  /** Publishes one claimed event and records its outcome exactly once. Never rejects. */
  async #attempt(event: ClaimedOutboxEvent, counts: MutableCounts): Promise<void> {
    const controller = new AbortController();
    let abandon: () => void = () => undefined;
    const abandoned = new Promise<'abandoned'>((resolve) => {
      abandon = () => resolve('abandoned');
    });
    this.#undecided.add(abandon);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: AttemptOutcome;
    try {
      const settled = this.#startPublish(event, controller);
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          // The attempt is over, but the underlying promise (and its slot) stays registered until it settles.
          controller.abort();
          resolve('timeout');
        }, this.#config.publishTimeoutMs);
      });
      outcome = await Promise.race([settled, timedOut, abandoned]);
    } finally {
      clearTimeout(timer);
      this.#undecided.delete(abandon);
    }

    if (outcome === 'abandoned') {
      counts.abandoned += 1;
      return;
    }
    if (outcome === 'timeout') {
      counts.timedOut += 1;
    }
    const lease: OutboxLease = {
      eventId: event.eventId,
      lockToken: event.lockToken,
      attemptCount: event.attemptCount,
    };
    try {
      if (outcome === 'ok') {
        if (await this.#store.ack(lease)) {
          counts.published += 1;
        } else {
          counts.staleNoop += 1;
        }
        return;
      }
      const code: OutboxFailureCode = outcome === 'timeout' ? 'PUBLISH_TIMEOUT' : 'PUBLISH_FAILED';
      this.#logger?.log('warn', 'outbox_publish_failed', { code });
      const result = await this.#store.fail(lease, code);
      if (result === 'RETRY_SCHEDULED') {
        counts.retryScheduled += 1;
      } else if (result === 'DEAD') {
        counts.deadAfterFailure += 1;
      } else {
        counts.staleNoop += 1;
      }
    } catch (error) {
      // Includes an unknown COMMIT. The row keeps its lease; stale-lease recovery decides later.
      counts.transitionErrors += 1;
      this.#logger?.log('warn', 'outbox_transition_failed', { code: safeErrorCode(error) });
    }
  }

  /**
   * Starts the publisher and registers the UNDERLYING promise. The returned promise settles exactly when the
   * publisher's own promise settles, and never rejects: success/failure is a value. The registry entry is
   * removed only then, which is what keeps a hung publisher's slot occupied.
   */
  #startPublish(event: ClaimedOutboxEvent, controller: AbortController): Promise<PublishSettlement> {
    const settled: Promise<PublishSettlement> = new Promise<void>((resolve) => {
      // A synchronous throw becomes a rejection; a non-promise return resolves.
      resolve(this.#publisher.publish(toPublishEvent(event), controller.signal));
    }).then(
      () => 'ok' as const,
      () => 'failed' as const,
    );
    this.#unsettled.set(settled, controller);
    void settled.then(() => {
      this.#unsettled.delete(settled);
    });
    return settled;
  }

  #summary(
    counts: MutableCounts,
    freeSlots: number,
    claimLimit: number,
    claimFailure: ClaimFailure | undefined,
  ): DispatchSummary {
    return Object.freeze({
      stopped: this.#stopped,
      freeSlots,
      claimLimit,
      claimed: counts.claimed,
      deadMarked: counts.deadMarked,
      published: counts.published,
      retryScheduled: counts.retryScheduled,
      deadAfterFailure: counts.deadAfterFailure,
      timedOut: counts.timedOut,
      staleNoop: counts.staleNoop,
      transitionErrors: counts.transitionErrors,
      abandoned: counts.abandoned,
      claimFailure,
    });
  }
}
