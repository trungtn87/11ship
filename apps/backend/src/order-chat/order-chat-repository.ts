import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ChatRole, ChatRoomType } from './order-chat-constants';
import { FeedCursor } from './order-chat-validation';

// The SQL of app.order_chat_messages, and the two row locks that make "send" and "close" mutually exclusive. Times are stored at millisecond precision, so the
// order of the feed (time, then id) is the same in the database and in memory.

const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export interface ChatMessageRow {
  readonly messageId: string;
  readonly roomType: ChatRoomType;
  readonly roomId: string;
  readonly senderUserId: string;
  readonly senderRole: ChatRole;
  readonly senderName: string;
  readonly body: string;
  readonly clientKey: string;
  readonly atMs: number;
}

interface RawMessage {
  message_id: string;
  room_type: ChatRoomType;
  room_id: string;
  sender_user_id: string;
  sender_role: ChatRole;
  sender_name: string;
  body: string;
  client_key: string;
  at_ms: string;
}

const COLUMNS = `m.message_id::text AS message_id, m.room_type, COALESCE(m.order_id, m.delivery_id)::text AS room_id, m.sender_user_id::text AS sender_user_id, m.sender_role,
  m.sender_name, m.body, m.client_key::text AS client_key, ${ms('m.created_at', 'at_ms')}`;

const toMessage = (r: RawMessage): ChatMessageRow => ({ messageId: r.message_id, roomType: r.room_type, roomId: r.room_id, senderUserId: r.sender_user_id, senderRole: r.sender_role, senderName: r.sender_name, body: r.body, clientKey: r.client_key, atMs: safe(r.at_ms) });

export interface NewMessage {
  readonly messageId: string;
  readonly roomType: ChatRoomType;
  readonly roomId: string;
  readonly senderUserId: string;
  readonly senderRole: ChatRole;
  readonly senderName: string;
  readonly body: string;
  readonly clientKey: string;
}

@Injectable()
export class OrderChatRepository {
  /**
   * Takes a SHARED lock on the order and returns its status AFTER the lock. Every command that ends an order updates the same row, so it waits for the sends
   * already holding this lock and a send that arrives after it committed reads the final status: exactly one of "message first" / "close first" happens.
   */
  async lockOrderStatus(context: TransactionContext, orderId: string): Promise<string | undefined> {
    const result = await context.query<{ status: string }>('SELECT status FROM app.orders WHERE order_id = $1::uuid FOR SHARE', [orderId]);
    return result.rows[0]?.status;
  }

  async lockDeliveryState(context: TransactionContext, deliveryId: string): Promise<string | undefined> {
    const result = await context.query<{ state: string }>('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid FOR SHARE', [deliveryId]);
    return result.rows[0]?.state;
  }

  async findByKey(context: TransactionContext, senderUserId: string, clientKey: string): Promise<ChatMessageRow | undefined> {
    const result = await context.query<RawMessage>(`SELECT ${COLUMNS} FROM app.order_chat_messages m WHERE m.sender_user_id = $1::uuid AND m.client_key = $2::uuid`, [senderUserId, clientKey]);
    const row = result.rows[0];
    return row === undefined ? undefined : toMessage(row);
  }

  /** How many messages this sender wrote in the last `windowMs` (database clock), over all rooms. */
  async countRecent(context: TransactionContext, senderUserId: string, windowMs: number): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.order_chat_messages WHERE sender_user_id = $1::uuid AND created_at > clock_timestamp() - ($2::bigint * interval '1 millisecond')`, [senderUserId, windowMs]);
    return safe(result.rows[0]?.n ?? '0');
  }

  /** Writes the message, or returns undefined when this sender already used this key (the caller then reads the stored message). */
  async insert(context: TransactionContext, m: NewMessage): Promise<ChatMessageRow | undefined> {
    const result = await context.query<RawMessage>(
      `INSERT INTO app.order_chat_messages (message_id, room_type, order_id, delivery_id, sender_user_id, sender_role, sender_name, body, client_key, created_at)
       VALUES ($1::uuid, $2::varchar, CASE WHEN $2::varchar = 'ORDER' THEN $3::uuid END, CASE WHEN $2::varchar = 'DIRECT' THEN $3::uuid END, $4::uuid, $5, $6, $7, $8::uuid, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (sender_user_id, client_key) DO NOTHING
       RETURNING message_id::text AS message_id, room_type, COALESCE(order_id, delivery_id)::text AS room_id, sender_user_id::text AS sender_user_id, sender_role, sender_name, body, client_key::text AS client_key, ${ms('created_at', 'at_ms')}`,
      [m.messageId, m.roomType, m.roomId, m.senderUserId, m.senderRole, m.senderName, m.body, m.clientKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMessage(row);
  }

  /**
   * The messages of a room strictly OLDER than the cursor in the feed order (time, milestones before messages, id), newest first. A cursor on a milestone
   * excludes the messages of its own millisecond, because they sort after it.
   */
  async listOlder(context: TransactionContext, roomType: ChatRoomType, roomId: string, before: FeedCursor | null, limit: number): Promise<ChatMessageRow[]> {
    const column = roomType === 'ORDER' ? 'm.order_id' : 'm.delivery_id';
    const result = await context.query<RawMessage>(
      `SELECT ${COLUMNS} FROM app.order_chat_messages m
        WHERE ${column} = $1::uuid
          AND ($2::bigint IS NULL OR (extract(epoch FROM m.created_at) * 1000)::bigint < $2::bigint OR ((extract(epoch FROM m.created_at) * 1000)::bigint = $2::bigint AND $3::int = 1 AND m.message_id::text < $4))
        ORDER BY m.created_at DESC, m.message_id DESC LIMIT $5`,
      [roomId, before === null ? null : before.atMs, before === null ? 0 : before.rank, before === null ? '' : before.id, limit],
    );
    return result.rows.map(toMessage);
  }

  /**
   * When the room's file closed and whether something keeps it open: the order's (or the direct delivery's) end time, the end of its latest closed complaint,
   * and the number of complaints still open. Retention counts from the LATER of the first two; an open complaint holds the deletion.
   */
  async retentionOf(context: TransactionContext, roomType: ChatRoomType, roomId: string): Promise<{ endedAtMs: number | null; complaintClosedAtMs: number | null; openComplaints: number }> {
    const subject = roomType === 'ORDER' ? 'o.ended_at' : 'd.ended_at';
    const from = roomType === 'ORDER' ? 'app.orders o' : 'app.deliveries d';
    const key = roomType === 'ORDER' ? 'o.order_id' : 'd.delivery_id';
    const complaints = roomType === 'ORDER' ? `x.order_id = o.order_id OR x.delivery_id IN (SELECT t.delivery_id FROM app.deliveries t WHERE t.order_id = o.order_id)` : `x.delivery_id = d.delivery_id`;
    const holds = roomType === 'ORDER' ? 'h.order_id = o.order_id' : 'h.delivery_id = d.delivery_id';
    const result = await context.query<{ ended_ms: string | null; complaint_ms: string | null; open_count: string }>(
      `SELECT (extract(epoch FROM ${subject}) * 1000)::bigint::text AS ended_ms,
              (extract(epoch FROM GREATEST(c.last_closed, hd.last_released)) * 1000)::bigint::text AS complaint_ms,
              (COALESCE(c.open_count, 0) + COALESCE(hd.open_count, 0))::text AS open_count
         FROM ${from}
         LEFT JOIN LATERAL (
           SELECT max(COALESCE(x.closed_at, x.concluded_at, x.updated_at)) FILTER (WHERE x.status IN ('RESOLVED', 'CLOSED_NO_ACTION')) AS last_closed,
                  count(*) FILTER (WHERE x.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AS open_count
             FROM app.complaints x WHERE ${complaints}) c ON true
         LEFT JOIN LATERAL (
           SELECT max(h.released_at) AS last_released, count(*) FILTER (WHERE h.released_at IS NULL) AS open_count
             FROM app.order_chat_holds h WHERE ${holds}) hd ON true
        WHERE ${key} = $1::uuid`,
      [roomId],
    );
    const row = result.rows[0];
    return { endedAtMs: row?.ended_ms == null ? null : safe(row.ended_ms), complaintClosedAtMs: row?.complaint_ms == null ? null : safe(row.complaint_ms), openComplaints: row === undefined ? 0 : safe(row.open_count) };
  }

  /**
   * Deletes, in batches, the messages of rooms whose retention ran out: closed for `days` (counted from the later of the file's end and its last closed
   * complaint, on the database clock) with no complaint still open. Only the typed messages go; order / delivery events and the audit are never touched.
   */
  async purgeExpired(context: TransactionContext, days: number, limit: number): Promise<number> {
    const due = (kind: 'ORDER' | 'DIRECT'): string => {
      const alias = kind === 'ORDER' ? 'o' : 'd';
      const table = kind === 'ORDER' ? 'app.orders o' : 'app.deliveries d';
      const joinOn = kind === 'ORDER' ? 'm.order_id = o.order_id' : 'm.delivery_id = d.delivery_id AND m.order_id IS NULL';
      const complaints = kind === 'ORDER' ? `x.order_id = o.order_id OR x.delivery_id IN (SELECT t.delivery_id FROM app.deliveries t WHERE t.order_id = o.order_id)` : `x.delivery_id = d.delivery_id`;
      const holds = kind === 'ORDER' ? 'h.order_id = o.order_id' : 'h.delivery_id = d.delivery_id';
      return `SELECT m.message_id FROM app.order_chat_messages m JOIN ${table} ON ${joinOn}
               LEFT JOIN LATERAL (
                 SELECT max(COALESCE(x.closed_at, x.concluded_at, x.updated_at)) FILTER (WHERE x.status IN ('RESOLVED', 'CLOSED_NO_ACTION')) AS last_closed,
                        count(*) FILTER (WHERE x.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AS open_count
                   FROM app.complaints x WHERE ${complaints}) c ON true
               LEFT JOIN LATERAL (
                 SELECT max(h.released_at) AS last_released, count(*) FILTER (WHERE h.released_at IS NULL) AS open_count
                   FROM app.order_chat_holds h WHERE ${holds}) hd ON true
              WHERE ${alias}.ended_at IS NOT NULL AND COALESCE(c.open_count, 0) = 0 AND COALESCE(hd.open_count, 0) = 0
                AND GREATEST(${alias}.ended_at, COALESCE(c.last_closed, ${alias}.ended_at), COALESCE(hd.last_released, ${alias}.ended_at)) + ($1::int * interval '1 day') <= clock_timestamp()`;
    };
    const result = await context.query(
      `DELETE FROM app.order_chat_messages WHERE message_id IN (
         SELECT message_id FROM (${due('ORDER')} UNION ${due('DIRECT')}) due LIMIT $2)`,
      [days, limit],
    );
    return result.rowCount ?? 0;
  }

  /** The open hold on a file, if any (at most one: unique index). */
  async openHold(context: TransactionContext, roomType: ChatRoomType, roomId: string): Promise<{ holdId: string; reason: string; placedAtMs: number } | undefined> {
    const column = roomType === 'ORDER' ? 'order_id' : 'delivery_id';
    const result = await context.query<{ hold_id: string; reason: string; placed_ms: string }>(
      `SELECT hold_id::text AS hold_id, reason, ${ms('placed_at', 'placed_ms')} FROM app.order_chat_holds WHERE ${column} = $1::uuid AND released_at IS NULL`,
      [roomId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { holdId: row.hold_id, reason: row.reason, placedAtMs: safe(row.placed_ms) };
  }

  async placeHold(context: TransactionContext, holdId: string, roomType: ChatRoomType, roomId: string, reason: string, userId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.order_chat_holds (hold_id, room_type, order_id, delivery_id, reason, placed_by, placed_at)
       VALUES ($1::uuid, $2::varchar, CASE WHEN $2::varchar = 'ORDER' THEN $3::uuid END, CASE WHEN $2::varchar = 'DIRECT' THEN $3::uuid END, $4, $5::uuid, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT DO NOTHING`,
      [holdId, roomType, roomId, reason, userId],
    );
    return result.rowCount === 1;
  }

  async releaseHold(context: TransactionContext, holdId: string, reason: string, userId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.order_chat_holds SET released_by = $3::uuid, release_reason = $2, released_at = date_trunc('milliseconds', clock_timestamp()) WHERE hold_id = $1::uuid AND released_at IS NULL`,
      [holdId, reason, userId],
    );
    return result.rowCount === 1;
  }
}
