import { Injectable } from '@nestjs/common';
import { CLOCK_CTE } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';
import { LIMIT_CONFIG_LOCK_KEY } from './admin-auth-constants';

export interface LimitConfigRow {
  readonly limiterKeyId: string;
  readonly keyCheck: string;
}

/** SQL for the singleton app.admin_auth_limit_config. It is only ever INSERTed (by the operator command), never updated. */
@Injectable()
export class AdminLimitConfigRepository {
  async read(context: TransactionContext): Promise<LimitConfigRow | undefined> {
    const result = await context.query<{ limiter_key_id: string; key_check: string }>(
      'SELECT limiter_key_id, key_check FROM app.admin_auth_limit_config WHERE singleton_id = 1',
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { limiterKeyId: row.limiter_key_id, keyCheck: row.key_check };
  }

  /** Serializes concurrent initializers for the rest of the transaction. */
  async lockInitialization(context: TransactionContext): Promise<void> {
    await context.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [LIMIT_CONFIG_LOCK_KEY]);
  }

  /** True when this call wrote the row. */
  async insert(context: TransactionContext, row: LimitConfigRow): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.admin_auth_limit_config (singleton_id, limiter_key_id, key_check, created_at)
       SELECT 1, $1, $2, clock.t FROM (${CLOCK_CTE}) AS clock
       ON CONFLICT (singleton_id) DO NOTHING`,
      [row.limiterKeyId, row.keyCheck],
    );
    return result.rowCount === 1;
  }
}
