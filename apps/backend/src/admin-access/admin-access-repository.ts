import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AppPermissionInput } from './admin-access-validation';

export interface AdminAccessRow {
  readonly userId: string;
  readonly fullName: string;
  readonly phoneNormalized: string;
  readonly membershipStatus: 'ACTIVE' | 'DISABLED';
  readonly membershipVersion: number;
  readonly accountStatus: string;
  readonly createdAtMs: number;
  readonly liveSessions: number;
  readonly lastSessionMs: number | null;
}

/** SQL of the administrator list of M12-C: membership, profile, account and live sessions, read together. Writers live in the M01 repositories. */
@Injectable()
export class AdminAccessRepository {
  async listAdministrators(context: TransactionContext, limit: number): Promise<AdminAccessRow[]> {
    const result = await context.query<{ user_id: string; full_name: string; phone: string; status: 'ACTIVE' | 'DISABLED'; version: string; account_status: string; created_ms: string; live: string; last_ms: string | null }>(
      `SELECT am.user_id::text AS user_id, ap.full_name, u.phone_normalized AS phone, am.status, am.version::text AS version, u.status AS account_status,
              (extract(epoch FROM am.created_at) * 1000)::bigint::text AS created_ms,
              (SELECT count(*) FROM app.admin_sessions s WHERE s.user_id = am.user_id AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp())::text AS live,
              (SELECT (extract(epoch FROM max(s.created_at)) * 1000)::bigint::text FROM app.admin_sessions s WHERE s.user_id = am.user_id) AS last_ms
         FROM app.admin_memberships am
         JOIN app.users u ON u.user_id = am.user_id
         JOIN app.admin_profiles ap ON ap.user_id = am.user_id
        WHERE am.admin_role = 'ADMIN'
        ORDER BY am.created_at DESC, am.user_id DESC
        LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => {
      const version = Number(row.version);
      const created = Number(row.created_ms);
      if (!Number.isSafeInteger(version) || !Number.isSafeInteger(created)) {
        throw new TechnicalError('internal', 'Database returned an unexpected administrator');
      }
      return {
        userId: row.user_id,
        fullName: row.full_name,
        phoneNormalized: row.phone,
        membershipStatus: row.status,
        membershipVersion: version,
        accountStatus: row.account_status,
        createdAtMs: created,
        liveSessions: Number(row.live),
        lastSessionMs: row.last_ms === null ? null : Number(row.last_ms),
      };
    });
  }

  /** Replaces the whole permission set of an ADMIN (the caller holds the membership FOR UPDATE and has compared the fingerprint). */
  async replacePermissions(context: TransactionContext, userId: string, rows: readonly AppPermissionInput[]): Promise<void> {
    await context.query('DELETE FROM app.admin_app_permissions WHERE user_id = $1::uuid', [userId]);
    for (const row of rows) {
      await context.query(
        `INSERT INTO app.admin_app_permissions (user_id, app, can_view, can_review_profile, can_lock, can_manage_catalog) VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [userId, row.app, row.canView, row.canReviewProfile, row.canLock, row.canManageCatalog],
      );
    }
  }
}
