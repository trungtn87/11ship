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
import { FEE_ANSWER_MINUTES_KEY, OrderParameter, OrderParameterChange, OrderParametersRepository } from './fee-answer-parameter';
import { OrderParametersBody } from './order-parameters-validation';

export const ORDER_PARAMETERS_OPERATION = 'admin.order_parameters.update.v1';
const RESOURCE = 'order_parameter';
const HISTORY_LIMIT = 30;
const iso = (ms: number): string => new Date(ms).toISOString();
const groupVersion = (rows: readonly OrderParameter[]): number => rows.reduce((sum, row) => sum + row.version, 0);

/**
 * Cài đặt → Đơn hàng → "Thời gian trả lời đề xuất phí" (minutes). SYSTEM changes it, any ADMIN reads it (system-settings/system-parameter-access.ts, the rule of
 * every system parameter): the role is checked under the actor's locks on every read AND write, so an ADMIN write is ADMIN_FORBIDDEN. The value is read from the
 * database every time a Shipper's counter-offer is made and the deadline is stored with that offer, so a change applies to the offers made after it and never
 * moves one already waiting. One transaction: record -> actor locks -> rows FOR UPDATE -> version check -> write -> change log (old, new, actor, time) -> audit ->
 * outbox -> COMMIT. A second session that saved in between is a version conflict, never a silent overwrite.
 */
@Injectable()
export class OrderParametersService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly parameters: OrderParametersRepository,
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
      return view(await this.parameters.readAll(context), await this.parameters.recentChanges(context, HISTORY_LIMIT));
    });
  }

  async update(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: OrderParametersBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: ORDER_PARAMETERS_OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, fee_answer_minutes: body.feeAnswerMinutes, reason: body.reason },
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
        const rows = await this.parameters.lockAll(context);
        if (groupVersion(rows) !== body.expectedVersion) {
          throw new AppError('ORDER_PARAMETER_VERSION_CONFLICT');
        }
        const changed: JsonObject[] = [];
        for (const row of rows) {
          if (row.key !== FEE_ANSWER_MINUTES_KEY || row.value === body.feeAnswerMinutes) {
            continue;
          }
          await this.parameters.write(context, row.key, body.feeAnswerMinutes, known.userId);
          await this.parameters.appendChange(context, {
            changeId: randomUUID(),
            key: row.key,
            oldValue: row.value,
            newValue: body.feeAnswerMinutes,
            actorUserId: known.userId,
            requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: ORDER_PARAMETERS_OPERATION,
            resourceType: RESOURCE,
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: { param_key: row.key, old_value: row.value, new_value: body.feeAnswerMinutes, ...(body.reason === null ? {} : { reason: body.reason }) },
          });
          await this.outbox.append(context, {
            eventType: 'order.parameter.changed.v1',
            eventSchemaVersion: 1,
            resourceType: RESOURCE,
            resourceId: row.key,
            resourceVersion: row.version + 1,
            payload: { param_key: row.key, old_value: row.value, new_value: body.feeAnswerMinutes },
          });
          changed.push({ param_key: row.key, old_value: row.value, new_value: body.feeAnswerMinutes });
        }
        const after = await this.parameters.readAll(context);
        const history = await this.parameters.recentChanges(context, HISTORY_LIMIT);
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { ...view(after, history), changed } };
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

function view(rows: readonly OrderParameter[], history: readonly OrderParameterChange[]): JsonObject {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const updated = rows.map((row) => row.updatedAtMs);
  return {
    version: groupVersion(rows),
    fee_answer_minutes: byKey.get(FEE_ANSWER_MINUTES_KEY)?.value ?? null,
    updated_at: updated.length === 0 ? null : iso(Math.max(...updated)),
    history: history.map((change) => ({
      change_id: change.changeId,
      param_key: change.key,
      old_value: change.oldValue,
      new_value: change.newValue,
      changed_by: change.changedBy,
      changed_at: iso(change.changedAtMs),
    })),
  };
}
