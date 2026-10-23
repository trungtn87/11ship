import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, standardAccountOriginPolicy } from '../auth/account-origin';
import { AUDIT_ACTIONS } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { bearerTokenFrom } from '../auth/session-service';
import { SessionRepository } from '../auth/session-repository';
import { digestToken } from '../auth/tokens';
import { UserRepository } from '../auth/user-repository';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  CLIENT_CONTEXT_AUDIT_ACTION,
  CLIENT_CONTEXT_OPERATION_ID,
  CLIENT_CONTEXT_SCOPE_TYPE,
  CLIENT_LOGOUT_AUDIT_ACTION,
  isClientApp,
  isClientPlatform,
} from './client-auth-constants';
import { assertPlatformAllowed, CLIENT_AUTH_SETTINGS, ClientAuthSettings } from './client-auth-policy';
import { sessionResponseOf } from './client-auth-result';
import { ClientContextInput } from './client-auth-validation';
import { contextAllowedForApp, isPublicContext, publicContextOf, PublicContext, storageRoleOf } from './client-context';
import { ClientIdentity, ClientIdentityReader } from './client-identity-reader';
import { ClientActor, ClientSessionAuthority } from './client-session-authority';
import { BindingInfo } from '../client-device/client-device-binding-participant';
import { isNativeSession } from '../client-device/client-device-constants';
import { ClientDeviceProofService, NativeRequestEvidence } from '../client-device/client-device-proof-service';
import { ClientDeviceRepository } from '../client-device/client-device-repository';

export interface ClientSessionOutcome {
  /** Native only: the device binding of the session, for the response headers. */
  readonly binding?: BindingInfo;
  readonly status: number;
  /** The `data` of the success envelope: CURRENT identity + session{expires_at}. Never a token. */
  readonly payload: JsonObject;
}

/** The CURRENT identity and the session instant read inside the transaction of the first execution or of the replay hook. */
interface ContextCapture {
  identity: ClientIdentity | undefined;
  expiresAtMs: number | undefined;
}

/**
 * The Bearer endpoints of the client API: GET me, POST context, POST logout (M01.04).
 *
 * Every authorization that counts runs INSIDE the business transaction, through ClientSessionAuthority: user row, then the
 * CURRENT session row, the fresh database clock after both waits, client-session and platform checks. The guard that ran
 * before the request is only a precheck. Lock order is the coordinator's: idempotency, user root, session, profile reads,
 * then audit and result.
 */
@Injectable()
export class ClientSessionService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly identityReader: ClientIdentityReader,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly deviceProof: ClientDeviceProofService,
    private readonly devices: ClientDeviceRepository,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy = standardAccountOriginPolicy(),
  ) {}

  /**
   * GET /v1/client-auth/me. One coherent read: user FOR SHARE, session FOR SHARE, then roles, profile and eligibility. It
   * returns the CURRENT identity and the session's absolute expiry, never the token, and it writes nothing (no audit, no
   * outbox). The active context is the one stored on the locked session row while it is still selectable, else null: a
   * stale context is reported as null and never silently replaced (GET has no side effect).
   */
  async me(principal: AuthPrincipal): Promise<ClientSessionOutcome> {
    const view = await this.transactions.withTransaction(async (context) => {
      // A LOCKED driver is served here with the limited identity (the wallet is the only thing it keeps); every other locked account
      // is refused (ACCOUNT_DISABLED) as before.
      const actor = await this.authority.lock(context, principal, 'share', { allowLockedDriver: true });
      const identity = await this.identityReader.read(context, {
        userId: actor.userId,
        phoneNormalized: principal.phoneNormalized,
        app: actor.app,
        enabled: !actor.limited,
        storedActiveRole: actor.storedActiveRole,
        limited: actor.limited,
      });
      const bound = isNativeSession(actor.platform, actor.app) ? await this.devices.sessionBinding(context, actor.sessionId) : undefined;
      return { identity, expiresAtMs: actor.expiresAtMs, binding: bound === undefined ? undefined : { bindingId: bound.bindingId, generation: bound.generation } };
    });
    return {
      status: 200,
      payload: sessionResponseOf(view.identity, view.expiresAtMs),
      ...(view.binding === undefined ? {} : { binding: view.binding }),
    };
  }

  /**
   * POST /v1/client-auth/context. Switches the context of THIS session to one it may select; it never grants anything
   * (contract11 sections 3 and 4). The decision is made under the user and session locks from the live state:
   *  - an app never wears a context outside its own (FOOD never DRIVER, SHIP never SHOP_OWNER);
   *  - the context must be SELECTABLE now (held role plus an ACTIVE owned shop / a not-CLOSED driver profile);
   *  - anything else is ROLE_NOT_AVAILABLE, one answer for "not held", "not selectable" and "not allowed for this app", so
   *    the response never discloses ownership.
   * Choosing SHOP_OWNER revokes the user's other SHOP-context sessions, as the legacy role selection does (storage SHOP);
   * CUSTOMER and DRIVER sessions and the other app are untouched.
   *
   * A replay of a committed switch does NOT apply it again and never moves the session back to an older context: the hook
   * re-checks the session (401 when revoked or expired) and that the requested context is still selectable (403
   * ROLE_NOT_AVAILABLE when it no longer is), then the response is the CURRENT identity. A replay writes no audit row.
   */
  async selectContext(
    principal: AuthPrincipal,
    input: ClientContextInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ClientSessionOutcome> {
    const capture: ContextCapture = { identity: undefined, expiresAtMs: undefined };

    const outcome = await this.executor.execute(
      {
        scopeType: CLIENT_CONTEXT_SCOPE_TYPE,
        scopeId: principal.sessionId,
        operationId: CLIENT_CONTEXT_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { context: input.context },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            await this.#authorizeContextReplay(context, guard, principal, capture);
            return true;
          },
        },
      },
      (context) => this.#switchContext(context, principal, input.context, requestId, capture),
    );

    if (capture.identity === undefined || capture.expiresAtMs === undefined) {
      // Unreachable: both paths fill the capture before the executor returns. Fail closed.
      throw new TechnicalError('internal', 'The context identity was not read');
    }
    return { status: outcome.status, payload: sessionResponseOf(capture.identity, capture.expiresAtMs) };
  }

  async #switchContext(
    context: TransactionContext,
    principal: AuthPrincipal,
    requested: PublicContext,
    requestId: string,
    capture: ContextCapture,
  ) {
    const actor = await this.authority.lock(context, principal, 'update');
    const selectable = await this.#requireSelectable(context, actor, requested);

    const storedPublic = actor.storedActiveRole === null ? undefined : publicContextOf(actor.storedActiveRole);
    const from = storedPublic !== undefined && selectable.includes(storedPublic) ? storedPublic : null;

    let revoked: string[] = [];
    if (requested === 'SHOP_OWNER') {
      revoked = await this.sessions.revokeOtherShopSessions(context, actor.userId, actor.sessionId);
    }
    await this.sessions.setActiveRole(context, actor.sessionId, storageRoleOf(requested));

    for (const revokedSessionId of revoked) {
      await this.audit.append(context, {
        requestId,
        actorType: 'USER',
        actorId: actor.userId,
        action: AUDIT_ACTIONS.sessionRevoke,
        resourceType: 'session',
        resourceId: revokedSessionId,
        outcome: 'SUCCESS',
        metadata: { reason: 'SHOP_REPLACED' },
      });
    }
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: actor.userId,
      action: CLIENT_CONTEXT_AUDIT_ACTION,
      resourceType: 'session',
      resourceId: actor.sessionId,
      outcome: 'SUCCESS',
      metadata: { user_id: actor.userId, session_id: actor.sessionId, from_context: from, to_context: requested },
    });

    capture.identity = await this.identityReader.read(context, {
      userId: actor.userId,
      phoneNormalized: principal.phoneNormalized,
      app: actor.app,
      enabled: true,
      storedActiveRole: storageRoleOf(requested),
    });
    capture.expiresAtMs = actor.expiresAtMs;

    return {
      status: 200,
      replayGuard: { user_id: actor.userId, session_id: actor.sessionId, context: requested },
      // Nothing to cache: the response is always the CURRENT identity, read at replay time.
      payload: { context: requested },
    };
  }

  /**
   * Replay authorization of a context switch. Same locks, same order and same session decision as the first execution (so
   * a revoked or expired session is 401 exactly as on any other call), then the requested context must STILL be selectable
   * for this app. Read-only: the session keeps whatever context it has now.
   */
  async #authorizeContextReplay(
    context: TransactionContext,
    guard: JsonObject,
    principal: AuthPrincipal,
    capture: ContextCapture,
  ): Promise<void> {
    const { user_id: userId, session_id: sessionId, context: requested } = guard;
    if (
      !isCanonicalUuid(userId) ||
      !isCanonicalUuid(sessionId) ||
      userId !== principal.userId ||
      sessionId !== principal.sessionId ||
      !isPublicContext(requested)
    ) {
      // A guard we did not write, or one that is not this caller's: fail closed, nothing is decrypted.
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#requireSelectable(context, actor, requested);

    capture.identity = await this.identityReader.read(context, {
      userId: actor.userId,
      phoneNormalized: principal.phoneNormalized,
      app: actor.app,
      enabled: true,
      storedActiveRole: actor.storedActiveRole,
    });
    capture.expiresAtMs = actor.expiresAtMs;
  }

  /** ROLE_NOT_AVAILABLE unless the app may wear the context AND it is selectable now. Returns the selectable set. */
  async #requireSelectable(context: TransactionContext, actor: ClientActor, requested: PublicContext): Promise<string[]> {
    if (!contextAllowedForApp(actor.app, requested)) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    const selectable = await this.identityReader.selectableContexts(context, actor.userId);
    if (!selectable.includes(requested)) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    return selectable;
  }

  /**
   * POST /v1/client-auth/logout (contract10 section 5). Revokes THIS session only: another app's session of the same
   * user and every Admin session are untouched. No Idempotency-Key: the operation is naturally idempotent.
   *  - a token that is not a well-formed bearer, or that no session matches: SESSION_INVALID (401);
   *  - a session already revoked or expired: 204, nothing changes, nothing is audited again;
   *  - an active session: user row, then session row, the state decided again under both locks, the platform gate on the
   *    platform recorded on the session, one UPDATE and ONE audit row, same transaction. A retry therefore finds it revoked.
   * The caller's identity is the token alone: nothing the client sends names a user or a session. An account that was
   * disabled meanwhile can still log out (it only removes access).
   */
  async logout(
    authorization: string | string[] | undefined,
    requestId: string,
    evidence?: NativeRequestEvidence,
  ): Promise<void> {
    const token = bearerTokenFrom(authorization);
    if (token === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    const digest = digestToken(token);

    // A native token is useless without the key it was issued to, logout included: the proof is checked before anything is
    // revoked (outside the transaction below: it opens its own for the nonce). A stale token (binding replaced) may still be
    // logged out by that same key.
    const known = await this.transactions.withTransaction((context) => this.sessions.findByDigest(context, digest));
    if (known !== undefined && known.authMethod !== 'PASSWORD' && isNativeSession(known.platform, known.app)) {
      if (!this.originPolicy.allows({ accountOrigin: known.accountOrigin, phoneNormalized: known.phoneNormalized })) {
        throw new AppError('SESSION_INVALID');
      }
      assertPlatformAllowed(this.settings, 'ANDROID');
      if (evidence === undefined) {
        throw new AppError('DEVICE_PROOF_REQUIRED');
      }
      await this.deviceProof.verifyBearerRequest(
        evidence,
        token,
        { sessionId: known.sessionId, platform: known.platform, app: known.app },
        { allowDetached: true },
      );
    }

    await this.transactions.withTransaction(async (context) => {
      const found = await this.sessions.findByDigest(context, digest);
      if (found === undefined) {
        throw new AppError('SESSION_INVALID');
      }
      // An origin this process does not serve (administration account, fixture outside fixture mode) is no session of this
      // API: the same answer as an unknown token, so nothing is disclosed.
      if (!this.originPolicy.allows({ accountOrigin: found.accountOrigin, phoneNormalized: found.phoneNormalized })) {
        throw new AppError('SESSION_INVALID');
      }
      if (found.revoked || found.expired) {
        return;
      }

      const user = await this.users.lockById(context, found.userId);
      const session = user === undefined ? undefined : await this.sessions.lockById(context, found.sessionId);
      if (user === undefined || session === undefined || session.userId !== found.userId) {
        throw new AppError('SESSION_INVALID');
      }
      if (session.revoked) {
        return;
      }
      // Fresh database time after both lock waits; equality counts as expired.
      if (session.expiresAtMs <= (await freshClockMs(context))) {
        return;
      }

      const view = await this.sessions.readClientView(context, found.sessionId);
      if (view === undefined || !isClientApp(view.app) || !isClientPlatform(view.platform)) {
        throw new AppError('SESSION_INVALID');
      }
      assertPlatformAllowed(this.settings, view.platform);

      if (await this.sessions.revokeById(context, found.sessionId)) {
        await this.audit.append(context, {
          requestId,
          actorType: 'USER',
          actorId: found.userId,
          action: CLIENT_LOGOUT_AUDIT_ACTION,
          resourceType: 'session',
          resourceId: found.sessionId,
          outcome: 'SUCCESS',
          metadata: { user_id: found.userId, session_id: found.sessionId, client_app: view.app },
        });
      }
    });
  }
}
