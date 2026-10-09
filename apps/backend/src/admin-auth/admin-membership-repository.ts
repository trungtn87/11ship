import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { toSafeInteger } from '../auth/auth-db';
import { AdminRole } from './admin-auth-constants';

export type MembershipStatus = 'ACTIVE' | 'DISABLED';

export interface MembershipRow {
  readonly userId: string;
  readonly adminRole: AdminRole;
  readonly status: MembershipStatus;
  readonly version: number;
}

interface RawMembership {
  user_id: string;
  admin_role: AdminRole;
  status: MembershipStatus;
  version: string;
}

function toMembership(row: RawMembership): MembershipRow {
  return {
    userId: row.user_id,
    adminRole: row.admin_role,
    status: row.status,
    version: toSafeInteger(row.version),
  };
}

/** SQL for app.admin_memberships. The membership - never the account origin - decides who is an administrator. */
@Injectable()
export class AdminMembershipRepository {
  async find(context: TransactionContext, userId: string): Promise<MembershipRow | undefined> {
    const result = await context.query<RawMembership>(
      `SELECT user_id, admin_role, status, version FROM app.admin_memberships WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMembership(row);
  }

  async lock(context: TransactionContext, userId: string): Promise<MembershipRow | undefined> {
    const result = await context.query<RawMembership>(
      `SELECT user_id, admin_role, status, version FROM app.admin_memberships WHERE user_id = $1::uuid FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMembership(row);
  }

  async lockShared(context: TransactionContext, userId: string): Promise<MembershipRow | undefined> {
    const result = await context.query<RawMembership>(
      `SELECT user_id, admin_role, status, version FROM app.admin_memberships WHERE user_id = $1::uuid FOR SHARE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMembership(row);
  }

  /** The one SYSTEM membership (whatever its status), locked FOR UPDATE, for the serialized bootstrap. */
  async lockSystem(context: TransactionContext): Promise<MembershipRow | undefined> {
    const result = await context.query<RawMembership>(
      `SELECT user_id, admin_role, status, version FROM app.admin_memberships WHERE admin_role = 'SYSTEM' FOR UPDATE`,
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMembership(row);
  }

  async insertSystem(context: TransactionContext, userId: string): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       SELECT $1::uuid, 'SYSTEM', 'ACTIVE', 1, clock.t, clock.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock`,
      [userId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Membership was not written');
    }
  }
}
