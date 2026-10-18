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
import { EligibilityChange, EligibilityParameters, EligibilityParametersRepository, EligibilityValues } from './eligibility-parameters-repository';
import { SHIPPER_SEARCH_RADIUS_M } from './shipping-eligibility';
import { SaveEligibilityBody } from './shipping-eligibility-policy-validation';

const OPERATION = 'admin.shipping_eligibility_policy.update.v1';
const RESOURCE = 'shipping_eligibility_policy';
const HISTORY_LIMIT = 30;
const iso = (ms: number): string => new Date(ms).toISOString();

const valuesView = (v: EligibilityValues): JsonObject => ({
  external_max_deliveries: v.externalMaxDeliveries,
  batch_max_delay_seconds: v.batchMaxDelaySeconds,
  pickup_service_seconds: v.pickupServiceSeconds,
  handoff_service_seconds: v.handoffServiceSeconds,
});

function view(p: EligibilityParameters, history: readonly EligibilityChange[]): JsonObject {
  return {
    version: p.version,
    ...valuesView(p),
    updated_by: p.updatedBy,
    updated_at: iso(p.updatedAtMs),
    // Fixed rules of the approved design, shown but never editable: the radius is not a setting, PLATFORM has no count limit.
    fixed: { search_radius_m: SHIPPER_SEARCH_RADIUS_M, platform_unlimited: true },
    history: history.map((c) => ({ version_after: c.versionAfter, old: valuesView(c.oldValues), new: valuesView(c.newValues), changed_by: c.changedBy, changed_at: iso(c.changedAtMs) })),
  };
}

const same = (a: EligibilityValues, b: EligibilityValues): boolean =>
  a.externalMaxDeliveries === b.externalMaxDeliveries && a.batchMaxDelaySeconds === b.batchMaxDelaySeconds && a.pickupServiceSeconds === b.pickupServiceSeconds && a.handoffServiceSeconds === b.handoffServiceSeconds;

/**
 * Cài đặt → Phí & điều kiện giao → Điều kiện nhận & ghép (M06-B/C). The rule of every system parameter: SYSTEM changes, any live ADMIN reads
 * (decided here under the actor's locks, never by the screen). One transaction: record -> actor locks -> the one row FOR UPDATE -> version
 * check -> write -> change log (old, new, actor, time) -> audit -> outbox. A change applies to the NEXT check; it never touches a delivery
 * already accepted (their ETA is M07's and immutable).
 */
@Injectable()
export class ShippingEligibilityPolicyService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly parameters: EligibilityParametersRepository,
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
      return view(await this.parameters.read(context), await this.parameters.recentChanges(context, HISTORY_LIMIT));
    });
  }

  async update(sessionToken: string | undefined, csrfHeader: unknown, body: SaveEligibilityBody, idempotencyKey: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, ...valuesView(body.values) },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#lockActor(context, known, 'write');
            return true;
          },
        },
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        const current = await this.parameters.lock(context);
        if (current.version !== body.expectedVersion) {
          throw new AppError('SHIPPING_ELIGIBILITY_VERSION_CONFLICT');
        }
        if (!same(current, body.values)) {
          await this.parameters.write(context, body.values, known.userId);
          await this.parameters.appendChange(context, {
            changeId: randomUUID(),
            versionAfter: current.version + 1,
            oldValues: current,
            newValues: body.values,
            actorUserId: known.userId,
            requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: OPERATION,
            resourceType: RESOURCE,
            resourceId: 'parameters',
            resourceVersion: current.version + 1,
            outcome: 'SUCCESS',
            metadata: {
              from_external_max: current.externalMaxDeliveries,
              to_external_max: body.values.externalMaxDeliveries,
              from_delay_seconds: current.batchMaxDelaySeconds,
              to_delay_seconds: body.values.batchMaxDelaySeconds,
              from_pickup_seconds: current.pickupServiceSeconds,
              to_pickup_seconds: body.values.pickupServiceSeconds,
              from_handoff_seconds: current.handoffServiceSeconds,
              to_handoff_seconds: body.values.handoffServiceSeconds,
            },
          });
          await this.outbox.append(context, {
            eventType: 'shipping.eligibility_policy.changed.v1',
            eventSchemaVersion: 1,
            resourceType: RESOURCE,
            resourceId: 'parameters',
            resourceVersion: current.version + 1,
            payload: { version: current.version + 1 },
          });
        }
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(await this.parameters.read(context), await this.parameters.recentChanges(context, HISTORY_LIMIT)) };
      },
    );
  }

  async #lockActor(context: TransactionContext, known: SessionLookup, access: ParameterAccess): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    assertParameterAccess(this.actor, locked, nowMs, access);
    return locked;
  }
}
