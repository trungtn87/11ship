import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
/** Supplement existing actor/correlation audit with safe state, stage and commission facts in the same transaction. */
export async function cancellationAudit(
  c: TransactionContext,
  resource: 'orders' | 'deliveries',
  id: string,
  version: number,
  assignmentId?: string | null,
): Promise<JsonObject> {
  const result = await c.query<{ before_state: string; after_state: string; reason: string | null; source: string; rule_snapshot: JsonObject | null }>(
    `SELECT before_state,after_state,reason,source,rule_snapshot FROM app.cancellation_transitions
     WHERE (resource_type=$1 AND resource_id=$2::uuid AND resource_version=$3) OR (resource_type='delivery_assignments' AND resource_id=$4::uuid)
     ORDER BY created_at,transition_id`,
    [resource, id, version, assignmentId ?? null],
  );
  const facts: JsonObject = { transitions: result.rows.map((row) => ({ ...row })) };
  if (resource === 'deliveries') {
    const d = (await c.query<{ order_id: string | null }>('SELECT order_id FROM app.deliveries WHERE delivery_id=$1::uuid', [id])).rows[0];
    facts.order_id = d?.order_id ?? null;
    facts.delivery_id = id;
    facts.assignment_id = assignmentId ?? null;
  } else facts.order_id = id;
  return facts;
}
