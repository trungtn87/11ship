import { Injectable } from '@nestjs/common';
import { AccountActivityRegistry } from '../account-lifecycle/account-activity-registry';
import { AdminUserAccountParticipant, OrdinaryAccount } from '../auth/admin-user-account-participant';
import { ACCOUNT_ERASURE_PURPOSE } from '../auth/auth-constants';
import { VerificationService, OtpRequestResult } from '../auth/verification-service';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { AuditWriter } from '../audit/audit-writer';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AccountErasureRepository } from './account-erasure-repository';
import { ACCOUNT_DELETE_REQUESTED_ACTION, RESOURCE_USER } from './account-deletion-service';
import { AuthPrincipal } from '../auth/auth-principal';
import { ErasureCodeInput, ErasureConfirmInput } from './account-erasure-validation';

/** How long the one-time erasure request stays usable after the OTP was confirmed. Short by design: the job runs within a minute. */
export const ACCOUNT_ERASURE_REQUEST_TTL_SECONDS = 300;

export type ErasureBlocker =
  | { readonly code: 'ACTIVE_WORK'; readonly items: readonly string[] }
  | { readonly code: 'WALLET_HELD' }
  | { readonly code: 'WALLET_AT_OR_ABOVE_MINIMUM' }
  | { readonly code: 'ALREADY_LOCKED' };

export type ErasurePrecheck =
  | { readonly kind: 'READY'; readonly balanceVnd: bigint; readonly forfeitVnd: bigint; readonly withdrawMinVnd: bigint }
  | { readonly kind: 'BLOCKED'; readonly blockers: readonly ErasureBlocker[] };

/** Validates the owner's OTP and schedules erasure with the agreed wallet amount. */
@Injectable()
export class AccountErasureService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly accounts: AdminUserAccountParticipant,
    private readonly activity: AccountActivityRegistry,
    private readonly verification: VerificationService,
    private readonly parameters: ShipperWalletParametersReader,
    private readonly drivers: DriverEligibilityReader,
    private readonly repository: AccountErasureRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /** The pre-check, read only. */
  async precheck(principal: AuthPrincipal): Promise<ErasurePrecheck> {
    return this.transactions.withTransaction((context) => this.#precheck(context, principal.userId));
  }

  /** Step 3: the code. Nothing is sent while a blocker stands or while a forfeit is not agreed. */
  async requestCode(principal: AuthPrincipal, input: ErasureCodeInput, clientIp: string): Promise<OtpRequestResult> {
    this.#assertReady(await this.precheck(principal), input);
    return this.verification.requestOtp(principal.phoneNormalized, ACCOUNT_ERASURE_PURPOSE, clientIp);
  }

  /** Step 4: the code is checked; then the account is locked and the one-time request written, in one transaction. */
  async confirm(
    principal: AuthPrincipal,
    input: ErasureConfirmInput,
    requestId: string,
  ): Promise<{ readonly result: 'ERASURE_SCHEDULED' }> {
    this.#assertReady(await this.precheck(principal), input);
    // The challenge must be this account's own: its phone and its purpose. Any other challenge is the same refusal as a wrong code.
    const bound = await this.transactions.withTransaction((context) => this.repository.verification(context, input.verificationId));
    if (bound === undefined || bound.purpose !== ACCOUNT_ERASURE_PURPOSE || bound.phoneNormalized !== principal.phoneNormalized) {
      throw new AppError('OTP_INVALID');
    }
    // A wrong or expired code is refused by the verification service itself, and nothing below runs.
    await this.verification.verifyOtp(input.verificationId, input.otp, requestId, ACCOUNT_ERASURE_PURPOSE);

    await this.transactions.withTransaction(async (context) => {
      const account = await this.accounts.lockOrdinary(context, principal.userId, 'write');
      if (account === undefined || account.status !== 'ACTIVE' || (await this.repository.validRequest(context, principal.userId)) !== undefined) {
        throw new AppError('ACCOUNT_ERASURE_BLOCKED');
      }
      await this.activity.lockWorkSources(context, principal.userId);
      this.#assertReady(await this.#precheck(context, principal.userId), input);
      await this.#lock(context, account, requestId, input.forfeitVnd, input.verificationId);
    });
    return { result: 'ERASURE_SCHEDULED' };
  }

  #assertReady(decision: ErasurePrecheck, input: ErasureCodeInput): void {
    if (decision.kind !== 'READY') {
      throw new AppError('ACCOUNT_ERASURE_BLOCKED');
    }
    if (decision.forfeitVnd !== input.forfeitVnd || (decision.forfeitVnd > 0n && !input.acceptForfeit)) {
      throw new AppError('ACCOUNT_ERASURE_CONSENT_REQUIRED');
    }
  }

  async #precheck(context: TransactionContext, userId: string): Promise<ErasurePrecheck> {
    const account = await this.accounts.lockOrdinary(context, userId, 'read');
    if (account === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    const blockers: ErasureBlocker[] = [];
    if (account.status === 'DISABLED') {
      blockers.push({ code: 'ALREADY_LOCKED' });
    }
    const active = await this.activity.activeWork(context, userId);
    if (active.length > 0) {
      blockers.push({ code: 'ACTIVE_WORK', items: [...active] });
    }
    const driverId = await this.drivers.driverIdOf(context, userId);
    const money = driverId === undefined ? { balanceVnd: 0n, heldVnd: 0n } : await this.repository.walletMoney(context, driverId);
    const limits = await this.parameters.limits(context);
    const minimum = BigInt(limits.withdrawMinVnd);
    if (money.heldVnd > 0n) {
      blockers.push({ code: 'WALLET_HELD' });
    }
    if (money.balanceVnd >= minimum) {
      blockers.push({ code: 'WALLET_AT_OR_ABOVE_MINIMUM' });
    }
    if (blockers.length > 0) {
      return { kind: 'BLOCKED', blockers };
    }
    const forfeit = money.balanceVnd > 0n ? money.balanceVnd : 0n;
    return { kind: 'READY', balanceVnd: money.balanceVnd, forfeitVnd: forfeit, withdrawMinVnd: minimum };
  }

  async #lock(context: TransactionContext, account: OrdinaryAccount, requestId: string, forfeitVnd: bigint, verificationId: string): Promise<void> {
    const changed = await this.accounts.disable(context, account, account.version, 'DELETE_REQUEST');
    if (changed === undefined) {
      throw new AppError('USER_ACCOUNT_VERSION_CONFLICT');
    }
    await this.repository.insertRequest(context, { requestId, userId: account.userId, verificationId, forfeitVnd, ttlSeconds: ACCOUNT_ERASURE_REQUEST_TTL_SECONDS });
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: account.userId,
      action: ACCOUNT_DELETE_REQUESTED_ACTION,
      resourceType: RESOURCE_USER,
      resourceId: account.userId,
      resourceVersion: changed.version,
      outcome: 'SUCCESS',
      metadata: { target_user_id: account.userId, state: 'ERASURE_SCHEDULED', version: changed.version, forfeit_vnd: forfeitVnd.toString(), flow: 'OTP' },
    });
    await this.outbox.append(context, {
      eventType: 'user.account.locked.v1',
      eventSchemaVersion: 1,
      resourceType: RESOURCE_USER,
      resourceId: account.userId,
      resourceVersion: changed.version,
      payload: { user_id: account.userId, account_status: 'DISABLED', version: changed.version },
    });
  }
}

