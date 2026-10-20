import { DriverRepository } from '../driver/driver-repository';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { WalletService } from '../wallet/wallet-service';
import { createHash, randomUUID } from 'node:crypto';
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
import { SystemSettingsReader } from '../system-settings/system-settings-reader';
import { OTP_REGISTRATION_ENABLED } from '../system-settings/system-settings-constants';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { isOrdinaryClientAccount } from '../auth/account-origin';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  CLIENT_REGISTER_AUDIT_ACTION,
  CLIENT_REGISTER_OPERATION_ID,
  CLIENT_REGISTER_SCOPE_TYPE,
  CLIENT_REGISTER_UNVERIFIED_AUDIT_ACTION,
  CLIENT_REGISTER_UNVERIFIED_OPERATION_ID,
  CLIENT_REGISTER_UNVERIFIED_SCOPE_TYPE,
  CLIENT_REGISTER_UNVERIFIED_TEST_AUDIT_ACTION,
  CLIENT_REGISTER_UNVERIFIED_TEST_OPERATION_ID,
  CLIENT_REGISTER_UNVERIFIED_TEST_SCOPE_TYPE,
  CLIENT_USER_REGISTERED_EVENT_SCHEMA_VERSION,
  CLIENT_USER_REGISTERED_EVENT_TYPE,
} from './client-auth-constants';
import {
  assertConsentSupported,
  assertDeviceAllowed,
  CLIENT_AUTH_SETTINGS,
  ClientAuthSettings,
} from './client-auth-policy';
import { ClientRegisterInput, ClientUnverifiedRegisterInput } from './client-auth-validation';
import { IdentityCapture, requireIdentity, responseOf, storedResultOf } from './client-auth-result';
import { ClientIdentityReader } from './client-identity-reader';
import { BindingInfo, ClientDeviceBindingParticipant } from '../client-device/client-device-binding-participant';
import {
  ClientDeviceProofService,
  NativeAuthProof,
  NativeRequestEvidence,
} from '../client-device/client-device-proof-service';

export interface ClientRegisterOutcome {
  /** Native only: the binding of the new session, for the response headers. */
  readonly binding?: BindingInfo;
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
    private readonly deviceProof: ClientDeviceProofService,
    private readonly deviceBinding: ClientDeviceBindingParticipant,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
    @Optional() @Inject(ACCOUNT_ORIGIN_POLICY) private readonly originPolicy: AccountOriginPolicy = standardAccountOriginPolicy(),
    // The SYSTEM settings. Optional only so that a unit harness without a database can build the service (it then keeps the proof path).
    @Optional() private readonly systemSettings?: SystemSettingsReader,
    @Optional() private readonly drivers?: DriverRepository,
    @Optional() private readonly roleGrants?: RoleGrantParticipant,
    @Optional() private readonly wallets?: WalletService,
  ) {}

  /**
   * Which registration the SERVER runs right now (never anything the request says): the development-only test mode, the proof
   * registration, or the registration without a proof that the SYSTEM setting otp_registration_enabled=false opens. Read from the
   * database on every call, so a change by SYSTEM is in effect at the next request.
   */
  async currentMode(): Promise<'DISABLED_TEST' | 'REQUIRED' | 'NOT_REQUIRED'> {
    if (this.settings.phoneVerificationMode === 'DISABLED_TEST') {
      return 'DISABLED_TEST';
    }
    if (this.systemSettings === undefined) {
      return 'REQUIRED';
    }
    return (await this.systemSettings.registrationOtpRequired()) ? 'REQUIRED' : 'NOT_REQUIRED';
  }

  async register(
    input: ClientRegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    evidence?: NativeRequestEvidence,
  ): Promise<ClientRegisterOutcome> {
    // Staging fixture mode closes every registration (same gate as the legacy route), before the key is read, any database
    // access, any hash or any executor call.
    this.originPolicy.assertRegistrationOpen();
    // The device gate: nothing is created, consumed or hashed for a platform that cannot be accepted.
    assertDeviceAllowed(this.settings, input.device);
    // The executor validates the key again; doing it first only avoids a database round trip and an Argon2 hash.
    parseIdempotencyKey(idempotencyKey);
    // ANDROID (issue #102): the OTP proof does NOT replace the native device proof. The registration token and its signature
    // are verified now, before any hash or write, exactly like the no-proof branch; a replay presents a fresh proof for the
    // same, already consumed, token.
    const nativeProof: NativeAuthProof | undefined =
      input.device.platform === 'ANDROID' ? await this.#nativeProof(evidence, input.device.app, idempotencyKey) : undefined;

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
            await this.#authorizeReplay(context, guard, input, capture, nativeProof);
            return true;
          },
        },
      },
      (context) => this.#registerNew(context, { input, proofId, passwordHash, requestId, nativeProof }, capture),
    );

    const stored = storedResultOf(outcome.payload);
    return {
      status: outcome.status,
      payload: responseOf(requireIdentity(capture), stored),
      replayed: outcome.replayed,
      ...(capture.binding === undefined ? {} : { binding: capture.binding }),
    };
  }

  /**
   * Registration WITHOUT a proof (CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST, development/test on loopback only).
   * Nothing here requests, verifies, creates or consumes an OTP or a proof, and nothing pretends the phone was verified: the
   * user is TEST_UNVERIFIED with phone_verified_at NULL. The route stays the same and so do the executor, the password hash,
   * the repositories and the transaction; only the idempotency namespace, the user insert and the audit action are the branch's
   * own, so a record of this branch is never replayed by the REQUIRED or the legacy registration.
   *
   * The same device gate, consent comparison and replay semantics as the REQUIRED branch apply: ONE transaction claims the key,
   * creates the user (unique phone), CUSTOMER, profile v1 and consent, the session, the audit row and the outbox event, and
   * stores the encrypted result. A replay returns the ORIGINAL token and expiry with the CURRENT identity, and only while the
   * mode is still on, the user ACTIVE, ordinary and TEST_UNVERIFIED, and the session neither revoked nor expired.
   */
  async registerUnverifiedTest(
    input: ClientUnverifiedRegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    evidence?: NativeRequestEvidence,
  ): Promise<ClientRegisterOutcome> {
    // Staging fixture mode closes every registration, and this branch exists only while the server runs the validated
    // no-proof test policy: a process without it answers closed before the key is read, any hash or any database access.
    this.originPolicy.assertRegistrationOpen();
    if (this.settings.phoneVerificationMode !== 'DISABLED_TEST' || !this.originPolicy.unverifiedTestMode) {
      throw new AppError('AUTH_REGISTRATION_UNAVAILABLE');
    }
    return this.#registerWithoutProof(TEST_VARIANT, input, idempotencyKey, requestId, evidence);
  }

  /**
   * Registration WITHOUT a proof while the SYSTEM setting otp_registration_enabled is OFF (Owner decision 2026-10-14): the
   * account is created PHONE_UNVERIFIED (phone_verified_at stays NULL; nothing pretends the number was proven). The route and the
   * body are the ones of the test branch (no token, no flag); the SERVER decides, from the database, on every request:
   * the setting is read before anything is hashed and AGAIN inside the transaction of the first execution, so a switch back to ON
   * between the two refuses the registration (PHONE_VERIFICATION_REQUIRED) instead of creating an unproven account. A replay of an
   * already committed registration does not read the setting: it only needs the account and the session to be intact.
   */
  async registerUnverified(
    input: ClientUnverifiedRegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    evidence?: NativeRequestEvidence,
  ): Promise<ClientRegisterOutcome> {
    this.originPolicy.assertRegistrationOpen();
    if (this.settings.phoneVerificationMode === 'DISABLED_TEST' || this.systemSettings === undefined) {
      throw new AppError('AUTH_REGISTRATION_UNAVAILABLE');
    }
    if (await this.systemSettings.registrationOtpRequired()) {
      throw new AppError('PHONE_VERIFICATION_REQUIRED');
    }
    return this.#registerWithoutProof(SETTING_VARIANT, input, idempotencyKey, requestId, evidence);
  }

  async #registerWithoutProof(
    variant: NoProofVariant,
    input: ClientUnverifiedRegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    evidence?: NativeRequestEvidence,
  ): Promise<ClientRegisterOutcome> {
    assertDeviceAllowed(this.settings, input.device);
    parseIdempotencyKey(idempotencyKey);
    // ANDROID: the registration token and its signature are verified now, before any hash or write. A replay presents a fresh
    // proof for the same, already consumed, token.
    const proof: NativeAuthProof | undefined =
      input.device.platform === 'ANDROID' ? await this.#nativeProof(evidence, input.device.app, idempotencyKey) : undefined;

    const passwordHash = await this.hasher.hash(input.password);
    const capture: IdentityCapture = { identity: undefined };

    const outcome = await this.executor.execute(
      {
        scopeType: variant.scopeType,
        scopeId: noProofScopeId(variant.scopeNamespace, input.phoneNormalized),
        operationId: variant.operationId,
        idempotencyKey,
        // Every logical input plus the mode; the password is only HMAC-fingerprinted by the executor, never stored or logged.
        logicalRequest: {
          mode: variant.mode,
          phone_normalized: input.phoneNormalized,
          full_name: input.fullName,
          password: input.password,
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
            await this.#authorizeNoProofReplay(variant, context, guard, input, capture, proof);
            return true;
          },
        },
      },
      (context) => this.#registerNoProofNew(variant, context, { input, passwordHash, requestId, proof }, capture),
    );

    const stored = storedResultOf(outcome.payload);
    return {
      status: outcome.status,
      payload: responseOf(requireIdentity(capture), stored),
      replayed: outcome.replayed,
      ...(capture.binding === undefined ? {} : { binding: capture.binding }),
    };
  }

  /**
   * The answer when the phone already belongs to an APP_USER account: a locked account whose owner asked for its deletion is
   * recoverable (ACCOUNT_RECOVERY_AVAILABLE: the app opens the recovery flow, which always needs an OTP); every other case,
   * including an account locked for a violation or for security, is the plain PHONE_ALREADY_REGISTERED.
   */
  async #phoneTakenError(context: TransactionContext, phoneNormalized: string): Promise<AppError> {
    const existing = await this.users.findByPhone(context, 'APP_USER', phoneNormalized);
    return existing?.status === 'DISABLED' && existing.lockReason === 'DELETE_REQUEST'
      ? new AppError('ACCOUNT_RECOVERY_AVAILABLE')
      : new AppError('PHONE_ALREADY_REGISTERED');
  }

  async #nativeProof(
    evidence: NativeRequestEvidence | undefined,
    app: 'FOOD' | 'SHIP',
    idempotencyKey: string | readonly string[] | undefined,
  ): Promise<NativeAuthProof> {
    if (evidence === undefined) {
      throw new AppError('DEVICE_PROOF_REQUIRED');
    }
    return this.deviceProof.verifyAuthRequest(evidence, app, idempotencyKey);
  }

  async #registerNew(
    context: TransactionContext,
    args: { input: ClientRegisterInput; proofId: string; passwordHash: string; requestId: string; nativeProof: NativeAuthProof | undefined },
    capture: IdentityCapture,
  ) {
    const { input, proofId, passwordHash, requestId, nativeProof } = args;

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
      throw await this.#phoneTakenError(context, input.phoneNormalized);
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
    if (input.device.app === 'SHIP') {
      if (!this.drivers || !this.roleGrants || !this.wallets) throw new TechnicalError('internal', 'Shipper provisioning unavailable');
      const driverId = randomUUID();
      if (!(await this.drivers.insertPending(context, { driverId, userId, fullName: input.fullName, plateNumber: null }))) throw new TechnicalError('internal', 'Shipper already exists');
      await this.roleGrants.grant(context, userId, 'DRIVER');
      await this.wallets.ensureZeroWallet(context, driverId);
    }

    // 4b. Native: the one-use registration grant decides the binding (a new user can only start a NEW binding), before the session.
    const plan =
      nativeProof === undefined ? undefined : await this.deviceBinding.prepare(context, { userId, app: input.device.app, proof: nativeProof });

    // 5. The CUSTOMER session and its plaintext token (returned once, stored only as a digest). The context is chosen on
    // purpose here; the legacy default (a roleless session) is untouched.
    const session = await this.sessions.create(context, {
      userId,
      device: { deviceId: input.device.deviceId, platform: input.device.platform, app: input.device.app },
      ttlSeconds: this.config.sessionTtlSeconds,
      activeRole: input.device.app === 'SHIP' ? 'DRIVER' : CUSTOMER_ROLE,
    });
    if (plan !== undefined) {
      capture.binding = await this.deviceBinding.finish(context, plan, { userId, sessionId: session.sessionId });
    }

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
      storedActiveRole: input.device.app === 'SHIP' ? 'DRIVER' : CUSTOMER_ROLE,
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
    nativeProof: NativeAuthProof | undefined,
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
    // Native: the session must still be on the current binding, issued to the key that signs THIS replay.
    if (nativeProof !== undefined) {
      capture.binding = await this.deviceBinding.assertReplayable(context, { sessionId, proof: nativeProof });
    } else if (input.device.platform === 'ANDROID') {
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
  async #registerNoProofNew(
    variant: NoProofVariant,
    context: TransactionContext,
    args: { input: ClientUnverifiedRegisterInput; passwordHash: string; requestId: string; proof: NativeAuthProof | undefined },
    capture: IdentityCapture,
  ) {
    const { input, passwordHash, requestId, proof } = args;

    // 0. The SYSTEM switch is read AGAIN inside the transaction of the first execution (a replay never gets here): if SYSTEM turned
    // the OTP back on after the request was accepted, no unproven account is created.
    if (variant.mode === 'OTP_OFF' && this.systemSettings !== undefined && (await this.systemSettings.isEnabledIn(context, OTP_REGISTRATION_ENABLED))) {
      throw new AppError('PHONE_VERIFICATION_REQUIRED');
    }

    // 1. The consent pair of THIS first execution, compared before any row is written. A replay never gets here.
    const consent = assertConsentSupported(this.settings, input.consent);

    // 2. The TEST_UNVERIFIED user (phone_verified_at NULL; no proof exists or is invented). The UNIQUE phone constraint decides
    // a race with any other registration route.
    const userId = randomUUID();
    const insert = variant.origin === 'PHONE_UNVERIFIED' ? this.users.insertPhoneUnverified : this.users.insertUnverifiedTest;
    const created = await insert.call(this.users, context, {
      userId,
      phoneNormalized: input.phoneNormalized,
      passwordHash,
    });
    if (!created) {
      throw await this.#phoneTakenError(context, input.phoneNormalized);
    }

    // 3. CUSTOMER, the profile (normalized name, version 1) and the consent (database time) through the same participant, on THIS
    // transaction. Everything is new, so everything must have been created: anything else rolls the registration back.
    const provisioned = await this.customer.provision(
      context,
      userId,
      { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion, clientApp: input.device.app },
      { initialFullName: input.fullName },
    );
    if (!provisioned.roleGranted || !provisioned.profileCreated || !provisioned.consentRecorded) {
      throw new TechnicalError('internal', 'A new customer was not fully provisioned');
    }
    if (input.device.app === 'SHIP') {
      if (!this.drivers || !this.roleGrants || !this.wallets) throw new TechnicalError('internal', 'Shipper provisioning unavailable');
      const driverId = randomUUID();
      if (!(await this.drivers.insertPending(context, { driverId, userId, fullName: input.fullName, plateNumber: null }))) throw new TechnicalError('internal', 'Shipper already exists');
      await this.roleGrants.grant(context, userId, 'DRIVER');
      await this.wallets.ensureZeroWallet(context, driverId);
    }

    // 3b. Native: the one-use registration grant decides the binding (a new user can only start a NEW binding), before the session.
    const plan =
      proof === undefined
        ? undefined
        : await this.deviceBinding.prepare(context, { userId, app: input.device.app, proof });

    // 4. The CUSTOMER session and its plaintext token (returned once, stored only as a digest).
    const session = await this.sessions.create(context, {
      userId,
      device: { deviceId: input.device.deviceId, platform: input.device.platform, app: input.device.app },
      ttlSeconds: this.config.sessionTtlSeconds,
      activeRole: input.device.app === 'SHIP' ? 'DRIVER' : CUSTOMER_ROLE,
    });
    if (plan !== undefined) {
      capture.binding = await this.deviceBinding.finish(context, plan, { userId, sessionId: session.sessionId });
    }

    // 5. Audit (this branch's own action) and ONE outbox event with the approved payload, same transaction. Safe fields only:
    // no phone, name, password, proof or token.
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: variant.auditAction,
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

    // 6. The identity as it stands at commit, read in this very transaction (the user and session locks are held).
    capture.identity = await this.identityReader.read(context, {
      userId,
      phoneNormalized: input.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: input.device.app === 'SHIP' ? 'DRIVER' : CUSTOMER_ROLE,
    });

    return {
      status: 201,
      replayGuard: { user_id: userId, session_id: session.sessionId },
      payload: { access_token: session.accessToken, expires_at: new Date(session.expiresAtMs).toISOString() },
    };
  }

  /**
   * Replay authorization of the no-proof branch (contract11 section 5): user then session, the order of the first execution,
   * state read after the locks, read-only. The mode must STILL be on in this process (the origin policy refuses a
   * TEST_UNVERIFIED account otherwise), so turning the mode off, a revoked or expired session or a disabled user never returns
   * the token: AUTH_RESULT_NOT_REPLAYABLE, not distinguishable by cause.
   */
  async #authorizeNoProofReplay(
    variant: NoProofVariant,
    context: TransactionContext,
    guard: JsonObject,
    input: ClientUnverifiedRegisterInput,
    capture: IdentityCapture,
    proof: NativeAuthProof | undefined,
  ): Promise<void> {
    const { user_id: userId, session_id: sessionId } = guard;
    if (!isCanonicalUuid(userId) || !isCanonicalUuid(sessionId)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }

    const user = await this.users.lockById(context, userId);
    if (
      user === undefined ||
      user.status !== 'ACTIVE' ||
      user.accountOrigin !== variant.origin ||
      !this.originPolicy.allows({ accountOrigin: user.accountOrigin, phoneNormalized: user.phoneNormalized })
    ) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }
    const eligibility = await this.customers.lockEligibility(context, userId);
    if (eligibility === undefined || !isOrdinaryClientAccount(eligibility)) {
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
    // Native: the session must still be on the current binding, issued to the key that signs THIS replay.
    if (proof !== undefined) {
      capture.binding = await this.deviceBinding.assertReplayable(context, { sessionId, proof });
    } else if (input.device.platform === 'ANDROID') {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }

    capture.identity = await this.identityReader.read(context, {
      userId,
      phoneNormalized: user.phoneNormalized,
      app: input.device.app,
      enabled: true,
      storedActiveRole: session.activeRole,
    });
  }
}

interface NoProofVariant {
  readonly mode: 'DISABLED_TEST' | 'OTP_OFF';
  readonly origin: 'TEST_UNVERIFIED' | 'PHONE_UNVERIFIED';
  readonly scopeType: string;
  readonly operationId: string;
  readonly auditAction: string;
  readonly scopeNamespace: string;
}

const TEST_VARIANT: NoProofVariant = {
  mode: 'DISABLED_TEST',
  origin: 'TEST_UNVERIFIED',
  scopeType: CLIENT_REGISTER_UNVERIFIED_TEST_SCOPE_TYPE,
  operationId: CLIENT_REGISTER_UNVERIFIED_TEST_OPERATION_ID,
  auditAction: CLIENT_REGISTER_UNVERIFIED_TEST_AUDIT_ACTION,
  scopeNamespace: 'client.auth.register.unverified_test.phone.v1',
};

const SETTING_VARIANT: NoProofVariant = {
  mode: 'OTP_OFF',
  origin: 'PHONE_UNVERIFIED',
  scopeType: CLIENT_REGISTER_UNVERIFIED_SCOPE_TYPE,
  operationId: CLIENT_REGISTER_UNVERIFIED_OPERATION_ID,
  auditAction: CLIENT_REGISTER_UNVERIFIED_AUDIT_ACTION,
  scopeNamespace: 'client.auth.register.unverified.phone.v1',
};

function noProofScopeId(namespace: string, phoneNormalized: string): string {
  return createHash('sha256').update(`${namespace}\u0000${phoneNormalized}`, 'utf8').digest('hex');
}

/**
 * The stable server-side scope id of the no-proof registration: SHA-256 (hex, 64 characters, inside the 128 of the engine) of
 * the normalized phone under a namespace of its own. It is the same for every request for the same phone, so a retry with
 * the same key meets the same record, and it is not a user id the client could pick. The phone is no secret in this store
 * (app.users keeps it in plaintext); the namespace only keeps this scope disjoint from every other scope type.
 */
export function unverifiedTestScopeId(phoneNormalized: string): string {
  return createHash('sha256')
    .update(`client.auth.register.unverified_test.phone.v1\u0000${phoneNormalized}`, 'utf8')
    .digest('hex');
}
