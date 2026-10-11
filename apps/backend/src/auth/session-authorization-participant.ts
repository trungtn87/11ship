import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import {
  ACCOUNT_ORIGIN_POLICY,
  AccountOriginPolicy,
  PhoneVerificationStatus,
  phoneVerificationStatusOf,
  standardAccountOriginPolicy,
} from './account-origin';
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

/** The only context the Shop variants accept (the value of sessions.active_role and of user_roles.role). */
const SHOP_ROLE = 'SHOP';

/** What a reader gets back from the shared variant: the session's CURRENT active role. */
export interface AuthorizedSessionState {
  readonly activeRole: string | null;
  /** Display only: derived from the LOCKED user row's account origin. Never an authorization source. */
  readonly phoneVerificationStatus: PhoneVerificationStatus;
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
 * so the answer never discloses whether a foreign session exists. The onboarding variants require no role:
 * onboarding is what earns the first role. The two SHOP variants (M02-A) additionally require the CURRENT context
 * to be SHOP, decided from the LOCKED session row and the current user_roles row, never from the guard's earlier
 * principal; they run after the session checks, so SESSION_* and ACCOUNT_DISABLED keep their precedence.
 */
@Injectable()
export class SessionAuthorizationParticipant {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    // Without an explicit binding the standard policy applies: verified accounts only, never a fixture.
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy = standardAccountOriginPolicy(),
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
    if (session === undefined || user === undefined) {
      // Unreachable: #decide refuses a missing user or session. Kept so the types narrow without a cast.
      throw new AppError('SESSION_INVALID');
    }
    return {
      activeRole: session.activeRole,
      phoneVerificationStatus: phoneVerificationStatusOf(user.accountOrigin),
    };
  }

  /**
   * For a Shop command that writes (M02-A): the same locks and the same session decision as lockAuthorizedActor
   * (user FOR UPDATE, then the CURRENT session FOR UPDATE, fresh database clock after both waits), and then the
   * caller must be in the SHOP context: the active role stored on the LOCKED session row is SHOP and the user holds
   * the SHOP role now. Anything else is SHOP_ROLE_REQUIRED (roleless, DRIVER context, a revoked role). The caller
   * proves ownership of a shop afterwards, under the membership and shop locks.
   */
  async lockAuthorizedShopActor(context: TransactionContext, actor: SessionActor): Promise<void> {
    assertActorShape(actor);
    const user = await this.users.lockById(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockById(context, actor.sessionId);
    await this.#decide(context, actor, user, session);
    if (session === undefined) {
      // Unreachable: #decide refuses a missing session. Kept so the type narrows without a cast.
      throw new AppError('SESSION_INVALID');
    }
    await this.#requireShopContext(context, actor.userId, session.activeRole);
  }

  /**
   * For a Shop reader (GET /v1/shop/me): the shared locks of lockAuthorizedActorShared (any number of readers of
   * one user run together; a role selection, a revocation or a Shop command is waited for) and then the same SHOP
   * context requirement as lockAuthorizedShopActor, read from the locked session row. The locks stay held until the
   * caller's transaction ends, so the role cannot change between this check and the read that follows.
   */
  async lockAuthorizedShopActorShared(context: TransactionContext, actor: SessionActor): Promise<void> {
    const { activeRole } = await this.lockAuthorizedActorShared(context, actor);
    await this.#requireShopContext(context, actor.userId, activeRole);
  }

  async #requireShopContext(
    context: TransactionContext,
    userId: string,
    activeRole: string | null,
  ): Promise<void> {
    // The role query only runs for a session already in the SHOP context: the cheap check comes first.
    if (activeRole !== SHOP_ROLE || !(await this.users.hasRole(context, userId, SHOP_ROLE))) {
      throw new AppError('SHOP_ROLE_REQUIRED');
    }
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
    // Account origin policy, decided on the LOCKED user row after the user and session locks were taken and before
    // anything else: a guard that passed a moment ago is only a precheck. An administration account never acts through
    // an application session, and a fixture whose mode was switched off, whose phone left the allowlist, or that is
    // read in production is refused here, so a command that waited behind a lock cannot act for it. Same answer as an
    // unknown session; nothing is disclosed.
    if (!this.policy.allows(user)) {
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
