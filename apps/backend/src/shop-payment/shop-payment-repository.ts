import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ENTITLEMENT_MENU_EXPANDED, SHOP_PAYMENT_PURPOSES, SHOP_PAYMENT_STATES, ShopEntitlement, ShopPaymentPurpose, ShopPaymentRejectReason, ShopPaymentState } from './shop-payment-constants';

// The SQL of app.shop_payment_requests, app.shop_payment_settlements and app.shop_entitlement_grants (#198). Nothing here touches a wallet, a ledger or a
// subscription clock (none exists). Amounts and times arrive as text and are parsed to safe integers; a malformed value is an internal error.

const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export interface ShopPaymentRow {
  readonly requestId: string;
  readonly shopId: string;
  readonly purpose: ShopPaymentPurpose;
  readonly amountRequestedVnd: number;
  readonly state: ShopPaymentState;
  readonly rejectReasonCode: ShopPaymentRejectReason | null;
  readonly createdByUserId: string;
  readonly reportedAtMs: number | null;
  readonly resolvedAtMs: number | null;
  readonly version: number;
  readonly createdAtMs: number;
}

export interface ShopPaymentCursor {
  readonly createdAtMs: number;
  readonly requestId: string;
}

interface RawPayment {
  request_id: string;
  shop_id: string;
  purpose: string;
  amount_requested_vnd: string;
  state: string;
  reject_reason_code: string | null;
  created_by_user_id: string;
  reported_ms: string | null;
  resolved_ms: string | null;
  version: string;
  created_ms: string;
}

const COLUMNS = `r.request_id::text AS request_id, r.shop_id::text AS shop_id, r.purpose, r.amount_requested_vnd::text AS amount_requested_vnd, r.state, r.reject_reason_code,
  r.created_by_user_id::text AS created_by_user_id, ${ms('r.reported_at', 'reported_ms')}, ${ms('r.resolved_at', 'resolved_ms')}, r.version::text AS version, ${ms('r.created_at', 'created_ms')}`;

function toPayment(row: RawPayment): ShopPaymentRow {
  if (!(SHOP_PAYMENT_STATES as readonly string[]).includes(row.state) || !(SHOP_PAYMENT_PURPOSES as readonly string[]).includes(row.purpose)) {
    throw new TechnicalError('internal', 'Database returned an unexpected payment request');
  }
  return {
    requestId: row.request_id,
    shopId: row.shop_id,
    purpose: row.purpose as ShopPaymentPurpose,
    amountRequestedVnd: safe(row.amount_requested_vnd),
    state: row.state as ShopPaymentState,
    rejectReasonCode: row.reject_reason_code as ShopPaymentRejectReason | null,
    createdByUserId: row.created_by_user_id,
    reportedAtMs: row.reported_ms === null ? null : safe(row.reported_ms),
    resolvedAtMs: row.resolved_ms === null ? null : safe(row.resolved_ms),
    version: safe(row.version),
    createdAtMs: safe(row.created_ms),
  };
}

export interface SettlementRow {
  readonly settlementId: string;
  readonly requestId: string;
  readonly shopId: string;
  readonly bankId: string;
  readonly systemAccountId: string;
  readonly canonicalTransactionId: string;
  readonly amountVnd: number;
  readonly receivedAtMs: number;
  readonly confirmedByUserId: string;
  readonly createdAtMs: number;
}

interface RawSettlement {
  settlement_id: string;
  request_id: string;
  shop_id: string;
  bank_id: string;
  system_owned_account_id: string;
  canonical_transaction_id: string;
  amount_vnd: string;
  received_ms: string;
  confirmed_by_user_id: string;
  created_ms: string;
}

const SETTLEMENT_COLUMNS = `s.settlement_id::text AS settlement_id, s.request_id::text AS request_id, s.shop_id::text AS shop_id, s.bank_id, s.system_owned_account_id::text AS system_owned_account_id,
  s.canonical_transaction_id, s.amount_vnd::text AS amount_vnd, ${ms('s.received_at', 'received_ms')}, s.confirmed_by_user_id::text AS confirmed_by_user_id, ${ms('s.created_at', 'created_ms')}`;

const toSettlement = (r: RawSettlement): SettlementRow => ({
  settlementId: r.settlement_id,
  requestId: r.request_id,
  shopId: r.shop_id,
  bankId: r.bank_id,
  systemAccountId: r.system_owned_account_id,
  canonicalTransactionId: r.canonical_transaction_id,
  amountVnd: safe(r.amount_vnd),
  receivedAtMs: safe(r.received_ms),
  confirmedByUserId: r.confirmed_by_user_id,
  createdAtMs: safe(r.created_ms),
});

export interface EntitlementEvent {
  readonly grantId: string;
  readonly shopId: string;
  readonly entitlement: ShopEntitlement;
  readonly action: 'GRANT' | 'REVOKE';
  readonly reason: string;
  readonly actorUserId: string;
  readonly paymentRequestId: string | null;
  readonly atMs: number;
}

interface RawEntitlement {
  grant_id: string;
  shop_id: string;
  entitlement: string;
  action: string;
  reason: string;
  actor_user_id: string;
  payment_request_id: string | null;
  at_ms: string;
}

const ENTITLEMENT_COLUMNS = `g.grant_id::text AS grant_id, g.shop_id::text AS shop_id, g.entitlement, g.action, g.reason, g.actor_user_id::text AS actor_user_id, g.payment_request_id::text AS payment_request_id, ${ms('g.created_at', 'at_ms')}`;

const toEntitlement = (r: RawEntitlement): EntitlementEvent => ({
  grantId: r.grant_id,
  shopId: r.shop_id,
  entitlement: r.entitlement as ShopEntitlement,
  action: r.action === 'GRANT' ? 'GRANT' : 'REVOKE',
  reason: r.reason,
  actorUserId: r.actor_user_id,
  paymentRequestId: r.payment_request_id,
  atMs: safe(r.at_ms),
});

export interface ListOptions {
  readonly state: ShopPaymentState | undefined;
  readonly limit: number;
  readonly after: ShopPaymentCursor | undefined;
}

export interface AdminListOptions extends ListOptions {
  /** true = only requests the shop reported a transfer for (the reconciliation queue); false = only those not reported; undefined = both. */
  readonly reported: boolean | undefined;
}

@Injectable()
export class ShopPaymentRepository {
  async insertPending(context: TransactionContext, input: { requestId: string; shopId: string; purpose: ShopPaymentPurpose; amountVnd: number; createdByUserId: string }): Promise<ShopPaymentRow> {
    const result = await context.query<RawPayment>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            inserted AS (
              INSERT INTO app.shop_payment_requests (request_id, shop_id, purpose, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
              SELECT $1::uuid, $2::uuid, $3, $4::bigint, 'PENDING', $5::uuid, 1, clock.t, clock.t FROM clock
              RETURNING *)
       SELECT ${COLUMNS} FROM inserted r`,
      [input.requestId, input.shopId, input.purpose, String(input.amountVnd), input.createdByUserId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Payment request was not written');
    }
    return toPayment(row);
  }

  async findOpen(context: TransactionContext, shopId: string, purpose: ShopPaymentPurpose): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(`SELECT ${COLUMNS} FROM app.shop_payment_requests r WHERE r.shop_id = $1::uuid AND r.purpose = $2 AND r.state = 'PENDING'`, [shopId, purpose]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  /** The request of THIS shop, or undefined (a request of another shop is not revealed). */
  async findOwned(context: TransactionContext, requestId: string, shopId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(`SELECT ${COLUMNS} FROM app.shop_payment_requests r WHERE r.request_id = $1::uuid AND r.shop_id = $2::uuid`, [requestId, shopId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  async lockOwned(context: TransactionContext, requestId: string, shopId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(`SELECT ${COLUMNS} FROM app.shop_payment_requests r WHERE r.request_id = $1::uuid AND r.shop_id = $2::uuid FOR UPDATE`, [requestId, shopId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  /** By id, any shop, no lock: discovery for the administration (which shop to lock first). */
  async findById(context: TransactionContext, requestId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(`SELECT ${COLUMNS} FROM app.shop_payment_requests r WHERE r.request_id = $1::uuid`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  async lockById(context: TransactionContext, requestId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(`SELECT ${COLUMNS} FROM app.shop_payment_requests r WHERE r.request_id = $1::uuid FOR UPDATE`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  /** Shared lock on the request row, the state read AFTER it: every command that resolves a request updates the same row, so send-and-resolve has one winner. */
  async lockStateShared(context: TransactionContext, requestId: string): Promise<ShopPaymentState | undefined> {
    const result = await context.query<{ state: string }>(`SELECT state FROM app.shop_payment_requests WHERE request_id = $1::uuid FOR SHARE`, [requestId]);
    const state = result.rows[0]?.state;
    return state === undefined ? undefined : (state as ShopPaymentState);
  }

  async listForShop(context: TransactionContext, shopId: string, options: ListOptions): Promise<ShopPaymentRow[]> {
    const result = await context.query<RawPayment>(
      `SELECT ${COLUMNS} FROM app.shop_payment_requests r
        WHERE r.shop_id = $1::uuid AND ($2::text IS NULL OR r.state = $2::text)
          AND ($3::bigint IS NULL OR (r.created_at, r.request_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::uuid))
        ORDER BY r.created_at DESC, r.request_id DESC LIMIT $5::int`,
      [shopId, options.state ?? null, options.after?.createdAtMs ?? null, options.after?.requestId ?? null, options.limit],
    );
    return result.rows.map(toPayment);
  }

  /** The reconciliation queue: reported-and-waiting first, then newest. */
  async listForAdmin(context: TransactionContext, options: AdminListOptions): Promise<ShopPaymentRow[]> {
    const result = await context.query<RawPayment>(
      `SELECT ${COLUMNS} FROM app.shop_payment_requests r
        WHERE ($1::text IS NULL OR r.state = $1::text)
          AND ($2::boolean IS NULL OR (r.reported_at IS NOT NULL) = $2::boolean)
          AND ($3::bigint IS NULL OR (r.created_at, r.request_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::uuid))
        ORDER BY r.created_at DESC, r.request_id DESC LIMIT $5::int`,
      [options.state ?? null, options.reported ?? null, options.after?.createdAtMs ?? null, options.after?.requestId ?? null, options.limit],
    );
    return result.rows.map(toPayment);
  }

  /** The first and only report mark. Conditional on PENDING and not yet reported; a second call updates zero rows. */
  async markReported(context: TransactionContext, requestId: string, userId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.shop_payment_requests r SET reported_at = clock.t, reported_by_user_id = $2::uuid, updated_at = clock.t, version = r.version + 1
                FROM clock WHERE r.request_id = $1::uuid AND r.state = 'PENDING' AND r.reported_at IS NULL RETURNING r.*)
       SELECT ${COLUMNS} FROM updated r`,
      [requestId, userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  /** PENDING (not reported) -> CANCELLED by the shop, at the expected version, in one conditional statement. */
  async cancelPending(context: TransactionContext, requestId: string, expectedVersion: number, userId: string): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.shop_payment_requests r SET state = 'CANCELLED', resolved_by_user_id = $3::uuid, resolved_at = clock.t, updated_at = clock.t, version = r.version + 1
                FROM clock WHERE r.request_id = $1::uuid AND r.state = 'PENDING' AND r.reported_at IS NULL AND r.version = $2::bigint RETURNING r.*)
       SELECT ${COLUMNS} FROM updated r`,
      [requestId, expectedVersion, userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  /** PENDING -> CONFIRMED | REJECTED by an administrator, at the expected version, in one conditional statement. */
  async resolve(context: TransactionContext, requestId: string, expectedVersion: number, state: 'CONFIRMED' | 'REJECTED', userId: string, reason: ShopPaymentRejectReason | null): Promise<ShopPaymentRow | undefined> {
    const result = await context.query<RawPayment>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.shop_payment_requests r SET state = $4, reject_reason_code = $5, resolved_by_user_id = $3::uuid, resolved_at = clock.t, updated_at = clock.t, version = r.version + 1
                FROM clock WHERE r.request_id = $1::uuid AND r.state = 'PENDING' AND r.version = $2::bigint RETURNING r.*)
       SELECT ${COLUMNS} FROM updated r`,
      [requestId, expectedVersion, userId, state, reason],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toPayment(row);
  }

  // ---- proof of money received ------------------------------------------------------------------------------------------------

  /** Writes the one proof of receipt of a request. A bank transaction already used (here or by a Shipper top-up) is a unique violation the caller turns into a clean error. */
  async insertSettlement(
    context: TransactionContext,
    s: { settlementId: string; requestId: string; shopId: string; bankId: string; systemAccountId: string; canonicalTransactionId: string; amountVnd: number; receivedAtIso: string; confirmedByUserId: string },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.shop_payment_settlements (settlement_id, request_id, shop_id, bank_id, system_owned_account_id, canonical_transaction_id, amount_vnd, received_at, confirmed_by_user_id, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::bigint, $8::timestamptz, $9::uuid, date_trunc('milliseconds', clock_timestamp()))`,
      [s.settlementId, s.requestId, s.shopId, s.bankId, s.systemAccountId, s.canonicalTransactionId, String(s.amountVnd), s.receivedAtIso, s.confirmedByUserId],
    );
  }

  /** Does a SHOP payment already use this bank transaction identity? (A Shipper top-up is checked through the wallet package's BankIdentityGuard.) */
  async usedBySettlement(context: TransactionContext, bankId: string, systemAccountId: string, transactionId: string): Promise<boolean> {
    const result = await context.query(
      `SELECT 1 FROM app.shop_payment_settlements WHERE bank_id = $1 AND system_owned_account_id = $2::uuid AND canonical_transaction_id = $3`,
      [bankId, systemAccountId, transactionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findSettlement(context: TransactionContext, requestId: string): Promise<SettlementRow | undefined> {
    const result = await context.query<RawSettlement>(`SELECT ${SETTLEMENT_COLUMNS} FROM app.shop_payment_settlements s WHERE s.request_id = $1::uuid`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSettlement(row);
  }

  // ---- manual entitlements -----------------------------------------------------------------------------------------------------

  /** The latest GRANT / REVOKE row of the right: it is granted exactly when that row is a GRANT. The caller holds the shop row lock when it decides. */
  async latestEntitlement(context: TransactionContext, shopId: string, entitlement: ShopEntitlement = ENTITLEMENT_MENU_EXPANDED): Promise<EntitlementEvent | undefined> {
    const result = await context.query<RawEntitlement>(
      `SELECT ${ENTITLEMENT_COLUMNS} FROM app.shop_entitlement_grants g WHERE g.shop_id = $1::uuid AND g.entitlement = $2 ORDER BY g.seq DESC LIMIT 1`,
      [shopId, entitlement],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toEntitlement(row);
  }

  async isGranted(context: TransactionContext, shopId: string, entitlement: ShopEntitlement = ENTITLEMENT_MENU_EXPANDED): Promise<boolean> {
    return (await this.latestEntitlement(context, shopId, entitlement))?.action === 'GRANT';
  }

  async insertEntitlement(
    context: TransactionContext,
    e: { grantId: string; shopId: string; entitlement: ShopEntitlement; action: 'GRANT' | 'REVOKE'; reason: string; actorUserId: string; paymentRequestId: string | null },
  ): Promise<EntitlementEvent> {
    const result = await context.query<RawEntitlement>(
      `WITH inserted AS (
         INSERT INTO app.shop_entitlement_grants (grant_id, shop_id, entitlement, action, reason, actor_user_id, payment_request_id, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, date_trunc('milliseconds', clock_timestamp())) RETURNING *)
       SELECT ${ENTITLEMENT_COLUMNS} FROM inserted g`,
      [e.grantId, e.shopId, e.entitlement, e.action, e.reason, e.actorUserId, e.paymentRequestId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Entitlement row was not written');
    }
    return toEntitlement(row);
  }

  async entitlementHistory(context: TransactionContext, shopId: string, limit: number): Promise<EntitlementEvent[]> {
    const result = await context.query<RawEntitlement>(`SELECT ${ENTITLEMENT_COLUMNS} FROM app.shop_entitlement_grants g WHERE g.shop_id = $1::uuid ORDER BY g.seq DESC LIMIT $2::int`, [shopId, limit]);
    return result.rows.map(toEntitlement);
  }

  /** The grant that followed this payment request, if any. */
  async grantOfPayment(context: TransactionContext, requestId: string): Promise<EntitlementEvent | undefined> {
    const result = await context.query<RawEntitlement>(`SELECT ${ENTITLEMENT_COLUMNS} FROM app.shop_entitlement_grants g WHERE g.payment_request_id = $1::uuid`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toEntitlement(row);
  }
}
