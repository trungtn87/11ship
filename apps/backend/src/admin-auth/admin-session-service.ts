import { Injectable } from '@nestjs/common';
import { digestToken } from '../auth/tokens';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ADMIN_AUDIT_ACTIONS, AdminRole } from './admin-auth-constants';
import { AdminChallengeRepository } from './admin-challenge-repository';
import { AdminCredentialChecks } from './admin-credential-checks';
import { AdminCrypto } from './admin-crypto';
import { isExpiredAt } from './admin-expiry';
import { AdminFactorRepository } from './admin-factor-repository';
import { AdminSessionRepository } from './admin-session-repository';

export type AdminState =
  | {
      readonly state: 'SESSION';
      readonly nextStep: null;
      readonly expiresAtMs: number;
      readonly csrfToken: string;
    }
  | {
      readonly state: 'PREAUTH';
      readonly nextStep: 'ENROLL_TOTP' | 'VERIFY_TOTP';
      readonly expiresAtMs: number;
      readonly csrfToken: string;
    };

export interface AdminMe {
  readonly userId: string;
  readonly adminRole: AdminRole;
  readonly expiresAtMs: number;
  readonly csrfToken: string;
}

/**
 * Reads and ends administration sessions. A session is accepted on EVERY request only if, under shared locks taken in the
 * contract's order (user, membership, factor, session), the account is ACTIVE, the current password still matches the
 * stored binding, the membership is ACTIVE at the issued version and the factor is the ACTIVE one the session was issued
 * for. Reads write nothing: the CSRF token is derived again from the stored nonce.
 */
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly checks: AdminCredentialChecks,
    private readonly identities: AdminIdentityParticipant,
    private readonly factors: AdminFactorRepository,
    private readonly challenges: AdminChallengeRepository,
    private readonly sessions: AdminSessionRepository,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
  ) {}

  /** GET /me: only a fully authenticated session. */
  async me(sessionToken: string | undefined): Promise<AdminMe> {
    if (sessionToken === undefined) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    const digest = digestToken(sessionToken);
    return this.transactions.withTransaction(async (context) => {
      const valid = await this.#readSession(context, digest);
      if (valid === undefined) {
        throw new AppError('ADMIN_SESSION_INVALID');
      }
      return valid;
    });
  }

  /** GET /state: the session if there is a valid one, otherwise the preauth step. */
  async state(sessionToken: string | undefined, preauthToken: string | undefined): Promise<AdminState> {
    return this.transactions.withTransaction(async (context): Promise<AdminState> => {
      if (sessionToken !== undefined) {
        const session = await this.#readSession(context, digestToken(sessionToken));
        if (session !== undefined) {
          return { state: 'SESSION', nextStep: null, expiresAtMs: session.expiresAtMs, csrfToken: session.csrfToken };
        }
      }
      if (preauthToken === undefined) {
        throw new AppError('ADMIN_SESSION_INVALID');
      }
      const preauth = await this.#readPreauth(context, digestToken(preauthToken));
      if (preauth === undefined) {
        throw new AppError('ADMIN_PREAUTH_INVALID');
      }
      return { state: 'PREAUTH', ...preauth };
    });
  }

  async #readSession(context: TransactionContext, digest: string): Promise<AdminMe | undefined> {
    const known = await this.sessions.findByDigest(context, digest);
    // The unlocked lookup only filters early; the decision is taken again under the locks below.
    if (known === undefined || known.revoked || known.expiredAtLookup) {
      return undefined;
    }
    const checked = await this.checks.lockAndCheck(context, known, 'read');
    if (checked === undefined) {
      return undefined;
    }
    const factor = await this.factors.lockShared(context, known.userId);
    if (
      factor === undefined ||
      factor.state !== 'ACTIVE' ||
      factor.factorId !== known.factorId ||
      factor.version !== known.factorVersion
    ) {
      return undefined;
    }
    const session = await this.sessions.lockShared(context, known.sessionId);
    // The database clock is read only now, after the last lock was granted: a session that expired while this request
    // waited for a lock is not accepted.
    const nowMs = await freshClockMs(context);
    if (session === undefined || session.revoked || isExpiredAt(session.expiresAtMs, nowMs)) {
      return undefined;
    }
    return {
      userId: known.userId,
      adminRole: checked.membership.adminRole,
      expiresAtMs: session.expiresAtMs,
      csrfToken: this.crypto.csrfToken({
        type: 'SESSION',
        credentialId: session.sessionId,
        nonce: session.csrfNonce,
        keyId: session.csrfKeyId,
      }),
    };
  }

  async #readPreauth(
    context: TransactionContext,
    digest: string,
  ): Promise<{ nextStep: 'ENROLL_TOTP' | 'VERIFY_TOTP'; expiresAtMs: number; csrfToken: string } | undefined> {
    const known = await this.challenges.findByDigest(context, digest);
    // The unlocked lookup only filters early; the decision is taken again under the locks below.
    if (known === undefined || known.consumed || known.expiredAtLookup) {
      return undefined;
    }
    const checked = await this.checks.lockAndCheck(context, known, 'read');
    if (checked === undefined) {
      return undefined;
    }
    const factor = await this.factors.lockShared(context, known.userId);
    const challenge = await this.challenges.lockShared(context, known.challengeId);
    // The database clock is read only now, after the last lock was granted: a step that expired while this request
    // waited for a lock is not reported as a live preauth state.
    const nowMs = await freshClockMs(context);
    if (challenge === undefined || challenge.consumed || isExpiredAt(challenge.expiresAtMs, nowMs)) {
      return undefined;
    }
    let nextStep: 'ENROLL_TOTP' | 'VERIFY_TOTP';
    if (factor !== undefined && factor.state === 'ACTIVE') {
      if (challenge.factorId !== factor.factorId || challenge.factorVersion !== factor.version) {
        return undefined;
      }
      nextStep = 'VERIFY_TOTP';
    } else {
      // Enrollment is still to be done: the step may not claim a factor that is not its own pending one.
      if (factor === undefined ? challenge.factorId !== null : factor.pendingChallengeId !== challenge.challengeId) {
        return undefined;
      }
      nextStep = 'ENROLL_TOTP';
    }
    return {
      nextStep,
      expiresAtMs: challenge.expiresAtMs,
      csrfToken: this.crypto.csrfToken({
        type: 'PREAUTH',
        credentialId: challenge.challengeId,
        nonce: challenge.csrfNonce,
        keyId: challenge.csrfKeyId,
      }),
    };
  }

  /**
   * POST /logout. A missing, expired or revoked session is a no-op (the controller still answers 204 and clears the
   * cookies); a live one needs a valid CSRF token, and is revoked together with its audit row.
   */
  async logout(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    meta: { requestId: string },
  ): Promise<void> {
    if (sessionToken === undefined) {
      return;
    }
    const digest = digestToken(sessionToken);
    const known = await this.transactions.withTransaction((context) => this.sessions.findByDigest(context, digest));
    if (known === undefined || known.revoked || known.expiredAtLookup) {
      return;
    }
    const csrfOk = this.crypto.csrfMatches(
      { type: 'SESSION', credentialId: known.sessionId, nonce: known.csrfNonce, keyId: known.csrfKeyId },
      csrfHeader,
    );
    if (!csrfOk) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    await this.transactions.withTransaction(async (context) => {
      // Ending a session only ever reduces access, so it does not re-run the full recheck; it takes the user lock
      // first so it keeps the same order as every other writer.
      const identity = await this.identities.lockById(context, known.userId);
      if (identity === undefined) {
        return;
      }
      const revoked = await this.sessions.revoke(context, known.sessionId);
      if (revoked) {
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: 'USER',
          actorId: known.userId,
          action: ADMIN_AUDIT_ACTIONS.logout,
          resourceType: 'admin_session',
          resourceId: known.sessionId,
          outcome: 'SUCCESS',
          metadata: { session_id: known.sessionId },
        });
      }
    });
  }
}
