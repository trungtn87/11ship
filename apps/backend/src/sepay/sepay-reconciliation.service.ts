import { Inject, Injectable } from '@nestjs/common';
import { TransactionManager } from '../transaction/transaction-manager';
import { readSepayConfig, SepayConfig } from './sepay-config';
import { parseSepayApiTransaction } from './sepay-event';
import { SepayReconciliationCursorRepository } from './sepay-reconciliation-cursor-repository';
import { SepaySettlementService } from './sepay-settlement-service';
import { SEPAY_TRANSACTIONS_CLIENT, SepayTransactionsClient } from './sepay-transactions-client';

export const SEPAY_PAGE_SIZE = 100;
/** Pause between pages: SePay allows 3 requests per second per IP; one page per 400 ms keeps the job well inside it. */
export const SEPAY_PAGE_INTERVAL_MS = 400;

/** What one run did. The outcome is a fixed code, never an error message or a payload. */
export type ReconciliationOutcome =
  | 'DISABLED'
  | 'NOT_CONFIGURED'
  | 'AUTH_HALTED'
  | 'BACKOFF'
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'PAYLOAD_INVALID'
  | 'FAILED'
  | 'OK';

export interface ReconciliationResult {
  readonly outcome: ReconciliationOutcome;
  /** Transactions read in this run (new or already recorded). */
  readonly read: number;
}

/** Stops a run with a fixed outcome; carries no text from the provider. */
class RunStopped extends Error {
  constructor(readonly outcome: 'PAYLOAD_INVALID') {
    super(outcome);
  }
}

export interface ReconciliationOptions {
  readonly pageIntervalMs: number;
  /** Time source in epoch ms; injected so back-off is testable without waiting. */
  readonly nowMs: () => number;
  /** Pause between pages; injected so tests do not wait. */
  readonly sleep: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: ReconciliationOptions = {
  pageIntervalMs: SEPAY_PAGE_INTERVAL_MS,
  nowMs: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Reconciliation job (M04 step 2): the safety net for webhooks SePay could not deliver. One run reads every incoming transfer recorded after the
 * stored cursor, page by page, and settles each through the SAME SepaySettlementService as the webhook (one credit writer, one decision,
 * idempotent by the inbox's unique keys). Rules:
 *  - off unless SEPAY_AUTO_TOPUP_ENABLED is "true", and no call to SePay without SEPAY_API_KEY (then no call is made at all);
 *  - the cursor is the id of the last transaction of a run that completed; a failed run never moves it and it is never reset silently;
 *  - 429: no further calls in this run; the job waits Retry-After (bounded), recorded in the cursor row, and tries again after it;
 *  - 401: the job stops and stays stopped for this process (a rotated key needs a restart, which re-reads the environment); cursor kept;
 *  - any other failure: the run ends, the cursor is kept, and the next tick re-reads the same window (safe: settlement is idempotent).
 */
@Injectable()
export class SepayReconciliationService {
  #authHalted = false;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly cursor: SepayReconciliationCursorRepository,
    private readonly settlement: SepaySettlementService,
    @Inject(SEPAY_TRANSACTIONS_CLIENT) private readonly client: SepayTransactionsClient,
  ) {}

  async runOnce(env: NodeJS.ProcessEnv, options: Partial<ReconciliationOptions> = {}): Promise<ReconciliationResult> {
    const opts: ReconciliationOptions = { ...DEFAULT_OPTIONS, ...options };
    const config: SepayConfig = readSepayConfig(env);
    if (!config.autoTopupEnabled) {
      return { outcome: 'DISABLED', read: 0 };
    }
    if (config.apiKey === null || config.misconfiguration !== null) {
      return { outcome: 'NOT_CONFIGURED', read: 0 };
    }
    if (this.#authHalted) {
      return { outcome: 'AUTH_HALTED', read: 0 };
    }
    const start = await this.transactions.withTransaction((context) => this.cursor.read(context));
    if (start.notBeforeMs !== null && opts.nowMs() < start.notBeforeMs) {
      return { outcome: 'BACKOFF', read: 0 };
    }
    return this.#run(config, start.lastTransactionUuid, opts);
  }

  async #run(config: SepayConfig, cursorBefore: string | null, opts: ReconciliationOptions): Promise<ReconciliationResult> {
    const apiKey = config.apiKey as string;
    // The window is fixed for the whole run: since_id does not move while pages are read.
    const sinceId = cursorBefore ?? undefined;
    let lastSeen: string | null = null;
    let read = 0;
    try {
      for (let page = 1; ; page += 1) {
        const result = await this.client.fetchPage({ apiKey, sinceId, page, perPage: SEPAY_PAGE_SIZE });
        if (result.kind === 'RATE_LIMITED') {
          await this.#record(null, 'RATE_LIMITED', opts.nowMs() + result.retryAfterSeconds * 1000);
          return { outcome: 'RATE_LIMITED', read };
        }
        if (result.kind === 'UNAUTHORIZED') {
          this.#authHalted = true;
          await this.#record(null, 'AUTH_FAILED', null);
          return { outcome: 'AUTH_FAILED', read };
        }
        for (const row of result.rows) {
          const event = parseSepayApiTransaction(row);
          if (event === undefined || event.sepayTransactionUuid === null) {
            throw new RunStopped('PAYLOAD_INVALID');
          }
          // One database transaction per event, through the shared settlement. A repeat changes nothing.
          await this.transactions.withTransaction((context) => this.settlement.settle(context, event, config));
          lastSeen = event.sepayTransactionUuid;
          read += 1;
        }
        if (!result.hasMore || result.rows.length === 0) {
          break;
        }
        await opts.sleep(opts.pageIntervalMs);
      }
    } catch (error) {
      const outcome = error instanceof RunStopped ? error.outcome : 'FAILED';
      await this.#record(null, outcome, null);
      return { outcome, read };
    }
    // The whole window was read and committed: only now does the cursor move, to the last transaction read (if any was read).
    await this.#record(lastSeen, 'OK', null);
    return { outcome: 'OK', read };
  }

  async #record(lastTransactionUuid: string | null, outcome: string, notBeforeMs: number | null): Promise<void> {
    await this.transactions.withTransaction((context) => this.cursor.record(context, { lastTransactionUuid, outcome, notBeforeMs }));
  }
}
