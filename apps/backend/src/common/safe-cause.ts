import { TransactionError } from '../transaction/transaction-error';

export interface SafeCause {
  /** A fixed identifier of why a request failed with a 5xx (a transaction reason): never a message, SQL, host or user data. */
  readonly cause?: string;
  /** A PostgreSQL SQLSTATE that passed the allow-list (see TransactionError). */
  readonly sql_state?: string;
}

/**
 * Why an infrastructure failure happened, safe to log. Only a TransactionError qualifies: its reason is one of a closed set of
 * constants and its SQLSTATE passed the allow-list. The message of any other exception is never turned into log text.
 */
export function safeCauseOf(error: unknown): SafeCause {
  if (error instanceof TransactionError) {
    return { cause: error.reason, ...(error.sqlState === undefined ? {} : { sql_state: error.sqlState }) };
  }
  return {};
}
