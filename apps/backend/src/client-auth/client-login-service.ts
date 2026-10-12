import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, standardAccountOriginPolicy } from '../auth/account-origin';
import { AUTH_CONFIG } from '../auth/auth-config.provider';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { SessionRepository } from '../auth/session-repository';
import { UserRepository, UserRow } from '../auth/user-repository';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  CLIENT_LOGIN_AUDIT_ACTION,
  CLIENT_LOGIN_OPERATION_ID,
  CLIENT_LOGIN_SCOPE_TYPE,
} from './client-auth-constants';
import { assertDeviceAllowed, CLIENT_AUTH_SETTINGS, ClientAuthSettings } from './client-auth-policy';
import { IdentityCapture, requireIdentity, responseOf, storedResultOf } from './client-auth-result';
import { ClientLoginInput } from './client-auth-validation';
import { defaultContextFor, PublicContext, storageRoleOf } from './client-context';
import { ClientIdentityReader } from './client-identity-reader';

export interface ClientLoginOutcome {
  readonly status: number;
  /** The `data` of the success envelope: CURRENT identity + the original access token and expiry. */
  readonly payload: JsonObject;
  readonly replayed: boolean;
}

/**
 * Login through POST /v1/client-auth/login (M01.04).
 *
 * Order of events:
 *  1. cheap refusals before any I/O: the device gate (ANDROID has no verifier, WEB only in LOCAL_WEB mode) and the
 *     Idempotency-Key shape;
 *  2. the credentials, OUTSIDE any transaction (Argon2): an unknown phone, an administration or non-PHONE_VERIFIED account
 *     and a wrong password are one answer, INVALID_CREDENTIALS, after the same amount of hashing work. Nothing about the
 *     account is disclosed to someone who does not hold its password, and no idempotency record exists before this passes, so
 *     the key cannot be used to probe an account;
 *  3. execute through the SAME IdempotencyExecutor as every other command, in a namespace of its own (scope = the user the
 *     credentials proved): one transaction claims the key, locks the user, RECHECKS hash, origin policy, ordinary eligibility
 *     and status under that lock (a password changed or an account disabled while Argon2 ran creates no session), chooses
 *     the context, creates the session, audits and stores the encrypted result. Login never grants or repairs a role.
 *
 * What a replay returns: the ORIGINAL token and expiry together with the CURRENT identity, read under the locks that just
 * authorized it. The authorization (user ACTIVE and ordinary, session neither revoked nor expired) runs before the engine
 * decrypts anything; a token that can no longer be used is AUTH_RESULT_NOT_REPLAYABLE and is never returned or restored. A
 * replay also needs the password again (step 2), so possession of the key alone returns nothing.
 *
 * The credential epoch of contract11 does not exist in the model yet (the reset slice adds it): until then a password
 * change is caught by step 2 itself, because the old password no longer verifies.
 */
@Injectable()
export class ClientLoginService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly users: UserRepository,
    private readonly customers: CustomerProfileRepository,
    private readonly sessions: SessionRepository,
    private readonly identityReader: ClientIdentityReader,
    private readonly audit: AuditWriter,
    private readonly recorder: StandaloneAuditRecorder,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy = standardAccountOriginPolicy(),
  ) {}

  async login(
    input: ClientLoginInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ClientLoginOutcome> {
    assertDeviceAllowed(this.settings, input.device);
    // The executor validates the key again; doing it first only avoids a database round trip and an Argon2 verification.
    parseIdempotencyKey(idempotencyKey);

    const user = await this.#verifiedUser(input);

    const capture: IdentityCapture = { identity: undefined };
    // Set only when the locked recheck finds an ENABLED ordinary account that is disabled: the best-effort audit of the
    // denial is written after the transaction ended (it was rolled back), exactly like the legacy login.
    const denied: { disabledUserId: string | undefined } = { disabledUserId: undefined };

    let outcome: IdempotentOutcome;
    try {
      outcome = await this.executor.execute(
        {
          scopeType: CLIENT_LOGIN_SCOPE_TYPE,
          scopeId: user.userId,
          operationId: CLIENT_LOGIN_OPERATION_ID,
          idempotencyKey,
          // Exactly the validated logical intent. The password keeps its original semantics; the executor only
          // HMAC-fingerprints this object, it is never stored or logged.
          logicalRequest: {
            phone_normalized: input.phoneNormalized,
            password: input.password,
            device: {
              device_id: input.device.deviceId,
              platform: input.device.platform,
              app: input.device.app,
            },
          },
          replay: {
            kind: 'sensitive',
            authorize: async (context, guard) => {
              await this.#authorizeReplay(context, guard, input, capture);
              return true;
            },
          },
        },
        (context) => this.#loginNew(context, { input, user, requestId }, capture, denied),
      );
    } catch (error) {
      if (denied.disabledUserId !== undefined && error instanceof AppError && error.code === 'ACCOUNT_DISABLED') {
        await this.recorder.recordBestEffort({
          requestId,
          actorType: 'USER',
          actorId: denied.disabledUserId,
          action: CLIENT_LOGIN_AUDIT_ACTION,
          resourceType: 'user',
          resourceId: denied.disabledUserId,
          outcome: 'DENIED',
          reasonCode: 'ACCOUNT_DISABLED',
        });
      }
      throw error;
    }

    const stored = storedResultOf(outcome.payload);
    return { status: outcome.status, payload: responseOf(requireIdentity(capture), stored), replayed: outcome.replayed };
  }

  /**
   * Step 2: who the credentials belong to, or INVALID_CREDENTIALS. Same shape of work for every refusal: a real
   * verification, or one against a dummy hash.
   */
  async #verifiedUser(input: ClientLoginInput): Promise<UserRow> {
    const user = await this.transactions.withTransaction((context) =>
      this.users.findByPhone(context, input.phoneNormalized),
    );
    if (user === undefined || user.accountOrigin !== 'PHONE_VERIFIED') {
      // An administration or fixture account has no client login in ANY mode: it is treated exactly like an unknown phone,
      // its own hash is never verified.
      await this.hasher.verifyAgainstDummy(input.password);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    // The origin policy only AFTER the password verified, so nothing about an origin is disclosed to a stranger.
    if (!this.originPolicy.allows(user)) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    return user;
  }

  async #loginNew(
    context: TransactionContext,
    args: { input: ClientLoginInput; user: UserRow; requestId: string },
    capture: IdentityCapture,
    denied: { disabledUserId: string | undefined },
  ) {
    const { input, user, requestId } = args;

    // 1. The ROOT user lock, then everything that decides the login is read again under it. Anything that moved while the
    // password was being verified is the same answer as a wrong password.
    const locked = await this.users.lockById(context, user.userId);
    if (locked === undefined || locked.passwordHash !== user.passwordHash || !this.originPolicy.allows(locked)) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const eligibility = await this.customers.lockEligibility(context, user.userId);
    if (
      eligibility === undefined ||
      eligibility.accountOrigin !== 'PHONE_VERIFIED' ||
      !eligibility.phoneVerified ||
      eligibility.hasAdminMembership
    ) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (locked.status !== 'ACTIVE') {
      denied.disabledUserId = locked.userId;
      throw new AppError('ACCOUNT_DISABLED');
    }

    // 2. The context of this login: chosen from the live selectable set, never granted. No selectable context is a roleless
    // session (active_role null): role_selection_required / onboarding_required tell the app what is missing.
    const selectable = await this.identityReader.selectableContexts(context, locked.userId);
    const chosen: PublicContext | null = defaultContextFor(input.device.app, selectable);

    // 3. The session and its plaintext token (returned once, stored only as a digest).
    const session = await this.sessions.create(context, {
      userId: locked.userId,
      device: { deviceId: input.device.deviceId, platform: input.device.platform, app: input.device.app },
      ttlSeconds: this.config.sessionTtlSeconds,
      ...(chosen === null ? {} : { activeRole: storageRoleOf(chosen) }),
    });

    // 4. ONE audit row, same transaction, safe fields only (no phone, password or token). No outbox event: no consumer.
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: locked.userId,
      action: CLIENT_LOGIN_AUDIT_ACTION,
      resourceType: 'user',
      resourceId: locked.userId,
      outcome: 'SUCCESS',
      metadata: {
        user_id: locked.userId,
        session_id: session.sessionId,
        client_app: input.device.app,
        binding_id: null,
      },
    });

    // 5. The identity as it stands at commit, read in this very transaction (the user lock is held).
    capture.identity = await this.identityReader.read(context, {
      userId: locked.userId,
      phoneNormalized: locked.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: chosen === null ? null : storageRoleOf(chosen),
    });

    return {
      status: 200,
      replayGuard: { user_id: locked.userId, session_id: session.sessionId },
      // ONLY the secret and the instant are stored (encrypted); the identity is never cached, so a replay cannot serve
      // stale rights.
      payload: { access_token: session.accessToken, expires_at: new Date(session.expiresAtMs).toISOString() },
    };
  }

  /**
   * Replay authorization (contract11 section 5). Same TransactionContext as the executor; locks user then session IN THE
   * ORDER of the first execution, reads the state after the locks and stays read-only. Only after this resolves does the
   * engine decrypt the stored result. Every denial is AUTH_RESULT_NOT_REPLAYABLE: the token is not returned, not restored
   * and not distinguishable by cause.
   */
  async #authorizeReplay(
    context: TransactionContext,
    guard: JsonObject,
    input: ClientLoginInput,
    capture: IdentityCapture,
  ): Promise<void> {
    const { user_id: userId, session_id: sessionId } = guard;
    if (!isCanonicalUuid(userId) || !isCanonicalUuid(sessionId)) {
      // A guard we did not write: fail closed, nothing is decrypted.
      throw new TechnicalError('internal', 'Invalid replay guard');
    }

    const user = await this.users.lockById(context, userId);
    if (
      user === undefined ||
      user.status !== 'ACTIVE' ||
      user.accountOrigin !== 'PHONE_VERIFIED' ||
      !this.originPolicy.allows({ accountOrigin: user.accountOrigin, phoneNormalized: user.phoneNormalized })
    ) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }
    const eligibility = await this.customers.lockEligibility(context, userId);
    if (
      eligibility === undefined ||
      eligibility.accountOrigin !== 'PHONE_VERIFIED' ||
      !eligibility.phoneVerified ||
      eligibility.hasAdminMembership
    ) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }
    const session = await this.sessions.lockById(context, sessionId);
    if (session === undefined || session.userId !== userId || session.revoked) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }
    const nowMs = await freshClockMs(context);
    if (session.expiresAtMs <= nowMs) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }

    // The CURRENT identity, under the locks that just authorized the replay: roles, profile, statuses and the CURRENT active
    // context as they are now (a context switch after the login is reflected, never undone).
    capture.identity = await this.identityReader.read(context, {
      userId,
      phoneNormalized: user.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: session.activeRole,
    });
  }
}
