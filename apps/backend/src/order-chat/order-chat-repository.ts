import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ChatRoomType, ChatSenderRole } from './order-chat-constants';
import { FeedCursor } from './order-chat-text';
import { FeedMessage } from './order-chat-feed';

// SQL of app.order_chat_messages (#191 owns it). Every method takes the caller's TransactionContext. Times are the database clock, read as epoch
// milliseconds; nothing here decides who may read or write: the service does, under the locks it takes before calling.

const MS = `(extract(epoch FROM m.created_at) * 1000)::bigint::text`;
const COLUMNS = `m.message_id::text AS message_id, m.seq::text AS seq, ${MS} AS at_ms, m.sender_user_id::text AS sender_user_id, m.sender_role, m.sender_name, m.body`;

interface RawMessage {
  message_id: string;
  seq: string;
  at_ms: string;
  sender_user_id: string;
  sender_role: ChatSenderRole;
  sender_name: string;
  body: string;
}

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

function toMessage(r: RawMessage): FeedMessage {
  return { messageId: r.message_id, seq: safe(r.seq), atMs: safe(r.at_ms), senderUserId: r.sender_user_id, senderRole: r.sender_role, senderName: r.sender_name, body: r.body };
}

export interface RoomRef {
  readonly type: ChatRoomType;
  readonly id: string;
}

export interface RoomHold {
  /** A complaint about the order (or one of its deliveries) is still open. */
  readonly open: boolean;
  /** When the latest complaint about it was closed, if any. */
  readonly lastClosedAtMs: number | null;
}

const WHERE = (room: RoomRef): string => (room.type === 'ORDER' ? 'm.order_id = $1::uuid' : 'm.delivery_id = $1::uuid');

@Injectable()
export class OrderChatRepository {
  /** Reads an order's own state under a SHARE lock: a concurrent close (which updates the row) either committed before us or waits for us. */
  async lockOrderShared(context: TransactionContext, orderId: string): Promise<{ readonly endedAtMs: number | null } | undefined> {
    const result = await context.query<{ ended_ms: string | null }>(`SELECT (extract(epoch FROM ended_at) * 1000)::bigint::text AS ended_ms FROM app.orders WHERE order_id = $1::uuid FOR SHARE`, [orderId]);
    const row = result.rows[0];
    return row === undefined ? undefined : { endedAtMs: row.ended_ms === null ? null : safe(row.ended_ms) };
  }

  async lockDeliveryShared(context: TransactionContext, deliveryId: string): Promise<{ readonly state: string; readonly endedAtMs: number | null } | undefined> {
    const result = await context.query<{ state: string; ended_ms: string | null }>(
      `SELECT state, (extract(epoch FROM ended_at) * 1000)::bigint::text AS ended_ms FROM app.deliveries WHERE delivery_id = $1::uuid FOR SHARE`,
      [deliveryId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { state: row.state, endedAtMs: row.ended_ms === null ? null : safe(row.ended_ms) };
  }

  async insert(context: TransactionContext, m: { messageId: string; room: RoomRef; senderUserId: string; senderRole: ChatSenderRole; senderName: string; body: string }): Promise<FeedMessage> {
    const result = await context.query<RawMessage>(
      `INSERT INTO app.order_chat_messages AS m (message_id, room_type, order_id, delivery_id, sender_user_id, sender_role, sender_name, body)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [m.messageId, m.room.type, m.room.type === 'ORDER' ? m.room.id : null, m.room.type === 'DELIVERY' ? m.room.id : null, m.senderUserId, m.senderRole, m.senderName, m.body],
    );
    return toMessage(result.rows[0] as RawMessage);
  }

  /** How many messages this person wrote in the last `seconds` (database clock), whatever the room. */
  async countRecent(context: TransactionContext, userId: string, seconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.order_chat_messages WHERE sender_user_id = $1::uuid AND created_at > date_trunc('milliseconds', clock_timestamp()) - ($2::int * interval '1 second')`,
      [userId, seconds],
    );
    return safe(result.rows[0]?.n);
  }

  /** The newest `limit` messages strictly before `before` (or the newest of all), newest first. */
  async listOlder(context: TransactionContext, room: RoomRef, before: FeedCursor | undefined, limit: number): Promise<FeedMessage[]> {
    const params: unknown[] = [room.id, limit];
    let cursor = '';
    if (before !== undefined) {
      params.push(before.atMs, before.rank, before.seq);
      cursor = `AND (${MS}::bigint, 1, m.seq) < ($3::bigint, $4::int, $5::bigint)`;
    }
    const result = await context.query<RawMessage>(`SELECT ${COLUMNS} FROM app.order_chat_messages m WHERE ${WHERE(room)} ${cursor} ORDER BY m.created_at DESC, m.seq DESC LIMIT $2::int`, params);
    return result.rows.map(toMessage);
  }

  /** The oldest `limit` messages strictly after `after`, oldest first. */
  async listNewer(context: TransactionContext, room: RoomRef, after: FeedCursor, limit: number): Promise<FeedMessage[]> {
    const result = await context.query<RawMessage>(
      `SELECT ${COLUMNS} FROM app.order_chat_messages m WHERE ${WHERE(room)} AND (${MS}::bigint, 1, m.seq) > ($3::bigint, $4::int, $5::bigint) ORDER BY m.created_at, m.seq LIMIT $2::int`,
      [room.id, limit, after.atMs, after.rank, after.seq],
    );
    return result.rows.map(toMessage);
  }

  /**
   * Complaints (M11) keep a room's history: an open one holds the deletion, a closed one moves the start of the retention to its closing. Read-only; M11's tables
   * are only read here, by id.
   */
  async hold(context: TransactionContext, room: RoomRef): Promise<RoomHold> {
    const target = room.type === 'ORDER' ? `(c.order_id = $1::uuid OR c.delivery_id IN (SELECT delivery_id FROM app.deliveries WHERE order_id = $1::uuid))` : `c.delivery_id = $1::uuid`;
    const result = await context.query<{ open: boolean; closed_ms: string | null }>(
      `SELECT bool_or(c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')) AS open,
              max((extract(epoch FROM c.closed_at) * 1000)::bigint)::text AS closed_ms
         FROM app.complaints c WHERE ${target}`,
      [room.id],
    );
    const row = result.rows[0];
    return { open: row?.open === true, lastClosedAtMs: row?.closed_ms === null || row?.closed_ms === undefined ? null : safe(row.closed_ms) };
  }

  /** The name a customer is shown under in a room; null when the profile has none. */
  async customerName(context: TransactionContext, userId: string): Promise<string | null> {
    const result = await context.query<{ full_name: string | null }>(`SELECT full_name FROM app.customer_profiles WHERE user_id = $1::uuid`, [userId]);
    const name = result.rows[0]?.full_name;
    return name === undefined || name === null || name.trim() === '' ? null : name.trim();
  }

  /**
   * Deletes the messages of rooms that closed more than `days` days ago (database clock), at most `batch` rows per call. A room is held while a complaint is
   * open, and counts from the closing of its latest complaint when that is later than the close of the order or direct delivery.
   */
  async purgeExpired(context: TransactionContext, days: number, batch: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `WITH due AS (
         SELECT m.message_id
           FROM app.order_chat_messages m
           LEFT JOIN app.orders o ON o.order_id = m.order_id
           LEFT JOIN app.deliveries d ON d.delivery_id = m.delivery_id
          WHERE COALESCE(o.ended_at, d.ended_at) IS NOT NULL
            AND GREATEST(
                  COALESCE(o.ended_at, d.ended_at),
                  COALESCE((SELECT max(c.closed_at) FROM app.complaints c
                             WHERE c.order_id = m.order_id OR c.delivery_id = m.delivery_id
                                OR c.delivery_id IN (SELECT x.delivery_id FROM app.deliveries x WHERE x.order_id = m.order_id)), '-infinity'::timestamptz)
                ) < date_trunc('milliseconds', clock_timestamp()) - ($1::int * interval '1 day')
            AND NOT EXISTS (SELECT 1 FROM app.complaints c
                             WHERE c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')
                               AND (c.order_id = m.order_id OR c.delivery_id = m.delivery_id
                                    OR c.delivery_id IN (SELECT x.delivery_id FROM app.deliveries x WHERE x.order_id = m.order_id)))
          ORDER BY m.seq
          LIMIT $2::int
       ), gone AS (DELETE FROM app.order_chat_messages WHERE message_id IN (SELECT message_id FROM due) RETURNING 1)
       SELECT count(*)::text AS n FROM gone`,
      [days, batch],
    );
    return safe(result.rows[0]?.n);
  }
}
