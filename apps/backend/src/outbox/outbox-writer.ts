import { randomUUID } from 'node:crypto';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { EventId, OutboxEventInput, prepareOutboxEvent } from './outbox-event';

// One PostgreSQL clock sample feeds BOTH occurred_at and available_at, so the two initial timestamps are
// exactly equal (no millisecond drift between two reads of a clock, and no application clock at all).
// Everything about the delivery state is fixed here: a new event is always PENDING with zero attempts and
// no lease, no publication and no error. The explicit casts keep parameter typing independent of how the
// driver declares its parameters.
const INSERT_OUTBOX_SQL = `
WITH clock AS (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS sampled_at
)
INSERT INTO app.outbox_events (
  event_id, event_type, event_schema_version, resource_type, resource_id, resource_version,
  occurred_at, payload, status, attempt_count, available_at, locked_at, lock_token,
  published_at, last_error_code
)
SELECT $1::uuid, $2::varchar, $3::smallint, $4::varchar, $5::varchar, $6::bigint,
       clock.sampled_at, $7::jsonb, 'PENDING', 0, clock.sampled_at, NULL, NULL, NULL, NULL
  FROM clock`;

export interface OutboxWriterOptions {
  /**
   * Test seam only: lets a test force a primary-key collision to provoke a REAL PostgreSQL failure.
   * Production never sets it; the default is a random UUID.
   */
  readonly idGenerator?: () => string;
}

/**
 * Appends an outbox event INSIDE the caller's transaction (the write path of the transactional outbox).
 *
 * Like the audit writer it is a participant: it receives a TransactionContext, opens no transaction and
 * owns no connection, so the event commits or rolls back together with the business mutation. It writes
 * the initial delivery state and nothing else. Claiming, leasing, acknowledging, retrying, reclaiming
 * and publishing belong to the dispatcher (M00-C1C) and do not exist here.
 */
export class OutboxWriter {
  readonly #newId: () => string;

  constructor(options: OutboxWriterOptions = {}) {
    this.#newId = options.idGenerator ?? randomUUID;
  }

  /** Returns the server-generated id of the new event. Throws before any statement on an invalid event. */
  async append(context: TransactionContext, event: OutboxEventInput): Promise<EventId> {
    const prepared = prepareOutboxEvent(event);
    const eventId = this.#newId();

    const result = await context.query(INSERT_OUTBOX_SQL, [
      eventId,
      prepared.eventType,
      prepared.eventSchemaVersion,
      prepared.resourceType,
      prepared.resourceId,
      prepared.resourceVersion,
      prepared.payloadJson,
    ]);
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Outbox event was not written');
    }
    return eventId;
  }
}
