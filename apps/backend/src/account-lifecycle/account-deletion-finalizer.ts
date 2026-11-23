import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminUserAccountParticipant, OrdinaryAccount } from '../auth/admin-user-account-participant';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountActivityRegistry } from './account-activity-registry';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { WalletAccountActivityReader } from '../wallet/wallet-account-activity-reader';
import { WalletAdjustmentService } from '../wallet/wallet-adjustment-service';

export type DeletionOutcome =
  | { readonly kind: 'DELETED'; readonly relatedData: readonly string[] }
  | { readonly kind: 'ACTIVE_WORK'; readonly relatedData: readonly string[]; readonly activeWork: readonly string[] }
  | { readonly kind: 'ALREADY_DISABLED'; readonly relatedData: readonly string[] };

/** Finalizes an OTP-authorized erasure under the user's, shops' and wallet's locks. */
@Injectable()
export class AccountDeletionFinalizer {
  constructor(
    private readonly activity: AccountActivityRegistry,
    private readonly accounts: AdminUserAccountParticipant,
    private readonly drivers: DriverEligibilityReader,
    private readonly walletActivity: WalletAccountActivityReader,
    private readonly wallets: WalletAdjustmentService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async finalize(
    context: TransactionContext,
    account: OrdinaryAccount,
    request: { readonly requestId: string; readonly forfeitVnd: bigint },
  ): Promise<DeletionOutcome> {
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
    const driverId = await this.drivers.driverIdOf(context, account.userId);
    const wallet = driverId === undefined ? { balanceVnd: 0n, heldVnd: 0n } : await this.walletActivity.money(context, driverId);
    if (wallet.heldVnd !== 0n || wallet.balanceVnd !== request.forfeitVnd) {
      return { kind: 'ACTIVE_WORK', relatedData: related, activeWork: ['WALLET_BALANCE'] };
    }
    if (driverId !== undefined && request.forfeitVnd > 0n) {
      const posted = await this.wallets.post(context, {
        driverId,
        sourceType: 'ACCOUNT_DELETE',
        sourceId: request.requestId,
        direction: 'CHARGE_TO_SHIPPER',
        amountVnd: request.forfeitVnd,
        postedByUserId: account.userId,
      });
      if (posted.kind !== 'POSTED') {
        throw new TechnicalError('internal', 'Forfeit could not be posted');
      }
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
