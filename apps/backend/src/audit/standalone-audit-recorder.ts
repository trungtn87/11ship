import { performance } from 'node:perf_hooks';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
} from '../transaction/transaction-manager';
import { TransactionError } from '../transaction/transaction-error';
import { AuditWriter } from './audit-writer';
import { prepareAuditEntry, StandaloneAuditEntry } from './audit-entry';

/**
 * Normative total budget of one standalone audit write (ADR-003 13.5): pool acquisition, BEGIN/setup,
 * the INSERT and COMMIT together. It is an infrastructure constant of M00-C1B, not configuration.
 */
export const STANDALONE_AUDIT_BUDGET_MS = 500;

/**
 * The only things a standalone audit failure ever logs. They are fixed literals: nothing from the error
 * that caused them (message, stack, code, driver detail) can reach a log line.
 */
export type StandaloneAuditFailureCode =
  | 'AUDIT_ENTRY_REJECTED'
  | 'AUDIT_ACQUIRE_TIMEOUT'
  | 'AUDIT_WRITE_TIMEOUT'
  | 'AUDIT_WRITE_FAILED';

const LOG_EVENT = 'audit_standalone_failed';

/** The slice of AuditWriter the recorder needs. A test may substitute a failing writer. */
export type AuditAppender = Pick<AuditWriter, 'append'>;

export interface AuditFailureLogger {
  log(level: 'warn', event: string, meta: { code: StandaloneAuditFailureCode }): void;
}

export interface StandaloneAuditRecorderOptions {
  /** Test seam: a SMALLER budget (1..500 ms) so a unit test does not wait half a second. */
  readonly budgetMs?: number;
  /** Test seam: a monotonic millisecond clock. Defaults to performance.now. */
  readonly now?: () => number;
}

type Acquired =
  | { readonly kind: 'client'; readonly client: TransactionClient }
  | { readonly kind: 'failed' }
  | { readonly kind: 'expired' };

function releaseQuietly(client: TransactionClient): void {
  try {
    client.release(false);
  } catch {
    // A driver error here cannot be handled and must not escape or be logged.
  }
}

function classifyWriteFailure(error: unknown): StandaloneAuditFailureCode {
  // By class and fixed reason only: the content of the error is never inspected or used. A lost COMMIT
  // acknowledgement (TRANSACTION_OUTCOME_UNKNOWN) is just another failed write to a best-effort audit.
  if (error instanceof TransactionError && error.reason === 'DEADLINE_EXCEEDED') {
    return 'AUDIT_WRITE_TIMEOUT';
  }
  return 'AUDIT_WRITE_FAILED';
}

/**
 * Records a DENIED or FAILURE audit row in its OWN short transaction, after the business transaction has
 * already rolled back and released its connection. It is best effort: whatever goes wrong (pool
 * exhaustion, timeout, outage, constraint violation, a throwing logger) is swallowed after one fixed-code
 * log line, so the caller keeps handling the ORIGINAL denial or failure unchanged.
 *
 * Budget. A single monotonic deadline of STANDALONE_AUDIT_BUDGET_MS covers pool acquisition, BEGIN, the
 * INSERT, COMMIT and the cleanup of a failed write. The TransactionManager does not count pool acquisition in its
 * own deadline; instead the connection is acquired HERE, under this deadline, and handed to a manager whose
 * transaction deadline is exactly the time that remains. That same deadline bounds the manager's own cleanup:
 * ROLLBACK races what is left of it, and a spent budget destroys the connection instead of rolling back, so a hung
 * rollback can never keep this client checked out past the budget and never changes the caller's original error.
 *
 * Late acquisition. pg cannot cancel a queued acquisition. If the budget runs out first, the pending
 * acquisition stays queued, and the client it eventually yields is released at once and never used: no
 * connection leaks and no audit row is ever written after the caller's budget is spent.
 *
 * Never call it from inside a business callback: that callback still holds a pool client, so under load
 * the acquisition could only time out (and the manager's nesting guard refuses the transaction anyway).
 */
export class StandaloneAuditRecorder {
  readonly #source: TransactionClientSource;
  readonly #writer: AuditAppender;
  readonly #logger: AuditFailureLogger;
  readonly #budgetMs: number;
  readonly #now: () => number;

  constructor(
    source: TransactionClientSource,
    writer: AuditAppender,
    logger: AuditFailureLogger,
    options: StandaloneAuditRecorderOptions = {},
  ) {
    const budgetMs = options.budgetMs ?? STANDALONE_AUDIT_BUDGET_MS;
    if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > STANDALONE_AUDIT_BUDGET_MS) {
      throw new RangeError('the standalone audit budget must be an integer between 1 and 500 ms');
    }
    this.#source = source;
    this.#writer = writer;
    this.#logger = logger;
    this.#budgetMs = budgetMs;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Resolves in every case; it never throws and never rejects. */
  async recordBestEffort(entry: StandaloneAuditEntry): Promise<void> {
    let failure: StandaloneAuditFailureCode | undefined;
    try {
      failure = await this.#attempt(entry);
    } catch (error) {
      failure = classifyWriteFailure(error);
    }
    if (failure !== undefined) {
      this.#report(failure);
    }
  }

  async #attempt(entry: StandaloneAuditEntry): Promise<StandaloneAuditFailureCode | undefined> {
    // SUCCESS can only be written in the business transaction. A SUCCESS (or malformed) entry here is a
    // programming error: it is refused without touching the pool and without throwing at the caller.
    if (typeof entry !== 'object' || entry === null || (entry.outcome !== 'DENIED' && entry.outcome !== 'FAILURE')) {
      return 'AUDIT_ENTRY_REJECTED';
    }
    try {
      prepareAuditEntry(entry);
    } catch {
      return 'AUDIT_ENTRY_REJECTED';
    }

    const deadline = this.#now() + this.#budgetMs;
    const acquired = await this.#acquire();
    if (acquired.kind === 'expired') {
      return 'AUDIT_ACQUIRE_TIMEOUT';
    }
    if (acquired.kind === 'failed') {
      return 'AUDIT_WRITE_FAILED';
    }

    const { client } = acquired;
    const remainingMs = Math.floor(deadline - this.#now());
    if (remainingMs < 1) {
      // The connection arrived exactly when the budget ran out: do not start a write the caller no
      // longer waits for.
      releaseQuietly(client);
      return 'AUDIT_ACQUIRE_TIMEOUT';
    }

    let handedOver = false;
    const preAcquired: TransactionClientSource = {
      acquire: () => {
        handedOver = true;
        return Promise.resolve(client);
      },
    };
    try {
      // A manager whose whole-transaction deadline is the time that remains. The idle timeout equals the
      // whole budget so PostgreSQL can never end the session between two statements of this short write.
      const manager = new TransactionManager(preAcquired, {
        timeoutMs: remainingMs,
        idleInTransactionTimeoutMs: STANDALONE_AUDIT_BUDGET_MS,
      });
      await manager.withTransaction((context) => this.#writer.append(context, entry));
      return undefined;
    } catch (error) {
      return classifyWriteFailure(error);
    } finally {
      if (!handedOver) {
        // The manager refused before taking the connection (for example the nesting guard): it is still ours.
        releaseQuietly(client);
      }
    }
  }

  /** Acquires a client, but never waits past the budget. */
  async #acquire(): Promise<Acquired> {
    const settled: Promise<Acquired> = Promise.resolve()
      .then(() => this.#source.acquire())
      .then(
        (client): Acquired => ({ kind: 'client', client }),
        (): Acquired => ({ kind: 'failed' }),
      );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<Acquired>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'expired' }), this.#budgetMs);
    });

    let first: Acquired;
    try {
      first = await Promise.race([settled, expired]);
    } finally {
      clearTimeout(timer);
    }

    if (first.kind === 'expired') {
      // The acquisition is still queued. Whatever client it yields later is released immediately and
      // never used. `settled` cannot reject, and releaseQuietly cannot throw.
      settled
        .then((late) => {
          if (late.kind === 'client') {
            releaseQuietly(late.client);
          }
        })
        .catch(() => undefined);
    }
    return first;
  }

  #report(code: StandaloneAuditFailureCode): void {
    try {
      this.#logger.log('warn', LOG_EVENT, { code });
    } catch {
      // A failing log sink must not change what the caller does next.
    }
  }
}
