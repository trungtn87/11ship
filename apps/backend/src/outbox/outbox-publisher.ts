import { JsonObject } from '../shared/json/json-object';

/**
 * What a publisher receives: the immutable business envelope plus the number of the attempt that is being
 * made. It deliberately does NOT carry the lease token (a publisher has no business with DB fencing) and no
 * delivery bookkeeping. `eventId` is identical on every retry and every redelivery: a consumer MUST dedupe
 * by it, because delivery is at-least-once and never exactly-once.
 */
export interface OutboxPublishEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventSchemaVersion: number;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  /** ISO-8601 instant taken from the PostgreSQL clock when the event was written. */
  readonly occurredAt: string;
  readonly payload: JsonObject;
  /** 1 for the first attempt; larger after a retry or after a stale-lease reclaim. */
  readonly attemptCount: number;
}

/**
 * The outbound edge of the dispatcher (broker, push, WebSocket, ...). C1C ships NO real implementation: only
 * a test fake exists.
 *
 * Contract:
 * - It is called OUTSIDE any database transaction, and only after the claim COMMIT was confirmed.
 * - `signal` is aborted when the attempt times out or the dispatcher is shut down. Aborting is a request,
 *   not a guarantee: an adapter may ignore it, and a call that was aborted may still have had its side
 *   effect. The dispatcher therefore never assumes that an aborted publish did not happen.
 * - Resolve = delivered. Reject (or throw) = failed. The rejection value is NEVER stored or logged.
 * - It must not throw from an abort listener.
 */
export interface OutboxPublisher {
  publish(event: OutboxPublishEvent, signal: AbortSignal): Promise<void>;
}
