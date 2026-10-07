import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig } from '../config/auth-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  AUDIT_ACTIONS,
  REGISTER_OPERATION_ID,
  REGISTER_PURPOSE,
  REGISTER_SCOPE_TYPE,
  USER_REGISTERED_EVENT_SCHEMA_VERSION,
  USER_REGISTERED_EVENT_TYPE,
} from './auth-constants';
import { AUTH_CONFIG } from './auth-config.provider';
import { RegisterInput } from './auth-validation';
import { PASSWORD_HASHER, PasswordHasher } from './password-hasher';
import { ProofRepository } from './proof-repository';
import { SessionRepository } from './session-repository';
import { digestToken, parseCanonicalToken } from './tokens';
import { UserRepository } from './user-repository';

export interface RegisterOutcome {
  readonly status: number;
  readonly payload: unknown;
  readonly replayed: boolean;
}

/**
 * Roleless registration through the M00-C1 IdempotencyExecutor (task section 9, ADR-003 13.2).
 *
 * Order of events:
 *  1. cheap refusals (Idempotency-Key shape, proof token shape);
 *  2. resolve the proof IDENTITY from its token digest, applying no state check (so a changed retry still
 *     meets the idempotency fingerprint before any business rule answers);
 *  3. hash the password OUTSIDE any transaction (a replay may waste one hash; holding database locks around
 *     Argon2 would be worse);
 *  4. execute: advisory lock + record lock (M00), then the callback under the proof row lock.
 * Register never creates a role and never reads a role, driver type or privilege from the request.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly proofs: ProofRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async register(
    input: RegisterInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<RegisterOutcome> {
    // The executor validates the key again; doing it first only avoids a database round trip and an Argon2
    // hash for a request that can never succeed.
    parseIdempotencyKey(idempotencyKey);

    const token = parseCanonicalToken(input.verificationToken);
    if (token === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const tokenDigest = digestToken(token);
    const proofId = await this.transactions.withTransaction((context) =>
      this.proofs.findIdByDigest(context, tokenDigest),
    );
    if (proofId === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }

    const passwordHash = await this.hasher.hash(input.password);

    const outcome = await this.executor.execute(
      {
        scopeType: REGISTER_SCOPE_TYPE,
        scopeId: proofId,
        operationId: REGISTER_OPERATION_ID,
        idempotencyKey,
        // Exactly the validated request. The password keeps its original semantics; the executor only
        // HMAC-fingerprints this object, it is never stored or logged.
        logicalRequest: {
          phone_normalized: input.phoneNormalized,
          password: input.password,
          verification_token: token,
          device: {
            device_id: input.device.deviceId,
            platform: input.device.platform,
            app: input.device.app,
          },
        },
        replay: {
          kind: 'sensitive',
          authorize: (context, guard) => this.#authorizeReplay(context, guard),
        },
      },
      (context) => this.#registerNew(context, { input, proofId, passwordHash, requestId }),
    );

    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async #registerNew(
    context: TransactionContext,
    args: { input: RegisterInput; proofId: string; passwordHash: string; requestId: string },
  ) {
    const { input, proofId, passwordHash, requestId } = args;

    // 1. Proof row lock, then the clock (after the lock).
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

    // 2. The user. The UNIQUE phone constraint decides a race between two valid proofs.
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

    // 3. The roleless session and its plaintext token (returned once, stored only as a digest).
    const session = await this.sessions.create(context, {
      userId,
      device: input.device,
      ttlSeconds: this.config.sessionTtlSeconds,
    });

    // 4. Audit and outbox in the same transaction. Safe fields only.
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: AUDIT_ACTIONS.register,
      resourceType: 'user',
      resourceId: userId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { session_id: session.sessionId },
    });
    await this.outbox.append(context, {
      eventType: USER_REGISTERED_EVENT_TYPE,
      eventSchemaVersion: USER_REGISTERED_EVENT_SCHEMA_VERSION,
      resourceType: 'user',
      resourceId: userId,
      resourceVersion: 1,
      payload: { user_id: userId },
    });

    return {
      status: 201,
      replayGuard: { proof_id: proofId, user_id: userId, session_id: session.sessionId },
      payload: {
        user_id: userId,
        phone_normalized: input.phoneNormalized,
        available_roles: [],
        active_role: null,
        onboarding_required: true,
        access_token: session.accessToken,
      },
    };
  }

  /**
   * Replay authorization (task section 9.4). Same TransactionContext as the executor; locks proof, user and
   * session IN THAT ORDER, reads the state after the locks and stays read-only. Natural expiry of the proof
   * does NOT deny a committed replay. Only after this resolves to true does M00 decrypt the stored result.
   */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject): Promise<true> {
    const { proof_id: proofId, user_id: userId, session_id: sessionId } = guard;
    if (!isCanonicalUuid(proofId) || !isCanonicalUuid(userId) || !isCanonicalUuid(sessionId)) {
      // A guard we did not write: fail closed, nothing is decrypted.
      throw new TechnicalError('internal', 'Invalid replay guard');
    }

    const proof = await this.proofs.lockForReplay(context, proofId);
    if (proof === undefined || proof.invalidated) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const user = await this.users.lockById(context, userId);
    if (user === undefined || user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED');
    }
    const session = await this.sessions.lockById(context, sessionId);
    if (session === undefined || session.userId !== userId || session.revoked) {
      throw new AppError('SESSION_REVOKED');
    }
    const nowMs = await freshClockMs(context);
    if (session.expiresAtMs <= nowMs) {
      throw new AppError('SESSION_EXPIRED');
    }
    return true;
  }
}
