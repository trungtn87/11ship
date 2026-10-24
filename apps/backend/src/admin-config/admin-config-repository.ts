import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';

export type ConfigGroupKey = 'security' | 'shipper_wallet' | 'delivery_policy' | 'notifications';
export const CONFIG_GROUP_KEYS: readonly ConfigGroupKey[] = ['security', 'shipper_wallet', 'delivery_policy', 'notifications'];

/** The audit action each owner writes when it changes its configuration, and the group the change belongs to. The owners' own rows are the history; M12 stores none. */
export const CONFIG_AUDIT_ACTIONS: Readonly<Record<string, ConfigGroupKey>> = {
  'admin.system_setting.update.v1': 'security',
  'admin.shipper_wallet_parameters.update.v1': 'shipper_wallet',
  'admin.shipping_eligibility_policy.update.v1': 'delivery_policy',
  'admin.shipping_fee_policy.apply.v1': 'delivery_policy',
  'admin.notification_config.update.v1': 'notifications',
};

export interface ConfigChangeRow {
  readonly atMs: number;
  readonly action: string;
  readonly actorName: string;
  readonly resourceVersion: number | null;
  readonly metadata: JsonObject;
}

@Injectable()
export class AdminConfigRepository {
  async recent(context: TransactionContext, actions: readonly string[], limit: number): Promise<ConfigChangeRow[]> {
    const result = await context.query<{ at_ms: string; action: string; actor_name: string | null; resource_version: string | null; metadata: JsonObject }>(
      `SELECT (extract(epoch FROM a.occurred_at) * 1000)::bigint::text AS at_ms, a.action,
              COALESCE(p.full_name, CASE WHEN m.admin_role = 'SYSTEM' THEN 'SYSTEM' END) AS actor_name, a.resource_version::text AS resource_version, a.metadata
         FROM app.audit_logs a
         LEFT JOIN app.admin_profiles p ON p.user_id::text = a.actor_id
         LEFT JOIN app.admin_memberships m ON m.user_id::text = a.actor_id
        WHERE a.action = ANY($1::text[]) AND a.outcome = 'SUCCESS'
        ORDER BY a.occurred_at DESC, a.audit_id DESC
        LIMIT $2::int`,
      [[...actions], limit],
    );
    return result.rows.map((row) => {
      const atMs = Number(row.at_ms);
      if (!Number.isSafeInteger(atMs)) {
        throw new TechnicalError('internal', 'Database returned an unexpected audit row');
      }
      return { atMs, action: row.action, actorName: row.actor_name ?? 'Không rõ', resourceVersion: row.resource_version === null ? null : Number(row.resource_version), metadata: row.metadata };
    });
  }
}
