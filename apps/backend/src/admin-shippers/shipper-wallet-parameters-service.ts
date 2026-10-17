import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ShipperWalletParametersRepository, WalletParameter, WalletParameterChange, WalletParameterKey } from '../driver/shipper-wallet-parameters';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { assertParameterAccess, ParameterAccess } from '../system-settings/system-parameter-access';
import { WalletParametersBody } from './admin-shipper-validation';

const OPERATION = 'admin.shipper_wallet_parameters.update.v1';
const RESOURCE = 'shipper_wallet_parameter';
const HISTORY_LIMIT = 30;
const iso = (ms: number): string => new Date(ms).toISOString();
const groupVersion = (rows: readonly WalletParameter[]): number => rows.reduce((sum, row) => sum + row.version, 0);

/**
 * Cài đặt → Tham số hệ thống → Ví Shipper: the minimum top-up and the minimum withdrawal PER REQUEST, in whole VND. SYSTEM changes
 * it, any ADMIN reads it (system-settings/system-parameter-access.ts, the rule of every system parameter): the backend checks the role under the
 * actor's locks on every read and write (an ADMIN write gets ADMIN_FORBIDDEN). The values are stored in the database and read from it on every use, so a change
 * applies to the next request and never touches a transaction that already happened. These are NOT the minimum wallet balance for
 * taking orders (an M04 rule). One transaction: record -> actor locks -> both rows FOR UPDATE -> version check -> writes -> change
 * log (old value, new value, actor, time) -> audit -> outbox -> COMMIT. The screen carries one version for the pair (the sum of the
 * row versions), so a second session that saved in between is a conflict, never a silent overwrite.
 */
@Injectable()
export class ShipperWalletParametersService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly parameters: ShipperWalletParametersRepository,
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
    body: WalletParametersBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION,
        idempotencyKey,
        logicalRequest: { expected_version: body.expectedVersion, topup_min_vnd: body.topupMinVnd, withdraw_min_vnd: body.withdrawMinVnd },
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
          throw new AppError('WALLET_PARAMETER_VERSION_CONFLICT');
        }
        const wanted: Readonly<Record<WalletParameterKey, number>> = { topup_min_vnd: body.topupMinVnd, withdraw_min_vnd: body.withdrawMinVnd };
        const changed: JsonObject[] = [];
        for (const row of rows) {
          const next = wanted[row.key];
          if (row.valueVnd === next) {
            continue;
          }
          await this.parameters.write(context, row.key, next, known.userId);
          await this.parameters.appendChange(context, {
            changeId: randomUUID(),
            key: row.key,
            oldValue: row.valueVnd,
            newValue: next,
            actorUserId: known.userId,
            requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: OPERATION,
            resourceType: RESOURCE,
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: { param_key: row.key, old_value: row.valueVnd, new_value: next },
          });
          await this.outbox.append(context, {
            eventType: 'shipper.wallet_parameter.changed.v1',
            eventSchemaVersion: 1,
            resourceType: RESOURCE,
            resourceId: row.key,
            resourceVersion: row.version + 1,
            payload: { param_key: row.key, old_value: row.valueVnd, new_value: next },
          });
          changed.push({ param_key: row.key, old_value: row.valueVnd, new_value: next });
        }
        const after = await this.parameters.readAll(context);
        const history = await this.parameters.recentChanges(context, HISTORY_LIMIT);
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { ...view(after, history), changed } };
      },
    );
  }

  /** The administration actor under the module's locks, the database clock read after them, then the parameter access rule. */
  async #lockActor(context: TransactionContext, known: SessionLookup, access: ParameterAccess): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    assertParameterAccess(this.actor, locked, nowMs, access);
    return locked;
  }
}

function view(rows: readonly WalletParameter[], history: readonly WalletParameterChange[]): JsonObject {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const updated = rows.map((row) => row.updatedAtMs);
  return {
    version: groupVersion(rows),
    topup_min_vnd: byKey.get('topup_min_vnd')?.valueVnd ?? null,
    withdraw_min_vnd: byKey.get('withdraw_min_vnd')?.valueVnd ?? null,
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
