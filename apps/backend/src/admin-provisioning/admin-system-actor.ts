import { Injectable } from '@nestjs/common';
import { AdminCredentialChecks, CheckedAdmin } from '../admin-auth/admin-credential-checks';
import { AdminCrypto } from '../admin-auth/admin-crypto';
import { isExpiredAt } from '../admin-auth/admin-expiry';
import { AdminFactorRepository, FactorRow } from '../admin-auth/admin-factor-repository';
import { AdminSessionRepository, AdminSessionRow, SessionLookup } from '../admin-auth/admin-session-repository';
import { digestToken } from '../auth/tokens';
import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

/** The SYSTEM actor as seen by one 1B transaction, under its locks. */
export interface LockedActor {
  readonly known: SessionLookup;
  readonly checked: CheckedAdmin;
  readonly factor: FactorRow;
  readonly session: AdminSessionRow;
}

export interface ActorLockModes {
  /** L4/L5: 'write' = FOR UPDATE on user and membership from the start (F1), 'read' = FOR SHARE. */
  readonly user: 'write' | 'read';
  /** L6: 'write' only for verify (advanceStep); never upgraded inside a transaction. */
  readonly factor: 'write' | 'read';
}

/**
 * Authorization of the SYSTEM administrator for every M01-D-ADMIN-1B route (contract sections 6.0 and 8.1).
 *  - precheck(): WITHOUT locks, only to refuse early: cookie -> session lookup -> CSRF (POST). Never the decision.
 *  - lock(): in the module order L4 users -> L5 admin_memberships -> L6 admin_totp_factors -> L7 admin_sessions, each
 *    in ONE mode for the whole transaction. Checks what does not depend on time: account ACTIVE, password binding,
 *    membership ACTIVE at the issued version, factor ACTIVE and equal to the session's factor id/version (F5: every GET
 *    too), session not revoked.
 *  - assertLive(): AFTER the caller's last lock, with the database clock read then: session not expired, and the
 *    membership is SYSTEM (an ADMIN session gets ADMIN_FORBIDDEN, never a SYSTEM action).
 */
@Injectable()
export class AdminSystemActor {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly sessions: AdminSessionRepository,
    private readonly checks: AdminCredentialChecks,
    private readonly factors: AdminFactorRepository,
    private readonly crypto: AdminCrypto,
  ) {}

  async precheck(sessionToken: string | undefined, csrf: { readonly required: boolean; readonly header?: unknown }): Promise<SessionLookup> {
    if (sessionToken === undefined) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    const digest = digestToken(sessionToken);
    const known = await this.transactions.withTransaction((context) => this.sessions.findByDigest(context, digest));
    // The unlocked lookup only filters early; the decision is taken again under the locks.
    if (known === undefined || known.revoked || known.expiredAtLookup) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    if (csrf.required) {
      const ok = this.crypto.csrfMatches(
        { type: 'SESSION', credentialId: known.sessionId, nonce: known.csrfNonce, keyId: known.csrfKeyId },
        csrf.header,
      );
      if (!ok) {
        throw new AppError('ADMIN_CSRF_INVALID');
      }
    }
    return known;
  }

  async lock(context: TransactionContext, known: SessionLookup, modes: ActorLockModes): Promise<LockedActor> {
    const checked = await this.checks.lockAndCheck(context, known, modes.user);
    if (checked === undefined) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    const factor =
      modes.factor === 'write'
        ? await this.factors.lock(context, known.userId)
        : await this.factors.lockShared(context, known.userId);
    if (
      factor === undefined ||
      factor.state !== 'ACTIVE' ||
      factor.factorId !== known.factorId ||
      factor.version !== known.factorVersion
    ) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    const session = await this.sessions.lockShared(context, known.sessionId);
    if (session === undefined || session.revoked || session.userId !== known.userId) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    return { known, checked, factor, session };
  }

  /** `nowMs` MUST be freshClockMs read after the LAST lock of the transaction (contract section 8.5). */
  assertLive(actor: LockedActor, nowMs: number): void {
    if (isExpiredAt(actor.session.expiresAtMs, nowMs)) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    if (actor.checked.membership.adminRole !== 'SYSTEM') {
      throw new AppError('ADMIN_FORBIDDEN');
    }
  }
}
