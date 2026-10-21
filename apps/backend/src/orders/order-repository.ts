import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { DeliveryState } from '../delivery/delivery-constants';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
import { OrderActor, OrderStatus } from './order-constants';

// SQL of app.customer_carts, app.orders, app.order_items and app.order_events (M10 owns the four). Every method takes the caller's TransactionContext: none of
// them begins, commits or rolls back. Times are read as epoch milliseconds and written with the database clock; money is a whole number of VND (the tables
// bound it to the safe-integer range). The ONLY read of another module's table is the state of the latest delivery of an Order (a read-only lateral join):
// a delivery is written by M07 alone.

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

export interface OrderRow {
  readonly orderId: string;
  readonly code: string;
  readonly clientRef: string;
  readonly customerUserId: string;
  readonly shopId: string;
  readonly status: OrderStatus;
  readonly version: number;
  readonly shopName: string;
  readonly shopPhone: string;
  readonly shopAddressText: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly addressLat: number | null;
  readonly addressLng: number | null;
  readonly sourceAddressId: string | null;
  readonly note: string | null;
  readonly scheduledForMs: number | null;
  readonly itemsOriginalTotalVnd: number;
  readonly itemsTotalVnd: number;
  readonly paidVnd: number;
  readonly feeEstimateVnd: number | null;
  readonly feeEstimateDistanceM: number | null;
  readonly editedAtMs: number | null;
  readonly changeReason: string | null;
  readonly confirmedAtMs: number | null;
  readonly readyAtMs: number | null;
  readonly scheduleRemindedAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly endActor: OrderActor | null;
  readonly endReason: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

interface RawOrder {
  order_id: string;
  code: string;
  client_ref: string;
  customer_user_id: string;
  shop_id: string;
  status: OrderStatus;
  version: string;
  shop_name: string;
  shop_phone: string;
  shop_address_text: string;
  recipient_name: string;
  recipient_phone: string;
  address_text: string;
  address_lat: number | null;
  address_lng: number | null;
  source_address_id: string | null;
  note: string | null;
  scheduled_ms: string | null;
  items_original_total_vnd: string;
  items_total_vnd: string;
  paid_vnd: string;
  fee_estimate_vnd: string | null;
  fee_estimate_distance_m: number | null;
  edited_ms: string | null;
  change_reason: string | null;
  confirmed_ms: string | null;
  ready_ms: string | null;
  reminded_ms: string | null;
  ended_ms: string | null;
  end_actor: OrderActor | null;
  end_reason: string | null;
  created_ms: string;
  updated_ms: string;
}

export const ORDER_COLUMNS = `o.order_id::text AS order_id, o.code, o.client_ref::text AS client_ref, o.customer_user_id::text AS customer_user_id, o.shop_id::text AS shop_id,
  o.status, o.version::text AS version, o.shop_name, o.shop_phone, o.shop_address_text, o.recipient_name, o.recipient_phone, o.address_text, o.address_lat, o.address_lng,
  o.source_address_id::text AS source_address_id, o.note, ${ms('o.scheduled_for', 'scheduled_ms')},
  o.items_original_total_vnd::text AS items_original_total_vnd, o.items_total_vnd::text AS items_total_vnd, o.paid_vnd::text AS paid_vnd,
  o.fee_estimate_vnd::text AS fee_estimate_vnd, o.fee_estimate_distance_m, ${ms('o.edited_at', 'edited_ms')}, o.change_reason,
  ${ms('o.confirmed_at', 'confirmed_ms')}, ${ms('o.ready_at', 'ready_ms')}, ${ms('o.schedule_reminded_at', 'reminded_ms')}, ${ms('o.ended_at', 'ended_ms')}, o.end_actor, o.end_reason,
  ${ms('o.created_at', 'created_ms')}, ${ms('o.updated_at', 'updated_ms')}`;

function toOrder(row: RawOrder): OrderRow {
  return {
    orderId: row.order_id,
    code: row.code,
    clientRef: row.client_ref,
    customerUserId: row.customer_user_id,
    shopId: row.shop_id,
    status: row.status,
    version: safe(row.version),
    shopName: row.shop_name,
    shopPhone: row.shop_phone,
    shopAddressText: row.shop_address_text,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    addressText: row.address_text,
    addressLat: row.address_lat,
    addressLng: row.address_lng,
    sourceAddressId: row.source_address_id,
    note: row.note,
    scheduledForMs: safeOrNull(row.scheduled_ms),
    itemsOriginalTotalVnd: safe(row.items_original_total_vnd),
    itemsTotalVnd: safe(row.items_total_vnd),
    paidVnd: safe(row.paid_vnd),
    feeEstimateVnd: safeOrNull(row.fee_estimate_vnd),
    feeEstimateDistanceM: row.fee_estimate_distance_m,
    editedAtMs: safeOrNull(row.edited_ms),
    changeReason: row.change_reason,
    confirmedAtMs: safeOrNull(row.confirmed_ms),
    readyAtMs: safeOrNull(row.ready_ms),
    scheduleRemindedAtMs: safeOrNull(row.reminded_ms),
    endedAtMs: safeOrNull(row.ended_ms),
    endActor: row.end_actor,
    endReason: row.end_reason,
    createdAtMs: safe(row.created_ms),
    updatedAtMs: safe(row.updated_ms),
  };
}

export interface OrderListItem {
  readonly order: OrderRow;
  /** The state of the most recent delivery of the Order, or null when none was ever called. */
  readonly latestDelivery: DeliveryState | null;
  readonly lineCount: number;
}

export interface NewOrder {
  readonly orderId: string;
  readonly code: string;
  readonly clientRef: string;
  readonly customerUserId: string;
  readonly shopId: string;
  readonly shopName: string;
  readonly shopPhone: string;
  readonly shopAddressText: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly addressLat: number | null;
  readonly addressLng: number | null;
  readonly sourceAddressId: string | null;
  readonly note: string | null;
  readonly scheduledForMs: number | null;
  readonly itemsTotalVnd: number;
  readonly feeEstimateVnd: number | null;
  readonly feeEstimateDistanceM: number | null;
}

export interface NewItem {
  readonly lineId: string;
  readonly lineNo: number;
  readonly menuItemId: string;
  readonly name: string;
  readonly note: string | null;
  readonly unitPriceVnd: number;
  readonly quantity: number;
}

export interface ItemRow {
  readonly lineId: string;
  readonly orderId: string;
  readonly lineNo: number;
  readonly menuItemId: string;
  readonly name: string;
  readonly note: string | null;
  readonly origUnitPriceVnd: number;
  readonly origQuantity: number;
  readonly unitPriceVnd: number;
  readonly quantity: number;
  readonly removedAtMs: number | null;
}

interface RawItem {
  line_id: string;
  order_id: string;
  line_no: number;
  menu_item_id: string;
  name: string;
  note: string | null;
  orig_unit_price_vnd: string;
  orig_quantity: number;
  unit_price_vnd: string;
  quantity: number;
  removed_ms: string | null;
}

const ITEM_COLUMNS = `i.line_id::text AS line_id, i.order_id::text AS order_id, i.line_no, i.menu_item_id::text AS menu_item_id, i.name, i.note,
  i.orig_unit_price_vnd::text AS orig_unit_price_vnd, i.orig_quantity, i.unit_price_vnd::text AS unit_price_vnd, i.quantity, ${ms('i.removed_at', 'removed_ms')}`;

function toItem(row: RawItem): ItemRow {
  return {
    lineId: row.line_id,
    orderId: row.order_id,
    lineNo: row.line_no,
    menuItemId: row.menu_item_id,
    name: row.name,
    note: row.note,
    origUnitPriceVnd: safe(row.orig_unit_price_vnd),
    origQuantity: row.orig_quantity,
    unitPriceVnd: safe(row.unit_price_vnd),
    quantity: row.quantity,
    removedAtMs: safeOrNull(row.removed_ms),
  };
}

export interface OrderEventRow {
  readonly eventId: string;
  readonly type: string;
  readonly actorType: OrderActor;
  readonly actorId: string | null;
  readonly note: string | null;
  readonly details: JsonObject | null;
  readonly atMs: number;
}

export interface OrderPatch {
  readonly status?: OrderStatus;
  readonly itemsTotalVnd?: number;
  readonly paidVnd?: number;
  readonly editedNow?: true;
  readonly changeReason?: string | null;
  readonly confirmedNow?: true;
  readonly readyNow?: true;
  readonly scheduleRemindedNow?: true;
  readonly endedNow?: OrderActor;
  readonly endReason?: string | null;
}

export interface CartRow {
  readonly shopId: string;
  readonly lines: readonly { readonly itemId: string; readonly quantity: number; readonly note: string | null; readonly name: string }[];
  readonly note: string | null;
  readonly version: number;
  readonly updatedAtMs: number;
}

export type CustomerScope = 'processing' | 'scheduled' | 'history';

export interface ShopListFilter {
  readonly filter: 'all' | 'pending' | 'preparing' | 'scheduled' | 'delivering' | 'attention' | 'history';
  readonly q: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

export interface AdminListFilter {
  readonly q: string;
  readonly status: string;
  readonly shop: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

const LATEST = `LEFT JOIN LATERAL (SELECT d.state FROM app.deliveries d WHERE d.order_id = o.order_id ORDER BY d.created_at DESC, d.delivery_id DESC LIMIT 1) ld ON true`;
const LINE_COUNT = `(SELECT count(*)::int FROM app.order_items i WHERE i.order_id = o.order_id AND i.removed_at IS NULL) AS line_count`;
const ENDED = `('COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED')`;

type RawListItem = RawOrder & { latest_state: DeliveryState | null; line_count: number };

function toListItem(row: RawListItem): OrderListItem {
  return { order: toOrder(row), latestDelivery: row.latest_state, lineCount: row.line_count };
}

const like = (value: string): string | null => (value === '' ? null : `%${value.replace(/[\\%_]/g, '\\$&')}%`);
const msToTs = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString());

@Injectable()
export class OrderRepository {
  // ---- carts ------------------------------------------------------------------------------------------------------------------

  async findCart(context: TransactionContext, userId: string): Promise<CartRow | undefined> {
    const result = await context.query<{ shop_id: string; lines: unknown; note: string | null; version: string; updated_ms: string }>(
      `SELECT shop_id::text AS shop_id, lines, note, version::text AS version, ${ms('updated_at', 'updated_ms')} FROM app.customer_carts WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (!Array.isArray(row.lines)) {
      throw new TechnicalError('internal', 'Database returned an unexpected cart');
    }
    const lines = (row.lines as unknown[]).map((entry) => {
      const e = entry as { item_id?: unknown; quantity?: unknown; note?: unknown; name?: unknown };
      if (typeof e.item_id !== 'string' || typeof e.quantity !== 'number' || typeof e.name !== 'string') {
        throw new TechnicalError('internal', 'Database returned an unexpected cart line');
      }
      return { itemId: e.item_id, quantity: e.quantity, note: typeof e.note === 'string' ? e.note : null, name: e.name };
    });
    return { shopId: row.shop_id, lines, note: row.note, version: safe(row.version), updatedAtMs: safe(row.updated_ms) };
  }

  /** The cart replaced as a whole (one row per customer). */
  async upsertCart(context: TransactionContext, userId: string, shopId: string, lines: readonly { itemId: string; quantity: number; note: string | null; name: string }[], note: string | null): Promise<CartRow> {
    await context.query(
      `INSERT INTO app.customer_carts (user_id, shop_id, lines, note, version, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3::jsonb, $4, 1, clock.t, clock.t FROM (SELECT ${CLOCK} AS t) AS clock
       ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, lines = EXCLUDED.lines, note = EXCLUDED.note,
         version = app.customer_carts.version + 1, updated_at = EXCLUDED.updated_at`,
      [userId, shopId, JSON.stringify(lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, note: l.note, name: l.name }))), note],
    );
    const cart = await this.findCart(context, userId);
    if (cart === undefined) {
      throw new TechnicalError('internal', 'Cart vanished after write');
    }
    return cart;
  }

  async deleteCart(context: TransactionContext, userId: string): Promise<void> {
    await context.query('DELETE FROM app.customer_carts WHERE user_id = $1::uuid', [userId]);
  }

  // ---- orders -----------------------------------------------------------------------------------------------------------------

  /** Inserts the Order in PENDING_CONFIRMATION with its lines (original = current). A code or client_ref collision returns false. */
  async insert(context: TransactionContext, o: NewOrder, items: readonly NewItem[]): Promise<boolean> {
    const inserted = await context.query(
      `INSERT INTO app.orders (
         order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
         address_lat, address_lng, source_address_id, note, scheduled_for, items_original_total_vnd, items_total_vnd, paid_vnd, fee_estimate_vnd, fee_estimate_distance_m,
         version, created_at, updated_at)
       SELECT $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'PENDING_CONFIRMATION', $6, $7, $8, $9, $10, $11,
              $12::float8, $13::float8, $14::uuid, $15, $16::timestamptz, $17::bigint, $17::bigint, 0, $18::bigint, $19::int,
              1, clock.t, clock.t
         FROM (SELECT ${CLOCK} AS t) AS clock
       ON CONFLICT DO NOTHING`,
      [
        o.orderId, o.code, o.clientRef, o.customerUserId, o.shopId, o.shopName, o.shopPhone, o.shopAddressText, o.recipientName, o.recipientPhone, o.addressText,
        o.addressLat, o.addressLng, o.sourceAddressId, o.note, msToTs(o.scheduledForMs), o.itemsTotalVnd, o.feeEstimateVnd, o.feeEstimateDistanceM,
      ],
    );
    if (inserted.rowCount !== 1) {
      return false;
    }
    for (const item of items) {
      await context.query(
        `INSERT INTO app.order_items (line_id, order_id, line_no, menu_item_id, name, note, orig_unit_price_vnd, orig_quantity, unit_price_vnd, quantity, created_at)
         SELECT $1::uuid, $2::uuid, $3::smallint, $4::uuid, $5, $6, $7::bigint, $8::int, $7::bigint, $8::int, clock.t FROM (SELECT ${CLOCK} AS t) AS clock`,
        [item.lineId, o.orderId, item.lineNo, item.menuItemId, item.name, item.note, item.unitPriceVnd, item.quantity],
      );
    }
    return true;
  }

  async findById(context: TransactionContext, orderId: string): Promise<OrderRow | undefined> {
    const result = await context.query<RawOrder>(`SELECT ${ORDER_COLUMNS} FROM app.orders o WHERE o.order_id = $1::uuid`, [orderId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toOrder(row);
  }

  async lockById(context: TransactionContext, orderId: string): Promise<OrderRow | undefined> {
    const result = await context.query<RawOrder>(`SELECT ${ORDER_COLUMNS} FROM app.orders o WHERE o.order_id = $1::uuid FOR UPDATE`, [orderId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toOrder(row);
  }

  async findOfCustomer(context: TransactionContext, orderId: string, userId: string): Promise<OrderRow | undefined> {
    const found = await this.findById(context, orderId);
    return found !== undefined && found.customerUserId === userId ? found : undefined;
  }

  async findOfShop(context: TransactionContext, orderId: string, shopId: string): Promise<OrderRow | undefined> {
    const found = await this.findById(context, orderId);
    return found !== undefined && found.shopId === shopId ? found : undefined;
  }

  async findByClientRef(context: TransactionContext, userId: string, clientRef: string): Promise<OrderRow | undefined> {
    const result = await context.query<RawOrder>(`SELECT ${ORDER_COLUMNS} FROM app.orders o WHERE o.customer_user_id = $1::uuid AND o.client_ref = $2::uuid`, [userId, clientRef]);
    const row = result.rows[0];
    return row === undefined ? undefined : toOrder(row);
  }

  /** The state of the latest delivery of an Order (read only; M07 owns the table). */
  async latestDeliveryState(context: TransactionContext, orderId: string): Promise<DeliveryState | null> {
    const result = await context.query<{ state: DeliveryState }>(`SELECT d.state FROM app.deliveries d WHERE d.order_id = $1::uuid ORDER BY d.created_at DESC, d.delivery_id DESC LIMIT 1`, [orderId]);
    return result.rows[0]?.state ?? null;
  }

  async listForCustomer(context: TransactionContext, userId: string, scope: CustomerScope, limit: number, offset: number): Promise<OrderListItem[]> {
    const result = await context.query<RawListItem>(
      `SELECT ${ORDER_COLUMNS}, ld.state AS latest_state, ${LINE_COUNT}
         FROM app.orders o ${LATEST}
        WHERE o.customer_user_id = $1::uuid
          AND CASE $2::text
                WHEN 'processing' THEN o.status NOT IN ${ENDED} AND o.scheduled_for IS NULL
                WHEN 'scheduled' THEN o.status NOT IN ${ENDED} AND o.scheduled_for IS NOT NULL
                ELSE o.status IN ${ENDED} END
        ORDER BY CASE WHEN $2::text = 'scheduled' THEN o.scheduled_for END ASC NULLS LAST, o.created_at DESC, o.order_id
        LIMIT $3 OFFSET $4`,
      [userId, scope, limit, offset],
    );
    return result.rows.map(toListItem);
  }

  async listForShop(context: TransactionContext, shopId: string, f: ShopListFilter, limit: number, offset: number): Promise<OrderListItem[]> {
    const result = await context.query<RawListItem>(
      `SELECT ${ORDER_COLUMNS}, ld.state AS latest_state, ${LINE_COUNT}
         FROM app.orders o ${LATEST}
        WHERE o.shop_id = $1::uuid
          AND CASE $2::text
                WHEN 'all' THEN o.status NOT IN ${ENDED}
                WHEN 'pending' THEN o.status = 'PENDING_CONFIRMATION'
                WHEN 'preparing' THEN o.status = 'PREPARING' AND COALESCE(ld.state, '') NOT IN ('delivering', 'picked_up', 'search_stopped', 'failed')
                WHEN 'scheduled' THEN o.status NOT IN ${ENDED} AND o.scheduled_for IS NOT NULL
                WHEN 'delivering' THEN o.status = 'PREPARING' AND ld.state IN ('delivering', 'picked_up')
                WHEN 'attention' THEN o.status = 'PREPARING' AND ld.state IN ('search_stopped', 'failed')
                ELSE o.status IN ${ENDED} END
          AND ($3::text IS NULL OR o.code ILIKE $3 ESCAPE '\\' OR o.recipient_name ILIKE $3 ESCAPE '\\')
          AND ($4::timestamptz IS NULL OR o.created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR o.created_at < $5::timestamptz)
        ORDER BY CASE WHEN $2::text = 'scheduled' THEN o.scheduled_for END ASC NULLS LAST, o.created_at DESC, o.order_id
        LIMIT $6 OFFSET $7`,
      [shopId, f.filter, like(f.q), msToTs(f.fromMs), msToTs(f.toMs), limit, offset],
    );
    return result.rows.map(toListItem);
  }

  /** Counters for the shop's filters (one pass). */
  async countsForShop(context: TransactionContext, shopId: string): Promise<{ pending: number; preparing: number; scheduled: number; delivering: number; attention: number }> {
    const result = await context.query<{ pending: number; preparing: number; scheduled: number; delivering: number; attention: number }>(
      `SELECT count(*) FILTER (WHERE o.status = 'PENDING_CONFIRMATION')::int AS pending,
              count(*) FILTER (WHERE o.status = 'PREPARING' AND COALESCE(ld.state, '') NOT IN ('delivering', 'picked_up', 'search_stopped', 'failed'))::int AS preparing,
              count(*) FILTER (WHERE o.status NOT IN ${ENDED} AND o.scheduled_for IS NOT NULL)::int AS scheduled,
              count(*) FILTER (WHERE o.status = 'PREPARING' AND ld.state IN ('delivering', 'picked_up'))::int AS delivering,
              count(*) FILTER (WHERE o.status = 'PREPARING' AND ld.state IN ('search_stopped', 'failed'))::int AS attention
         FROM app.orders o ${LATEST} WHERE o.shop_id = $1::uuid`,
      [shopId],
    );
    return result.rows[0] ?? { pending: 0, preparing: 0, scheduled: 0, delivering: 0, attention: 0 };
  }

  async listForAdmin(context: TransactionContext, f: AdminListFilter, limit: number, offset: number): Promise<{ rows: OrderListItem[]; total: number }> {
    const params = [like(f.q), f.status === '' ? null : f.status, like(f.shop), msToTs(f.fromMs), msToTs(f.toMs)];
    const where = `($1::text IS NULL OR o.code ILIKE $1 ESCAPE '\\' OR o.recipient_name ILIKE $1 ESCAPE '\\' OR o.recipient_phone ILIKE $1 ESCAPE '\\')
          AND ($2::text IS NULL OR o.status = $2)
          AND ($3::text IS NULL OR o.shop_name ILIKE $3 ESCAPE '\\')
          AND ($4::timestamptz IS NULL OR o.created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR o.created_at < $5::timestamptz)`;
    const total = await context.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.orders o WHERE ${where}`, params);
    const result = await context.query<RawListItem>(
      `SELECT ${ORDER_COLUMNS}, ld.state AS latest_state, ${LINE_COUNT}
         FROM app.orders o ${LATEST}
        WHERE ${where}
        ORDER BY o.created_at DESC, o.order_id
        LIMIT $6 OFFSET $7`,
      [...params, limit, offset],
    );
    return { rows: result.rows.map(toListItem), total: total.rows[0]?.n ?? 0 };
  }

  /**
   * Applies a patch to a row the caller holds locked. The version is checked in the statement and advanced by it; undefined when no row matched. The
   * database guard (app.orders_guard) is the last line: it refuses an illegal transition, a changed snapshot or a locked amount.
   */
  async update(context: TransactionContext, orderId: string, expectedVersion: number, patch: OrderPatch): Promise<OrderRow | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [orderId, expectedVersion];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      sets.push(sql.replace('?', `$${String(values.length)}`));
    };
    if (patch.status !== undefined) add('status = ?', patch.status);
    if (patch.itemsTotalVnd !== undefined) add('items_total_vnd = ?::bigint', patch.itemsTotalVnd);
    if (patch.paidVnd !== undefined) add('paid_vnd = ?::bigint', patch.paidVnd);
    if (patch.editedNow === true) sets.push(`edited_at = COALESCE(edited_at, ${CLOCK})`);
    if (patch.changeReason !== undefined) add('change_reason = ?', patch.changeReason);
    if (patch.confirmedNow === true) sets.push(`confirmed_at = ${CLOCK}`);
    if (patch.readyNow === true) sets.push(`ready_at = ${CLOCK}`);
    if (patch.scheduleRemindedNow === true) sets.push(`schedule_reminded_at = ${CLOCK}`);
    if (patch.endedNow !== undefined) {
      sets.push(`ended_at = ${CLOCK}`);
      add('end_actor = ?', patch.endedNow);
    }
    if (patch.endReason !== undefined) add('end_reason = ?', patch.endReason);
    const result = await context.query<RawOrder>(
      `UPDATE app.orders o SET ${sets.join(', ')}${sets.length > 0 ? ', ' : ''}version = o.version + 1, updated_at = GREATEST(${CLOCK}, o.updated_at)
        WHERE o.order_id = $1::uuid AND o.version = $2::bigint
        RETURNING ${ORDER_COLUMNS}`,
      values,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toOrder(row);
  }

  /** Orders whose wanted time is close, confirmed, not yet reminded (the reminder is sent once). */
  async claimScheduleReminders(context: TransactionContext, leadMs: number, limit: number): Promise<OrderRow[]> {
    const result = await context.query<RawOrder>(
      `SELECT ${ORDER_COLUMNS} FROM app.orders o
        WHERE o.status = 'PREPARING' AND o.scheduled_for IS NOT NULL AND o.schedule_reminded_at IS NULL
          AND o.scheduled_for - ($1::bigint * interval '1 millisecond') <= ${CLOCK}
        ORDER BY o.scheduled_for, o.order_id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [leadMs, limit],
    );
    return result.rows.map(toOrder);
  }

  // ---- items ------------------------------------------------------------------------------------------------------------------

  async listItems(context: TransactionContext, orderId: string): Promise<ItemRow[]> {
    const result = await context.query<RawItem>(`SELECT ${ITEM_COLUMNS} FROM app.order_items i WHERE i.order_id = $1::uuid ORDER BY i.line_no`, [orderId]);
    return result.rows.map(toItem);
  }

  /** Applies the shop's edit to one line of an Order that is still waiting for confirmation (the database refuses it otherwise). */
  async updateItem(context: TransactionContext, lineId: string, change: { quantity?: number; unitPriceVnd?: number; remove?: true }): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [lineId];
    if (change.quantity !== undefined) {
      values.push(change.quantity);
      sets.push(`quantity = $${String(values.length)}::int`);
    }
    if (change.unitPriceVnd !== undefined) {
      values.push(change.unitPriceVnd);
      sets.push(`unit_price_vnd = $${String(values.length)}::bigint`);
    }
    if (change.remove === true) {
      sets.push(`removed_at = ${CLOCK}`);
    }
    if (sets.length === 0) {
      return;
    }
    await context.query(`UPDATE app.order_items SET ${sets.join(', ')} WHERE line_id = $1::uuid`, values);
  }

  // ---- events -----------------------------------------------------------------------------------------------------------------

  async appendEvent(context: TransactionContext, e: { eventId: string; orderId: string; type: string; actorType: OrderActor; actorId: string | null; note: string | null; details: JsonObject | null }): Promise<void> {
    await context.query(
      `INSERT INTO app.order_events (event_id, order_id, type, actor_type, actor_id, note, details, at)
       SELECT $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::jsonb, clock.t FROM (SELECT ${CLOCK} AS t) AS clock`,
      [e.eventId, e.orderId, e.type, e.actorType, e.actorId, e.note === null ? null : e.note.slice(0, 480), e.details === null ? null : JSON.stringify(e.details)],
    );
  }

  async listEvents(context: TransactionContext, orderId: string, limit: number): Promise<OrderEventRow[]> {
    const result = await context.query<{ event_id: string; type: string; actor_type: OrderActor; actor_id: string | null; note: string | null; details: JsonObject | null; at_ms: string }>(
      `SELECT event_id::text AS event_id, type, actor_type, actor_id::text AS actor_id, note, details, ${ms('at', 'at_ms')}
         FROM app.order_events WHERE order_id = $1::uuid ORDER BY at, event_id LIMIT $2`,
      [orderId, limit],
    );
    return result.rows.map((r) => ({ eventId: r.event_id, type: r.type, actorType: r.actor_type, actorId: r.actor_id, note: r.note, details: r.details, atMs: safe(r.at_ms) }));
  }
}
