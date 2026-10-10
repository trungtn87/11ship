import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  FAILURE_LOCK_SECONDS,
  TOTP_FAILURE_LIMIT,
  TOTP_FAILURE_WINDOW_SECONDS,
} from '../admin-auth/admin-auth-constants';
import { AdminCrypto } from '../admin-auth/admin-crypto';
import { AdminFactorRepository } from '../admin-auth/admin-factor-repository';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminLimitsRepository } from '../admin-auth/admin-limits-repository';
import { matchTotp } from '../admin-auth/totp';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AuditWriter } from '../audit/audit-writer';
import { AdminAuthRateLimitError, AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminInvitationReader, InvitationDetail } from './admin-invitation-reader';
import { AdminOperationRepository, OperationRow } from './admin-operation-repository';
import {
  ACTOR_TYPE_SYSTEM,
  OPERATION_ATTEMPT_LIMIT,
  OperationAction,
  PROVISIONING_AUDIT_ACTIONS,
  RESOURCE_OPERATION,
} from './admin-provisioning-constants';
import { setBusinessLockTimeout } from './admin-provisioning-locks';
import { canonicalPayload, OperationRequest, targetOf } from './admin-provisioning-validation';
import { iso, operationView } from './admin-provisioning-views';
import { AdminSystemActor, LockedActor } from './admin-system-actor';

export interface CreatedOperation {
  readonly operation_id: string;
  readonly action: OperationAction;
  readonly status: 'PENDING';
  readonly expires_at: string;
}

type VerifyOutcome =
  | { readonly kind: 'ok'; readonly operationId: string; readonly expiresAtMs: number }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'wrong'; readonly retryAfterSeconds: number };

/** The current bindings of an operation (contract 7.3): same actor session, factor generation and membership version. */
export function operationBindingHolds(operation: OperationRow, actor: LockedActor): boolean {
  return (
    operation.actorUserId === actor.known.userId &&
    operation.actorSessionId === actor.session.sessionId &&
    operation.factorId === actor.factor.factorId &&
    operation.factorVersion === actor.factor.version &&
    operation.membershipVersion === actor.checked.membership.version
  );
}

/** For reissue/revoke the target must still be the PENDING invitation at the expected version. */
export function operationTargetHolds(operation: OperationRow, target: InvitationDetail | undefined): boolean {
  if (operation.targetId === null) {
    return true;
  }
  return (
    target !== undefined &&
    target.invitationId === operation.targetId &&
    target.status === 'PENDING' &&
    target.version === operation.expectedVersion
  );
}

/**
 * Step-up 2FA of the SYSTEM administrator (contract section 7, transactions 8.3.1-8.3.3). None of these transactions
 * goes through the idempotency executor, so each one sets lock_timeout itself before its first lock (Owner decision).
 */
@Injectable()
export class AdminOperationService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly operations: AdminOperationRepository,
    private readonly invitations: AdminInvitationReader,
    private readonly identities: AdminIdentityParticipant,
    private readonly factors: AdminFactorRepository,
    private readonly limits: AdminLimitsRepository,
    private readonly limiter: AdminLimiter,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  /**
   * 8.3.1 (F1). user and membership FOR UPDATE from the very start, so two create-operations of one SYSTEM never run
   * their checks and writes at the same time: the second waits at L4 and then SEES the first one's committed row,
   * invalidates it (REPLACED) and inserts its own. The live-operation unique index is never part of the control flow.
   */
  async createOperation(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    request: OperationRequest,
    meta: { requestId: string },
  ): Promise<CreatedOperation> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const canonical = canonicalPayload(request);
    const { targetId, expectedVersion } = targetOf(request);
    return this.transactions.withTransaction(async (context): Promise<CreatedOperation> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const actor = await this.actor.lock(context, known, { user: 'write', factor: 'read' });
      // L8 before L9: the INSERT below takes FOR KEY SHARE on the target, which this transaction then already holds.
      const target = targetId === null ? undefined : await this.invitations.lockShared(context, targetId);
      const live = await this.operations.lockLive(context, known.userId);
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);

      if (targetId !== null) {
        if (target === undefined) {
          throw new AppError('ADMIN_INVITATION_NOT_FOUND');
        }
        if (target.status !== 'PENDING') {
          throw new AppError('ADMIN_INVITATION_NOT_PENDING');
        }
        if (target.version !== expectedVersion) {
          throw new AppError('ADMIN_VERSION_CONFLICT');
        }
      }
      // Early phone checks (Q3): no lock is taken for them; the business route checks again under its locks and the
      // activation (1C) remains the final authority.
      const phone =
        request.action === 'CREATE_INVITATION'
          ? request.payload.phone
          : request.action === 'REISSUE_INVITATION'
            ? target?.phoneNormalized
            : undefined;
      if (request.action === 'CREATE_INVITATION' && phone !== undefined) {
        const pending = await this.invitations.findPending(context, phone);
        if (pending !== undefined && nowMs < pending.expiresAtMs) {
          throw new AppError('ADMIN_INVITATION_PENDING_EXISTS');
        }
      }
      if (phone !== undefined && (await this.identities.findByPhone(context, phone)) !== undefined) {
        throw new AppError('ADMIN_PHONE_CONFLICT');
      }

      const { fingerprint, keyId } = this.crypto.operationFingerprint(request.action, canonical);
      let replaced: string | undefined;
      for (const operation of live) {
        if (await this.operations.replace(context, operation.operationId)) {
          replaced = operation.operationId;
        }
      }
      const operationId = randomUUID();
      const { expiresAtMs } = await this.operations.insert(context, {
        operationId,
        actorUserId: known.userId,
        actorSessionId: actor.session.sessionId,
        factorId: actor.factor.factorId,
        factorVersion: actor.factor.version,
        membershipVersion: actor.checked.membership.version,
        action: request.action,
        targetId,
        expectedVersion,
        payloadFingerprint: fingerprint,
        fingerprintKeyId: keyId,
      });
      const metadata: JsonObject = { operation_id: operationId, action: request.action };
      if (targetId !== null) {
        metadata.target_id = targetId;
      }
      if (replaced !== undefined) {
        metadata.replaced_operation_id = replaced;
      }
      await this.audit.append(context, {
        requestId: meta.requestId,
        actorType: ACTOR_TYPE_SYSTEM,
        actorId: known.userId,
        action: PROVISIONING_AUDIT_ACTIONS.operationCreated,
        resourceType: RESOURCE_OPERATION,
        resourceId: operationId,
        outcome: 'SUCCESS',
        metadata,
      });
      return { operation_id: operationId, action: request.action, status: 'PENDING', expires_at: iso(expiresAtMs) };
    });
  }

  /**
   * 8.3.2 (F6), in the #34 verify pattern: the transaction RETURNS what happened and the refusal is thrown only after
   * it committed, so the counters of a wrong code are durable. Counted only when a code was actually compared and
   * wrong: a locked bucket, an unusable operation or a malformed body counts nothing and opens no secret.
   */
  async verify(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    operationId: string,
    code: string,
    meta: { requestId: string },
  ): Promise<{ operation_id: string; status: 'VERIFIED'; expires_at: string }> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const bucket = this.limiter.totpUserBucket(known.userId);
    const outcome = await this.transactions.withTransaction(async (context): Promise<VerifyOutcome> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      // Unlocked read of the IMMUTABLE target id, only to lock the invitation (L8) before the operation (L9).
      const peek = await this.operations.peekTarget(context, operationId);
      // L2: the failure bucket shared with login (Q5). A locked user is refused before anything is opened.
      const [state] = await this.limits.lockBuckets(context, [bucket], TOTP_FAILURE_WINDOW_SECONDS);
      if (state === undefined) {
        throw new AppError('ADMIN_SESSION_INVALID');
      }
      if (state.lockedRemainingSeconds > 0) {
        return { kind: 'limited', retryAfterSeconds: state.lockedRemainingSeconds };
      }
      const actor = await this.actor.lock(context, known, { user: 'write', factor: 'write' });
      const target =
        peek === undefined || peek.targetId === null ? undefined : await this.invitations.lockShared(context, peek.targetId);
      const operation = await this.operations.lock(context, operationId, known.userId);
      // ONE database instant, after every lock wait: it decides the session, the operation and the TOTP window.
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);
      if (
        operation === undefined ||
        operation.status !== 'PENDING' ||
        nowMs >= operation.expiresAtMs ||
        operation.attemptCount >= OPERATION_ATTEMPT_LIMIT ||
        !operationBindingHolds(operation, actor) ||
        !operationTargetHolds(operation, target)
      ) {
        // Refused by the CURRENT conditions only: rolled back, nothing is stored (not even INVALIDATED).
        throw new AppError('ADMIN_STEP_UP_REQUIRED');
      }

      const secret = this.crypto.openTotpSecret(
        actor.factor.keyId,
        { userId: known.userId, factorId: actor.factor.factorId, factorVersion: actor.factor.version },
        actor.factor.envelope,
      );
      const step = matchTotp(secret, code, nowMs / 1000, actor.factor.lastAcceptedStep);
      if (step === undefined) {
        const after = await this.limits.recordFailure(context, {
          bucketKey: bucket.bucketKey,
          limit: TOTP_FAILURE_LIMIT,
          lockSeconds: FAILURE_LOCK_SECONDS,
        });
        const attempt = await this.operations.recordWrongAttempt(context, operation.operationId);
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: ACTOR_TYPE_SYSTEM,
          actorId: known.userId,
          action: PROVISIONING_AUDIT_ACTIONS.operationVerifyDenied,
          resourceType: RESOURCE_OPERATION,
          resourceId: operation.operationId,
          outcome: 'DENIED',
          reasonCode: attempt.exhausted ? 'ATTEMPTS_EXHAUSTED' : 'TOTP_INVALID',
          metadata: { operation_id: operation.operationId, attempt_count: attempt.attemptCount },
        });
        return { kind: 'wrong', retryAfterSeconds: after.lockedRemainingSeconds };
      }

      await this.factors.advanceStep(context, { factorId: actor.factor.factorId, step });
      if (!(await this.operations.markVerified(context, operation.operationId))) {
        throw new AppError('ADMIN_STEP_UP_REQUIRED');
      }
      await this.audit.append(context, {
        requestId: meta.requestId,
        actorType: ACTOR_TYPE_SYSTEM,
        actorId: known.userId,
        action: PROVISIONING_AUDIT_ACTIONS.operationVerified,
        resourceType: RESOURCE_OPERATION,
        resourceId: operation.operationId,
        outcome: 'SUCCESS',
        metadata: { operation_id: operation.operationId },
      });
      return { kind: 'ok', operationId: operation.operationId, expiresAtMs: operation.expiresAtMs };
    });

    switch (outcome.kind) {
      case 'ok':
        return { operation_id: outcome.operationId, status: 'VERIFIED', expires_at: iso(outcome.expiresAtMs) };
      case 'limited':
        throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
      case 'wrong':
        if (outcome.retryAfterSeconds > 0) {
          throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
        }
        throw new AppError('ADMIN_TOTP_INVALID');
    }
  }

  /** 8.3.3 (F5): read-only; shared locks in the same order; nothing is written, whatever the stored state. */
  async read(sessionToken: string | undefined, operationId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const peek = await this.operations.peekTarget(context, operationId);
      const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const target =
        peek === undefined || peek.targetId === null ? undefined : await this.invitations.lockShared(context, peek.targetId);
      const operation = await this.operations.lockShared(context, operationId, known.userId);
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);
      if (operation === undefined) {
        // Another actor's or an unknown operation: the same single step-up answer, no existence oracle.
        throw new AppError('ADMIN_STEP_UP_REQUIRED');
      }
      const bindingOk = operationBindingHolds(operation, actor) && operationTargetHolds(operation, target);
      return operationView(operation, nowMs, bindingOk);
    });
  }
}

