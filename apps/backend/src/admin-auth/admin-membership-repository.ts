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

  /**
   * The user id of the one SYSTEM membership (whatever its status), read WITHOUT a lock. The serialized bootstrap uses
   * it only to learn WHICH account to lock; it then locks the user, then that membership, and re-checks the role under
   * the lock, so the administration lock order (user, then membership) is never inverted.
   */
  async findSystemUserId(context: TransactionContext): Promise<string | undefined> {
    const result = await context.query<{ user_id: string }>(
      `SELECT user_id FROM app.admin_memberships WHERE admin_role = 'SYSTEM'`,
    );
    return result.rows[0]?.user_id;
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

  /**
   * ACTIVE <-> DISABLED of an ADMIN membership, version + 1. The version is part of every session's binding, so any session issued for the old version stops working
   * with this change (M12-C); the caller holds the membership FOR UPDATE and passes the version it read.
   */
  async setStatus(context: TransactionContext, userId: string, expectedVersion: number, status: MembershipStatus): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_memberships SET status = $3, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE user_id = $1::uuid AND version = $2::bigint AND admin_role = 'ADMIN'`,
      [userId, expectedVersion, status],
    );
    return result.rowCount === 1;
  }
}
