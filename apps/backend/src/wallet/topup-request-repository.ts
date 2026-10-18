import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { MAX_WALLET_VND } from './wallet-types';

// SQL of app.wallet_topup_requests and the READ of the receiving accounts (M04-B2.1). A request asks for money; it never moves any: this
// file has no statement on a wallet balance, the ledger, a topup or a bank record. The only writes are the INSERT of a PENDING request
// and the conditional PENDING -> CANCELLED UPDATE. Amounts arrive as text and are parsed to bigint (a malformed value is an internal error).

export type TopupRequestState = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export const TOPUP_REQUEST_STATES: readonly TopupRequestState[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'];

export interface TopupRequestRow {
  readonly requestId: string;
  readonly walletId: string;
  readonly driverId: string;
  readonly amountRequestedVnd: bigint;
  readonly state: TopupRequestState;
  readonly version: number;
  readonly createdAtMs: number;
  readonly resolvedAtMs: number | null;
}

export interface ReceivingAccount {
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
}

export interface TopupListCursor {
  readonly createdAtMs: number;
  readonly requestId: string;
}

interface RawRequest {
  request_id: string;
  wallet_id: string;
  driver_id: string;
  amount_requested_vnd: string;
  state: string;
  version: string;
  created_ms: string;
  resolved_ms: string | null;
}

const COLUMNS = `r.request_id::text AS request_id, r.wallet_id::text AS wallet_id, r.driver_id::text AS driver_id,
  r.amount_requested_vnd::text AS amount_requested_vnd, r.state, r.version::text AS version,
  (extract(epoch FROM r.created_at) * 1000)::bigint::text AS created_ms,
  (extract(epoch FROM r.resolved_at) * 1000)::bigint::text AS resolved_ms`;

function safeNumber(raw: unknown): number {
  const value = typeof raw === 'string' && /^[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

function toRequest(row: RawRequest): TopupRequestRow {
  if (!TOPUP_REQUEST_STATES.includes(row.state as TopupRequestState) || !/^[0-9]{1,16}$/.test(row.amount_requested_vnd)) {
    throw new TechnicalError('internal', 'Database returned an unexpected top-up request');
  }
  const amount = BigInt(row.amount_requested_vnd);
  if (amount <= 0n || amount > MAX_WALLET_VND) {
    throw new TechnicalError('internal', 'Database returned an unexpected top-up amount');
  }
  return {
    requestId: row.request_id,
    walletId: row.wallet_id,
    driverId: row.driver_id,
    amountRequestedVnd: amount,
    state: row.state as TopupRequestState,
    version: safeNumber(row.version),
    createdAtMs: safeNumber(row.created_ms),
    resolvedAtMs: row.resolved_ms === null ? null : safeNumber(row.resolved_ms),
  };
}

export interface AdminTopupRow extends TopupRequestRow {
  /** The amount the administrator recorded as received (CONFIRMED only), which may differ from the amount asked for. */
  readonly actualAmountVnd: bigint | null;
  readonly receivedAtMs: number | null;
}

interface RawAdminRequest extends RawRequest {
  actual_amount_vnd: string | null;
  received_ms: string | null;
}

function toAdminRow(row: RawAdminRequest): AdminTopupRow {
  const base = toRequest(row);
  if (row.actual_amount_vnd !== null && !/^[0-9]{1,16}$/.test(row.actual_amount_vnd)) {
    throw new TechnicalError('internal', 'Database returned an unexpected top-up amount');
  }
  return { ...base, actualAmountVnd: row.actual_amount_vnd === null ? null : BigInt(row.actual_amount_vnd), receivedAtMs: row.received_ms === null ? null : safeNumber(row.received_ms) };
}

@Injectable()
export class TopupRequestRepository {
  /** The receiving accounts the system accepts money on today (can_receive = true), in a stable order. Read only. */
  async listReceivingAccounts(context: TransactionContext): Promise<ReceivingAccount[]> {
    const result = await context.query<{ bank_id: string; account_number: string; account_holder: string }>(
      `SELECT a.bank_id, a.account_number, a.account_holder FROM app.system_owned_bank_accounts a
        WHERE a.can_receive ORDER BY a.bank_id, a.account_number`,
    );
    return result.rows.map((row) => ({ bankId: row.bank_id, accountNumber: row.account_number, accountHolder: row.account_holder }));
  }

  /** Inserts a PENDING request at version 1. The creator is the authenticated user; the time is the database clock. */
  async insertPending(
    context: TransactionContext,
    input: { requestId: string; walletId: string; driverId: string; amountVnd: bigint; createdByUserId: string },
  ): Promise<TopupRequestRow> {
    const result = await context.query<RawRequest>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            inserted AS (
              INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
              SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'PENDING', $5::uuid, 1, clock.t, clock.t FROM clock
              RETURNING *
            )
       SELECT ${COLUMNS} FROM inserted r`,
      [input.requestId, input.walletId, input.driverId, input.amountVnd.toString(), input.createdByUserId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Top-up request was not written');
    }
    return toRequest(row);
  }

  /** The request row, locked FOR UPDATE, only when it belongs to this driver; otherwise undefined (existence is not revealed). */
  async lockOwned(context: TransactionContext, requestId: string, driverId: string): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(
      `SELECT ${COLUMNS} FROM app.wallet_topup_requests r WHERE r.request_id = $1::uuid AND r.driver_id = $2::uuid FOR UPDATE`,
      [requestId, driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  async findOwned(context: TransactionContext, requestId: string, driverId: string): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(
      `SELECT ${COLUMNS} FROM app.wallet_topup_requests r WHERE r.request_id = $1::uuid AND r.driver_id = $2::uuid`,
      [requestId, driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  /**
   * PENDING -> CANCELLED at the expected version, in ONE conditional statement, so a racing resolution (an administrator in B2.2) decides
   * by the database: the loser updates zero rows and gets undefined. resolved_by is the cancelling user; the time is the database clock.
   */
  async cancelPending(context: TransactionContext, requestId: string, expectedVersion: number, actorUserId: string): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.wallet_topup_requests r
                 SET state = 'CANCELLED', resolved_by_user_id = $3::uuid, resolved_at = clock.t, updated_at = clock.t, version = r.version + 1
                FROM clock
               WHERE r.request_id = $1::uuid AND r.state = 'PENDING' AND r.version = $2::bigint
               RETURNING r.*
            )
       SELECT ${COLUMNS} FROM updated r`,
      [requestId, expectedVersion, actorUserId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  /** Newest first (created_at, request_id), at most `limit` rows after the cursor. A plain read. */
  async listForWallet(
    context: TransactionContext,
    walletId: string,
    options: { state: TopupRequestState | undefined; limit: number; after: TopupListCursor | undefined },
  ): Promise<TopupRequestRow[]> {
    const result = await context.query<RawRequest>(
      `SELECT ${COLUMNS} FROM app.wallet_topup_requests r
        WHERE r.wallet_id = $1::uuid
          AND ($2::text IS NULL OR r.state = $2::text)
          AND ($3::bigint IS NULL OR (r.created_at, r.request_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::uuid))
        ORDER BY r.created_at DESC, r.request_id DESC
        LIMIT $5::int`,
      [walletId, options.state ?? null, options.after?.createdAtMs ?? null, options.after?.requestId ?? null, options.limit],
    );
    return result.rows.map(toRequest);
  }

  // ---- Administration (M04-B2.2b): every request of any Shipper, read and resolved by an authorised administrator ----

  /** A request by id, any owner, WITHOUT a lock: used only to discover which Shipper to lock first; every decision is re-read under the locks. */
  async findById(context: TransactionContext, requestId: string): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(`SELECT ${COLUMNS} FROM app.wallet_topup_requests r WHERE r.request_id = $1::uuid`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  async lockById(context: TransactionContext, requestId: string): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(`SELECT ${COLUMNS} FROM app.wallet_topup_requests r WHERE r.request_id = $1::uuid FOR UPDATE`, [requestId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  /**
   * PENDING -> CONFIRMED | REJECTED at the expected version in ONE conditional statement (the loser of a race with the Shipper's cancel updates zero rows).
   * The resolver is the administrator; the time is the database clock. CONFIRMED is only valid together with its topup (checked at COMMIT).
   */
  async resolve(
    context: TransactionContext,
    requestId: string,
    expectedVersion: number,
    state: 'CONFIRMED' | 'REJECTED',
    actorUserId: string,
  ): Promise<TopupRequestRow | undefined> {
    const result = await context.query<RawRequest>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            resolved AS (
              UPDATE app.wallet_topup_requests r
                 SET state = $4, resolved_by_user_id = $3::uuid, resolved_at = clock.t, updated_at = clock.t, version = r.version + 1
                FROM clock
               WHERE r.request_id = $1::uuid AND r.state = 'PENDING' AND r.version = $2::bigint
               RETURNING r.*
            )
       SELECT ${COLUMNS} FROM resolved r`,
      [requestId, expectedVersion, actorUserId, state],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRequest(row);
  }

  /** Newest first, with the actual amount and the time received of a CONFIRMED request. No bank reference, no account, no phone. */
  async listForAdmin(
    context: TransactionContext,
    options: { state: TopupRequestState | undefined; limit: number; after: TopupListCursor | undefined },
  ): Promise<AdminTopupRow[]> {
    const result = await context.query<RawAdminRequest>(
      `SELECT ${COLUMNS}, t.actual_amount_vnd::text AS actual_amount_vnd, (extract(epoch FROM t.received_at) * 1000)::bigint::text AS received_ms
         FROM app.wallet_topup_requests r LEFT JOIN app.wallet_topups t ON t.request_id = r.request_id
        WHERE ($1::text IS NULL OR r.state = $1::text)
          AND ($2::bigint IS NULL OR (r.created_at, r.request_id) < ('epoch'::timestamptz + $2::bigint * interval '1 millisecond', $3::uuid))
        ORDER BY r.created_at DESC, r.request_id DESC
        LIMIT $4::int`,
      [options.state ?? null, options.after?.createdAtMs ?? null, options.after?.requestId ?? null, options.limit],
    );
    return result.rows.map(toAdminRow);
  }

  async findForAdmin(context: TransactionContext, requestId: string): Promise<AdminTopupRow | undefined> {
    const result = await context.query<RawAdminRequest>(
      `SELECT ${COLUMNS}, t.actual_amount_vnd::text AS actual_amount_vnd, (extract(epoch FROM t.received_at) * 1000)::bigint::text AS received_ms
         FROM app.wallet_topup_requests r LEFT JOIN app.wallet_topups t ON t.request_id = r.request_id WHERE r.request_id = $1::uuid`,
      [requestId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAdminRow(row);
  }
}
