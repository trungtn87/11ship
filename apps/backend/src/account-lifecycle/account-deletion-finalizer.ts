import { Injectable } from '@nestjs/common';
import { AdminUserAccountParticipant, OrdinaryAccount } from '../auth/admin-user-account-participant';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountActivityRegistry } from './account-activity-registry';

/**
 * What a deletion of an ordinary APP_USER account turned into (Owner decisions 2026-10-14 and OD-26).
 *  - DELETED: the account had NO data that must be kept; it, its sessions, bindings, consents, profile and roles are gone (audit entries stay).
 *  - LOCKED: it has data to keep and no work in progress; it is DISABLED with lock reason DELETE_REQUEST (id, roles and every record stay) and
 *    every unrevoked session is revoked. The owner can recover it with the OTP flow.
 *  - ACTIVE_WORK: it has data to keep and orders / deliveries / money still being processed: nothing was changed.
 *  - ALREADY_DISABLED: it has data to keep and is already locked: nothing was changed.
 */
export type DeletionOutcome =
  | { readonly kind: 'DELETED' }
  | { readonly kind: 'LOCKED'; readonly relatedData: readonly string[]; readonly version: number; readonly changedAtMs: number; readonly revokedSessions: number }
  | { readonly kind: 'ACTIVE_WORK'; readonly relatedData: readonly string[]; readonly activeWork: readonly string[] }
  | { readonly kind: 'ALREADY_DISABLED'; readonly relatedData: readonly string[] };

/**
 * The ONE decision "delete or lock this account", shared by the administration delete command, the owner's confirmation and the sweeper that
 * finishes a pending request (P5-6a). It writes the account state only; each caller writes its own audit entry and outbox event (their actor,
 * action and payload differ) in the same transaction.
 *
 * The caller holds the account row FOR UPDATE (AdminUserAccountParticipant.lockOrdinary). Here: the account's shops and wallet FOR UPDATE
 * (so no order or money can be added between the check and the change) -> related data -> purge, or active work -> lock. Every check that
 * cannot answer is a refusal (USER_ACCOUNT_ACTIVITY_UNVERIFIED), never an empty answer.
 */
@Injectable()
export class AccountDeletionFinalizer {
  constructor(
    private readonly activity: AccountActivityRegistry,
    private readonly accounts: AdminUserAccountParticipant,
  ) {}

  async finalize(context: TransactionContext, account: OrdinaryAccount): Promise<DeletionOutcome> {
    // Locks first, then the read: the data seen is the data that is still there when the account is purged or locked.
    await this.activity.lockWorkSources(context, account.userId);
    const related = await this.activity.relatedData(context, account.userId);
    if (related.length === 0) {
      if (!(await this.accounts.purge(context, account))) {
        throw new TechnicalError('internal', 'Locked account could not be deleted');
      }
      return { kind: 'DELETED' };
    }
    if (account.status === 'DISABLED') {
      return { kind: 'ALREADY_DISABLED', relatedData: related };
    }
    const activeWork = await this.activity.activeWork(context, account.userId);
    if (activeWork.length > 0) {
      return { kind: 'ACTIVE_WORK', relatedData: related, activeWork };
    }
    const disabled = await this.accounts.disable(context, account, account.version, 'DELETE_REQUEST');
    if (disabled === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be updated');
    }
    return { kind: 'LOCKED', relatedData: related, version: disabled.version, changedAtMs: disabled.changedAtMs, revokedSessions: disabled.revokedSessions };
  }
}
