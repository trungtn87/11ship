import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { MAX_WALLET_VND } from './wallet-types';

// SQL of app.wallet_withdrawals, its event trail and the OUT side of the bank registry (M04-C). Nothing here decides: the services check the rights, the
// state and the money; every transition below is ONE conditional UPDATE (state and version in the WHERE), so a racing writer updates zero rows and gets
// undefined. Amounts arrive as text and are parsed to bigint. The bank snapshot is copied by the database from the Shipper's own VERIFIED bank row in the
// same statement that inserts the withdrawal: a caller never supplies bank data.

export type WithdrawalState = 'PENDING' | 'PROCESSING' | 'RECONCILIATION' | 'PAID' | 'CANCELLED';
export const WITHDRAWAL_STATES: readonly WithdrawalState[] = ['PENDING', 'PROCESSING', 'RECONCILIATION', 'PAID', 'CANCELLED'];
export type ReconciliationReason = 'UNKNOWN_OUTCOME' | 'AMOUNT_MISMATCH' | 'DESTINATION_MISMATCH' | 'TAKEOVER_NEEDED';
export const RECONCILIATION_REASONS: readonly ReconciliationReason[] = ['UNKNOWN_OUTCOME', 'AMOUNT_MISMATCH', 'DESTINATION_MISMATCH', 'TAKEOVER_NEEDED'];
export type WithdrawalOutcome = 'PAID' | 'CANCELLED_BY_SHIPPER' | 'CONFIRMED_NOT_SENT_FINAL';
export type WithdrawalEventKind =
  | 'CREATED'
  | 'CANCELLED'
  | 'PROCESSING_STARTED'
  | 'PAID'
  | 'RECONCILIATION_REPORTED'
  | 'RECONCILIATION_UNKNOWN'
  | 'RECONCILED_PAID'
  | 'RECONCILED_NOT_SENT';

export interface WithdrawalRow {
  readonly withdrawalId: string;
  readonly walletId: string;
  readonly driverId: string;
  readonly holdId: string;
  readonly amountVnd: bigint;
  readonly state: WithdrawalState;
  readonly version: number;
  readonly bankCode: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly createdByUserId: string;
  readonly processingOwnerUserId: string | null;
  readonly processingAttemptId: string | null;
  readonly processingStartedAtMs: number | null;
  readonly reconciliationReason: ReconciliationReason | null;
  readonly reconciliationReportedByUserId: string | null;
  readonly reconciliationReportedAtMs: number | null;
  readonly bankRecordId: string | null;
  readonly outcome: WithdrawalOutcome | null;
  readonly resolvedByUserId: string | null;
  readonly resolvedAtMs: number | null;
  readonly paidAtMs: number | null;
  readonly createdAtMs: number;
}

export interface WithdrawalCursor {
  readonly createdAtMs: number;
  readonly withdrawalId: string;
}

export interface WithdrawalEventRow {
  readonly eventId: string;
  readonly kind: WithdrawalEventKind;
  readonly fromState: WithdrawalState | null;
  readonly toState: WithdrawalState;
  readonly actorUserId: string;
  readonly reasonCode: string | null;
  readonly withdrawalVersion: number;
  readonly createdAtMs: number;
}

export interface OutgoingRecord {
  readonly bankRecordId: string;
  readonly bankId: string;
  readonly systemAccountId: string;
  readonly amountVnd: bigint;
  readonly occurredAtMs: number;
}

interface Raw {
  withdrawal_id: string;
  wallet_id: string;
  driver_id: string;
  hold_id: string;
  amount_vnd: string;
  state: string;
  version: string;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  created_by_user_id: string;
  processing_owner_user_id: string | null;
  processing_attempt_id: string | null;
  processing_ms: string | null;
  reconciliation_reason: string | null;
  reconciliation_by: string | null;
  reconciliation_ms: string | null;
  bank_record_id: string | null;
  outcome: string | null;
  resolved_by_user_id: string | null;
  resolved_ms: string | null;
  paid_ms: string | null;
  created_ms: string;
}

const COLUMNS = `w.withdrawal_id::text AS withdrawal_id, w.wallet_id::text AS wallet_id, w.driver_id::text AS driver_id, w.hold_id::text AS hold_id,
  w.amount_vnd::text AS amount_vnd, w.state, w.version::text AS version, w.bank_code, w.bank_name, w.account_number, w.account_holder,
  w.created_by_user_id::text AS created_by_user_id, w.processing_owner_user_id::text AS processing_owner_user_id, w.processing_attempt_id::text AS processing_attempt_id,
  (extract(epoch FROM w.processing_started_at) * 1000)::bigint::text AS processing_ms, w.reconciliation_reason,
  w.reconciliation_reported_by_user_id::text AS reconciliation_by, (extract(epoch FROM w.reconciliation_reported_at) * 1000)::bigint::text AS reconciliation_ms,
  w.bank_record_id::text AS bank_record_id, w.outcome, w.resolved_by_user_id::text AS resolved_by_user_id,
  (extract(epoch FROM w.resolved_at) * 1000)::bigint::text AS resolved_ms, (extract(epoch FROM w.paid_at) * 1000)::bigint::text AS paid_ms,
  (extract(epoch FROM w.created_at) * 1000)::bigint::text AS created_ms`;

function safeNumber(raw: unknown): number {
  const value = typeof raw === 'string' && /^[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

function optionalNumber(raw: string | null): number | null {
  return raw === null ? null : safeNumber(raw);
}

function toWithdrawal(row: Raw): WithdrawalRow {
  if (!WITHDRAWAL_STATES.includes(row.state as WithdrawalState) || !/^[0-9]{1,16}$/.test(row.amount_vnd)) {
    throw new TechnicalError('internal', 'Database returned an unexpected withdrawal');
  }
  const amount = BigInt(row.amount_vnd);
  if (amount <= 0n || amount > MAX_WALLET_VND) {
    throw new TechnicalError('internal', 'Database returned an unexpected withdrawal amount');
  }
  return {
    withdrawalId: row.withdrawal_id,
    walletId: row.wallet_id,
    driverId: row.driver_id,
    holdId: row.hold_id,
    amountVnd: amount,
    state: row.state as WithdrawalState,
    version: safeNumber(row.version),
    bankCode: row.bank_code,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
    createdByUserId: row.created_by_user_id,
    processingOwnerUserId: row.processing_owner_user_id,
    processingAttemptId: row.processing_attempt_id,
    processingStartedAtMs: optionalNumber(row.processing_ms),
    reconciliationReason: row.reconciliation_reason as ReconciliationReason | null,
    reconciliationReportedByUserId: row.reconciliation_by,
    reconciliationReportedAtMs: optionalNumber(row.reconciliation_ms),
    bankRecordId: row.bank_record_id,
    outcome: row.outcome as WithdrawalOutcome | null,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAtMs: optionalNumber(row.resolved_ms),
    paidAtMs: optionalNumber(row.paid_ms),
    createdAtMs: safeNumber(row.created_ms),
  };
}

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;

@Injectable()
export class WithdrawalRepository {
  /**
   * Inserts a PENDING withdrawal at version 1 and snapshots, in the SAME statement, the Shipper's bank account — but only while it is VERIFIED. Returns
   * undefined when there is no verified account (nothing is written). The hold row is written by the caller right after (both foreign keys are deferred).
   */
  async insertPending(
    context: TransactionContext,
    input: { withdrawalId: string; walletId: string; driverId: string; holdId: string; amountVnd: bigint; createdByUserId: string },
  ): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(
      `WITH inserted AS (
         INSERT INTO app.wallet_withdrawals (withdrawal_id, wallet_id, driver_id, hold_id, amount_vnd, state, version, bank_code, bank_name, account_number, account_holder,
                                             bank_snapshot_at, bank_verified_at, created_by_user_id, created_at, updated_at)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'PENDING', 1, b.bank_code, b.bank_name, b.account_number, b.account_holder,
                b.updated_at, b.verified_at, $6::uuid, ${CLOCK}, ${CLOCK}
           FROM app.driver_bank_accounts b
          WHERE b.driver_id = $3::uuid AND b.verification_state = 'VERIFIED' AND b.verified_at IS NOT NULL
         RETURNING *
       )
       SELECT ${COLUMNS} FROM inserted w`,
      [input.withdrawalId, input.walletId, input.driverId, input.holdId, input.amountVnd.toString(), input.createdByUserId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async findById(context: TransactionContext, withdrawalId: string): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_withdrawals w WHERE w.withdrawal_id = $1::uuid`, [withdrawalId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async lockById(context: TransactionContext, withdrawalId: string): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_withdrawals w WHERE w.withdrawal_id = $1::uuid FOR UPDATE`, [withdrawalId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async findOwned(context: TransactionContext, withdrawalId: string, driverId: string): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_withdrawals w WHERE w.withdrawal_id = $1::uuid AND w.driver_id = $2::uuid`, [withdrawalId, driverId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async lockOwned(context: TransactionContext, withdrawalId: string, driverId: string): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_withdrawals w WHERE w.withdrawal_id = $1::uuid AND w.driver_id = $2::uuid FOR UPDATE`, [withdrawalId, driverId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async listForWallet(
    context: TransactionContext,
    walletId: string,
    options: { state: WithdrawalState | undefined; limit: number; after: WithdrawalCursor | undefined },
  ): Promise<WithdrawalRow[]> {
    const result = await context.query<Raw>(
      `SELECT ${COLUMNS} FROM app.wallet_withdrawals w
        WHERE w.wallet_id = $1::uuid
          AND ($2::text IS NULL OR w.state = $2::text)
          AND ($3::bigint IS NULL OR (w.created_at, w.withdrawal_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::uuid))
        ORDER BY w.created_at DESC, w.withdrawal_id DESC
        LIMIT $5::int`,
      [walletId, options.state ?? null, options.after?.createdAtMs ?? null, options.after?.withdrawalId ?? null, options.limit],
    );
    return result.rows.map(toWithdrawal);
  }

  async listForAdmin(context: TransactionContext, options: { state: WithdrawalState | undefined; limit: number; after: WithdrawalCursor | undefined }): Promise<WithdrawalRow[]> {
    const result = await context.query<Raw>(
      `SELECT ${COLUMNS} FROM app.wallet_withdrawals w
        WHERE ($1::text IS NULL OR w.state = $1::text)
          AND ($2::bigint IS NULL OR (w.created_at, w.withdrawal_id) < ('epoch'::timestamptz + $2::bigint * interval '1 millisecond', $3::uuid))
        ORDER BY w.created_at DESC, w.withdrawal_id DESC
        LIMIT $4::int`,
      [options.state ?? null, options.after?.createdAtMs ?? null, options.after?.withdrawalId ?? null, options.limit],
    );
    return result.rows.map(toWithdrawal);
  }

  /** True while the Shipper's bank account is STILL the exact verified one the withdrawal was snapshotted from (not edited, re-verified, rejected or missing). */
  async bankSnapshotIsCurrent(context: TransactionContext, withdrawalId: string): Promise<boolean> {
    const result = await context.query<{ current: boolean }>(
      `SELECT (b.verification_state = 'VERIFIED' AND b.updated_at = w.bank_snapshot_at AND b.verified_at = w.bank_verified_at
               AND b.bank_code = w.bank_code AND b.account_number = w.account_number AND b.account_holder = w.account_holder) AS current
         FROM app.wallet_withdrawals w JOIN app.driver_bank_accounts b ON b.driver_id = w.driver_id WHERE w.withdrawal_id = $1::uuid`,
      [withdrawalId],
    );
    return result.rows[0]?.current === true;
  }

  /** PENDING -> CANCELLED by the Shipper at the expected version. */
  async cancelByShipper(context: TransactionContext, withdrawalId: string, expectedVersion: number, actorUserId: string): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET state = 'CANCELLED', outcome = 'CANCELLED_BY_SHIPPER', resolved_by_user_id = $3::uuid, resolved_at = ${CLOCK}, updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = 'PENDING' AND w.version = $2::bigint RETURNING w.*`,
      [withdrawalId, expectedVersion, actorUserId],
    );
  }

  /** PENDING -> PROCESSING: the claim (owner and attempt) is written once, here. */
  async startProcessing(context: TransactionContext, withdrawalId: string, expectedVersion: number, ownerUserId: string, attemptId: string): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET state = 'PROCESSING', processing_owner_user_id = $3::uuid, processing_attempt_id = $4::uuid, processing_started_at = ${CLOCK},
              updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = 'PENDING' AND w.version = $2::bigint RETURNING w.*`,
      [withdrawalId, expectedVersion, ownerUserId, attemptId],
    );
  }

  /** PROCESSING -> RECONCILIATION (the reason and the reporter are written once). */
  async reportReconciliation(
    context: TransactionContext,
    withdrawalId: string,
    expectedVersion: number,
    reason: ReconciliationReason,
    reporterUserId: string,
    bankRecordId: string | null,
  ): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET state = 'RECONCILIATION', reconciliation_reason = $3, reconciliation_reported_by_user_id = $4::uuid, reconciliation_reported_at = ${CLOCK},
              bank_record_id = $5::uuid, updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = 'PROCESSING' AND w.version = $2::bigint RETURNING w.*`,
      [withdrawalId, expectedVersion, reason, reporterUserId, bankRecordId],
    );
  }

  /** RECONCILIATION -> RECONCILIATION: nothing is decided; the version moves (a concurrent reconciler conflicts) and an outgoing record may be attached once. */
  async touchReconciliation(context: TransactionContext, withdrawalId: string, expectedVersion: number, bankRecordId: string | null): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET bank_record_id = COALESCE(w.bank_record_id, $3::uuid), updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = 'RECONCILIATION' AND w.version = $2::bigint RETURNING w.*`,
      [withdrawalId, expectedVersion, bankRecordId],
    );
  }

  /** PROCESSING | RECONCILIATION -> PAID. The outgoing record is the one recorded in this transaction (or earlier, in RECONCILIATION). */
  async markPaid(
    context: TransactionContext,
    withdrawalId: string,
    from: 'PROCESSING' | 'RECONCILIATION',
    expectedVersion: number,
    actorUserId: string,
    bankRecordId: string,
    paidAtIso: string,
  ): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET state = 'PAID', outcome = 'PAID', bank_record_id = COALESCE(w.bank_record_id, $4::uuid), resolved_by_user_id = $3::uuid, resolved_at = ${CLOCK},
              paid_at = $5::timestamptz, updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = $6 AND w.version = $2::bigint RETURNING w.*`,
      [withdrawalId, expectedVersion, actorUserId, bankRecordId, paidAtIso, from],
    );
  }

  /** RECONCILIATION -> CANCELLED: certainly never sent (no outgoing record exists). */
  async resolveNotSent(context: TransactionContext, withdrawalId: string, expectedVersion: number, actorUserId: string): Promise<WithdrawalRow | undefined> {
    return this.#update(
      context,
      `UPDATE app.wallet_withdrawals w SET state = 'CANCELLED', outcome = 'CONFIRMED_NOT_SENT_FINAL', resolved_by_user_id = $3::uuid, resolved_at = ${CLOCK}, updated_at = ${CLOCK}, version = w.version + 1
        WHERE w.withdrawal_id = $1::uuid AND w.state = 'RECONCILIATION' AND w.version = $2::bigint AND w.bank_record_id IS NULL RETURNING w.*`,
      [withdrawalId, expectedVersion, actorUserId],
    );
  }

  async #update(context: TransactionContext, sql: string, params: readonly unknown[]): Promise<WithdrawalRow | undefined> {
    const result = await context.query<Raw>(`WITH changed AS (${sql}) SELECT ${COLUMNS} FROM changed w`, [...params]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWithdrawal(row);
  }

  async insertEvent(
    context: TransactionContext,
    input: { eventId: string; withdrawalId: string; kind: WithdrawalEventKind; fromState: WithdrawalState | null; toState: WithdrawalState; actorUserId: string; reasonCode: string | null; version: number },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.wallet_withdrawal_events (event_id, withdrawal_id, kind, from_state, to_state, actor_user_id, reason_code, withdrawal_version, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::bigint, ${CLOCK})`,
      [input.eventId, input.withdrawalId, input.kind, input.fromState, input.toState, input.actorUserId, input.reasonCode, input.version],
    );
  }

  async listEvents(context: TransactionContext, withdrawalId: string): Promise<WithdrawalEventRow[]> {
    const result = await context.query<{
      event_id: string;
      kind: string;
      from_state: string | null;
      to_state: string;
      actor_user_id: string;
      reason_code: string | null;
      withdrawal_version: string;
      created_ms: string;
    }>(
      `SELECT e.event_id::text AS event_id, e.kind, e.from_state, e.to_state, e.actor_user_id::text AS actor_user_id, e.reason_code, e.withdrawal_version::text AS withdrawal_version,
              (extract(epoch FROM e.created_at) * 1000)::bigint::text AS created_ms
         FROM app.wallet_withdrawal_events e WHERE e.withdrawal_id = $1::uuid ORDER BY e.created_at, e.event_id`,
      [withdrawalId],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      kind: row.kind as WithdrawalEventKind,
      fromState: row.from_state as WithdrawalState | null,
      toState: row.to_state as WithdrawalState,
      actorUserId: row.actor_user_id,
      reasonCode: row.reason_code,
      withdrawalVersion: safeNumber(row.withdrawal_version),
      createdAtMs: safeNumber(row.created_ms),
    }));
  }

  /**
   * Records the OUTGOING bank transaction in the shared registry. The identity (bank, system account, transaction id) is unique across the whole system, in
   * both directions: false means somebody already recorded it (for this or any other withdrawal or topup) and nothing was written.
   */
  async insertOutgoingRecord(
    context: TransactionContext,
    input: { bankRecordId: string; bankId: string; systemAccountId: string; canonicalTransactionId: string; amountVnd: bigint; occurredAtIso: string; withdrawalId: string },
  ): Promise<boolean> {
    let result;
    try { result = await context.query(
      `INSERT INTO app.wallet_bank_transactions (bank_record_id, bank_id, system_owned_account_id, canonical_transaction_id, direction, amount_vnd, occurred_at, topup_id, withdrawal_id, created_at)
       SELECT $1::uuid, $2, $3::uuid, $4, 'OUT', $5::bigint, $6::timestamptz, NULL, $7::uuid, ${CLOCK}
       ON CONFLICT (bank_id, system_owned_account_id, canonical_transaction_id) DO NOTHING`,
      [input.bankRecordId, input.bankId, input.systemAccountId, input.canonicalTransactionId, input.amountVnd.toString(), input.occurredAtIso, input.withdrawalId],
    );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'business_bank_receipts_pkey') throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
      throw error;
    }
    return result.rowCount === 1;
  }

  async findOutgoingRecord(context: TransactionContext, bankRecordId: string): Promise<OutgoingRecord | undefined> {
    const result = await context.query<{ bank_record_id: string; bank_id: string; system_account_id: string; amount_vnd: string; occurred_ms: string }>(
      `SELECT b.bank_record_id::text AS bank_record_id, b.bank_id, b.system_owned_account_id::text AS system_account_id, b.amount_vnd::text AS amount_vnd,
              (extract(epoch FROM b.occurred_at) * 1000)::bigint::text AS occurred_ms
         FROM app.wallet_bank_transactions b WHERE b.bank_record_id = $1::uuid AND b.direction = 'OUT'`,
      [bankRecordId],
    );
    const row = result.rows[0];
    if (row === undefined || !/^[0-9]{1,16}$/.test(row.amount_vnd)) {
      return undefined;
    }
    return { bankRecordId: row.bank_record_id, bankId: row.bank_id, systemAccountId: row.system_account_id, amountVnd: BigInt(row.amount_vnd), occurredAtMs: safeNumber(row.occurred_ms) };
  }

  /** Does any outgoing record of this withdrawal exist (a plain read; the registry is append-only)? */
  async hasOutgoingRecord(context: TransactionContext, withdrawalId: string): Promise<boolean> {
    const result = await context.query(`SELECT 1 FROM app.wallet_bank_transactions b WHERE b.withdrawal_id = $1::uuid AND b.direction = 'OUT'`, [withdrawalId]);
    return result.rowCount === 1;
  }
}
