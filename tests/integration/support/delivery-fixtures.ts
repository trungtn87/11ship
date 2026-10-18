import { randomUUID } from 'node:crypto';

// M07 rows for the suites of OTHER modules whose tables now point at a delivery (M04 commission holds, M06 fee agreements): the foreign keys are real, so a
// test needs a real delivery / assignment behind its ids. Nothing here goes through the application; these are plain INSERTs of valid rows.

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
}

/** The two deferred invariants of M07 (delivery / assignment / hold agree). Fixtures that insert the assignment before its hold defer them around the pair. */
export const M07_INVARIANT_TRIGGERS = ['app.deliveries_invariants', 'app.delivery_assignments_invariants'] as const;

/** A `waiting_driver` delivery of the shop. Returns its id. */
export async function insertDeliveryRow(q: Queryable, input: { shopId: string; userId: string; deliveryId?: string }): Promise<string> {
  const deliveryId = input.deliveryId ?? randomUUID();
  await q.query(
    `INSERT INTO app.deliveries (
       delivery_id, code, source, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng,
       recipient_name, recipient_phone, dropoff_address_text, goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer,
       search_started_at, search_expires_at, version, created_at, updated_at)
     VALUES ($1::uuid, $2, 'DIRECT', $3::uuid, $4::uuid, 'waiting_driver', 'Fixture shop', '+84900000001', 'Fixture address', 21.0, 105.8,
       'Khách', '+84912345678', '12 Phố Huế', 'Hộp quà', 0, 0, 'STANDARD', 'CUSTOMER',
       date_trunc('milliseconds', now()), date_trunc('milliseconds', now()) + interval '30 minutes', 1, now(), now())`,
    [deliveryId, `F-${deliveryId.slice(0, 8)}`, input.shopId, input.userId],
  );
  return deliveryId;
}

export type SourceOutcome = 'ACTIVE' | 'RELEASED' | 'CAPTURED';

/**
 * The assignment that a commission hold of the given final status belongs to, inserted directly in the matching state (ACTIVE: delivery accepted; RELEASED:
 * assignment cancelled, delivery searching again; CAPTURED: delivery and assignment completed), so the M07 invariant holds once the hold has that status.
 * The hold itself is inserted by the caller, with the invariants deferred (M07_INVARIANT_TRIGGERS) until it exists.
 */
export async function insertCommissionSource(q: Queryable, input: { shopId: string; userId: string; driverId: string; amountVnd: number; outcome: SourceOutcome }): Promise<string> {
  const deliveryId = randomUUID();
  const assignmentId = randomUUID();
  const state = input.outcome === 'ACTIVE' ? 'accepted' : input.outcome === 'RELEASED' ? 'waiting_driver' : 'completed';
  const done = input.outcome === 'CAPTURED';
  await q.query(
    `INSERT INTO app.deliveries (
       delivery_id, code, source, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng,
       recipient_name, recipient_phone, dropoff_address_text, dropoff_lat, dropoff_lng, goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer, fee_vnd,
       search_started_at, search_expires_at, picked_up_at, ended_at, version, created_at, updated_at)
     VALUES ($1::uuid, $2, 'DIRECT', $3::uuid, $4::uuid, $5, 'Fixture shop', '+84900000001', 'Fixture address', 21.0, 105.8,
       'Khách', '+84912345678', '12 Phố Huế', 21.0, 105.82, 'Hộp quà', 0, 0, 'STANDARD', 'CUSTOMER', $6,
       date_trunc('milliseconds', now()), date_trunc('milliseconds', now()) + interval '30 minutes', $7, $8, 1, now(), now())`,
    [deliveryId, `F-${deliveryId.slice(0, 8)}`, input.shopId, input.userId, state, done ? 10000 : null, done ? new Date() : null, done ? new Date() : null],
  );
  const status = input.outcome === 'ACTIVE' ? 'ACTIVE' : input.outcome === 'RELEASED' ? 'CANCELLED_BY_SHIPPER' : 'COMPLETED';
  await q.query(
    `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, status, accepted_at, commission_vnd, commission_policy, ended_at, end_actor, version, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now(), $5::bigint, 'COMMISSION_V1', $6, $7, 1, now(), now())`,
    [assignmentId, deliveryId, input.driverId, status, input.amountVnd, input.outcome === 'ACTIVE' ? null : new Date(), input.outcome === 'ACTIVE' ? null : 'SHIPPER'],
  );
  return assignmentId;
}
