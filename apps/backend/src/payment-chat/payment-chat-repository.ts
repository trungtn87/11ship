import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { DriverRepository } from '../driver/driver-repository';
import { ShopRepository } from '../shop/shop-repository';
import { TopupRequestRepository } from '../wallet/topup-request-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { FeedCursor } from '../order-chat/order-chat-validation';
import { CaseFacts } from './payment-chat-feed';
import { CaseKind, PaymentChatRole } from './payment-chat-constants';

// The SQL of app.case_chat_messages and the real facts its feed shows. Times are stored at millisecond precision, so the feed order (time, then id) is the same in
// the database and in memory.

const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export interface PaymentMessageRow {
  readonly messageId: string;
  readonly caseKind: CaseKind;
  readonly caseId: string;
  readonly senderUserId: string;
  readonly senderRole: PaymentChatRole;
  readonly senderName: string;
  readonly body: string;
  readonly clientKey: string;
  readonly atMs: number;
}

interface RawMessage {
  message_id: string;
  case_kind: CaseKind;
  case_id: string;
  sender_user_id: string;
  sender_role: PaymentChatRole;
  sender_name: string;
  body: string;
  client_key: string;
  at_ms: string;
}

const COLUMNS = `m.message_id::text AS message_id, m.case_kind, COALESCE(m.topup_request_id, m.shop_payment_id)::text AS case_id, m.sender_user_id::text AS sender_user_id, m.sender_role,
  m.sender_name, m.body, m.client_key::text AS client_key, ${ms('m.created_at', 'at_ms')}`;

const toMessage = (r: RawMessage): PaymentMessageRow => ({ messageId: r.message_id, caseKind: r.case_kind, caseId: r.case_id, senderUserId: r.sender_user_id, senderRole: r.sender_role, senderName: r.sender_name, body: r.body, clientKey: r.client_key, atMs: safe(r.at_ms) });

export interface NewPaymentMessage {
  readonly messageId: string;
  readonly caseKind: CaseKind;
  readonly caseId: string;
  readonly senderUserId: string;
  readonly senderRole: PaymentChatRole;
  readonly senderName: string;
  readonly body: string;
  readonly clientKey: string;
}

/** Who a case belongs to and what to call them, read from the owners' tables. */
export interface CaseOwner {
  readonly kind: CaseKind;
  readonly id: string;
  /** Shipper's driver id (DRIVER_TOPUP) or the shop id (SHOP_PAYMENT). */
  readonly subjectId: string;
  readonly subjectName: string;
  /** The account that owns the case (the Shipper's / the shop owner's user id), when the owner tables say so now. */
  readonly ownerUserId: string | null;
}

@Injectable()
export class PaymentChatRepository {
  constructor(
    private readonly topups: TopupRequestRepository,
    private readonly drivers: DriverRepository,
    private readonly shops: ShopRepository,
  ) {}

  /** The case and its owner, no lock. The Shipper's and the shop's rows come through the repositories that own those tables. Undefined when it does not exist. */
  async findCase(context: TransactionContext, kind: CaseKind, id: string): Promise<CaseOwner | undefined> {
    if (kind === 'DRIVER_TOPUP') {
      const request = await this.topups.findById(context, id);
      const driver = request === undefined ? undefined : await this.drivers.findById(context, request.driverId);
      return request === undefined || driver === undefined ? undefined : { kind, id, subjectId: driver.driverId, subjectName: driver.fullName, ownerUserId: driver.userId };
    }
    const found = await context.query<{ shop_id: string }>(`SELECT shop_id::text AS shop_id FROM app.shop_payment_requests WHERE request_id = $1::uuid`, [id]);
    const shopId = found.rows[0]?.shop_id;
    const shop = shopId === undefined ? undefined : await this.shops.findById(context, shopId);
    if (shopId === undefined || shop === undefined) {
      return undefined;
    }
    return { kind, id, subjectId: shopId, subjectName: shop.name, ownerUserId: (await this.shops.ownerUserIdOfShop(context, shopId)) ?? null };
  }

  /**
   * Takes a SHARED lock on the request row and returns its state AFTER the lock. Every command that closes a request (confirm, reject, cancel) updates the same
   * row, so it waits for the sends already holding this lock and a send that arrives after it committed reads the final state: exactly one of "message first" /
   * "close first" happens.
   */
  async lockStateShared(context: TransactionContext, kind: CaseKind, id: string): Promise<string | undefined> {
    if (kind === 'DRIVER_TOPUP') {
      return this.topups.lockStateShared(context, id);
    }
    const result = await context.query<{ state: string }>(`SELECT state FROM app.shop_payment_requests WHERE request_id = $1::uuid FOR SHARE`, [id]);
    return result.rows[0]?.state;
  }

  /** The real facts the milestones come from. */
  async facts(context: TransactionContext, kind: CaseKind, id: string): Promise<CaseFacts | undefined> {
    if (kind === 'DRIVER_TOPUP') {
      const r = await this.topups.findById(context, id);
      if (r === undefined) {
        return undefined;
      }
      const reported = (await this.topups.reportedAt(context, [id])).get(id);
      return { kind, id, state: r.state, createdAtMs: r.createdAtMs, reportedAtMs: reported ?? null, resolvedAtMs: r.resolvedAtMs, grantedAtMs: null };
    }
    const result = await context.query<{ state: string; created_ms: string; resolved_ms: string | null; reported_ms: string | null; granted_ms: string | null }>(
      `SELECT r.state, ${ms('r.created_at', 'created_ms')}, ${ms('r.resolved_at', 'resolved_ms')}, ${ms('r.reported_at', 'reported_ms')}, ${ms('g.created_at', 'granted_ms')}
         FROM app.shop_payment_requests r LEFT JOIN app.shop_entitlement_grants g ON g.payment_request_id = r.request_id WHERE r.request_id = $1::uuid`,
      [id],
    );
    const r = result.rows[0];
    return r === undefined ? undefined : { kind, id, state: r.state as CaseFacts['state'], createdAtMs: safe(r.created_ms), reportedAtMs: r.reported_ms === null ? null : safe(r.reported_ms), resolvedAtMs: r.resolved_ms === null ? null : safe(r.resolved_ms), grantedAtMs: r.granted_ms === null ? null : safe(r.granted_ms) };
  }

  async findByKey(context: TransactionContext, senderUserId: string, clientKey: string): Promise<PaymentMessageRow | undefined> {
    const result = await context.query<RawMessage>(`SELECT ${COLUMNS} FROM app.case_chat_messages m WHERE m.sender_user_id = $1::uuid AND m.client_key = $2::uuid`, [senderUserId, clientKey]);
    const row = result.rows[0];
    return row === undefined ? undefined : toMessage(row);
  }

  /** How many messages this sender wrote in THIS room in the last `windowMs` (database clock). */
  async countRecent(context: TransactionContext, senderUserId: string, kind: CaseKind, id: string, windowMs: number): Promise<number> {
    const column = kind === 'DRIVER_TOPUP' ? 'topup_request_id' : 'shop_payment_id';
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.case_chat_messages WHERE sender_user_id = $1::uuid AND ${column} = $2::uuid AND created_at > clock_timestamp() - ($3::bigint * interval '1 millisecond')`,
      [senderUserId, id, windowMs],
    );
    return safe(result.rows[0]?.n ?? '0');
  }

  /** Writes the message, or returns undefined when this sender already used this key (the caller then reads the stored message). */
  async insert(context: TransactionContext, m: NewPaymentMessage): Promise<PaymentMessageRow | undefined> {
    const result = await context.query<RawMessage>(
      `INSERT INTO app.case_chat_messages (message_id, case_kind, topup_request_id, shop_payment_id, sender_user_id, sender_role, sender_name, body, client_key, created_at)
       VALUES ($1::uuid, $2::varchar, CASE WHEN $2::varchar = 'DRIVER_TOPUP' THEN $3::uuid END, CASE WHEN $2::varchar = 'SHOP_PAYMENT' THEN $3::uuid END, $4::uuid, $5, $6, $7, $8::uuid, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (sender_user_id, client_key) DO NOTHING
       RETURNING message_id::text AS message_id, case_kind, COALESCE(topup_request_id, shop_payment_id)::text AS case_id, sender_user_id::text AS sender_user_id, sender_role, sender_name, body, client_key::text AS client_key, ${ms('created_at', 'at_ms')}`,
      [m.messageId, m.caseKind, m.caseId, m.senderUserId, m.senderRole, m.senderName, m.body, m.clientKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMessage(row);
  }

  /** The messages of a room strictly OLDER than the cursor in the feed order, newest first. A cursor on a milestone excludes the messages of its own millisecond. */
  async listOlder(context: TransactionContext, kind: CaseKind, id: string, before: FeedCursor | null, limit: number): Promise<PaymentMessageRow[]> {
    const column = kind === 'DRIVER_TOPUP' ? 'm.topup_request_id' : 'm.shop_payment_id';
    const result = await context.query<RawMessage>(
      `SELECT ${COLUMNS} FROM app.case_chat_messages m
        WHERE ${column} = $1::uuid
          AND ($2::bigint IS NULL OR (extract(epoch FROM m.created_at) * 1000)::bigint < $2::bigint OR ((extract(epoch FROM m.created_at) * 1000)::bigint = $2::bigint AND $3::int = 1 AND m.message_id::text < $4))
        ORDER BY m.created_at DESC, m.message_id DESC LIMIT $5`,
      [id, before === null ? null : before.atMs, before === null ? 0 : before.rank, before === null ? '' : before.id, limit],
    );
    return result.rows.map(toMessage);
  }

  /** The Shipper top-up report mark ("Tôi đã chuyển khoản"): written once. Returns false when it was already there. */
  insertTopupReport(context: TransactionContext, requestId: string, userId: string): Promise<boolean> {
    return this.topups.insertReport(context, requestId, userId);
  }
}
