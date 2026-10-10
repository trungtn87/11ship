import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { digestToken } from '../auth/tokens';
import { AuditWriter } from '../audit/audit-writer';
import { AdminAuthRateLimitError, AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_SESSION_TTL_SECONDS,
  AdminRole,
  CHALLENGE_ATTEMPT_LIMIT,
  FAILURE_LOCK_SECONDS,
  TOTP_FAILURE_LIMIT,
  TOTP_FAILURE_WINDOW_SECONDS,
  TOTP_ISSUER,
} from './admin-auth-constants';
import { AdminChallengeRepository, ChallengeLookup, ChallengeRow } from './admin-challenge-repository';
import { AdminCredentialChecks } from './admin-credential-checks';
import { AdminCrypto } from './admin-crypto';
import { isExpiredAt } from './admin-expiry';
import { AdminFactorRepository, FactorRow } from './admin-factor-repository';
import { AdminLimiter } from './admin-limiter';
import { AdminLimitsRepository } from './admin-limits-repository';
import { AdminSessionRepository } from './admin-session-repository';
import { base32Encode } from './base32';
import { buildOtpauthUri, matchTotp } from './totp';

export interface EnrollmentStarted {
  /** Base32 secret and the otpauth URI the client builds the QR code from. Response is no-store. */
  readonly secret: string;
  readonly otpauthUri: string;
  readonly expiresAtMs: number;
}

export interface SessionIssued {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly adminRole: AdminRole;
  readonly expiresAtMs: number;
}

type Mode = 'ENROLLMENT' | 'LOGIN';

type VerifyOutcome =
  | { readonly kind: 'ok'; readonly issued: SessionIssued }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'wrong'; readonly retryAfterSeconds: number };

/**
 * Step 2 of the administration login: enrollment (first factor) and verification. Lock order of every path here:
 * TOTP_USER bucket -> user -> membership -> factor -> challenge -> sessions, in ONE transaction per request, with no
 * lock taken backwards and no nested transaction.
 */
@Injectable()
export class AdminTotpService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly limiter: AdminLimiter,
    private readonly limits: AdminLimitsRepository,
    private readonly checks: AdminCredentialChecks,
    private readonly factors: AdminFactorRepository,
    private readonly challenges: AdminChallengeRepository,
    private readonly sessions: AdminSessionRepository,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * The preauth step behind a cookie and its CSRF token, or the contract's refusal. No lock: a precheck that only
   * filters early. Whether the step is still valid is decided again under the locks, with a database clock read after
   * the last lock was granted.
   */
  async #precheck(preauthToken: string | undefined, csrfHeader: unknown): Promise<ChallengeLookup> {
    if (preauthToken === undefined) {
      throw new AppError('ADMIN_PREAUTH_INVALID');
    }
    const digest = digestToken(preauthToken);
    const challenge = await this.transactions.withTransaction((context) =>
      this.challenges.findByDigest(context, digest),
    );
    if (challenge === undefined || challenge.consumed || challenge.expiredAtLookup) {
      throw new AppError('ADMIN_PREAUTH_INVALID');
    }
    const csrfOk = this.crypto.csrfMatches(
      { type: 'PREAUTH', credentialId: challenge.challengeId, nonce: challenge.csrfNonce, keyId: challenge.csrfKeyId },
      csrfHeader,
    );
    if (!csrfOk) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    return challenge;
  }

  /** POST /totp/enrollment: returns the pending secret (the same one on a repeat for the same challenge). */
  async startEnrollment(preauthToken: string | undefined, csrfHeader: unknown): Promise<EnrollmentStarted> {
    const known = await this.#precheck(preauthToken, csrfHeader);

    return this.transactions.withTransaction(async (context): Promise<EnrollmentStarted> => {
      const checked = await this.checks.lockAndCheck(context, known, 'write');
      if (checked === undefined) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      const userId = checked.identity.userId;
      const factor = await this.factors.lock(context, userId);
      const challenge = await this.challenges.lock(context, known.challengeId);
      // The database clock is read only now, after every lock wait of this request. A step that expired while the
      // request waited is refused here: no factor is created and no secret is returned for it.
      const nowMs = await freshClockMs(context);
      if (challenge === undefined || challenge.consumed || isExpiredAt(challenge.expiresAtMs, nowMs)) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }

      let secret: Buffer;
      if (factor === undefined) {
        if (challenge.factorId !== null) {
          // The step claims a factor that does not exist: never repaired, never reused.
          throw new AppError('ADMIN_PREAUTH_INVALID');
        }
        const factorId = randomUUID();
        secret = this.crypto.newTotpSecret();
        const sealed = this.crypto.sealTotpSecret({ userId, factorId, factorVersion: 1 }, secret);
        // The challenge points the factor, and the factor is written before the challenge snapshot: one transaction,
        // so nothing is visible (and the secret is not returned) until it commits.
        await this.factors.insertPending(context, {
          userId,
          factorId,
          keyId: sealed.keyId,
          envelope: sealed.envelope,
          challengeId: challenge.challengeId,
        });
        await this.challenges.setFactorSnapshot(context, {
          challengeId: challenge.challengeId,
          factorId,
          factorVersion: 1,
        });
      } else if (factor.state === 'ACTIVE') {
        throw new AppError('ADMIN_ENROLLMENT_NOT_ALLOWED');
      } else if (this.#ownsPending(factor, challenge)) {
        secret = this.crypto.openTotpSecret(
          factor.keyId,
          { userId, factorId: factor.factorId, factorVersion: factor.version },
          factor.envelope,
        );
      } else {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }

      const secretBase32 = base32Encode(secret);
      return {
        secret: secretBase32,
        otpauthUri: buildOtpauthUri({ issuer: TOTP_ISSUER, label: checked.identity.phoneNormalized, secretBase32 }),
        expiresAtMs: challenge.expiresAtMs,
      };
    });
  }

  /** POST /totp/enrollment/verify: the first correct code activates the factor and opens the session. */
  async completeEnrollment(
    preauthToken: string | undefined,
    csrfHeader: unknown,
    code: string,
    meta: { requestId: string },
  ): Promise<SessionIssued> {
    return this.#verify('ENROLLMENT', preauthToken, csrfHeader, code, meta);
  }

  /** POST /totp/verify: a correct code for the ACTIVE factor opens the session. */
  async verifyLogin(
    preauthToken: string | undefined,
    csrfHeader: unknown,
    code: string,
    meta: { requestId: string },
  ): Promise<SessionIssued> {
    return this.#verify('LOGIN', preauthToken, csrfHeader, code, meta);
  }

  #ownsPending(factor: FactorRow, challenge: ChallengeRow): boolean {
    return (
      factor.state === 'PENDING' &&
      factor.pendingChallengeId === challenge.challengeId &&
      challenge.factorId === factor.factorId &&
      challenge.factorVersion === factor.version
    );
  }

  async #verify(
    mode: Mode,
    preauthToken: string | undefined,
    csrfHeader: unknown,
    code: string,
    meta: { requestId: string },
  ): Promise<SessionIssued> {
    const known = await this.#precheck(preauthToken, csrfHeader);
    const bucket = this.limiter.totpUserBucket(known.userId);

    const outcome = await this.transactions.withTransaction(async (context): Promise<VerifyOutcome> => {
      // 1. The failure bucket first. A locked user is refused before anything is decrypted or compared.
      const [state] = await this.limits.lockBuckets(context, [bucket], TOTP_FAILURE_WINDOW_SECONDS);
      if (state === undefined) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      if (state.lockedRemainingSeconds > 0) {
        return { kind: 'limited', retryAfterSeconds: state.lockedRemainingSeconds };
      }

      // 2. user -> membership (+ password binding), then factor, then the challenge.
      const checked = await this.checks.lockAndCheck(context, known, 'write');
      if (checked === undefined) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      const userId = checked.identity.userId;
      const factor = await this.factors.lock(context, userId);
      const challenge = await this.challenges.lock(context, known.challengeId);
      // The database clock is read ONCE, here, after every lock wait of this request (the bucket, the user, the
      // membership, the factor and the challenge). It decides the expiry of the step and, below, the TOTP window, so
      // both use the same instant. A step that expired while the request waited is refused before any secret is opened.
      const nowMs = await freshClockMs(context);
      if (
        challenge === undefined ||
        challenge.consumed ||
        isExpiredAt(challenge.expiresAtMs, nowMs) ||
        challenge.attemptCount >= CHALLENGE_ATTEMPT_LIMIT
      ) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      if (factor === undefined) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      if (mode === 'ENROLLMENT') {
        if (factor.state === 'ACTIVE') {
          throw new AppError('ADMIN_ENROLLMENT_NOT_ALLOWED');
        }
        if (!this.#ownsPending(factor, challenge)) {
          throw new AppError('ADMIN_PREAUTH_INVALID');
        }
      } else if (
        factor.state !== 'ACTIVE' ||
        challenge.factorId !== factor.factorId ||
        challenge.factorVersion !== factor.version
      ) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }

      // 3. The comparison, with the database instant read AFTER every lock wait (nowMs above).
      const secret = this.crypto.openTotpSecret(
        factor.keyId,
        { userId, factorId: factor.factorId, factorVersion: factor.version },
        factor.envelope,
      );
      const step = matchTotp(secret, code, nowMs / 1000, factor.lastAcceptedStep);

      if (step === undefined) {
        // Wrong, outside the window or replayed: the same answer. Both counters move in THIS transaction, which
        // commits; the refusal is thrown by the caller afterwards.
        await this.challenges.recordWrongAttempt(context, challenge.challengeId);
        const after = await this.limits.recordFailure(context, {
          bucketKey: bucket.bucketKey,
          limit: TOTP_FAILURE_LIMIT,
          lockSeconds: FAILURE_LOCK_SECONDS,
        });
        return { kind: 'wrong', retryAfterSeconds: after.lockedRemainingSeconds };
      }

      // 4. Success: factor, challenge, older sessions, the new session and the audit rows - all or nothing.
      if (mode === 'ENROLLMENT') {
        await this.factors.activate(context, { factorId: factor.factorId, step });
      } else {
        await this.factors.advanceStep(context, { factorId: factor.factorId, step });
      }
      await this.challenges.consume(context, challenge.challengeId);
      const issued = await this.#issueSession(context, {
        userId,
        passwordHash: checked.identity.passwordHash,
        adminRole: checked.membership.adminRole,
        membershipVersion: checked.membership.version,
        factorId: factor.factorId,
        factorVersion: factor.version,
        deviceId: challenge.deviceId,
        requestId: meta.requestId,
        enrolled: mode === 'ENROLLMENT',
      });
      return { kind: 'ok', issued };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.issued;
      case 'limited':
        throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
      case 'wrong':
        if (outcome.retryAfterSeconds > 0) {
          throw new AdminAuthRateLimitError(outcome.retryAfterSeconds);
        }
        throw new AppError('ADMIN_TOTP_INVALID');
    }
  }

  async #issueSession(
    context: TransactionContext,
    input: {
      userId: string;
      passwordHash: string;
      adminRole: AdminRole;
      membershipVersion: number;
      factorId: string;
      factorVersion: number;
      deviceId: string;
      requestId: string;
      enrolled: boolean;
    },
  ): Promise<SessionIssued> {
    // Revoke first (including expired-but-unrevoked rows), so the one-active-session index is never the thing that decides.
    await this.sessions.revokeAllForUser(context, input.userId);
    const token = this.crypto.randomBytes(32).toString('base64url');
    const csrf = this.crypto.newCsrf();
    const binding = this.crypto.newPasswordBinding(input.userId, input.passwordHash);
    const created = await this.sessions.insert(context, {
      userId: input.userId,
      tokenDigest: digestToken(token),
      csrfNonce: csrf.nonce,
      csrfKeyId: csrf.keyId,
      passwordBinding: binding.binding,
      passwordKeyId: binding.keyId,
      membershipVersion: input.membershipVersion,
      factorId: input.factorId,
      factorVersion: input.factorVersion,
      deviceId: input.deviceId,
      ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
    });
    const csrfToken = this.crypto.csrfToken({
      type: 'SESSION',
      credentialId: created.sessionId,
      nonce: csrf.nonce,
      keyId: csrf.keyId,
    });
    if (input.enrolled) {
      await this.audit.append(context, {
        requestId: input.requestId,
        actorType: 'USER',
        actorId: input.userId,
        action: ADMIN_AUDIT_ACTIONS.totpEnrolled,
        resourceType: 'admin_factor',
        resourceId: input.factorId,
        outcome: 'SUCCESS',
        metadata: { factor_id: input.factorId, factor_version: input.factorVersion },
      });
    }
    await this.audit.append(context, {
      requestId: input.requestId,
      actorType: 'USER',
      actorId: input.userId,
      action: ADMIN_AUDIT_ACTIONS.loginCompleted,
      resourceType: 'admin_session',
      resourceId: created.sessionId,
      outcome: 'SUCCESS',
      metadata: {
        session_id: created.sessionId,
        membership_version: input.membershipVersion,
        factor_id: input.factorId,
        factor_version: input.factorVersion,
      },
    });
    return {
      sessionToken: token,
      csrfToken,
      userId: input.userId,
      adminRole: input.adminRole,
      expiresAtMs: created.expiresAtMs,
    };
  }
}
