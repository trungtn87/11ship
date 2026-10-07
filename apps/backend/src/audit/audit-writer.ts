import { randomUUID } from 'node:crypto';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AuditEntry, prepareAuditEntry } from './audit-entry';

// The audit row's timestamp is the PostgreSQL clock at INSERT time, truncated to the column's millisecond
// precision. The application clock is never a source of truth for it.
const INSERT_AUDIT_SQL = `
INSERT INTO app.audit_logs (
  audit_id, occurred_at, request_id, actor_type, actor_id, action,
  resource_type, resource_id, resource_version, outcome, reason_code, metadata
) VALUES (
  $1::uuid, date_trunc('milliseconds', clock_timestamp()), $2::uuid, $3, $4, $5,
  $6, $7, $8::bigint, $9, $10, $11::jsonb
)`;

export interface AuditWriterOptions {
  /**
   * Test seam only: lets a test force a primary-key collision to provoke a REAL PostgreSQL failure.
   * Production never sets it; the default is a random UUID.
   */
  readonly idGenerator?: () => string;
}

/**
 * Appends an audit row INSIDE the caller's transaction.
 *
 * It is a participant, not a coordinator: it receives a TransactionContext and nothing else. It has no
 * pool, no TransactionManager, no BEGIN/COMMIT and no standalone mode, so a SUCCESS audit can only ever
 * commit or roll back together with the business mutation it describes. A failure (invalid entry or a
 * database error) is THROWN, never swallowed: the outer transaction then rolls back the mutation, the
 * outbox event and the idempotency record with it.
 */
export class AuditWriter {
  readonly #newId: () => string;

  constructor(options: AuditWriterOptions = {}) {
    this.#newId = options.idGenerator ?? randomUUID;
  }

  async append(context: TransactionContext, entry: AuditEntry): Promise<void> {
    // The whole entry is validated BEFORE any statement is sent; nothing is repaired or truncated.
    const prepared = prepareAuditEntry(entry);

    const result = await context.query(INSERT_AUDIT_SQL, [
      this.#newId(),
      prepared.requestId,
      prepared.actorType,
      prepared.actorId,
      prepared.action,
      prepared.resourceType,
      prepared.resourceId,
      prepared.resourceVersion,
      prepared.outcome,
      prepared.reasonCode,
      prepared.metadataJson,
    ]);
    if (result.rowCount !== 1) {
      // Impossible for a single-row INSERT that did not fail; refuse to continue on a guess.
      throw new TechnicalError('internal', 'Audit row was not written');
    }
  }
}
