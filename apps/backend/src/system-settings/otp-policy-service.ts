import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { OTP_POLICY_BOUNDS, OTP_POLICY_KEYS, OtpPolicy, OtpPolicyChange, OtpPolicyRepository } from '../auth/otp-policy-repository';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { OtpPolicyBody } from './otp-policy-validation';
import { assertParameterAccess, ParameterAccess } from './system-parameter-access';

export const OTP_POLICY_OPERATION = 'admin.otp_policy.update.v1';
const RESOURCE = 'otp_policy';
const HISTORY_LIMIT = 20;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Hệ thống › Tham số › SMS & OTP (issue #117): the six limits of the OTP SMS flow. Same rule as every system parameter: SYSTEM changes
 * them, any administrator reads them (an ADMIN write is ADMIN_FORBIDDEN, decided under the actor's locks on every call). The values
 * live in PostgreSQL and are read by every OTP request, so a save is in force for the next request without a restart. One transaction
 * opened by the idempotency executor: record -> actor locks -> policy row FOR UPDATE -> version check -> write -> history (before,
 * after, actor, reason) -> audit -> COMMIT. A second session that saved in between is a version conflict, never a silent overwrite.
 */
@Injectable()
export class OtpPolicyService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly policy: OtpPolicyRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async read(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const locked = await this.#lockActor(context, known, 'read');
      return view(await this.policy.read(context), await this.policy.recentChanges(context, HISTORY_LIMIT), locked.checked.membership.adminRole === 'SYSTEM');
    });
  }

  async update(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: OtpPolicyBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OTP_POLICY_OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, ...body.values, reason: body.reason },
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
        const current = await this.policy.lock(context);
        if (current.version !== body.expectedVersion) {
          throw new AppError('OTP_POLICY_VERSION_CONFLICT');
        }
        const changedKeys = OTP_POLICY_KEYS.filter((key) => current.values[key] !== body.values[key]);
        if (changedKeys.length > 0) {
          await this.policy.write(context, body.values, known.userId);
          await this.policy.appendChange(context, {
            changeId: randomUUID(),
            version: current.version + 1,
            oldValues: current.values,
            newValues: body.values,
            reason: body.reason,
            actorUserId: known.userId,
            requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: OTP_POLICY_OPERATION,
            resourceType: RESOURCE,
            resourceId: 'otp_policy',
            resourceVersion: current.version + 1,
            outcome: 'SUCCESS',
            metadata: {
              from_values: { ...current.values },
              to_values: { ...body.values },
              changed_keys: [...changedKeys],
              ...(body.reason === null ? {} : { reason: body.reason }),
            },
          });
        }
        const after = await this.policy.read(context);
        const history = await this.policy.recentChanges(context, HISTORY_LIMIT);
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { ...view(after, history, true), changed_keys: [...changedKeys] } };
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

function view(current: OtpPolicy, history: readonly OtpPolicyChange[], editable: boolean): JsonObject {
  const bounds: JsonObject = {};
  const defaults: JsonObject = {};
  for (const key of OTP_POLICY_KEYS) {
    bounds[key] = { min: OTP_POLICY_BOUNDS[key].min, max: OTP_POLICY_BOUNDS[key].max };
    defaults[key] = OTP_POLICY_BOUNDS[key].default;
  }
  return {
    version: current.version,
    ...current.values,
    bounds,
    defaults,
    editable,
    updated_at: iso(current.updatedAtMs),
    updated_by: current.updatedBy,
    history: history.map((change) => ({
      change_id: change.changeId,
      version: change.version,
      old_values: { ...change.oldValues },
      new_values: { ...change.newValues },
      reason: change.reason,
      changed_by: change.changedBy,
      changed_at: iso(change.changedAtMs),
    })),
  };
}
