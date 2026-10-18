import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of the money posted by an administrator's confirmation (M04-B2.2b): the wallet row lock, the receiving account lock, the bank record (IN), the topup, the
// ledger credit and the balance. Only TopupPostingService calls it, in that order, inside the caller's transaction. Every amount is bound as text and parsed to bigint.

export interface LockedWallet {
  readonly walletId: string;
  readonly driverId: string;
  readonly balanceVnd: bigint;
  readonly heldVnd: bigint;
  readonly version: number;
}
export interface LockedAccount {
  readonly bankId: string;
  readonly canReceive: boolean;
}
export interface LastLedger {
  readonly sequenceNo: number;
  readonly balanceAfterVnd: bigint;
}

function amount(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

@Injectable()
export class TopupSettlementRepository {
  async lockWallet(context: TransactionContext, walletId: string): Promise<LockedWallet | undefined> {
    const result = await context.query<{ wallet_id: string; driver_id: string; balance_vnd: string; held_vnd: string; version: string }>(
      `SELECT wallet_id::text AS wallet_id, driver_id::text AS driver_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, version::text AS version
         FROM app.driver_wallets WHERE wallet_id = $1::uuid FOR UPDATE`,
      [walletId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { walletId: row.wallet_id, driverId: row.driver_id, balanceVnd: amount(row.balance_vnd), heldVnd: amount(row.held_vnd), version: Number(amount(row.version)) };
  }

  /** The receiving account, FOR SHARE: a switch-off (FOR UPDATE) waits for a confirmation that already passed this check. */
  async lockAccountShared(context: TransactionContext, accountId: string): Promise<LockedAccount | undefined> {
    const result = await context.query<{ bank_id: string; can_receive: boolean }>(
      `SELECT a.bank_id, a.can_receive FROM app.system_owned_bank_accounts a WHERE a.system_account_id = $1::uuid FOR SHARE`,
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { bankId: row.bank_id, canReceive: row.can_receive };
  }

  async lastLedger(context: TransactionContext, walletId: string): Promise<LastLedger | undefined> {
    const result = await context.query<{ sequence_no: string; balance_after_vnd: string }>(
      `SELECT l.sequence_no::text AS sequence_no, l.balance_after_vnd::text AS balance_after_vnd FROM app.wallet_ledger_entries l
        WHERE l.wallet_id = $1::uuid ORDER BY l.sequence_no DESC LIMIT 1`,
      [walletId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { sequenceNo: Number(amount(row.sequence_no)), balanceAfterVnd: amount(row.balance_after_vnd) };
  }

  /** The bank transaction identity is unique across the whole system: the loser of a race, or a repeat of anyone's, inserts nothing and gets false. */
  async insertBankRecord(
    context: TransactionContext,
    input: { bankRecordId: string; bankId: string; systemAccountId: string; canonicalTransactionId: string; amountVnd: bigint; occurredAtIso: string; topupId: string },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.wallet_bank_transactions (bank_record_id, bank_id, system_owned_account_id, canonical_transaction_id, direction, amount_vnd, occurred_at, topup_id, withdrawal_id, created_at)
       SELECT $1::uuid, $2, $3::uuid, $4, 'IN', $5::bigint, $6::timestamptz, $7::uuid, NULL, date_trunc('milliseconds', clock_timestamp())
       ON CONFLICT (bank_id, system_owned_account_id, canonical_transaction_id) DO NOTHING`,
      [input.bankRecordId, input.bankId, input.systemAccountId, input.canonicalTransactionId, input.amountVnd.toString(), input.occurredAtIso, input.topupId],
    );
    return result.rowCount === 1;
  }

  async insertTopup(
    context: TransactionContext,
    input: { topupId: string; walletId: string; requestId: string; bankRecordId: string; amountVnd: bigint; receivedAtIso: string; confirmedByUserId: string },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.wallet_topups (topup_id, wallet_id, request_id, bank_record_id, actual_amount_vnd, received_at, confirmed_by_user_id, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::timestamptz, $7::uuid, date_trunc('milliseconds', clock_timestamp()))`,
      [input.topupId, input.walletId, input.requestId, input.bankRecordId, input.amountVnd.toString(), input.receivedAtIso, input.confirmedByUserId],
    );
  }

  async insertTopupLedger(
    context: TransactionContext,
    input: { entryId: string; walletId: string; sequenceNo: number; deltaVnd: bigint; balanceAfterVnd: bigint; topupId: string },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id)
       VALUES ($1::uuid, $2::uuid, $3::bigint, 'TOPUP', $4::bigint, $5::bigint, date_trunc('milliseconds', clock_timestamp()), $6::uuid)`,
      [input.entryId, input.walletId, input.sequenceNo, input.deltaVnd.toString(), input.balanceAfterVnd.toString(), input.topupId],
    );
  }

  /** balance_vnd = the new balance, version +1, at the version read under the lock; held_vnd is not in the statement. */
  async addToBalance(context: TransactionContext, input: { walletId: string; expectedVersion: number; newBalanceVnd: bigint }): Promise<void> {
    const result = await context.query(
      `UPDATE app.driver_wallets
          SET balance_vnd = $3::bigint, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE wallet_id = $1::uuid AND version = $2::bigint`,
      [input.walletId, input.expectedVersion, input.newBalanceVnd.toString()],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Wallet changed under its lock');
    }
  }
}
