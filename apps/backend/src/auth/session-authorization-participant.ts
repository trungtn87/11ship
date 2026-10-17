import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientDeviceRepository } from '../client-device/client-device-repository';
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
/** The context a LOCKED account keeps for the wallet (Owner decision 2026-10-14). */
const DRIVER_ROLE = 'DRIVER';

/**
 * Opt-in of the limited access of a LOCKED driver: wallet balance, transaction history and withdrawal requests, nothing else. Every
 * variant refuses a locked account (ACCOUNT_DISABLED) unless the caller passes this explicitly, so a business command added later is
 * closed to a locked account by default; the wallet endpoints are the ones that opt in.
 */
export interface LockedAccessOptions {
  readonly allowLockedDriver?: boolean;
}

/** What a reader gets back from the shared variant: the session's CURRENT active role. */
export interface AuthorizedSessionState {
  readonly activeRole: string | null;
  /** Display only: derived from the LOCKED user row's account origin. Never an authorization source. */
  readonly phoneVerificationStatus: PhoneVerificationStatus;
  /** True only for a LOCKED driver served through the limited access (the caller opted in): wallet only. */
  readonly limited: boolean;
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
    // The native device binding (M01-ANDROID). Optional only so that a unit test can build the participant without a database.
    @Optional() private readonly bindings?: ClientDeviceRepository,
  ) {}

  /** For a command that writes: user FOR UPDATE, then session FOR UPDATE. */
  async lockAuthorizedActor(context: TransactionContext, actor: SessionActor): Promise<void> {
    assertActorShape(actor);
    const user = await this.users.lockById(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockById(context, actor.sessionId);
    await this.#decide(context, actor, user, session);
  }

  /**
   * The WALLET variant of a DRIVER (balance, history, withdrawal request): the same locks, the same session decision, and a LOCKED
   * account is accepted here, and only here, when it holds the DRIVER role and the session is in the DRIVER context (the limited
   * access). An ACTIVE driver is served the same way. Anything else is refused exactly as by lockAuthorizedActor (ACCOUNT_DISABLED for a
   * locked non-driver) or ROLE_NOT_AVAILABLE (not in the DRIVER context). The locks stay held until the caller's transaction ends.
   */
  async lockAuthorizedDriverWalletActor(context: TransactionContext, actor: SessionActor): Promise<{ readonly limited: boolean }> {
    assertActorShape(actor);
    const user = await this.users.lockById(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockById(context, actor.sessionId);
    const limited = await this.#decide(context, actor, user, session, { allowLockedDriver: true });
    if (session === undefined || session.activeRole !== DRIVER_ROLE || !(await this.users.hasRole(context, actor.userId, DRIVER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    return { limited };
  }

  /**
   * For a reader (/auth/me): user FOR SHARE, then session FOR SHARE. Any number of readers of one user run
   * together; a role selection, a revocation or an onboarding command (FOR UPDATE) is waited for. Returns the
   * active role read from the LOCKED session row.
   */
  async lockAuthorizedActorShared(
    context: TransactionContext,
    actor: SessionActor,
    options: LockedAccessOptions = {},
  ): Promise<AuthorizedSessionState> {
    assertActorShape(actor);
    const user = await this.users.lockByIdForShare(context, actor.userId);
    const session = user === undefined ? undefined : await this.sessions.lockByIdForShare(context, actor.sessionId);
    const limited = await this.#decide(context, actor, user, session, options);
    if (session === undefined || user === undefined) {
      // Unreachable: #decide refuses a missing user or session. Kept so the types narrow without a cast.
      throw new AppError('SESSION_INVALID');
    }
    return {
      activeRole: session.activeRole,
      phoneVerificationStatus: phoneVerificationStatusOf(user.accountOrigin),
      limited,
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

  /** Returns true when the caller is served through the LIMITED access of a locked driver (only when it opted in). */
  async #decide(
    context: TransactionContext,
    actor: SessionActor,
    user: UserRow | undefined,
    session: LockedSession | undefined,
    options: LockedAccessOptions = {},
  ): Promise<boolean> {
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
    let limited = false;
    if (user.status !== 'ACTIVE') {
      // A locked account has no business access. The one exception (opt-in): a DRIVER that is in the DRIVER context keeps the
      // wallet, so it can still see its balance and withdraw what it owns.
      if (
        options.allowLockedDriver !== true ||
        session.activeRole !== DRIVER_ROLE ||
        !(await this.users.hasRole(context, user.userId, DRIVER_ROLE))
      ) {
        throw new AppError('ACCOUNT_DISABLED');
      }
      limited = true;
    }
    // A native (ANDROID Food / Ship) session lives only while it sits on the user's CURRENT device binding. Rechecked here, under
    // the user and session locks, so a request that waited behind a device replacement fails after it (contract11 section 8).
    if (this.bindings !== undefined && (await this.bindings.nativeSessionState(context, actor.sessionId)) === 'UNBOUND') {
      throw new AppError('SESSION_REVOKED');
    }
    return limited;
  }
}

/** The ids come from the guard; a malformed one is refused before any SQL cast can fail with a server error. */
function assertActorShape(actor: SessionActor): void {
  if (!isCanonicalUuid(actor.userId) || !isCanonicalUuid(actor.sessionId)) {
    throw new AppError('SESSION_INVALID');
  }
}
