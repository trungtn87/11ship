import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of app.system_owned_bank_accounts for the SYSTEM configuration (M04-B2.2a): read, and INSERT of an account that is NOT yet receiving.
// There is no UPDATE here: switching an account on (can_receive = true) opens the money path and belongs to B2.2b, so this package cannot do
// it and the runtime role has no UPDATE privilege on the table. The INSERT writes the literal false.

export interface SystemBankAccountRow {
  readonly accountId: string;
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly canReceive: boolean;
  readonly version: number;
  readonly createdAtMs: number;
}

interface RawAccount {
  system_account_id: string;
  bank_id: string;
  account_number: string;
  account_holder: string;
  can_receive: boolean;
  version: string;
  created_ms: string;
}

const COLUMNS = `a.system_account_id::text AS system_account_id, a.bank_id, a.account_number, a.account_holder, a.can_receive,
  a.version::text AS version, (extract(epoch FROM a.created_at) * 1000)::bigint::text AS created_ms`;

function toAccount(row: RawAccount): SystemBankAccountRow {
  const version = Number(row.version);
  const createdAtMs = Number(row.created_ms);
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(createdAtMs)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return { accountId: row.system_account_id, bankId: row.bank_id, accountNumber: row.account_number, accountHolder: row.account_holder, canReceive: row.can_receive, version, createdAtMs };
}

@Injectable()
export class SystemBankAccountRepository {
  async list(context: TransactionContext): Promise<SystemBankAccountRow[]> {
    const result = await context.query<RawAccount>(`SELECT ${COLUMNS} FROM app.system_owned_bank_accounts a ORDER BY a.created_at, a.system_account_id`);
    return result.rows.map(toAccount);
  }

  async find(context: TransactionContext, accountId: string): Promise<SystemBankAccountRow | undefined> {
    const result = await context.query<RawAccount>(`SELECT ${COLUMNS} FROM app.system_owned_bank_accounts a WHERE a.system_account_id = $1::uuid`, [accountId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  /**
   * Inserts an account that cannot receive money yet (can_receive is the literal false). The unique (bank, number) decides a race: the
   * loser inserts nothing and gets undefined, and nothing of the existing account is revealed.
   */
  async insertInactive(
    context: TransactionContext,
    input: { accountId: string; bankId: string; accountNumber: string; accountHolder: string },
  ): Promise<SystemBankAccountRow | undefined> {
    const result = await context.query<RawAccount>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            inserted AS (
              INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, version, created_at, updated_at)
              SELECT $1::uuid, $2, $3, $4, false, 1, clock.t, clock.t FROM clock
              ON CONFLICT (bank_id, account_number) DO NOTHING
              RETURNING *
            )
       SELECT ${COLUMNS} FROM inserted a`,
      [input.accountId, input.bankId, input.accountNumber, input.accountHolder],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAccount(row);
  }
}
