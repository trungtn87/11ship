import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminCrypto } from '../admin-auth/admin-crypto';
import { ADMIN_LIMITER_KEY } from '../admin-auth/admin-limiter';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminInvitationParticipant } from '../admin-invitations/admin-invitation-participant';
import { InvitationPermission } from '../admin-invitations/admin-invitation-repository';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { generateToken } from '../auth/tokens';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminAuthConfig, AdminLimiterKey } from '../config/admin-auth-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminInvitationReader, InvitationDetail } from './admin-invitation-reader';
import { AdminOperationRepository, OperationRow } from './admin-operation-repository';
import { operationBindingHolds } from './admin-operation-service';
import {
  ACTOR_TYPE_SYSTEM,
  INVITATION_DEDUPE_SECONDS,
  INVITATION_REPLAY_SECONDS,
  OperationAction,
  PROVISIONING_AUDIT_ACTIONS,
  PROVISIONING_OPERATION_IDS,
  PROVISIONING_SCOPE_TYPE,
  RESOURCE_INVITATION,
} from './admin-provisioning-constants';
import { lockPhone, setBusinessLockTimeout } from './admin-provisioning-locks';
import {
  canonicalPayload,
  CreatePayload,
  encodeCursor,
  ListQuery,
  ReissuePayload,
  RevokePayload,
} from './admin-provisioning-validation';
import {
  activationLink,
  createdInvitationView,
  invitationListItemView,
  invitationView,
  permissionsAudit,
} from './admin-provisioning-views';
import { AdminSystemActor, LockedActor } from './admin-system-actor';

type ReplayKind = 'create' | 'reissue' | 'revoke';

/**
 * ADMIN invitations by the SYSTEM administrator (contract sections 6.6-6.9 and 8.4). create / reissue / revoke run in ONE
 * transaction opened by the idempotency executor: L1 (advisory + record) -> L3 phone -> L4 users X -> L5 membership X ->
 * L6 factor S -> L7 session S -> L8 invitation X -> L9 operation X -> database clock -> checks (authz > step-up >
 * business) -> writes -> audit -> the executor's record -> COMMIT. Any error rolls everything back, the operation
 * stays VERIFIED and the Idempotency-Key is not consumed. The executor never runs the callback twice.
 */
@Injectable()
export class AdminInvitationService {
  readonly #lockTimeoutMs: number;
  readonly #ttlSeconds: number;
  readonly #activationOrigin: string;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly invitations: AdminInvitationParticipant,
    private readonly reader: AdminInvitationReader,
    private readonly operations: AdminOperationRepository,
    private readonly identities: AdminIdentityParticipant,
    private readonly crypto: AdminCrypto,
    private readonly audit: AuditWriter,
    @Inject(ADMIN_LIMITER_KEY) private readonly limiterKey: AdminLimiterKey,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Inject(ADMIN_AUTH_CONFIG) adminConfig: AdminAuthConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
    this.#ttlSeconds = adminConfig.invitationTtlSeconds;
    this.#activationOrigin = adminConfig.activationOrigin;
  }

  // ----- create (6.6, 8.4.1) -------------------------------------------------------------------------------------

  async create(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    input: { operationId: string; payload: CreatePayload },
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const canonical = canonicalPayload({ action: 'CREATE_INVITATION', payload: input.payload });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: PROVISIONING_OPERATION_IDS.create,
        idempotencyKey,
        logicalRequest: { operation_id: input.operationId, payload: canonical },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, 'create') },
        ttl: { replaySeconds: INVITATION_REPLAY_SECONDS, dedupeSeconds: INVITATION_DEDUPE_SECONDS },
      },
      async (context) => {
        const payload = input.payload;
        await lockPhone(context, this.limiterKey, payload.phone);
        const actor = await this.actor.lock(context, known, { user: 'write', factor: 'read' });
        const pending = await this.invitations.lockPendingByPhone(context, payload.phone);
        const operation = await this.operations.lock(context, input.operationId, known.userId);
        const nowMs = await freshClockMs(context);
        this.actor.assertLive(actor, nowMs);
        this.#assertUsable(operation, actor, 'CREATE_INVITATION', null, null, canonical, nowMs);

        if (pending !== undefined) {
          if (nowMs < pending.expiresAtMs) {
            throw new AppError('ADMIN_INVITATION_PENDING_EXISTS');
          }
          // Expired but not yet terminal: it still holds the one-PENDING-per-phone index, so it is closed first.
          const version = await this.invitations.transition(context, pending.invitationId, pending.version, { to: 'EXPIRED' });
          if (version === undefined) {
            throw new TechnicalError('internal', 'Locked pending invitation could not be expired');
          }
          await this.#audit(context, meta, known.userId, PROVISIONING_AUDIT_ACTIONS.expired, pending.invitationId, version, {
            invitation_id: pending.invitationId,
            version,
          });
        }
        if ((await this.identities.findByPhone(context, payload.phone)) !== undefined) {
          throw new AppError('ADMIN_PHONE_CONFLICT');
        }

        const created = await this.#insertInvitation(context, known.userId, {
          phone: payload.phone,
          fullName: payload.fullName,
          note: payload.note,
          permissions: payload.permissions,
        });
        await this.#consume(context, input.operationId);
        await this.#audit(context, meta, known.userId, PROVISIONING_AUDIT_ACTIONS.created, created.detail.invitationId, 1, {
          invitation_id: created.detail.invitationId,
          generation_id: created.detail.generationId,
          version: 1,
          operation_id: input.operationId,
          permissions: permissionsAudit(payload.permissions),
        });
        return {
          status: 201,
          replayGuard: { actor_user_id: known.userId, invitation_id: created.detail.invitationId, kind: 'create' },
          payload: {
            invitation: createdInvitationView(created.detail, payload.permissions),
            activation_link: created.link,
          },
        };
      },
    );
  }

  // ----- reissue (6.8, 8.4.2) ------------------------------------------------------------------------------------

  async reissue(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    input: { operationId: string; payload: ReissuePayload },
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const payload = input.payload;
    const phone = await this.#authorizeAndTargetPhone(known, payload.invitationId);
    const canonical = canonicalPayload({ action: 'REISSUE_INVITATION', payload });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: PROVISIONING_OPERATION_IDS.reissue,
        idempotencyKey,
        logicalRequest: { operation_id: input.operationId, payload: canonical },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, 'reissue') },
        ttl: { replaySeconds: INVITATION_REPLAY_SECONDS, dedupeSeconds: INVITATION_DEDUPE_SECONDS },
      },
      async (context) => {
        await lockPhone(context, this.limiterKey, phone);
        const actor = await this.actor.lock(context, known, { user: 'write', factor: 'read' });
        const old = await this.invitations.lock(context, payload.invitationId);
        const operation = await this.operations.lock(context, input.operationId, known.userId);
        const nowMs = await freshClockMs(context);
        this.actor.assertLive(actor, nowMs);
        this.#assertUsable(
          operation,
          actor,
          'REISSUE_INVITATION',
          payload.invitationId,
          payload.expectedVersion,
          canonical,
          nowMs,
        );
        if (old === undefined) {
          throw new AppError('ADMIN_INVITATION_NOT_FOUND');
        }
        // Q2: only a PENDING invitation is reissued, also one that is already past expires_at.
        if (old.status !== 'PENDING') {
          throw new AppError('ADMIN_INVITATION_NOT_PENDING');
        }
        if (old.version !== payload.expectedVersion) {
          throw new AppError('ADMIN_VERSION_CONFLICT');
        }
        if (old.phoneNormalized !== phone) {
          throw new TechnicalError('internal', 'Invitation phone changed although it is immutable');
        }
        if ((await this.identities.findByPhone(context, phone)) !== undefined) {
          throw new AppError('ADMIN_PHONE_CONFLICT');
        }
        const oldDetail = await this.reader.read(context, payload.invitationId);
        if (oldDetail === undefined) {
          throw new TechnicalError('internal', 'Locked invitation is missing');
        }
        // Q1: absent -> the old sealed snapshot (immutable, so a plain read is exact); present -> the new snapshot.
        const permissions = payload.permissions ?? (await this.reader.permissions(context, payload.invitationId));

        const newId = randomUUID();
        // The OLD row becomes terminal FIRST (deferred successor FK), then the successor PENDING is inserted.
        const superseded = await this.invitations.transition(context, payload.invitationId, old.version, {
          to: 'SUPERSEDED',
          successorId: newId,
        });
        if (superseded === undefined) {
          throw new AppError('ADMIN_VERSION_CONFLICT');
        }
        const created = await this.#insertInvitation(
          context,
          known.userId,
          { phone, fullName: oldDetail.fullName, note: oldDetail.note, permissions },
          newId,
        );
        await this.#consume(context, input.operationId);
        await this.#audit(context, meta, known.userId, PROVISIONING_AUDIT_ACTIONS.reissued, newId, 1, {
          invitation_id: newId,
          superseded_invitation_id: payload.invitationId,
          operation_id: input.operationId,
          reason: payload.reason,
          permissions_source: payload.permissions === null ? 'COPIED' : 'PROVIDED',
          permissions: permissionsAudit(permissions),
        });
        return {
          status: 201,
          replayGuard: { actor_user_id: known.userId, invitation_id: newId, kind: 'reissue' },
          payload: {
            invitation: createdInvitationView(created.detail, permissions),
            superseded_invitation_id: payload.invitationId,
            activation_link: created.link,
          },
        };
      },
    );
  }

  // ----- revoke (6.9, 8.4.3) -------------------------------------------------------------------------------------

  async revoke(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    input: { operationId: string; payload: RevokePayload },
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const payload = input.payload;
    const phone = await this.#authorizeAndTargetPhone(known, payload.invitationId);
    const canonical = canonicalPayload({ action: 'REVOKE_INVITATION', payload });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: PROVISIONING_OPERATION_IDS.revoke,
        idempotencyKey,
        logicalRequest: { operation_id: input.operationId, payload: canonical },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, 'revoke') },
        ttl: { replaySeconds: INVITATION_REPLAY_SECONDS, dedupeSeconds: INVITATION_DEDUPE_SECONDS },
      },
      async (context) => {
        await lockPhone(context, this.limiterKey, phone);
        const actor = await this.actor.lock(context, known, { user: 'write', factor: 'read' });
        const old = await this.invitations.lock(context, payload.invitationId);
        const operation = await this.operations.lock(context, input.operationId, known.userId);
        const nowMs = await freshClockMs(context);
        this.actor.assertLive(actor, nowMs);
        this.#assertUsable(
          operation,
          actor,
          'REVOKE_INVITATION',
          payload.invitationId,
          payload.expectedVersion,
          canonical,
          nowMs,
        );
        if (old === undefined) {
          throw new AppError('ADMIN_INVITATION_NOT_FOUND');
        }
        // Owner decision: revoke only a PENDING invitation, also one that is already past expires_at.
        if (old.status !== 'PENDING') {
          throw new AppError('ADMIN_INVITATION_NOT_PENDING');
        }
        if (old.version !== payload.expectedVersion) {
          throw new AppError('ADMIN_VERSION_CONFLICT');
        }
        const version = await this.invitations.transition(context, payload.invitationId, old.version, { to: 'REVOKED' });
        if (version === undefined) {
          throw new AppError('ADMIN_VERSION_CONFLICT');
        }
        await this.#consume(context, input.operationId);
        await this.#audit(context, meta, known.userId, PROVISIONING_AUDIT_ACTIONS.revoked, payload.invitationId, version, {
          invitation_id: payload.invitationId,
          version,
          operation_id: input.operationId,
          reason: payload.reason,
        });
        const detail = await this.reader.read(context, payload.invitationId);
        if (detail === undefined) {
          throw new TechnicalError('internal', 'Revoked invitation is missing');
        }
        const permissions = await this.reader.permissions(context, payload.invitationId);
        return {
          status: 200,
          replayGuard: { actor_user_id: known.userId, invitation_id: payload.invitationId, kind: 'revoke' },
          payload: { invitation: invitationView(detail, permissions, nowMs) },
        };
      },
    );
  }

  // ----- reads (6.7, 6.9, 8.3.3) ---------------------------------------------------------------------------------

  async get(sessionToken: string | undefined, invitationId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const detail = await this.reader.lockShared(context, invitationId);
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);
      if (detail === undefined) {
        throw new AppError('ADMIN_INVITATION_NOT_FOUND');
      }
      const permissions = await this.reader.permissions(context, invitationId);
      return { invitation: invitationView(detail, permissions, nowMs), activation: { state: 'NONE' } };
    });
  }

  async list(sessionToken: string | undefined, query: ListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);
      const rows = await this.reader.list(context, query);
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(invitationListItemView),
        next_cursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ createdAtMs: last.createdAtMs, invitationId: last.invitationId })
            : null,
      };
    });
  }

  // ----- shared steps ---------------------------------------------------------------------------------------------

  /**
   * Finding (review of #41 at ad9b092): the target lookup of reissue/revoke must not answer an ADMIN-role (or an
   * otherwise invalid) session with a NOT_FOUND that reveals whether an invitation id exists. So, BEFORE the lookup,
   * a separate read-only authorization transaction runs the full actor check under shared locks in the module order
   * (L4 users S -> L5 membership S -> L6 factor S -> L7 session S, lock_timeout first), reads the database clock after
   * those locks and requires a live SYSTEM session (assertLive): ADMIN -> 403 ADMIN_FORBIDDEN, expired / revoked /
   * factor or membership drift -> 401 ADMIN_SESSION_INVALID, for an existing and an unknown id alike. Only then is
   * the IMMUTABLE phone read (plain SELECT, no lock) to derive the L3 key; an unknown id is then 404. The transaction
   * ends (read-only commit) before the coordinator starts, so no actor lock is ever held while L1/L3 are acquired; the
   * coordinator and the replay hook repeat the authoritative actor check under their own locks.
   */
  async #authorizeAndTargetPhone(known: SessionLookup, invitationId: string): Promise<string> {
    const phone = await this.transactions.withTransaction(async (context): Promise<string | undefined> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(actor, nowMs);
      return this.reader.peekPhone(context, invitationId);
    });
    if (phone === undefined) {
      throw new AppError('ADMIN_INVITATION_NOT_FOUND');
    }
    return phone;
  }

  /** Contract 7.3: the operation is usable for exactly this request, by the database clock read after the last lock. */
  #assertUsable(
    operation: OperationRow | undefined,
    actor: LockedActor,
    action: OperationAction,
    targetId: string | null,
    expectedVersion: number | null,
    canonical: JsonObject,
    nowMs: number,
  ): void {
    if (
      operation === undefined ||
      operation.status !== 'VERIFIED' ||
      nowMs >= operation.expiresAtMs ||
      operation.action !== action ||
      operation.targetId !== targetId ||
      operation.expectedVersion !== expectedVersion ||
      !operationBindingHolds(operation, actor)
    ) {
      throw new AppError('ADMIN_STEP_UP_REQUIRED');
    }
    const matches = this.crypto.operationFingerprintMatches({
      keyId: operation.fingerprintKeyId,
      action,
      canonicalPayload: canonical,
      stored: operation.payloadFingerprint,
    });
    if (!matches) {
      throw new AppError('ADMIN_STEP_UP_REQUIRED');
    }
  }

  /** VERIFIED -> CONSUMED in the mutation's transaction; a row past expires_at by the statement clock does not match. */
  async #consume(context: TransactionContext, operationId: string): Promise<void> {
    if (!(await this.operations.consume(context, operationId))) {
      throw new AppError('ADMIN_STEP_UP_REQUIRED');
    }
  }

  async #insertInvitation(
    context: TransactionContext,
    createdBy: string,
    input: { phone: string; fullName: string; note: string | null; permissions: readonly InvitationPermission[] },
    invitationId: string = randomUUID(),
  ): Promise<{ detail: InvitationDetail; link: string }> {
    // 32 CSPRNG bytes through the administration crypto (a failing RNG is a 503, never a weaker token).
    const token = generateToken((size) => this.crypto.randomBytes(size));
    await this.invitations.create(context, {
      invitationId,
      generationId: randomUUID(),
      phoneNormalized: input.phone,
      fullName: input.fullName,
      note: input.note,
      tokenDigest: token.digest,
      createdBy,
      ttlSeconds: this.#ttlSeconds,
      permissions: input.permissions,
    });
    const detail = await this.reader.read(context, invitationId);
    if (detail === undefined) {
      throw new TechnicalError('internal', 'Invitation was not written');
    }
    return { detail, link: activationLink(this.#activationOrigin, token.token) };
  }

  async #audit(
    context: TransactionContext,
    meta: { requestId: string },
    actorId: string,
    action: string,
    invitationId: string,
    version: number,
    metadata: JsonObject,
  ): Promise<void> {
    await this.audit.append(context, {
      requestId: meta.requestId,
      actorType: ACTOR_TYPE_SYSTEM,
      actorId,
      action,
      resourceType: RESOURCE_INVITATION,
      resourceId: invitationId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata,
    });
  }

  /**
   * Sensitive replay (9.3, F2). Same context as the executor, read-only, LOCK BEFORE READ, and nothing is decrypted
   * unless this resolves to true: the current session must still be a live SYSTEM session of the same actor, and for
   * create/reissue the invitation behind the stored link must still be PENDING and before its expires_at, by the
   * database clock read after these locks. Otherwise 409 ADMIN_INVITATION_NOT_REPLAYABLE, before any decryption.
   */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, kind: ReplayKind): Promise<true> {
    const invitationId = guard.invitation_id;
    if (guard.actor_user_id !== known.userId || guard.kind !== kind || !isCanonicalUuid(invitationId)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    const actor = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const invitation = kind === 'revoke' ? undefined : await this.reader.lockShared(context, invitationId);
    const nowMs = await freshClockMs(context);
    this.actor.assertLive(actor, nowMs);
    if (kind !== 'revoke' && (invitation === undefined || invitation.status !== 'PENDING' || nowMs >= invitation.expiresAtMs)) {
      throw new AppError('ADMIN_INVITATION_NOT_REPLAYABLE');
    }
    return true;
  }
}
