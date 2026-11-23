import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminUserAccountParticipant, OrdinaryAccount } from '../auth/admin-user-account-participant';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountActivityRegistry } from './account-activity-registry';

/**
 * What a deletion of an ordinary APP_USER account turned into (Owner decisions 2026-10-14, OD-26 and 2026-11-22).
 *  - DELETED: the account was ANONYMIZED: its personal data is removed now (sessions, devices, profile, addresses, push tokens, notifications,
 *    the personal snapshots of its orders and deliveries); the row stays as a DISABLED / DELETE_REQUEST tombstone, so the money, orders and
 *    records keep their links. The phone number is released.
 *  - ACTIVE_WORK: orders / deliveries / money still being processed, or a wallet balance / held amount not yet paid out: nothing was changed.
 *  - ALREADY_DISABLED: the account is already locked: nothing was changed.
 */
export type DeletionOutcome =
  | { readonly kind: 'DELETED'; readonly relatedData: readonly string[] }
  | { readonly kind: 'ACTIVE_WORK'; readonly relatedData: readonly string[]; readonly activeWork: readonly string[] }
  | { readonly kind: 'ALREADY_DISABLED'; readonly relatedData: readonly string[] };

/**
 * The ONE decision "delete this account", shared by the administration delete command, the owner's confirmation and the sweeper that finishes
 * a pending request (P5-6a, Owner decision 2026-11-22). It writes the account state only; each caller writes its own audit entry and outbox
 * event (their actor, action and payload differ) in the same transaction.
 *
 * The caller holds the account row FOR UPDATE (AdminUserAccountParticipant.lockOrdinary). Here: the account's shops and wallet FOR UPDATE
 * (so no order or money can be added between the check and the change) -> active work -> wallet balance and held amount -> anonymization.
 * Money still owed to the shipper is never anonymized away: the account waits (pending) until the balance is withdrawn (OD-31).
 * Every check that cannot answer is a refusal (USER_ACCOUNT_ACTIVITY_UNVERIFIED), never an empty answer.
 */
@Injectable()
export class AccountDeletionFinalizer {
  constructor(
    private readonly activity: AccountActivityRegistry,
    private readonly accounts: AdminUserAccountParticipant,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  /** The names of the work still in progress (orders, deliveries, money, records); empty = none. Read only: the erasure pre-check uses it before any change. */
  async activeWork(context: TransactionContext, userId: string): Promise<readonly string[]> {
    return this.activity.activeWork(context, userId);
  }

  async finalize(context: TransactionContext, account: OrdinaryAccount): Promise<DeletionOutcome> {
    // Locks first, then the read: the data seen is the data that is still there when the account is anonymized.
    await this.activity.lockWorkSources(context, account.userId);
    const related = await this.activity.relatedData(context, account.userId);
    // A lock for the owner's erasure (DELETE_REQUEST) is the state the erasure starts from: the job decides from here (its request is checked by the database).
    if (account.status === 'DISABLED' && account.lockReason !== 'DELETE_REQUEST') {
      return { kind: 'ALREADY_DISABLED', relatedData: related };
    }
    const activeWork = await this.activity.activeWork(context, account.userId);
    if (activeWork.length > 0) {
      return { kind: 'ACTIVE_WORK', relatedData: related, activeWork };
    }
    if (await this.activity.walletBalanceOpen(context, account.userId)) {
      return { kind: 'ACTIVE_WORK', relatedData: related, activeWork: ['WALLET_BALANCE'] };
    }
    // An unusable password: the anonymized row can never be signed in to (the phone is a placeholder too).
    const unusable = await this.hasher.hash(randomBytes(32).toString('base64url'));
    if (!(await this.accounts.anonymize(context, account, unusable))) {
      throw new TechnicalError('internal', 'Locked account could not be anonymized');
    }
    return { kind: 'DELETED', relatedData: related };
  }

  /**
   * A deletion request on an account an administrator locked for VIOLATION / SECURITY (the request survives that lock, OD-26): once nothing is in
   * progress the request is settled by KEEPING the stronger lock (never replaced by DELETE_REQUEST, never purged: the lock is evidence and the data
   * stays), the sessions are revoked again and the request is cleared. While work is in progress nothing changes.
   * The caller holds the account row FOR UPDATE and has checked that the account is DISABLED with such a reason.
   */
  async settleUnderLock(context: TransactionContext, account: OrdinaryAccount): Promise<LockKeptOutcome | { readonly kind: 'ACTIVE_WORK'; readonly activeWork: readonly string[] }> {
    await this.activity.lockWorkSources(context, account.userId);
    const activeWork = await this.activity.activeWork(context, account.userId);
    if (activeWork.length > 0) {
      return { kind: 'ACTIVE_WORK', activeWork };
    }
    const related = await this.activity.relatedData(context, account.userId);
    const settled = await this.accounts.settleRequestUnderLock(context, account);
    if (settled === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be updated');
    }
    return { kind: 'LOCK_KEPT', relatedData: related, version: settled.version, revokedSessions: settled.revokedSessions, lockReason: account.lockReason ?? 'VIOLATION' };
  }
}

/** The request of an administratively locked account was settled by keeping that lock. */
export interface LockKeptOutcome {
  readonly kind: 'LOCK_KEPT';
  readonly relatedData: readonly string[];
  readonly version: number;
  readonly revokedSessions: number;
  readonly lockReason: string;
}
