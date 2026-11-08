import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AccountDeletionFinalizer } from '../account-lifecycle/account-deletion-finalizer';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, isClientLoginOrigin } from '../auth/account-origin';
import { AdminUserAccountParticipant } from '../auth/admin-user-account-participant';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { UserRepository, UserRow } from '../auth/user-repository';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentOutcome } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AccountDeletionLimiter } from './account-deletion-limiter';
import { AccountDeletionInput } from './account-deletion-validation';

/** What the owner's confirmation turned into. PENDING = the running work is being finished first. */
export type AccountDeletionResult = 'DELETED' | 'LOCKED' | 'PENDING';

export const ACCOUNT_DELETE_SCOPE_TYPE = 'account_delete_phone';
export const ACCOUNT_DELETE_OPERATION_ID = 'account.delete.confirm.v1';
export const ACCOUNT_DELETE_REQUESTED_ACTION = 'account.delete.requested.v1';
export const ACCOUNT_DELETE_FINALIZED_ACTION = 'account.delete.finalized.v1';
const RESOURCE_USER = 'user';

export interface AccountDeletionOutcome {
  readonly status: number;
  readonly payload: IdempotentOutcome['payload'];
  readonly replayed: boolean;
}

/**
 * The owner's own account deletion (P5-6a, Owner decision OD-26): POST /v1/account-deletion/confirm with the phone and the CURRENT password.
 *
 * Order of events (the same discipline as the client login):
 *  1. cheap refusals first: the Idempotency-Key shape;
 *  2. the SEPARATE quota (client address + phone), before any account is looked at;
 *  3. the credentials, OUTSIDE any transaction (Argon2): an unknown phone, an administration / fixture / other non-client account, a wrong
 *     password and an account locked for a violation or for security are ONE answer, INVALID_CREDENTIALS, after the same amount of hashing
 *     work. A wrong password never changes the account;
 *  4. the SAME IdempotencyExecutor, scope = a hash of the phone. A replay is answered from the stored acknowledgement only for an identical
 *     phone + password (the executor fingerprints both), so it still works after the account was deleted. A new execution takes the user row
 *     FOR UPDATE, RECHECKS the password hash and the account shape under that lock (anything that moved while Argon2 ran is the same answer
 *     as a wrong password), then decides:
 *       - nothing in progress  -> the shared finalizer: DELETED (no data to keep) or LOCKED (DELETE_REQUEST, sessions revoked) immediately;
 *       - work in progress     -> DELETE_REQUEST_PENDING: delete_requested_at is set, NEW work is refused everywhere (assertNewWorkAllowed),
 *                                 the running work is finished and the sweeper finalizes once nothing is in progress.
 *     A request that finds the deletion already pending answers PENDING again (no second audit entry); an account already locked at the
 *     owner's request answers LOCKED.
 *
 * There is no cancel (OD-26) and no administrator step; the administration only reads the state and the audit trail.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly limiter: AccountDeletionLimiter,
    private readonly executor: IdempotencyExecutor,
    private readonly users: UserRepository,
    private readonly accounts: AdminUserAccountParticipant,
    private readonly finalizer: AccountDeletionFinalizer,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy,
  ) {}

  async confirm(
    input: AccountDeletionInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    clientIdentity: string,
  ): Promise<AccountDeletionOutcome> {
    parseIdempotencyKey(idempotencyKey);
    await this.limiter.reserve(clientIdentity, input.phoneNormalized);
    const verified = await this.#verifiedUser(input);
    const outcome = await this.executor.execute(
      {
        scopeType: ACCOUNT_DELETE_SCOPE_TYPE,
        scopeId: scopeIdOf(input.phoneNormalized),
        operationId: ACCOUNT_DELETE_OPERATION_ID,
        idempotencyKey,
        // Exactly the validated intent; the executor only HMAC-fingerprints it, the password is never stored or logged.
        logicalRequest: { phone_normalized: input.phoneNormalized, password: input.password },
        // The stored acknowledgement is only the word DELETED / LOCKED / PENDING, and it is returned only to a request whose phone and password
        // fingerprint equals the original one.
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#confirmNew(context, verified, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  /** Step 3: the account the credentials belong to, or undefined (the caller answers INVALID_CREDENTIALS after the key is claimed). */
  async #verifiedUser(input: AccountDeletionInput): Promise<UserRow | undefined> {
    const user = await this.transactions.withTransaction((context) => this.users.findByPhone(context, 'APP_USER', input.phoneNormalized));
    if (user === undefined || !isClientLoginOrigin(user.accountOrigin)) {
      // The same amount of hashing work as a real verification; the account's own hash is never verified.
      await this.hasher.verifyAgainstDummy(input.password);
      return undefined;
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      return undefined;
    }
    return this.originPolicy.allows(user) ? user : undefined;
  }

  async #confirmNew(context: TransactionContext, verified: UserRow | undefined, requestId: string) {
    if (verified === undefined) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    // 1. The ROOT user lock; everything that decides the request is read again under it.
    const locked = await this.users.lockById(context, verified.userId);
    if (locked === undefined || locked.passwordHash !== verified.passwordHash || !this.originPolicy.allows(locked)) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const account = await this.accounts.lockOrdinary(context, locked.userId, 'write');
    if (account === undefined) {
      // Not an ordinary client account (administration, fixture ...): the same answer as an unknown phone.
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (account.status === 'DISABLED') {
      // Locked at the owner's own request: the request is already done. Locked for any other reason: not ours to undo or to purge.
      if (account.lockReason !== 'DELETE_REQUEST') {
        throw new AppError('INVALID_CREDENTIALS');
      }
      return this.#answer('LOCKED');
    }
    const state = await this.users.deleteRequestState(context, account.userId);
    if (state === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be read');
    }
    if (state.requested) {
      return this.#answer('PENDING');
    }

    // 2. The decision is the account lifecycle's own (shared with the administration delete and the sweeper).
    const outcome = await this.finalizer.finalize(context, account);
    if (outcome.kind === 'DELETED') {
      await this.#finalized(context, { requestId, userId: account.userId, version: account.version, result: 'DELETED', trigger: 'CONFIRM', relatedData: [], revokedSessions: 0 });
      return this.#answer('DELETED');
    }
    if (outcome.kind === 'LOCKED') {
      await this.#finalized(context, { requestId, userId: account.userId, version: outcome.version, result: 'LOCKED', trigger: 'CONFIRM', relatedData: outcome.relatedData, revokedSessions: outcome.revokedSessions });
      return this.#answer('LOCKED');
    }
    if (outcome.kind === 'ALREADY_DISABLED') {
      // Unreachable: the account is ACTIVE under our lock. Refuse rather than guess.
      throw new TechnicalError('internal', 'Active account reported as disabled');
    }

    // 3. Work in progress: DELETE_REQUEST_PENDING. The sessions stay so the running work can be finished.
    const marked = await this.users.markDeleteRequested(context, { userId: account.userId, expectedVersion: account.version });
    if (marked === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be updated');
    }
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: account.userId,
      action: ACCOUNT_DELETE_REQUESTED_ACTION,
      resourceType: RESOURCE_USER,
      resourceId: account.userId,
      resourceVersion: marked.version,
      outcome: 'SUCCESS',
      metadata: { target_user_id: account.userId, state: 'DELETE_REQUEST_PENDING', version: marked.version, active_work: [...outcome.activeWork], related_data: [...outcome.relatedData] },
    });
    await this.outbox.append(context, {
      eventType: 'user.account.delete_requested.v1',
      eventSchemaVersion: 1,
      resourceType: RESOURCE_USER,
      resourceId: account.userId,
      resourceVersion: marked.version,
      payload: { user_id: account.userId, version: marked.version },
    });
    return this.#answer('PENDING');
  }

  #answer(result: AccountDeletionResult) {
    return { status: 200, replayGuard: { kind: 'account_delete' }, payload: { result } };
  }

  /** The audit entry and the outbox event of a deletion that reached its end (DELETED or LOCKED), written by the confirmation and by the sweeper alike. */
  async recordFinalized(
    context: TransactionContext,
    entry: { requestId?: string; userId: string; version: number; result: 'DELETED' | 'LOCKED'; trigger: 'CONFIRM' | 'SWEEPER'; relatedData: readonly string[]; revokedSessions: number },
  ): Promise<void> {
    await this.#finalized(context, { ...entry, requestId: entry.requestId ?? randomUUID() });
  }

  async #finalized(
    context: TransactionContext,
    entry: { requestId: string; userId: string; version: number; result: 'DELETED' | 'LOCKED'; trigger: 'CONFIRM' | 'SWEEPER'; relatedData: readonly string[]; revokedSessions: number },
  ): Promise<void> {
    await this.audit.append(context, {
      requestId: entry.requestId,
      actorType: entry.trigger === 'CONFIRM' ? 'USER' : 'SYSTEM',
      actorId: entry.trigger === 'CONFIRM' ? entry.userId : null,
      action: ACCOUNT_DELETE_FINALIZED_ACTION,
      resourceType: RESOURCE_USER,
      resourceId: entry.userId,
      resourceVersion: entry.version,
      outcome: 'SUCCESS',
      metadata: {
        target_user_id: entry.userId,
        result: entry.result,
        trigger: entry.trigger,
        version: entry.version,
        revoked_sessions: entry.revokedSessions,
        related_data: [...entry.relatedData],
        ...(entry.result === 'LOCKED' ? { lock_reason: 'DELETE_REQUEST' } : {}),
      },
    });
    await this.outbox.append(context, {
      eventType: entry.result === 'DELETED' ? 'user.account.deleted.v1' : 'user.account.locked.v1',
      eventSchemaVersion: 1,
      resourceType: RESOURCE_USER,
      resourceId: entry.userId,
      resourceVersion: entry.version,
      payload: entry.result === 'DELETED' ? { user_id: entry.userId } : { user_id: entry.userId, account_status: 'DISABLED', version: entry.version },
    });
  }
}

/** A stable server-side scope id derived from the normalized phone (never random per request, never client supplied). */
export function scopeIdOf(phoneNormalized: string): string {
  return createHash('sha256').update(`account.delete.confirm.phone.v1\u0000${phoneNormalized}`, 'utf8').digest('hex');
}
