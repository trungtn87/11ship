import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ActorType, AssignmentStatus, Custody, DeliveryState, FeeMode, FeePayer, GoodsCondition, FailReasonCode } from './delivery-constants';

// SQL of app.deliveries, app.delivery_assignments, app.delivery_events and app.delivery_incidents (M07 owns the four). Every method takes the
// caller's TransactionContext: none of them begins, commits or rolls back. Times are read as epoch milliseconds and written with the database clock;
// money is a whole number of VND (the tables bound it to the safe-integer range). A malformed value from the database is an internal error.

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;
const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

const safeOrNull = (raw: unknown): number | null => (raw === null || raw === undefined ? null : safe(raw));

export interface DeliveryRow {
  readonly deliveryId: string;
  readonly code: string;
  readonly displayCode?: string | null;
  readonly source: 'DIRECT' | 'ORDER';
  readonly orderId: string | null;
  readonly previousDeliveryId: string | null;
  readonly shopId: string;
  readonly requestedBy: string;
  readonly state: DeliveryState;
  readonly version: number;
  readonly shopName: string;
  readonly shopPhone: string;
  readonly pickupAddressText: string;
  readonly pickupLat: number;
  readonly pickupLng: number;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly dropoffAddressText: string;
  readonly dropoffAreaText: string | null;
  readonly dropoffLat: number | null;
  readonly dropoffLng: number | null;
  readonly dropoffPinnedBy: string | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly note: string | null;
  readonly feeMode: FeeMode;
  readonly feePayer: FeePayer;
  readonly feeVnd: number | null;
  readonly routeDistanceM: number | null;
  readonly searchStartedAtMs: number;
  readonly searchExpiresAtMs: number;
  readonly searchStoppedAtMs: number | null;
  readonly reminded5AtMs: number | null;
  readonly reminded15AtMs: number | null;
  readonly pickedUpAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly endReason: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

interface RawDelivery {
  delivery_id: string;
  code: string;
  display_code?: string | null;
  source: 'DIRECT' | 'ORDER';
  order_id: string | null;
  previous_delivery_id: string | null;
  shop_id: string;
  requested_by: string;
  state: DeliveryState;
  version: string;
  shop_name: string;
  shop_phone: string;
  pickup_address_text: string;
  pickup_lat: number;
  pickup_lng: number;
  recipient_name: string;
  recipient_phone: string;
  dropoff_address_text: string;
  dropoff_area_text: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_pinned_by: string | null;
  goods_description: string;
  goods_value_vnd: string;
  paid_vnd: string;
  note: string | null;
  fee_mode: FeeMode;
  fee_payer: FeePayer;
  fee_vnd: string | null;
  route_distance_m: number | null;
  started_ms: string;
  expires_ms: string;
  stopped_ms: string | null;
  r5_ms: string | null;
  r15_ms: string | null;
  picked_ms: string | null;
  ended_ms: string | null;
  end_reason: string | null;
  created_ms: string;
  updated_ms: string;
}

export const DELIVERY_COLUMNS = `d.delivery_id::text AS delivery_id, d.code, app.shop_display_delivery(d.delivery_id) AS display_code, d.source, d.order_id::text AS order_id, d.previous_delivery_id::text AS previous_delivery_id,
  d.shop_id::text AS shop_id, d.requested_by::text AS requested_by, d.state, d.version::text AS version, d.shop_name, d.shop_phone, d.pickup_address_text,
  d.pickup_lat, d.pickup_lng, d.recipient_name, d.recipient_phone, d.dropoff_address_text, d.dropoff_area_text, d.dropoff_lat, d.dropoff_lng,
  d.dropoff_pinned_by::text AS dropoff_pinned_by, d.goods_description, d.goods_value_vnd::text AS goods_value_vnd, d.paid_vnd::text AS paid_vnd, d.note,
  d.fee_mode, d.fee_payer, d.fee_vnd::text AS fee_vnd, d.route_distance_m,
  ${ms('d.search_started_at', 'started_ms')}, ${ms('d.search_expires_at', 'expires_ms')}, ${ms('d.search_stopped_at', 'stopped_ms')},
  ${ms('d.reminded_5_at', 'r5_ms')}, ${ms('d.reminded_15_at', 'r15_ms')}, ${ms('d.picked_up_at', 'picked_ms')}, ${ms('d.ended_at', 'ended_ms')}, d.end_reason,
  ${ms('d.created_at', 'created_ms')}, ${ms('d.updated_at', 'updated_ms')}`;

export function toDelivery(row: RawDelivery): DeliveryRow {
  return {
    deliveryId: row.delivery_id,
    code: row.code,
    displayCode: row.display_code ?? null,
    source: row.source,
    orderId: row.order_id,
    previousDeliveryId: row.previous_delivery_id,
    shopId: row.shop_id,
    requestedBy: row.requested_by,
    state: row.state,
    version: safe(row.version),
    shopName: row.shop_name,
    shopPhone: row.shop_phone,
    pickupAddressText: row.pickup_address_text,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    dropoffAddressText: row.dropoff_address_text,
    dropoffAreaText: row.dropoff_area_text,
    dropoffLat: row.dropoff_lat,
    dropoffLng: row.dropoff_lng,
    dropoffPinnedBy: row.dropoff_pinned_by,
    goodsDescription: row.goods_description,
    goodsValueVnd: safe(row.goods_value_vnd),
    paidVnd: safe(row.paid_vnd),
    note: row.note,
    feeMode: row.fee_mode,
    feePayer: row.fee_payer,
    feeVnd: safeOrNull(row.fee_vnd),
    routeDistanceM: row.route_distance_m,
    searchStartedAtMs: safe(row.started_ms),
    searchExpiresAtMs: safe(row.expires_ms),
    searchStoppedAtMs: safeOrNull(row.stopped_ms),
    reminded5AtMs: safeOrNull(row.r5_ms),
    reminded15AtMs: safeOrNull(row.r15_ms),
    pickedUpAtMs: safeOrNull(row.picked_ms),
    endedAtMs: safeOrNull(row.ended_ms),
    endReason: row.end_reason,
    createdAtMs: safe(row.created_ms),
    updatedAtMs: safe(row.updated_ms),
  };
}

export interface NewDelivery {
  readonly deliveryId: string;
  readonly code: string;
  readonly source: 'DIRECT' | 'ORDER';
  readonly orderId: string | null;
  readonly previousDeliveryId: string | null;
  readonly shopId: string;
  readonly requestedBy: string;
  readonly shopName: string;
  readonly shopPhone: string;
  readonly pickupAddressText: string;
  readonly pickupLat: number;
  readonly pickupLng: number;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly dropoffAddressText: string;
  readonly dropoffAreaText: string | null;
  readonly dropoffLat: number | null;
  readonly dropoffLng: number | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly note: string | null;
  readonly feeMode: FeeMode;
  readonly feePayer: FeePayer;
  readonly feeVnd: number | null;
  readonly routeDistanceM: number | null;
}

/** The columns a state change may write. Anything else is fixed at creation. A key set to null clears the column. */
export interface DeliveryPatch {
  readonly state?: DeliveryState;
  readonly dropoffLat?: number;
  readonly dropoffLng?: number;
  readonly dropoffPinnedBy?: string;
  readonly dropoffAddressText?: string;
  readonly dropoffAreaText?: string | null;
  readonly feeVnd?: number;
  readonly feeConfirmedBy?: string;
  readonly routeDistanceM?: number | null;
  readonly searchStoppedNow?: true;
  readonly remindedNow?: 5 | 15;
  readonly pickedUpNow?: true;
  readonly endedNow?: true;
  readonly endReason?: string | null;
}

export type ShopScope = 'active' | 'history' | 'all';

export interface AssignmentRow {
  readonly assignmentId: string;
  readonly deliveryId: string;
  readonly driverId: string;
  readonly status: AssignmentStatus;
  readonly acceptedAtMs: number;
  readonly originalEtaAtMs: number | null;
  readonly commissionVnd: bigint;
  readonly commissionPolicy: string;
  readonly destinationConfirmedAtMs: number | null;
  readonly pickedUpAtMs: number | null;
  readonly lastPickupReminderAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly endActor: ActorType | null;
  readonly endReason: string | null;
  readonly version: number;
}

interface RawAssignment {
  assignment_id: string;
  delivery_id: string;
  driver_id: string;
  status: AssignmentStatus;
  accepted_ms: string;
  eta_ms: string | null;
  commission_vnd: string;
  commission_policy: string;
  dest_ms: string | null;
  picked_ms: string | null;
  reminder_ms: string | null;
  ended_ms: string | null;
  end_actor: ActorType | null;
  end_reason: string | null;
  version: string;
}

const A_COLUMNS = `a.assignment_id::text AS assignment_id, a.delivery_id::text AS delivery_id, a.driver_id::text AS driver_id, a.status,
  ${ms('a.accepted_at', 'accepted_ms')}, ${ms('a.original_eta_at', 'eta_ms')}, a.commission_vnd::text AS commission_vnd, a.commission_policy,
  ${ms('a.destination_confirmed_at', 'dest_ms')}, ${ms('a.picked_up_at', 'picked_ms')}, ${ms('a.last_pickup_reminder_at', 'reminder_ms')},
  ${ms('a.ended_at', 'ended_ms')}, a.end_actor, a.end_reason, a.version::text AS version`;

function toAssignment(row: RawAssignment): AssignmentRow {
  if (!/^[0-9]{1,16}$/.test(row.commission_vnd)) {
    throw new TechnicalError('internal', 'Database returned an unexpected commission');
  }
  return {
    assignmentId: row.assignment_id,
    deliveryId: row.delivery_id,
    driverId: row.driver_id,
    status: row.status,
    acceptedAtMs: safe(row.accepted_ms),
    originalEtaAtMs: safeOrNull(row.eta_ms),
    commissionVnd: BigInt(row.commission_vnd),
    commissionPolicy: row.commission_policy,
    destinationConfirmedAtMs: safeOrNull(row.dest_ms),
    pickedUpAtMs: safeOrNull(row.picked_ms),
    lastPickupReminderAtMs: safeOrNull(row.reminder_ms),
    endedAtMs: safeOrNull(row.ended_ms),
    endActor: row.end_actor,
    endReason: row.end_reason,
    version: safe(row.version),
  };
}

export interface EventRow {
  readonly seq: number;
  readonly type: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly assignmentId: string | null;
  readonly note: string | null;
  readonly atMs: number;
}

export interface IncidentRow {
  readonly incidentId: string;
  readonly deliveryId: string;
  readonly assignmentId: string;
  readonly driverId: string;
  readonly status: 'OPEN' | 'CLOSED';
  readonly custody: Custody;
  readonly reasonCode: FailReasonCode;
  readonly reasonNote: string | null;
  readonly goodsCondition: GoodsCondition;
  readonly openedAtMs: number;
  readonly closedAtMs: number | null;
  readonly closeNote: string | null;
  readonly m11ReferredAtMs: number | null;
  readonly version: number;
}

interface RawIncident {
  incident_id: string;
  delivery_id: string;
  assignment_id: string;
  driver_id: string;
  status: 'OPEN' | 'CLOSED';
  custody: Custody;
  reason_code: FailReasonCode;
  reason_note: string | null;
  goods_condition: GoodsCondition;
  opened_ms: string;
  closed_ms: string | null;
  close_note: string | null;
  m11_ms: string | null;
  version: string;
}

const I_COLUMNS = `i.incident_id::text AS incident_id, i.delivery_id::text AS delivery_id, i.assignment_id::text AS assignment_id, i.driver_id::text AS driver_id,
  i.status, i.custody, i.reason_code, i.reason_note, i.goods_condition, ${ms('i.opened_at', 'opened_ms')}, ${ms('i.closed_at', 'closed_ms')}, i.close_note,
  ${ms('i.m11_referred_at', 'm11_ms')}, i.version::text AS version`;

function toIncident(row: RawIncident): IncidentRow {
  return {
    incidentId: row.incident_id,
    deliveryId: row.delivery_id,
    assignmentId: row.assignment_id,
    driverId: row.driver_id,
    status: row.status,
    custody: row.custody,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    goodsCondition: row.goods_condition,
    openedAtMs: safe(row.opened_ms),
    closedAtMs: safeOrNull(row.closed_ms),
    closeNote: row.close_note,
    m11ReferredAtMs: safeOrNull(row.m11_ms),
    version: safe(row.version),
  };
}

const ACTIVE_LIST_STATES = `('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering')`;

@Injectable()
export class DeliveryRepository {
  // ---- deliveries ------------------------------------------------------------------------------------------------------------

  /** Inserts a delivery in `waiting_driver` with the search window starting NOW (database clock). A code collision returns false (the caller picks another code). */
  async insert(context: TransactionContext, d: NewDelivery): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.deliveries (
         delivery_id, code, source, order_id, previous_delivery_id, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng,
         recipient_name, recipient_phone, dropoff_address_text, dropoff_area_text, dropoff_lat, dropoff_lng, goods_description, goods_value_vnd, paid_vnd, note,
         fee_mode, fee_payer, fee_vnd, route_distance_m, search_started_at, search_expires_at, version, created_at, updated_at)
       SELECT $1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7::uuid, 'waiting_driver', $8, $9, $10, $11::float8, $12::float8,
              $13, $14, $15, $16, $17::float8, $18::float8, $19, $20::bigint, $21::bigint, $22,
              $23, $24, $25::bigint, $26::int, clock.t, clock.t + interval '30 minutes', 1, clock.t, clock.t
         FROM (SELECT ${CLOCK} AS t) AS clock
       ON CONFLICT (code) DO NOTHING`,
      [
        d.deliveryId, d.code, d.source, d.orderId, d.previousDeliveryId, d.shopId, d.requestedBy, d.shopName, d.shopPhone, d.pickupAddressText, d.pickupLat, d.pickupLng,
        d.recipientName, d.recipientPhone, d.dropoffAddressText, d.dropoffAreaText, d.dropoffLat, d.dropoffLng, d.goodsDescription, d.goodsValueVnd, d.paidVnd, d.note,
        d.feeMode, d.feePayer, d.feeVnd, d.routeDistanceM,
      ],
    );
    return result.rowCount === 1;
  }

  async findById(context: TransactionContext, deliveryId: string): Promise<DeliveryRow | undefined> {
    const result = await context.query<RawDelivery>(`SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d WHERE d.delivery_id = $1::uuid`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toDelivery(row);
  }

  /** Locks the row and returns it as it is AFTER the lock. */
  async lockById(context: TransactionContext, deliveryId: string): Promise<DeliveryRow | undefined> {
    const result = await context.query<RawDelivery>(`SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d WHERE d.delivery_id = $1::uuid FOR UPDATE`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toDelivery(row);
  }

  /** Every delivery that was made for an order, oldest first (M11 reads it: the customer rates the Shipper of the one that succeeded). */
  async listByOrder(context: TransactionContext, orderId: string): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(`SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d WHERE d.order_id = $1::uuid ORDER BY d.created_at, d.delivery_id`, [orderId]);
    return result.rows.map(toDelivery);
  }

  /**
   * The whole chain a delivery belongs to (the first call, every "call again" after it), oldest first: M11 reads it before it applies a conclusion
   * to a result, because a later delivery may have changed the facts.
   */
  async listChain(context: TransactionContext, deliveryId: string): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(
      `WITH RECURSIVE up(delivery_id, previous_delivery_id) AS (
         SELECT delivery_id, previous_delivery_id FROM app.deliveries WHERE delivery_id = $1::uuid
         UNION ALL
         SELECT p.delivery_id, p.previous_delivery_id FROM app.deliveries p JOIN up ON p.delivery_id = up.previous_delivery_id
       ), down(delivery_id) AS (
         SELECT delivery_id FROM up WHERE previous_delivery_id IS NULL
         UNION ALL
         SELECT n.delivery_id FROM app.deliveries n JOIN down ON n.previous_delivery_id = down.delivery_id
       )
       SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d WHERE d.delivery_id IN (SELECT delivery_id FROM down) ORDER BY d.created_at, d.delivery_id`,
      [deliveryId],
    );
    return result.rows.map(toDelivery);
  }

  /** The delivery a Shop owns, or undefined (the same answer for a stranger's and a missing one). */
  async findOfShop(context: TransactionContext, deliveryId: string, shopId: string): Promise<DeliveryRow | undefined> {
    const found = await this.findById(context, deliveryId);
    return found !== undefined && found.shopId === shopId ? found : undefined;
  }

  /**
   * The shop's list. "active" is what the shop still has to look at: running or searching deliveries, a stopped search (call again / cancel) and a failed
   * delivery whose goods are not settled. "history" is every other one, newest first.
   */
  async listForShop(
    context: TransactionContext,
    shopId: string,
    scope: ShopScope,
    query: string,
    limit: number,
    options: { filter: 'all' | 'searching' | 'accepted' | 'delivering' | 'completed' | 'failed'; fromMs: number | null; toMs: number | null; offset: number } = { filter: 'all', fromMs: null, toMs: null, offset: 0 },
  ): Promise<DeliveryRow[]> {
    const pattern = query === '' ? null : `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await context.query<RawDelivery>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM app.deliveries d
        WHERE d.shop_id = $1::uuid
          AND ($2::text = 'all' OR (($2::text = 'active') = (d.state IN ${ACTIVE_LIST_STATES} OR d.state = 'search_stopped'
                                   OR EXISTS (SELECT 1 FROM app.delivery_incidents i WHERE i.delivery_id = d.delivery_id AND i.status = 'OPEN'))))
          AND ($3::text IS NULL OR d.code ILIKE $3 ESCAPE '\\' OR app.shop_display_delivery(d.delivery_id) ILIKE $3 ESCAPE '\\' OR d.recipient_name ILIKE $3 ESCAPE '\\')
          AND CASE $5::text
              WHEN 'searching' THEN d.state IN ('waiting_driver', 'search_stopped')
              WHEN 'accepted' THEN d.state IN ('accepted', 'location_confirmed')
              WHEN 'delivering' THEN d.state IN ('picked_up', 'delivering')
              WHEN 'completed' THEN d.state = 'completed'
              WHEN 'failed' THEN d.state IN ('failed', 'cancelled_by_merchant', 'cancelled_by_system')
              ELSE TRUE END
          AND ($6::timestamptz IS NULL OR d.created_at >= $6::timestamptz)
          AND ($7::timestamptz IS NULL OR d.created_at < $7::timestamptz)
        ORDER BY d.created_at DESC, d.delivery_id
        LIMIT $4 OFFSET $8`,
      [shopId, scope, pattern, limit, options.filter, options.fromMs === null ? null : new Date(options.fromMs).toISOString(), options.toMs === null ? null : new Date(options.toMs).toISOString(), options.offset],
    );
    return result.rows.map(toDelivery);
  }

  /** Every delivery of an Order (M10), oldest first: the history of its calls. */
  async listOfOrder(context: TransactionContext, orderId: string): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(`SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d WHERE d.order_id = $1::uuid ORDER BY d.created_at, d.delivery_id`, [orderId]);
    return result.rows.map(toDelivery);
  }

  /** The deliveries on offer: searching, not expired, no active assignment. The caller filters by distance and eligibility. */
  async listOpenOffers(context: TransactionContext, limit: number): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM app.deliveries d
        WHERE d.state = 'waiting_driver' AND d.search_expires_at > ${CLOCK}
        ORDER BY d.created_at, d.delivery_id
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(toDelivery);
  }

  /** Applies a patch to a row the caller holds locked. The version is checked in the statement and advanced by it; undefined when no row matched. */
  async update(context: TransactionContext, deliveryId: string, expectedVersion: number, patch: DeliveryPatch): Promise<DeliveryRow | undefined> {
    const params: unknown[] = [deliveryId, expectedVersion];
    const sets: string[] = ['version = version + 1', `updated_at = ${CLOCK}`];
    const bind = (value: unknown, cast: string): string => {
      params.push(value);
      return `$${String(params.length)}${cast}`;
    };
    if (patch.state !== undefined) {
      sets.push(`state = ${bind(patch.state, '::varchar')}`);
    }
    if (patch.dropoffLat !== undefined && patch.dropoffLng !== undefined) {
      sets.push(`dropoff_lat = ${bind(patch.dropoffLat, '::float8')}`, `dropoff_lng = ${bind(patch.dropoffLng, '::float8')}`);
    }
    if (patch.dropoffPinnedBy !== undefined) {
      sets.push(`dropoff_pinned_by = ${bind(patch.dropoffPinnedBy, '::uuid')}`, `dropoff_pinned_at = ${CLOCK}`);
    }
    if (patch.dropoffAddressText !== undefined) {
      sets.push(`dropoff_address_text = ${bind(patch.dropoffAddressText, '::varchar')}`);
    }
    if (patch.dropoffAreaText !== undefined) {
      sets.push(`dropoff_area_text = ${bind(patch.dropoffAreaText, '::varchar')}`);
    }
    if (patch.feeVnd !== undefined) {
      sets.push(`fee_vnd = ${bind(patch.feeVnd, '::bigint')}`);
    }
    if (patch.feeConfirmedBy !== undefined) {
      sets.push(`fee_confirmed_by = ${bind(patch.feeConfirmedBy, '::uuid')}`, `fee_confirmed_at = ${CLOCK}`);
    }
    if (patch.routeDistanceM !== undefined) {
      sets.push(`route_distance_m = ${bind(patch.routeDistanceM, '::int')}`);
    }
    if (patch.searchStoppedNow === true) {
      sets.push(`search_stopped_at = ${CLOCK}`);
    }
    if (patch.remindedNow === 5) {
      sets.push(`reminded_5_at = ${CLOCK}`);
    }
    if (patch.remindedNow === 15) {
      sets.push(`reminded_15_at = ${CLOCK}`);
    }
    if (patch.pickedUpNow === true) {
      sets.push(`picked_up_at = ${CLOCK}`);
    }
    if (patch.endedNow === true) {
      sets.push(`ended_at = ${CLOCK}`);
    }
    if (patch.endReason !== undefined) {
      sets.push(`end_reason = ${bind(patch.endReason, '::varchar')}`);
    }
    const result = await context.query<RawDelivery>(
      `UPDATE app.deliveries d SET ${sets.join(', ')} WHERE d.delivery_id = $1::uuid AND d.version = $2::bigint RETURNING ${DELIVERY_COLUMNS}`,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDelivery(row);
  }

  /** Waiting deliveries whose window has closed, oldest first; locked (skipping rows another sweeper holds) so two sweepers never take the same one. */
  async claimExpired(context: TransactionContext, limit: number): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(
      `SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d
        WHERE d.state = 'waiting_driver' AND d.search_expires_at <= ${CLOCK}
        ORDER BY d.search_expires_at, d.delivery_id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return result.rows.map(toDelivery);
  }

  /** Waiting deliveries that may owe a 5 or 15 minute reminder (not expired, a mark reached and not yet sent). The caller re-checks under the lock. */
  async listReminderCandidates(context: TransactionContext, limit: number): Promise<DeliveryRow[]> {
    const result = await context.query<RawDelivery>(
      `SELECT ${DELIVERY_COLUMNS} FROM app.deliveries d
        WHERE d.state = 'waiting_driver' AND d.search_expires_at > ${CLOCK}
          AND ((d.reminded_5_at IS NULL AND d.search_started_at + interval '5 minutes' <= ${CLOCK})
            OR (d.reminded_15_at IS NULL AND d.search_started_at + interval '15 minutes' <= ${CLOCK}))
        ORDER BY d.search_started_at, d.delivery_id LIMIT $1`,
      [limit],
    );
    return result.rows.map(toDelivery);
  }

  // ---- assignments -----------------------------------------------------------------------------------------------------------

  async insertAssignment(
    context: TransactionContext,
    a: { assignmentId: string; deliveryId: string; driverId: string; originalEtaAtMs: number | null; commissionVnd: bigint; commissionPolicy: string; destinationConfirmed: boolean },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, status, accepted_at, original_eta_at, commission_vnd, commission_policy,
                                             destination_confirmed_at, version, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'ACTIVE', clock.t, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint / 1000.0) END, $5::bigint, $6,
              CASE WHEN $7::boolean THEN clock.t ELSE NULL END, 1, clock.t, clock.t
         FROM (SELECT ${CLOCK} AS t) AS clock`,
      [a.assignmentId, a.deliveryId, a.driverId, a.originalEtaAtMs, a.commissionVnd.toString(), a.commissionPolicy, a.destinationConfirmed],
    );
  }

  async lockActiveAssignment(context: TransactionContext, deliveryId: string): Promise<AssignmentRow | undefined> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.delivery_id = $1::uuid AND a.status = 'ACTIVE' FOR UPDATE`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAssignment(row);
  }

  async findActiveAssignment(context: TransactionContext, deliveryId: string): Promise<AssignmentRow | undefined> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.delivery_id = $1::uuid AND a.status = 'ACTIVE'`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAssignment(row);
  }

  async findAssignment(context: TransactionContext, assignmentId: string): Promise<AssignmentRow | undefined> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.assignment_id = $1::uuid`, [assignmentId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAssignment(row);
  }

  /** Every assignment of a delivery, oldest first (the history). */
  async listAssignments(context: TransactionContext, deliveryId: string): Promise<AssignmentRow[]> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.delivery_id = $1::uuid ORDER BY a.accepted_at, a.assignment_id`, [deliveryId]);
    return result.rows.map(toAssignment);
  }

  /** The open assignments of a Shipper, in the order they were accepted. */
  async listActiveOfDriver(context: TransactionContext, driverId: string): Promise<AssignmentRow[]> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.driver_id = $1::uuid AND a.status = 'ACTIVE' ORDER BY a.accepted_at, a.assignment_id`, [driverId]);
    return result.rows.map(toAssignment);
  }

  /** The assignments of a Shipper that ended, newest first (their history). */
  async listEndedOfDriver(context: TransactionContext, driverId: string, limit: number): Promise<AssignmentRow[]> {
    const result = await context.query<RawAssignment>(`SELECT ${A_COLUMNS} FROM app.delivery_assignments a WHERE a.driver_id = $1::uuid AND a.status <> 'ACTIVE' ORDER BY a.ended_at DESC, a.assignment_id LIMIT $2`, [driverId, limit]);
    return result.rows.map(toAssignment);
  }

  async countActiveOfDriver(context: TransactionContext, driverId: string): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.delivery_assignments WHERE driver_id = $1::uuid AND status = 'ACTIVE'`, [driverId]);
    return safe(result.rows[0]?.n);
  }

  /** Ends an active assignment (the version is checked). Returns false when it was not ACTIVE at that version. */
  async endAssignment(context: TransactionContext, assignmentId: string, expectedVersion: number, status: Exclude<AssignmentStatus, 'ACTIVE'>, actor: ActorType, reason: string | null): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.delivery_assignments SET status = $3::varchar, ended_at = ${CLOCK}, end_actor = $4::varchar, end_reason = $5::varchar, version = version + 1, updated_at = ${CLOCK}
        WHERE assignment_id = $1::uuid AND version = $2::bigint AND status = 'ACTIVE'`,
      [assignmentId, expectedVersion, status, actor, reason],
    );
    return result.rowCount === 1;
  }

  /** Marks the destination confirmed / the goods picked up / a reminder sent on an active assignment. */
  async touchAssignment(context: TransactionContext, assignmentId: string, expectedVersion: number, what: 'destination' | 'pickup' | 'reminder'): Promise<boolean> {
    const column = what === 'destination' ? 'destination_confirmed_at' : what === 'pickup' ? 'picked_up_at' : 'last_pickup_reminder_at';
    const result = await context.query(
      `UPDATE app.delivery_assignments SET ${column} = ${CLOCK}, version = version + 1, updated_at = ${CLOCK}
        WHERE assignment_id = $1::uuid AND version = $2::bigint AND status = 'ACTIVE'`,
      [assignmentId, expectedVersion],
    );
    return result.rowCount === 1;
  }

  /** Active assignments that are accepted, not picked up and owe a reminder (the sweeper re-checks under the delivery lock). */
  async listPickupReminderCandidates(context: TransactionContext, limit: number): Promise<AssignmentRow[]> {
    const result = await context.query<RawAssignment>(
      `SELECT ${A_COLUMNS} FROM app.delivery_assignments a
        WHERE a.status = 'ACTIVE' AND a.picked_up_at IS NULL
          AND COALESCE(a.last_pickup_reminder_at, a.accepted_at) + interval '5 minutes' <= ${CLOCK}
        ORDER BY COALESCE(a.last_pickup_reminder_at, a.accepted_at), a.assignment_id LIMIT $1`,
      [limit],
    );
    return result.rows.map(toAssignment);
  }

  // ---- events ----------------------------------------------------------------------------------------------------------------

  /** Appends an event with the next sequence number. The caller holds the delivery row lock, so the sequence cannot collide. */
  async appendEvent(context: TransactionContext, e: { eventId: string; deliveryId: string; type: string; actorType: ActorType; actorId: string | null; assignmentId: string | null; note: string | null }): Promise<void> {
    await context.query(
      `INSERT INTO app.delivery_events (event_id, delivery_id, seq, event_type, actor_type, actor_id, assignment_id, note, created_at)
       SELECT $1::uuid, $2::uuid, COALESCE(MAX(v.seq), 0) + 1, $3, $4, $5::uuid, $6::uuid, $7, ${CLOCK}
         FROM (SELECT seq FROM app.delivery_events WHERE delivery_id = $2::uuid) AS v`,
      [e.eventId, e.deliveryId, e.type, e.actorType, e.actorId, e.assignmentId, e.note],
    );
  }

  async listEvents(context: TransactionContext, deliveryId: string, limit: number): Promise<EventRow[]> {
    const result = await context.query<{ seq: number; event_type: string; actor_type: ActorType; actor_id: string | null; assignment_id: string | null; note: string | null; at_ms: string }>(
      `SELECT seq, event_type, actor_type, actor_id::text AS actor_id, assignment_id::text AS assignment_id, note, ${ms('created_at', 'at_ms')}
         FROM app.delivery_events WHERE delivery_id = $1::uuid ORDER BY seq LIMIT $2`,
      [deliveryId, limit],
    );
    return result.rows.map((row) => ({ seq: row.seq, type: row.event_type, actorType: row.actor_type, actorId: row.actor_id, assignmentId: row.assignment_id, note: row.note, atMs: safe(row.at_ms) }));
  }

  // ---- incidents -------------------------------------------------------------------------------------------------------------

  async insertIncident(
    context: TransactionContext,
    i: { incidentId: string; deliveryId: string; assignmentId: string; driverId: string; reasonCode: FailReasonCode; reasonNote: string | null; goodsCondition: GoodsCondition },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.delivery_incidents (incident_id, delivery_id, assignment_id, driver_id, status, custody, reason_code, reason_note, goods_condition, opened_at, version, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'OPEN', 'SHIPPER', $5, $6, $7, clock.t, 1, clock.t, clock.t FROM (SELECT ${CLOCK} AS t) AS clock`,
      [i.incidentId, i.deliveryId, i.assignmentId, i.driverId, i.reasonCode, i.reasonNote, i.goodsCondition],
    );
  }

  async findIncident(context: TransactionContext, deliveryId: string): Promise<IncidentRow | undefined> {
    const result = await context.query<RawIncident>(`SELECT ${I_COLUMNS} FROM app.delivery_incidents i WHERE i.delivery_id = $1::uuid`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toIncident(row);
  }

  async lockIncident(context: TransactionContext, deliveryId: string): Promise<IncidentRow | undefined> {
    const result = await context.query<RawIncident>(`SELECT ${I_COLUMNS} FROM app.delivery_incidents i WHERE i.delivery_id = $1::uuid FOR UPDATE`, [deliveryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toIncident(row);
  }

  /** Settles the goods: SHOP (back at the shop) or HANDLED (dealt with, no new delivery). The version is checked; false when it did not match. */
  async closeIncident(context: TransactionContext, incidentId: string, expectedVersion: number, custody: 'SHOP' | 'HANDLED', closedBy: string, note: string | null): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.delivery_incidents SET status = 'CLOSED', custody = $3::varchar, closed_at = ${CLOCK}, closed_by = $4::uuid, close_note = $5::varchar, version = version + 1, updated_at = ${CLOCK}
        WHERE incident_id = $1::uuid AND version = $2::bigint AND status = 'OPEN'`,
      [incidentId, expectedVersion, custody, closedBy, note],
    );
    return result.rowCount === 1;
  }

  /** Records that the incident was passed on to the complaints module (M11). */
  async markReferred(context: TransactionContext, incidentId: string, expectedVersion: number, referredBy: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.delivery_incidents SET m11_referred_at = ${CLOCK}, m11_referred_by = $3::uuid, version = version + 1, updated_at = ${CLOCK}
        WHERE incident_id = $1::uuid AND version = $2::bigint AND m11_referred_at IS NULL`,
      [incidentId, expectedVersion, referredBy],
    );
    return result.rowCount === 1;
  }

  /** The open goods-custody incidents of a Shipper: the responsibility guard for closing or settling an account. */
  async countOpenIncidentsOfDriver(context: TransactionContext, driverId: string): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.delivery_incidents WHERE driver_id = $1::uuid AND status = 'OPEN'`, [driverId]);
    return safe(result.rows[0]?.n);
  }

  // ---- admin reads -----------------------------------------------------------------------------------------------------------

  async listForAdmin(
    context: TransactionContext,
    filter: { q: string; state: string | null; goods: 'OPEN' | 'CLOSED' | null; fromMs: number | null; toMs: number | null; shop: string; driverIds: readonly string[] | null },
    page: { limit: number; offset: number },
  ): Promise<{ rows: Array<{ delivery: DeliveryRow; driverId: string | null; incidentStatus: 'OPEN' | 'CLOSED' | null; custody: Custody | null }>; total: number }> {
    const like = (value: string): string | null => (value === '' ? null : `%${value.replace(/[\\%_]/g, '\\$&')}%`);
    const params = [like(filter.q), filter.state, filter.goods, filter.fromMs, filter.toMs, like(filter.shop), filter.driverIds === null ? null : [...filter.driverIds]];
    const where = `($1::text IS NULL OR d.code ILIKE $1 ESCAPE '\\')
          AND ($2::text IS NULL OR d.state = $2)
          AND ($3::text IS NULL OR (i.incident_id IS NOT NULL AND i.status = $3))
          AND ($4::bigint IS NULL OR d.created_at >= to_timestamp($4::bigint / 1000.0))
          AND ($5::bigint IS NULL OR d.created_at < to_timestamp($5::bigint / 1000.0))
          AND ($6::text IS NULL OR d.shop_name ILIKE $6 ESCAPE '\\')
          AND ($7::uuid[] IS NULL OR COALESCE(a.driver_id, i.driver_id) = ANY($7::uuid[]))`;
    const from = `FROM app.deliveries d
         LEFT JOIN app.delivery_incidents i ON i.delivery_id = d.delivery_id
         LEFT JOIN app.delivery_assignments a ON a.delivery_id = d.delivery_id AND a.status = 'ACTIVE'`;
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n ${from} WHERE ${where}`, params);
    const result = await context.query<RawDelivery & { driver_id: string | null; incident_status: 'OPEN' | 'CLOSED' | null; incident_custody: Custody | null }>(
      `SELECT ${DELIVERY_COLUMNS}, COALESCE(a.driver_id, i.driver_id)::text AS driver_id, i.status AS incident_status, i.custody AS incident_custody
         ${from} WHERE ${where}
        ORDER BY d.updated_at DESC, d.delivery_id LIMIT $8 OFFSET $9`,
      [...params, page.limit, page.offset],
    );
    return {
      total: safe(total.rows[0]?.n),
      rows: result.rows.map((row) => ({ delivery: toDelivery(row), driverId: row.driver_id, incidentStatus: row.incident_status, custody: row.incident_custody })),
    };
  }

  /** The four counters of the Admin list (all deliveries, not the filtered page). */
  async counters(context: TransactionContext): Promise<{ searching: number; waitingPickup: number; delivering: number; needsAttention: number }> {
    const result = await context.query<{ searching: string; waiting: string; delivering: string; attention: string }>(
      `SELECT count(*) FILTER (WHERE state = 'waiting_driver')::text AS searching,
              count(*) FILTER (WHERE state IN ('accepted', 'location_confirmed'))::text AS waiting,
              count(*) FILTER (WHERE state IN ('picked_up', 'delivering'))::text AS delivering,
              (count(*) FILTER (WHERE state = 'search_stopped')
               + (SELECT count(*) FROM app.delivery_incidents WHERE status = 'OPEN'))::text AS attention
         FROM app.deliveries`,
    );
    const row = result.rows[0];
    return { searching: safe(row?.searching), waitingPickup: safe(row?.waiting), delivering: safe(row?.delivering), needsAttention: safe(row?.attention) };
  }
}
