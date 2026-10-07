import { isSqlState } from '../common/safe-error';
import { TechnicalError, TechnicalErrorKind } from '../common/app-errors';

export type TransactionFailureReason =
  // Infrastructure failures: surfaced as the generic 503 envelope.
  | 'ACQUIRE_FAILED'
  | 'BEGIN_FAILED'
  | 'DEADLINE_EXCEEDED'
  | 'CONNECTION_LOST'
  | 'CLIENT_STATE_UNKNOWN'
  | 'SERIALIZATION_FAILURE'
  | 'DEADLOCK_DETECTED'
  | 'COMMIT_REJECTED'
  // Programming errors (misuse of the API): surfaced as the generic 500 envelope.
  | 'CONTEXT_CLOSED'
  | 'CONTROL_STATEMENT'
  | 'NESTED_TRANSACTION'
  | 'DETACHED_QUERY';

const PROGRAMMING_ERRORS: ReadonlySet<TransactionFailureReason> = new Set([
  'CONTEXT_CLOSED',
  'CONTROL_STATEMENT',
  'NESTED_TRANSACTION',
  'DETACHED_QUERY',
]);

/**
 * A sanitized transaction failure. It carries a fixed reason and, at most, a PostgreSQL SQLSTATE
 * that passed the allow-list; never the driver message, SQL, parameters or the original error.
 */
export class TransactionError extends TechnicalError {
  readonly reason: TransactionFailureReason;
  readonly sqlState: string | undefined;

  constructor(reason: TransactionFailureReason, sqlState?: string) {
    const kind: TechnicalErrorKind = PROGRAMMING_ERRORS.has(reason) ? 'internal' : 'unavailable';
    super(kind, `Transaction failed (${reason})`);
    this.name = 'TransactionError';
    this.reason = reason;
    this.sqlState = isSqlState(sqlState) ? sqlState : undefined;
  }
}
