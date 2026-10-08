import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { LockedSession, SessionRepository } from './session-repository';
import { UserRepository, UserRow } from './user-repository';

/**
 * The server-authenticated caller of a command: the user AND the session it came in on. Both come from
 * SessionAuthGuard, never from a request body, and neither is a bearer token.
 */
export interface SessionActor {
  readonly userId: string;
  readonly sessionId: string;
}

/** What a reader gets back from the shared variant: the session's CURRENT active role. */
export interface AuthorizedSessionState {
  readonly activeRole: string | null;
}

/**
 * Re-authorizes the caller INSIDE a business transaction (M00/M01 post-merge repair, section 1).
 *
 * SessionAuthGuard reads the session with a plain SELECT before the transaction exists, so it is only a
 * precheck: a session can be revoked or expire while the command waits for a lock. This participant is the
 * authorization that counts. It is a PARTICIPANT, not a coordinator: it receives the caller's TransactionContext,
 * opens no transaction, and reuses UserRepository and SessionRepository so no other module issues SQL against
 * app.users or app.sessions.
 *
 * Lock order (the same as role/select): user row, then the CURRENT session row. Both locks stay held until the
 * transaction ends, so a revocation cannot commit between this check and the business effects that follow.
 * The fresh PostgreSQL clock is read AFTER both lock waits; expiresAt <= now is expired.
 *
 * Error precedence for an existing session of this user: SESSION_REVOKED, then SESSION_EXPIRED, then
 * ACCOUNT_DISABLED. A missing user, a missing session and a session of ANOTHER user are all SESSION_INVALID,
 * so the answer never discloses whether a foreign session exists. No role is required: onboarding is what
 * earns the first role.
 */
@Injectable()
export class SessionAuthorizationParticipant {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  /** For a command that writes: user FOR UPDATE, then session FOR UPDATE. */
  async lockAuthorizedActor(context: TransactionContext, actor: SessionActor): Promise<void> {
    assertActorShape(actor);
    const user = await this.users.lockById(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockById(context, actor.sessionId);
    await this.#decide(context, actor, user, session);
  }

  /**
   * For a reader (/auth/me): user FOR SHARE, then session FOR SHARE. Any number of readers of one user run
   * together; a role selection, a revocation or an onboarding command (FOR UPDATE) is waited for. Returns the
   * active role read from the LOCKED session row.
   */
  async lockAuthorizedActorShared(
    context: TransactionContext,
    actor: SessionActor,
  ): Promise<AuthorizedSessionState> {
    assertActorShape(actor);
    const user = await this.users.lockByIdForShare(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockByIdForShare(context, actor.sessionId);
    await this.#decide(context, actor, user, session);
    if (session === undefined) {
      // Unreachable: #decide refuses a missing session. Kept so the type narrows without a cast.
      throw new AppError('SESSION_INVALID');
    }
    return { activeRole: session.activeRole };
  }

  async #decide(
    context: TransactionContext,
    actor: SessionActor,
    user: UserRow | undefined,
    session: LockedSession | undefined,
  ): Promise<void> {
    if (user === undefined || session === undefined || session.userId !== actor.userId) {
      throw new AppError('SESSION_INVALID');
    }
    if (session.revoked) {
      throw new AppError('SESSION_REVOKED');
    }
    // Fresh database time, taken after every authorization lock wait. Never an application clock.
    const nowMs = await freshClockMs(context);
    if (session.expiresAtMs <= nowMs) {
      throw new AppError('SESSION_EXPIRED');
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED');
    }
  }
}

/** The ids come from the guard; a malformed one is refused before any SQL cast can fail with a server error. */
function assertActorShape(actor: SessionActor): void {
  if (!isCanonicalUuid(actor.userId) || !isCanonicalUuid(actor.sessionId)) {
    throw new AppError('SESSION_INVALID');
  }
}
