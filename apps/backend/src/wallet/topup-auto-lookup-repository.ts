import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * Read-only lookups the automatic bank-evidence path (SePay webhook, M04 step 1) needs BEFORE it takes its locks. They live in the wallet
 * package because they read wallet tables (the package rule: only wallet/ issues SQL on them). Nothing here locks or writes: the caller
 * takes the driver, wallet and request locks in ADR-004 order, and the posting path re-checks everything under those locks.
 */
export interface ReceivingAccountRow {
  readonly systemAccountId: string;
  readonly canReceive: boolean;
}

export interface RequestByCodeRow {
  readonly requestId: string;
  readonly walletId: string;
  readonly driverId: string;
}

@Injectable()
export class TopupAutoLookupRepository {
  /** The system receiving account for this bank and number. No lock: the posting path takes it FOR SHARE in its own order. */
  async findReceivingAccount(context: TransactionContext, bankId: string, accountNumber: string): Promise<ReceivingAccountRow | undefined> {
    const result = await context.query<{ system_account_id: string; can_receive: boolean }>(
      `SELECT system_account_id::text AS system_account_id, can_receive FROM app.system_owned_bank_accounts WHERE bank_id = $1 AND account_number = $2`,
      [bankId, accountNumber],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { systemAccountId: row.system_account_id, canReceive: row.can_receive };
  }

  /** The request that owns this transfer code, in any state. No lock: the caller locks the driver, the wallet and the request in order. */
  async findRequestByCode(context: TransactionContext, transferCode: string): Promise<RequestByCodeRow | undefined> {
    const result = await context.query<{ request_id: string; wallet_id: string; driver_id: string }>(
      `SELECT request_id::text AS request_id, wallet_id::text AS wallet_id, driver_id::text AS driver_id
         FROM app.wallet_topup_requests WHERE transfer_code_key = $1`,
      [transferCode],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { requestId: row.request_id, walletId: row.wallet_id, driverId: row.driver_id };
  }

  /** True when this bank transaction is already recorded on this account, by anyone. A read: the posting path decides under its own lock too. */
  async bankRecordExists(context: TransactionContext, bankId: string, systemAccountId: string, canonicalTransactionId: string): Promise<boolean> {
    const result = await context.query(
      `SELECT 1 FROM app.wallet_bank_transactions WHERE bank_id = $1 AND system_owned_account_id = $2::uuid AND canonical_transaction_id = $3 LIMIT 1`,
      [bankId, systemAccountId, canonicalTransactionId],
    );
    return result.rows.length > 0;
  }
}
