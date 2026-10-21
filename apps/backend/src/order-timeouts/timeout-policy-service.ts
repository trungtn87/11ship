import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { parseTimeoutParameters } from './timeout-policy';
@Injectable()
export class TimeoutPolicyService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly audit: AuditWriter,
  ) {}
  async authorize(c: TransactionContext, known: SessionLookup): Promise<'SYSTEM' | 'ADMIN'> {
    const locked = await this.actor.lock(c, known, { user: 'read', factor: 'read' });
    const rows = await this.permissions.permissions(c, known.userId);
    this.actor.assertSessionLive(locked, await freshClockMs(c));
    const role = locked.checked.membership.adminRole;
    if (role !== 'SYSTEM' && !rows.some((p) => p.app === 'DRIVER' && p.canView && p.canLock)) throw new AppError('ADMIN_FORBIDDEN');
    return role;
  }
  async view(c: TransactionContext): Promise<JsonObject> {
    const p = (
      await c.query<{ version: number; parameters: JsonObject; updated_at: Date }>(
        'SELECT version,parameters,updated_at FROM app.order_timeout_policy WHERE id',
      )
    ).rows[0]!;
    const history = (
      await c.query('SELECT version,old_values,new_values,actor_id,created_at FROM app.order_timeout_policy_changes ORDER BY version DESC LIMIT 20')
    ).rows;
    return {
      version: p.version,
      parameters: p.parameters,
      updated_at: p.updated_at.toISOString(),
      effective: 'Áp dụng cho giai đoạn mới bắt đầu sau khi lưu. Giai đoạn đang chạy giữ thời hạn và phiên bản đã chốt.',
      history: history.map((r) => ({ ...r, created_at: (r.created_at as Date).toISOString() })) as JsonObject[],
    };
  }
  async read(token: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (c) => {
      await this.authorize(c, known);
      return this.view(c);
    });
  }
  async save(token: string | undefined, csrf: unknown, raw: unknown, key: string | readonly string[] | undefined, requestId: string) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new AppError('ADMIN_INPUT_INVALID');
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).sort().join() !== 'expected_version,parameters' || !Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1)
      throw new AppError('ADMIN_INPUT_INVALID');
    const parameters = parseTimeoutParameters(body.parameters),
      known = await this.actor.precheck(token, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: 'admin.order_timeout.update.v1',
        idempotencyKey: key,
        logicalRequest: { expected_version: Number(body.expected_version), parameters },
        replay: {
          kind: 'sensitive',
          authorize: async (c, guard) => {
            if (guard.actor_user_id !== known.userId) throw new AppError('ADMIN_SESSION_INVALID');
            await this.authorize(c, known);
            return true;
          },
        },
      },
      async (c) => {
        const role = await this.authorize(c, known);
        const old = (await c.query<{ version: number; parameters: JsonObject }>('SELECT version,parameters FROM app.order_timeout_policy WHERE id FOR UPDATE'))
          .rows[0]!;
        if (old.version !== body.expected_version) throw new AppError('SYSTEM_SETTING_VERSION_CONFLICT');
        await c.query('UPDATE app.order_timeout_policy SET parameters=$1::jsonb,version=version+1,updated_at=clock_timestamp(),updated_by=$2::uuid WHERE id', [
          JSON.stringify(parameters),
          known.userId,
        ]);
        await c.query(
          'INSERT INTO app.order_timeout_policy_changes(change_id,version,old_values,new_values,actor_id,request_id) VALUES($1::uuid,$2,$3::jsonb,$4::jsonb,$5::uuid,$6)',
          [randomUUID(), old.version + 1, JSON.stringify(old.parameters), JSON.stringify(parameters), known.userId, requestId],
        );
        await this.audit.append(c, {
          requestId,
          actorType: role,
          actorId: known.userId,
          action: 'admin.order_timeout.update.v1',
          resourceType: 'order_timeout_policy',
          resourceId: null,
          outcome: 'SUCCESS',
          metadata: { old_values: old.parameters, new_values: parameters, rule_version: old.version + 1 },
        });
        return { status: 200, payload: await this.view(c), replayGuard: { actor_user_id: known.userId } };
      },
    );
  }
}
