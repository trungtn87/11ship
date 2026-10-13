import { Inject, Injectable } from '@nestjs/common';
import { isOrdinaryClientAccount } from '../auth/account-origin';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { actorOf, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { SessionRepository } from '../auth/session-repository';
import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ClientApp, ClientPlatform, isClientApp, isClientPlatform } from './client-auth-constants';
import { assertPlatformAllowed, CLIENT_AUTH_SETTINGS, ClientAuthSettings } from './client-auth-policy';

/** What a client endpoint knows about its caller once the user and session rows are locked and validated. */
export interface ClientActor {
  readonly userId: string;
  readonly sessionId: string;
  /** The client app the session was created for (immutable). It only narrows routing, it grants nothing. */
  readonly app: ClientApp;
  /** The role stored on the LOCKED session row, or null. */
  readonly storedActiveRole: string | null;
  readonly expiresAtMs: number;
  /** The platform recorded on the session (immutable). */
  readonly platform: ClientPlatform;
}

export type ClientActorLock = 'update' | 'share';

/**
 * Re-authorizes the caller of a Bearer client endpoint INSIDE its transaction (M01.04). The existing
 * SessionAuthorizationParticipant does the part that already exists and is shared with every other command: user row, then
 * the CURRENT session row (FOR UPDATE for a writer, FOR SHARE for a reader), the origin policy on the locked user, the fresh
 * database clock after both waits and the error precedence SESSION_REVOKED, SESSION_EXPIRED, ACCOUNT_DISABLED. This class adds
 * what only the client API needs, all read under those locks:
 *  - the session must be a CLIENT session (app FOOD or SHIP, platform WEB or ANDROID): a legacy session of another app label
 *    is simply not a valid session of this API;
 *  - the platform gate applies to the platform RECORDED on the session (ANDROID: no verifier, 503; WEB outside LOCAL_WEB mode:
 *    DEVICE_PROOF_REQUIRED), so nothing is served on a platform this process cannot vouch for;
 *  - the account must be an ORDINARY one (PHONE_VERIFIED with a verification time, or TEST_UNVERIFIED without one; the process
 *    policy already refused the latter outside the no-proof test mode; no administration membership), otherwise the session
 *    is invalid, with the same answer as an unknown one.
 * It is a participant: it opens no transaction and issues no lock beyond the two rows the participant takes. In the shared mode it
 * never upgrades the user row lock (readEligibility takes none).
 */
@Injectable()
export class ClientSessionAuthority {
  constructor(
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerProfileRepository,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
  ) {}

  async lock(context: TransactionContext, principal: AuthPrincipal, mode: ClientActorLock): Promise<ClientActor> {
    const actor = actorOf(principal);
    if (mode === 'update') {
      await this.sessionAuth.lockAuthorizedActor(context, actor);
    } else {
      await this.sessionAuth.lockAuthorizedActorShared(context, actor);
    }
    const view = await this.sessions.readClientView(context, actor.sessionId);
    if (view === undefined || !isClientApp(view.app) || !isClientPlatform(view.platform)) {
      throw new AppError('SESSION_INVALID');
    }
    assertPlatformAllowed(this.settings, view.platform);
    await this.#requireOrdinary(context, actor.userId);
    return {
      userId: actor.userId,
      sessionId: actor.sessionId,
      app: view.app,
      storedActiveRole: view.activeRole,
      expiresAtMs: view.expiresAtMs,
      platform: view.platform,
    };
  }

  async #requireOrdinary(context: TransactionContext, userId: string): Promise<void> {
    const eligibility = await this.customers.readEligibility(context, userId);
    if (eligibility === undefined || !isOrdinaryClientAccount(eligibility)) {
      throw new AppError('SESSION_INVALID');
    }
  }
}
