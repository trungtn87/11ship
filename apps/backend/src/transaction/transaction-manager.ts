import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../common/app-errors';
import { isSqlState, isSystemErrorCode } from '../common/safe-error';
import { QueryRows, TransactionContext } from './transaction-context';
import { TransactionError } from './transaction-error';

/** What the manager needs from a pooled connection. Implemented over pg.PoolClient in production. */
export interface TransactionClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryRows>;
  /** `destroy = true` removes the connection from the pool instead of returning it. */
  release(destroy?: boolean): void;
  /** Subscribes to connection-level errors; returns the unsubscribe function. */
  onError(listener: (error: Error) => void): () => void;
}

export interface TransactionClientSource {
  acquire(): Promise<TransactionClient>;
}

export interface TransactionOptions {
  /** Total wall-clock budget of one transaction, from BEGIN to COMMIT. */
  readonly timeoutMs: number;
  /** PostgreSQL idle_in_transaction_session_timeout applied with SET LOCAL semantics. */
  readonly idleInTransactionTimeoutMs: number;
}

// Statements that would end, nest or split the transaction behind the manager's back. This is a
// guard rail against accidents, not a security boundary: transaction control is not part of the
// context API at all.
const CONTROL_STATEMENT =
  /(?:^|;)\s*(?:begin|commit|rollback|end|abort|start\s+transaction|savepoint|release|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i;
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

function isControlStatement(text: string): boolean {
  return CONTROL_STATEMENT.test(text.replace(LEADING_COMMENTS, ''));
}

interface ServerRejection {
  readonly code: string;
  readonly severity: string;
}

/**
 * True only for an ErrorResponse that PostgreSQL sent (it carries SQLSTATE and severity). Network,
 * socket and client-side timeout errors have no such fields, so they never count as "the server
 * said no".
 */
function serverRejectionOf(error: unknown): ServerRejection | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  if (isSqlState(code) && typeof severity === 'string' && /^(ERROR|FATAL|PANIC)$/.test(severity)) {
    return { code, severity };
  }
  return undefined;
}

function isFatal(rejection: ServerRejection | undefined): boolean {
  return rejection !== undefined && (rejection.severity === 'FATAL' || rejection.severity === 'PANIC');
}

const CONNECTION_FAILURE_MESSAGE =
  /^(Connection terminated|Client has encountered a connection error|Client was closed|Client has already been released)/;

const DEADLINE = Symbol('transaction-deadline');

/** Per-transaction state. Not exported: participants can never reach it. */
class TransactionSession {
  state: 'ACTIVE' | 'CLOSED' = 'ACTIVE';
  inFlight = 0;
  connectionError: Error | undefined;
  /** A query failed without a server answer: the connection can no longer be trusted. */
  dirty = false;
  readonly context: TransactionContext;
  readonly #client: TransactionClient;
  readonly #unsubscribe: () => void;
  #finished = false;

  constructor(client: TransactionClient) {
    this.#client = client;
    // A checked-out client that emits 'error' without a listener would crash the process.
    this.#unsubscribe = client.onError((error) => {
      this.connectionError = error;
    });
    this.context = new BoundContext(this);
  }

  /** Statement from a participant: refused after close and for transaction-control SQL. */
  participantQuery(text: string, values?: readonly unknown[]): Promise<QueryRows> {
    if (this.state !== 'ACTIVE') {
      return Promise.reject(new TransactionError('CONTEXT_CLOSED'));
    }
    if (typeof text !== 'string' || isControlStatement(text)) {
      return Promise.reject(new TransactionError('CONTROL_STATEMENT'));
    }
    return this.execute(text, values);
  }

  /** Statement issued by the manager itself (BEGIN, COMMIT, ROLLBACK, setup). */
  execute(text: string, values?: readonly unknown[]): Promise<QueryRows> {
    this.inFlight += 1;
    let pending: Promise<QueryRows>;
    try {
      pending = this.#client.query(text, values);
    } catch (error) {
      this.inFlight -= 1;
      this.dirty = true;
      return Promise.reject(error);
    }
    return pending.then(
      (result) => {
        this.inFlight -= 1;
        return result;
      },
      (error: unknown) => {
        this.inFlight -= 1;
        // No server answer, or a FATAL one (the session is going away): the connection is suspect.
        const rejection = serverRejectionOf(error);
        if (rejection === undefined || isFatal(rejection)) {
          this.dirty = true;
        }
        throw error;
      },
    );
  }

  close(): void {
    this.state = 'CLOSED';
  }

  /** A client in this state must be destroyed, not rolled back and reused. */
  mustDestroy(): boolean {
    return this.inFlight > 0 || this.dirty || this.connectionError !== undefined;
  }

  /** Releases or destroys the connection exactly once. */
  finish(destroy: boolean): void {
    if (this.#finished) {
      return;
    }
    this.#finished = true;
    this.#unsubscribe();
    try {
      this.#client.release(destroy);
    } catch {
      // Nothing useful can be done and nothing may be leaked from a driver error.
    }
  }
}

class BoundContext implements TransactionContext {
  readonly #session: TransactionSession;

  constructor(session: TransactionSession) {
    this.#session = session;
  }

  get isActive(): boolean {
    return this.#session.state === 'ACTIVE';
  }

  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryRows<R>> {
    return this.#session.participantQuery(text, values) as Promise<QueryRows<R>>;
  }
}

const insideTransaction = new AsyncLocalStorage<true>();

/**
 * The single coordinator of PostgreSQL transactions (ADR-003 §2, §13.1).
 *
 * - One connection per transaction, BEGIN/COMMIT/ROLLBACK and release owned here.
 * - The callback receives a TransactionContext only. Nested withTransaction is refused.
 * - A hard deadline closes the context; the callback is NOT cancelled (JavaScript cannot), so a late
 *   callback simply can no longer reach the database.
 * - A connection whose state is unknown (query in flight, connection error, client-side timeout) is
 *   destroyed, never returned to the pool.
 * - COMMIT without a server answer is an UNKNOWN outcome: never reported as a rollback, never retried.
 * - Callbacks are never run twice by this class.
 */
export class TransactionManager {
  readonly #source: TransactionClientSource;
  readonly #options: TransactionOptions;

  constructor(source: TransactionClientSource, options: TransactionOptions) {
    for (const value of [options.timeoutMs, options.idleInTransactionTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError('transaction timeouts must be positive integers');
      }
    }
    this.#source = source;
    this.#options = options;
  }

  async withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    // AsyncLocalStorage is used ONLY as a nesting guard. The transaction itself is always the
    // explicit context that the callback receives.
    if (insideTransaction.getStore() !== undefined) {
      throw new TransactionError('NESTED_TRANSACTION');
    }

    let client: TransactionClient;
    try {
      client = await this.#source.acquire();
    } catch {
      throw new TransactionError('ACQUIRE_FAILED');
    }

    const session = new TransactionSession(client);
    return insideTransaction.run(true, () => this.#run(session, work));
  }

  async #run<T>(
    session: TransactionSession,
    work: (context: TransactionContext) => Promise<T>,
  ): Promise<T> {
    try {
      await session.execute('BEGIN');
      await session.execute("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [
        String(this.#options.idleInTransactionTimeoutMs),
      ]);
    } catch (error) {
      session.close();
      session.finish(true);
      throw new TransactionError('BEGIN_FAILED', serverRejectionOf(error)?.code);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(DEADLINE), this.#options.timeoutMs);
    });
    const running = Promise.resolve().then(() => work(session.context));
    // If the deadline wins, the callback may still fail later; that must not become an unhandled rejection.
    running.catch(() => undefined);

    let value: T | undefined;
    let failure: unknown;
    let failed = false;
    try {
      value = await Promise.race([running, deadline]);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      clearTimeout(timer);
    }

    if (failed) {
      session.close();
      await this.#abort(session);
      if (failure === DEADLINE) {
        throw new TransactionError('DEADLINE_EXCEEDED');
      }
      throw this.#translate(failure, session);
    }

    // From here on no participant statement can start; only COMMIT is allowed on the client.
    session.close();
    if (session.inFlight > 0) {
      // The callback finished while a query it never awaited is still running.
      session.finish(true);
      throw new TransactionError('DETACHED_QUERY');
    }
    if (session.connectionError !== undefined || session.dirty) {
      // COMMIT was never sent over a trustworthy connection, so nothing can have been committed.
      session.finish(true);
      throw new TransactionError(
        session.connectionError !== undefined ? 'CONNECTION_LOST' : 'CLIENT_STATE_UNKNOWN',
      );
    }

    let committed: QueryRows;
    try {
      committed = await session.execute('COMMIT');
    } catch (error) {
      throw this.#afterFailedCommit(session, error);
    }
    // COMMIT of a transaction that an earlier statement already aborted does not fail: PostgreSQL
    // rolls it back and answers with the command tag ROLLBACK. That must not be reported as success.
    if (committed.command !== undefined && committed.command !== 'COMMIT') {
      session.finish(false);
      throw new TransactionError('COMMIT_REJECTED');
    }
    session.finish(false);
    return value as T;
  }

  /** ROLLBACK and release; destroy the connection instead whenever its state is not trustworthy. */
  async #abort(session: TransactionSession): Promise<void> {
    if (session.mustDestroy()) {
      session.finish(true);
      return;
    }
    try {
      await session.execute('ROLLBACK');
      session.finish(false);
    } catch {
      session.finish(true);
    }
  }

  /** Keeps the callback's own error, except for failures that must be reported as technical ones. */
  #translate(error: unknown, session: TransactionSession): unknown {
    if (error instanceof TransactionError || error instanceof AppError) {
      return error;
    }
    const rejection = serverRejectionOf(error);
    if (rejection?.code === '40001') {
      return new TransactionError('SERIALIZATION_FAILURE', '40001');
    }
    if (rejection?.code === '40P01') {
      return new TransactionError('DEADLOCK_DETECTED', '40P01');
    }
    const message = error instanceof Error ? error.message : '';
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (
      session.connectionError !== undefined ||
      isFatal(rejection) ||
      (rejection === undefined && (CONNECTION_FAILURE_MESSAGE.test(message) || isSystemErrorCode(code)))
    ) {
      return new TransactionError('CONNECTION_LOST', rejection?.code);
    }
    return error;
  }

  #afterFailedCommit(session: TransactionSession, error: unknown): unknown {
    const rejection = serverRejectionOf(error);
    if (rejection === undefined) {
      // No answer from PostgreSQL: the transaction may or may not be committed. Report that
      // honestly, drop the connection, and never run the callback again.
      session.finish(true);
      return new AppError('TRANSACTION_OUTCOME_UNKNOWN');
    }
    // PostgreSQL answered: the COMMIT was rejected, so the transaction was rolled back.
    session.finish(isFatal(rejection));
    if (rejection.code === '40001') {
      return new TransactionError('SERIALIZATION_FAILURE', '40001');
    }
    if (rejection.code === '40P01') {
      return new TransactionError('DEADLOCK_DETECTED', '40P01');
    }
    return new TransactionError('COMMIT_REJECTED', rejection.code);
  }
}
