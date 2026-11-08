import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { AccountDeletionFinalizer } from '../account-lifecycle/account-deletion-finalizer';
import { AdminUserAccountParticipant } from '../auth/admin-user-account-participant';
import { UserRepository } from '../auth/user-repository';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_ACCOUNT_DELETION_CONFIG } from '../config/account-deletion-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AccountDeletionService } from './account-deletion-service';

const BATCH = 50;

export interface AccountDeletionSweepResult {
  /** Deleted or locked by this sweep. */
  readonly finalized: number;
  /** Still have work in progress: left pending. */
  readonly waiting: number;
  /** Not ours any more (finalized by another instance, locked or changed meanwhile) or busy under another transaction. */
  readonly skipped: number;
  /** Could not be decided (an activity check could not answer ...): left pending, tried again at the next sweep. */
  readonly failed: number;
}

/**
 * Finishes the deletions the owners asked for while they still had work in progress (P5-6a, OD-26). It is the one place that moves
 * DELETE_REQUEST_PENDING to its end; the confirmation tries the same decision once, immediately (the fast path).
 *
 * Why a sweeper and not a hook on every way an order, delivery or payment can end: those ends come from many modules and many paths (customer
 * and shop cancellations, timeouts, the Shipper's last step, administrator actions, finance decisions); one missed path would leave an
 * account pending forever. The sweeper asks the same shared finalizer the question "is anything still in progress?" under the account's locks,
 * so it cannot miss an end and cannot act early.
 *
 * Safe to run on several instances at once and more than once: the candidate list is only a list; every account is then taken in its OWN
 * transaction with FOR UPDATE SKIP LOCKED (an account another instance or a request is working on is skipped), its state is read again under
 * the lock, and the audit entry and the outbox event are written only when the account actually reaches its end, in that same transaction,
 * so a repeated or concurrent sweep finalizes an account exactly once.
 */
@Injectable()
export class AccountDeletionSweeper {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly users: UserRepository,
    private readonly accounts: AdminUserAccountParticipant,
    private readonly finalizer: AccountDeletionFinalizer,
    private readonly deletion: AccountDeletionService,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  async sweep(): Promise<AccountDeletionSweepResult> {
    const candidates = await this.transactions.withTransaction((context) => this.users.listDeleteRequested(context, BATCH));
    let finalized = 0;
    let waiting = 0;
    let skipped = 0;
    let failed = 0;
    for (const userId of candidates) {
      try {
        const step = await this.transactions.withTransaction((context) => this.#one(context, userId));
        if (step === 'FINALIZED') {
          finalized += 1;
        } else if (step === 'WAITING') {
          waiting += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger?.log('error', 'account_deletion_sweep_item_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
      }
    }
    return { finalized, waiting, skipped, failed };
  }

  async #one(context: TransactionContext, userId: string): Promise<'FINALIZED' | 'WAITING' | 'SKIPPED'> {
    const user = await this.users.lockByIdSkipLocked(context, userId);
    if (user === undefined || user.status !== 'ACTIVE') {
      return 'SKIPPED';
    }
    const state = await this.users.deleteRequestState(context, userId);
    if (state === undefined || !state.requested) {
      return 'SKIPPED';
    }
    const account = await this.accounts.lockOrdinary(context, userId, 'write');
    if (account === undefined) {
      return 'SKIPPED';
    }
    const outcome = await this.finalizer.finalize(context, account);
    if (outcome.kind === 'DELETED') {
      await this.deletion.recordFinalized(context, { userId, version: account.version, result: 'DELETED', trigger: 'SWEEPER', relatedData: [], revokedSessions: 0 });
      return 'FINALIZED';
    }
    if (outcome.kind === 'LOCKED') {
      await this.deletion.recordFinalized(context, {
        userId,
        version: outcome.version,
        result: 'LOCKED',
        trigger: 'SWEEPER',
        relatedData: outcome.relatedData,
        revokedSessions: outcome.revokedSessions,
      });
      return 'FINALIZED';
    }
    return outcome.kind === 'ACTIVE_WORK' ? 'WAITING' : 'SKIPPED';
  }
}

/** Runs the sweep on a fixed interval in a real environment, like every other job (setInterval, never overlapping itself, unref'd). Not started in tests, which call `sweep()` themselves. */
@Injectable()
export class AccountDeletionSweeperRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly sweeper: AccountDeletionSweeper,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    const interval = (this.config.accountDeletion ?? DEFAULT_ACCOUNT_DELETION_CONFIG).sweepIntervalMs;
    this.#timer = setInterval(() => void this.#tick(), interval);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async #tick(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      await this.sweeper.sweep();
    } catch (error) {
      this.logger?.log('error', 'account_deletion_sweep_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.#running = false;
    }
  }
}
