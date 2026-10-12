import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, standardAccountOriginPolicy } from '../auth/account-origin';
import { CUSTOMER_ROLE, REGISTER_PURPOSE } from '../auth/auth-constants';
import { AUTH_CONFIG } from '../auth/auth-config.provider';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { CustomerProvisioningParticipant } from '../auth/customer-provisioning-participant';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { ProofRepository } from '../auth/proof-repository';
import { SessionRepository } from '../auth/session-repository';
import { digestToken, parseCanonicalToken } from '../auth/tokens';
import { UserRepository } from '../auth/user-repository';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  CLIENT_REGISTER_AUDIT_ACTION,
  CLIENT_REGISTER_OPERATION_ID,
  CLIENT_REGISTER_SCOPE_TYPE,
  CLIENT_USER_REGISTERED_EVENT_SCHEMA_VERSION,
  CLIENT_USER_REGISTERED_EVENT_TYPE,
} from './client-auth-constants';
import {
  assertConsentSupported,
  assertDeviceAllowed,
  CLIENT_AUTH_SETTINGS,
  ClientAuthSettings,
} from './client-auth-policy';
import { ClientRegisterInput } from './client-auth-validation';
import { IdentityCapture, requireIdentity, responseOf, storedResultOf } from './client-auth-result';
import { ClientIdentityReader } from './client-identity-reader';

export interface ClientRegisterOutcome {
  readonly status: number;
  /** The `data` of the success envelope: CURRENT identity + the original access token and expiry. */
  readonly payload: JsonObject;
  readonly replayed: boolean;
}

/**
 * Registration of a CUSTOMER through POST /v1/client-auth/register (M01.03).
 *
 * Order of events:
 *  1. cheap refusals before any I/O: fixture-mode closure, the device gate (ANDROID has no verifier, WEB only in LOCAL_WEB
 *     mode), the Idempotency-Key shape and the proof token shape;
 *  2. resolve the proof IDENTITY from its token digest with no state check, so a changed retry meets the idempotency
 *     fingerprint before any business rule answers;
 *  3. hash the password OUTSIDE any transaction;
 *  4. execute through the SAME IdempotencyExecutor as every other command, in a namespace of its own: one transaction
 *     claims the key, locks and rechecks the REGISTER proof (DB clock after the lock), creates the ordinary user, consumes
 *     the proof, grants CUSTOMER, writes the profile (normalized name, version 1) and the consent (DB time), creates the
 *     CUSTOMER session, audits, emits the event and stores the encrypted result.
 *
 * What a replay returns: the ORIGINAL token and expiry (the only things stored) together with the CURRENT identity, read
 * under the same locks that authorized the replay. The authorization (proof not invalidated, user ACTIVE and ordinary,
 * session of that user neither revoked nor expired) runs before the engine decrypts anything; a token that can no longer
 * be used is AUTH_RESULT_NOT_REPLAYABLE and is never returned, never restored. Natural expiry of the proof after commit
 * does not stop a replay, and neither does a later change of the server consent pair: only a first execution compares it.
 */
@Injectable()
export class ClientRegistrationService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly proofs: ProofRepository,
    private readonly users: UserRepository,
    private readonly customers: CustomerProfileRepository,
    private readonly sessions: SessionRepository,
    private readonly customer: CustomerProvisioningParticipant,
    private readonly identityReader: ClientIdentityReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy = standardAccountOriginPolicy(),
  ) {}

  async register(
    input: ClientRegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ClientRegisterOutcome> {
    // Staging fixture mode closes every registration (same gate as the legacy route), before the key is read, any database
    // access, any hash or any executor call.
    this.originPolicy.assertRegistrationOpen();
    // The device gate: nothing is created, consumed or hashed for a platform that cannot be accepted.
    assertDeviceAllowed(this.settings, input.device);
    // The executor validates the key again; doing it first only avoids a database round trip and an Argon2 hash.
    parseIdempotencyKey(idempotencyKey);

    const token = parseCanonicalToken(input.verificationToken);
    if (token === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const tokenDigest = digestToken(token);
    const proofId = await this.transactions.withTransaction((context) => this.proofs.findIdByDigest(context, tokenDigest));
    if (proofId === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }

    const passwordHash = await this.hasher.hash(input.password);

    // Filled inside the transaction that commits (first execution) or that authorizes the replay; read only afterwards.
    const capture: IdentityCapture = { identity: undefined };

    const outcome = await this.executor.execute(
      {
        scopeType: CLIENT_REGISTER_SCOPE_TYPE,
        scopeId: proofId,
        operationId: CLIENT_REGISTER_OPERATION_ID,
        idempotencyKey,
        // Exactly the validated logical intent. The password keeps its original semantics; the executor only
        // HMAC-fingerprints this object, it is never stored or logged.
        logicalRequest: {
          phone_normalized: input.phoneNormalized,
          full_name: input.fullName,
          password: input.password,
          verification_token: token,
          device: {
            device_id: input.device.deviceId,
            platform: input.device.platform,
            app: input.device.app,
          },
          consent: {
            terms_version: input.consent.termsVersion,
            privacy_version: input.consent.privacyVersion,
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
      (context) => this.#registerNew(context, { input, proofId, passwordHash, requestId }, capture),
    );

    const stored = storedResultOf(outcome.payload);
    return { status: outcome.status, payload: responseOf(requireIdentity(capture), stored), replayed: outcome.replayed };
  }

  async #registerNew(
    context: TransactionContext,
    args: { input: ClientRegisterInput; proofId: string; passwordHash: string; requestId: string },
    capture: IdentityCapture,
  ) {
    const { input, proofId, passwordHash, requestId } = args;

    // 1. Proof row lock, then the clock (after the lock): the same recheck as the legacy route.
    const proof = await this.proofs.lockForRegister(context, proofId);
    if (proof === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const nowMs = await freshClockMs(context);
    if (proof.purpose !== REGISTER_PURPOSE) {
      throw new AppError('VERIFICATION_PURPOSE_MISMATCH');
    }
    if (proof.phoneNormalized !== input.phoneNormalized) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    if (proof.consumed) {
      throw new AppError('VERIFICATION_PROOF_USED');
    }
    if (proof.expiresAtMs <= nowMs) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    if (proof.invalidated) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }

    // 2. The consent pair of THIS first execution, compared before any row is written. A replay never gets here.
    const consent = assertConsentSupported(this.settings, input.consent);

    // 3. The ordinary user. The UNIQUE phone constraint decides a race between two valid proofs, and between this route
    // and the legacy one.
    const userId = randomUUID();
    const created = await this.users.insertRegistered(context, {
      userId,
      phoneNormalized: input.phoneNormalized,
      passwordHash,
      proofId,
    });
    if (!created) {
      throw new AppError('PHONE_ALREADY_REGISTERED');
    }
    await this.proofs.consume(context, proofId);

    // 4. CUSTOMER, the profile with the normalized name (version 1, initialization not update) and the consent (database
    // time), through the M01.02 participant on THIS transaction. Everything is new here, so everything must have been
    // created: anything else is a broken invariant and rolls the whole registration back.
    const provisioned = await this.customer.provision(
      context,
      userId,
      { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion, clientApp: input.device.app },
      { initialFullName: input.fullName },
    );
    if (!provisioned.roleGranted || !provisioned.profileCreated || !provisioned.consentRecorded) {
      throw new TechnicalError('internal', 'A new customer was not fully provisioned');
    }

    // 5. The CUSTOMER session and its plaintext token (returned once, stored only as a digest). The context is chosen on
    // purpose here; the legacy default (a roleless session) is untouched.
    const session = await this.sessions.create(context, {
      userId,
      device: { deviceId: input.device.deviceId, platform: input.device.platform, app: input.device.app },
      ttlSeconds: this.config.sessionTtlSeconds,
      activeRole: CUSTOMER_ROLE,
    });

    // 6. Audit and ONE outbox event in the same transaction. Safe fields only: no phone, name, proof, password or token.
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: CLIENT_REGISTER_AUDIT_ACTION,
      resourceType: 'user',
      resourceId: userId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { session_id: session.sessionId, client_app: input.device.app },
    });
    await this.outbox.append(context, {
      eventType: CLIENT_USER_REGISTERED_EVENT_TYPE,
      eventSchemaVersion: CLIENT_USER_REGISTERED_EVENT_SCHEMA_VERSION,
      resourceType: 'user',
      resourceId: userId,
      resourceVersion: 1,
      payload: {
        user_id: userId,
        client_app: input.device.app,
        granted_role: CUSTOMER_ROLE,
        terms_version: consent.termsVersion,
        privacy_version: consent.privacyVersion,
      },
    });

    // 7. The identity as it stands at commit, read in this very transaction (the user and session locks are held).
    capture.identity = await this.identityReader.read(context, {
      userId,
      phoneNormalized: input.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: CUSTOMER_ROLE,
    });

    return {
      status: 201,
      replayGuard: { proof_id: proofId, user_id: userId, session_id: session.sessionId },
      // ONLY the secret and the instant are stored (encrypted); the identity is never cached, so a replay cannot serve
      // stale rights.
      payload: { access_token: session.accessToken, expires_at: new Date(session.expiresAtMs).toISOString() },
    };
  }

  /**
   * Replay authorization (contract11 section 5). Same TransactionContext as the executor; locks proof, user and session IN
   * THAT ORDER (the order of the first execution), reads the state after the locks and stays read-only. Only after this
   * resolves does the engine decrypt the stored result. A denial is always AUTH_RESULT_NOT_REPLAYABLE: the token is not
   * returned, not restored and not distinguishable by cause. Natural expiry of the proof does NOT deny a committed replay.
   * The credential epoch of contract11 does not exist in the model yet (the reset slice adds it, together with the session
   * revocation that this check already honours).
   */
  async #authorizeReplay(
    context: TransactionContext,
    guard: JsonObject,
    input: ClientRegisterInput,
    capture: IdentityCapture,
  ): Promise<void> {
    const { proof_id: proofId, user_id: userId, session_id: sessionId } = guard;
    if (!isCanonicalUuid(proofId) || !isCanonicalUuid(userId) || !isCanonicalUuid(sessionId)) {
      // A guard we did not write: fail closed, nothing is decrypted.
      throw new TechnicalError('internal', 'Invalid replay guard');
    }

    const proof = await this.proofs.lockForReplay(context, proofId);
    if (proof === undefined || proof.invalidated) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
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

    // The CURRENT identity, under the locks that just authorized the replay: roles, profile and statuses as they are now.
    capture.identity = await this.identityReader.read(context, {
      userId,
      phoneNormalized: user.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: session.activeRole,
    });
  }
}
