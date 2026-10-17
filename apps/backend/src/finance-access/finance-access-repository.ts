import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { FinanceGrantState } from './finance-access-constants';

// SQL of app.admin_finance_grants (M04-B2.2a). Writers lock the row FOR UPDATE after the target's user and membership rows; the participant that
// authorizes a finance command locks it FOR SHARE, so a revocation waits for a command that already passed the check, and a command started after
// the revocation sees it.

export interface FinanceGrantRow {
  readonly userId: string;
  readonly permissionKey: string;
  readonly state: FinanceGrantState;
  readonly version: number;
  readonly grantedAtMs: number;
  readonly revokedAtMs: number | null;
}

interface RawGrant {
  user_id: string;
  permission_key: string;
  state: string;
  version: string;
  granted_ms: string;
  revoked_ms: string | null;
}

const COLUMNS = `g.user_id::text AS user_id, g.permission_key, g.state, g.version::text AS version,
  (extract(epoch FROM g.granted_at) * 1000)::bigint::text AS granted_ms, (extract(epoch FROM g.revoked_at) * 1000)::bigint::text AS revoked_ms`;

function toGrant(row: RawGrant): FinanceGrantRow {
  const version = Number(row.version);
  const grantedAtMs = Number(row.granted_ms);
  const revokedAtMs = row.revoked_ms === null ? null : Number(row.revoked_ms);
  if ((row.state !== 'GRANTED' && row.state !== 'REVOKED') || !Number.isSafeInteger(version) || !Number.isSafeInteger(grantedAtMs) || (revokedAtMs !== null && !Number.isSafeInteger(revokedAtMs))) {
    throw new TechnicalError('internal', 'Database returned an unexpected finance grant');
  }
  return { userId: row.user_id, permissionKey: row.permission_key, state: row.state, version, grantedAtMs, revokedAtMs };
}

@Injectable()
export class FinanceAccessRepository {
  /** Every right row of one administrator, in key order. A plain read. */
  async listForUser(context: TransactionContext, userId: string): Promise<FinanceGrantRow[]> {
    const result = await context.query<RawGrant>(`SELECT ${COLUMNS} FROM app.admin_finance_grants g WHERE g.user_id = $1::uuid ORDER BY g.permission_key`, [userId]);
    return result.rows.map(toGrant);
  }

  async lockForUpdate(context: TransactionContext, userId: string, permissionKey: string): Promise<FinanceGrantRow | undefined> {
    const result = await context.query<RawGrant>(
      `SELECT ${COLUMNS} FROM app.admin_finance_grants g WHERE g.user_id = $1::uuid AND g.permission_key = $2 FOR UPDATE`,
      [userId, permissionKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGrant(row);
  }

  async lockForShare(context: TransactionContext, userId: string, permissionKey: string): Promise<FinanceGrantRow | undefined> {
    const result = await context.query<RawGrant>(
      `SELECT ${COLUMNS} FROM app.admin_finance_grants g WHERE g.user_id = $1::uuid AND g.permission_key = $2 FOR SHARE`,
      [userId, permissionKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGrant(row);
  }

  /** A first grant: GRANTED at version 1 (the database refuses a holder that is not an ADMIN membership). */
  async insertGranted(context: TransactionContext, input: { userId: string; permissionKey: string; grantedBy: string }): Promise<FinanceGrantRow> {
    const result = await context.query<RawGrant>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            inserted AS (
              INSERT INTO app.admin_finance_grants (user_id, permission_key, state, granted_by_user_id, granted_at, version, created_at, updated_at)
              SELECT $1::uuid, $2, 'GRANTED', $3::uuid, clock.t, 1, clock.t, clock.t FROM clock
              RETURNING *
            )
       SELECT ${COLUMNS} FROM inserted g`,
      [input.userId, input.permissionKey, input.grantedBy],
    );
    return this.#one(result.rows[0]);
  }

  /** REVOKED -> GRANTED again (the row is locked and its version checked by the caller). */
  async regrant(context: TransactionContext, input: { userId: string; permissionKey: string; grantedBy: string }): Promise<FinanceGrantRow> {
    const result = await context.query<RawGrant>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.admin_finance_grants g
                 SET state = 'GRANTED', granted_by_user_id = $3::uuid, granted_at = clock.t, revoked_by_user_id = NULL, revoked_at = NULL,
                     version = g.version + 1, updated_at = clock.t
                FROM clock WHERE g.user_id = $1::uuid AND g.permission_key = $2 AND g.state = 'REVOKED'
               RETURNING g.*
            )
       SELECT ${COLUMNS} FROM updated g`,
      [input.userId, input.permissionKey, input.grantedBy],
    );
    return this.#one(result.rows[0]);
  }

  /** GRANTED -> REVOKED. */
  async revoke(context: TransactionContext, input: { userId: string; permissionKey: string; revokedBy: string }): Promise<FinanceGrantRow> {
    const result = await context.query<RawGrant>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            updated AS (
              UPDATE app.admin_finance_grants g
                 SET state = 'REVOKED', revoked_by_user_id = $3::uuid, revoked_at = clock.t, version = g.version + 1, updated_at = clock.t
                FROM clock WHERE g.user_id = $1::uuid AND g.permission_key = $2 AND g.state = 'GRANTED'
               RETURNING g.*
            )
       SELECT ${COLUMNS} FROM updated g`,
      [input.userId, input.permissionKey, input.revokedBy],
    );
    return this.#one(result.rows[0]);
  }

  #one(row: RawGrant | undefined): FinanceGrantRow {
    if (row === undefined) {
      // The row was locked and checked just before, so this is unreachable; never guess, roll the transaction back.
      throw new TechnicalError('internal', 'Finance grant was not written');
    }
    return toGrant(row);
  }
}
