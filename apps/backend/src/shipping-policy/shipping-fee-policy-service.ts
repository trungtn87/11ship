import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { assertParameterAccess, ParameterAccess } from '../system-settings/system-parameter-access';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { FeePolicy, MAX_DISTANCE_M, MAX_FEE_VND, MAX_TIERS, samePolicy } from './shipping-fee-policy';
import { evaluateQuote } from './shipping-fee-quote';
import { PolicyDraft, PolicyVersion, ShippingFeePolicyRepository } from './shipping-fee-policy-repository';
import { ApplyBody, PreviewBody, SaveDraftBody } from './shipping-fee-policy-validation';

const SAVE_DRAFT_OPERATION = 'admin.shipping_fee_policy.save_draft.v1';
const APPLY_OPERATION = 'admin.shipping_fee_policy.apply.v1';
const RESOURCE = 'shipping_fee_policy';
const HISTORY_LIMIT = 50;
const iso = (ms: number): string => new Date(ms).toISOString();

const policyView = (policy: FeePolicy): JsonObject => ({
  tiers: policy.tiers.map((t) => ({ from_m: t.fromM, to_m: t.toM, fee_vnd: t.feeVnd })),
  tail: { base_fee_vnd: policy.tail.baseFeeVnd, step_m: policy.tail.stepM, step_fee_vnd: policy.tail.stepFeeVnd },
});

const versionView = (v: PolicyVersion): JsonObject => ({ version_no: v.versionNo, ...policyView(v.policy), note: v.note, applied_by: v.appliedBy, applied_at: iso(v.appliedAtMs) });

const draftView = (d: PolicyDraft): JsonObject => ({
  version: d.version,
  ...(d.policy === null ? { tiers: null, tail: null } : policyView(d.policy)),
  updated_by: d.updatedBy,
  updated_at: iso(d.updatedAtMs),
});

/** `history` is left out of a write's answer (its stored replay is capped at 64 KB); the screen reads the whole state again. */
function state(active: PolicyVersion | undefined, draft: PolicyDraft, history: readonly PolicyVersion[] | null): JsonObject {
  return {
    active: active === undefined ? null : versionView(active),
    draft: draftView(draft),
    ...(history === null ? {} : { history: history.map(versionView) }),
    limits: { max_tiers: MAX_TIERS, max_fee_vnd: MAX_FEE_VND, max_distance_m: MAX_DISTANCE_M },
  };
}

/**
 * Cài đặt → Phí & điều kiện giao → Bảng giá ship (M06-A). Access is the rule of every system parameter: SYSTEM changes it, any live
 * ADMIN session reads and may preview (an ADMIN write gets ADMIN_FORBIDDEN, decided here under the actor's locks, not by the screen).
 *
 * A write is one transaction opened by the idempotency executor: record -> actor locks -> the one draft row FOR UPDATE -> version check ->
 * write -> audit (actor, time, what) -> outbox -> COMMIT. "Áp dụng" copies the saved draft into a NEW immutable version (the draft row's lock
 * serializes the numbering) and empties the draft. Versions are never edited, so a quote or order that stored its version number and fee
 * keeps both whatever the Admin does later. No fee is built in: with no applied version nothing is priced.
 */
@Injectable()
export class ShippingFeePolicyService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly policies: ShippingFeePolicyRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async read(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockActor(context, known, 'read');
      return this.#state(context);
    });
  }

  /** "Thử tính phí": prices a distance against the table in force or the one being edited. Writes nothing, stores nothing. */
  async preview(sessionToken: string | undefined, csrfHeader: unknown, body: PreviewBody): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockActor(context, known, 'read');
      const active = await this.policies.active(context);
      const snapshot = body.policy !== null ? { versionNo: 0, policy: body.policy } : active === undefined ? null : { versionNo: active.versionNo, policy: active.policy };
      const outcome = evaluateQuote(snapshot, body.distanceM);
      return {
        status: outcome.status,
        fee_vnd: outcome.feeVnd,
        distance_m: body.distanceM,
        based_on: body.policy !== null ? 'EDITING' : 'ACTIVE',
        ...(outcome.status === 'PRICED' ? { policy_version_no: body.policy !== null ? null : outcome.policyVersionNo, band: outcome.band } : { reason: outcome.reason }),
      };
    });
  }

  async saveDraft(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: SaveDraftBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: SAVE_DRAFT_OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, ...policyView(body.policy) },
        replay: this.#replay(known),
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        const draft = await this.policies.lockDraft(context);
        if (draft.version !== body.expectedVersion) {
          throw new AppError('SHIPPING_DRAFT_VERSION_CONFLICT');
        }
        await this.policies.writeDraft(context, body.policy, known.userId);
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: SAVE_DRAFT_OPERATION,
          resourceType: RESOURCE,
          resourceId: 'draft',
          resourceVersion: draft.version + 1,
          outcome: 'SUCCESS',
          metadata: { tier_count: body.policy.tiers.length, draft_version: draft.version + 1 },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#state(context, false) };
      },
    );
  }

  async apply(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: ApplyBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: APPLY_OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, note: body.note },
        replay: this.#replay(known),
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        const draft = await this.policies.lockDraft(context);
        if (draft.version !== body.expectedVersion) {
          throw new AppError('SHIPPING_DRAFT_VERSION_CONFLICT');
        }
        if (draft.policy === null) {
          throw new AppError('SHIPPING_DRAFT_EMPTY');
        }
        const before = await this.policies.active(context);
        if (before !== undefined && samePolicy(before.policy, draft.policy)) {
          throw new AppError('SHIPPING_POLICY_UNCHANGED');
        }
        const created = await this.policies.insertVersion(context, {
          versionId: randomUUID(),
          policy: draft.policy,
          note: body.note,
          actorUserId: known.userId,
          requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
        });
        await this.policies.writeDraft(context, null, known.userId);
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: APPLY_OPERATION,
          resourceType: RESOURCE,
          resourceId: created.versionId,
          resourceVersion: created.versionNo,
          outcome: 'SUCCESS',
          metadata: { version_no: created.versionNo, previous_version_no: before?.versionNo ?? 0, tier_count: created.policy.tiers.length },
        });
        await this.outbox.append(context, {
          eventType: 'shipping.fee_policy.applied.v1',
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: created.versionId,
          resourceVersion: created.versionNo,
          payload: { version_no: created.versionNo },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#state(context, false) };
      },
    );
  }

  async #state(context: TransactionContext, withHistory = true): Promise<JsonObject> {
    return state(await this.policies.active(context), await this.policies.readDraft(context), withHistory ? await this.policies.history(context, HISTORY_LIMIT) : null);
  }

  #replay(known: SessionLookup) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (guard.actor_user_id !== known.userId) {
          throw new AppError('ADMIN_SESSION_INVALID');
        }
        await this.#lockActor(context, known, 'write');
        return true;
      },
    };
  }

  /** The administration actor under the module's locks, the database clock read after them, then the parameter access rule. */
  async #lockActor(context: TransactionContext, known: SessionLookup, access: ParameterAccess): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    assertParameterAccess(this.actor, locked, nowMs, access);
    return locked;
  }
}
