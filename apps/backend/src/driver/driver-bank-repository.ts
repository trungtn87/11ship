import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK_CTE, toSafeInteger } from './driver-db';
import { BankVerificationState } from './driver-types';

export interface DriverBankRow {
  readonly driverId: string;
  readonly bankCode: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly verificationState: BankVerificationState;
  readonly verifiedBy: string | null;
  readonly verifiedAtMs: number | null;
  readonly rejectionReason: string | null;
  readonly updatedAtMs: number;
}

export interface BankFields {
  readonly bankCode: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
}

interface RawBank {
  driver_id: string;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  verification_state: BankVerificationState;
  verified_by: string | null;
  verified_ms: string | null;
  rejection_reason: string | null;
  updated_ms: string;
}

const COLUMNS = `driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by::text AS verified_by,
  (extract(epoch FROM verified_at) * 1000)::bigint::text AS verified_ms, rejection_reason, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms`;

function toBank(row: RawBank): DriverBankRow {
  return {
    driverId: row.driver_id,
    bankCode: row.bank_code,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
    verificationState: row.verification_state,
    verifiedBy: row.verified_by,
    verifiedAtMs: row.verified_ms === null ? null : toSafeInteger(row.verified_ms),
    rejectionReason: row.rejection_reason,
    updatedAtMs: toSafeInteger(row.updated_ms),
  };
}

/** SQL for app.driver_bank_accounts. The caller holds the owning driver row locked; nothing here locks on its own. */
@Injectable()
export class DriverBankRepository {
  async find(context: TransactionContext, driverId: string): Promise<DriverBankRow | undefined> {
    const result = await context.query<RawBank>(`SELECT ${COLUMNS} FROM app.driver_bank_accounts WHERE driver_id = $1::uuid`, [driverId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toBank(row);
  }

  /** Creates the account or replaces its data. Any write leaves it UNVERIFIED: a verification belongs to one exact set of data. */
  async upsertUnverified(context: TransactionContext, driverId: string, fields: BankFields): Promise<DriverBankRow> {
    const result = await context.query<RawBank>(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, created_at, updated_at)
       SELECT $1::uuid, $2, $3, $4, $5, 'UNVERIFIED', clock.t, clock.t FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (driver_id) DO UPDATE
          SET bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name, account_number = EXCLUDED.account_number,
              account_holder = EXCLUDED.account_holder, verification_state = 'UNVERIFIED', verified_by = NULL, verified_at = NULL,
              rejection_reason = NULL, updated_at = EXCLUDED.updated_at
       RETURNING ${COLUMNS}`,
      [driverId, fields.bankCode, fields.bankName, fields.accountNumber, fields.accountHolder],
    );
    return toBank(result.rows[0] as RawBank);
  }

  async markVerified(context: TransactionContext, driverId: string, adminUserId: string): Promise<DriverBankRow | undefined> {
    const result = await context.query<RawBank>(
      `UPDATE app.driver_bank_accounts AS b
          SET verification_state = 'VERIFIED', verified_by = $2::uuid, verified_at = clock.t, rejection_reason = NULL, updated_at = clock.t
         FROM (${CLOCK_CTE}) AS clock
        WHERE b.driver_id = $1::uuid
    RETURNING ${COLUMNS}`,
      [driverId, adminUserId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toBank(row);
  }

  async markRejected(context: TransactionContext, driverId: string, reason: string): Promise<DriverBankRow | undefined> {
    const result = await context.query<RawBank>(
      `UPDATE app.driver_bank_accounts AS b
          SET verification_state = 'REJECTED', verified_by = NULL, verified_at = NULL, rejection_reason = $2, updated_at = clock.t
         FROM (${CLOCK_CTE}) AS clock
        WHERE b.driver_id = $1::uuid
    RETURNING ${COLUMNS}`,
      [driverId, reason],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toBank(row);
  }

  /** The profile name changed: the stored holder no longer proves anything, so the account goes back to UNVERIFIED. */
  async resetToUnverified(context: TransactionContext, driverId: string): Promise<void> {
    await context.query(
      `UPDATE app.driver_bank_accounts AS b
          SET verification_state = 'UNVERIFIED', verified_by = NULL, verified_at = NULL, rejection_reason = NULL, updated_at = clock.t
         FROM (${CLOCK_CTE}) AS clock
        WHERE b.driver_id = $1::uuid`,
      [driverId],
    );
  }
}
