import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';

export type InvitationApp = 'CUSTOMER' | 'SHOP' | 'DRIVER';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'SUPERSEDED' | 'EXPIRED' | 'PHONE_CONFLICT';
export type TerminalInvitationStatus = Exclude<InvitationStatus, 'PENDING'>;

export interface InvitationPermission {
  readonly app: InvitationApp;
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  /** Dish-group management (SHOP only, needs VIEW). Absent = false, so older callers and snapshots are unchanged. */
  readonly canManageCatalog?: boolean;
}

export interface NewInvitationRow {
  readonly invitationId: string;
  readonly generationId: string;
  readonly phoneNormalized: string;
  readonly fullName: string;
  readonly note: string | null;
  /** SHA-256 hex digest of the opaque token. The token itself is never seen here. */
  readonly tokenDigest: string;
  readonly createdBy: string;
  /** Validity in seconds, added to the database clock of the insert (expires_at is never an application time). */
  readonly ttlSeconds: number;
}

export interface InvitationRow {
  readonly invitationId: string;
  readonly generationId: string;
  readonly phoneNormalized: string;
  readonly status: InvitationStatus;
  readonly version: number;
  readonly snapshotSealed: boolean;
  /** Epoch milliseconds from the database; compare with a database clock read AFTER the last lock, never with now(). */
  readonly expiresAtMs: number;
}

interface RawInvitation {
  invitation_id: string;
  generation_id: string;
  phone_normalized: string;
  status: InvitationStatus;
  version: string;
  snapshot_sealed: boolean;
  expires_at_ms: string;
}

const COLUMNS = `invitation_id, generation_id, phone_normalized, status, version, snapshot_sealed,
       ${epochMs('expires_at')} AS expires_at_ms`;

function toInvitation(row: RawInvitation): InvitationRow {
  return {
    invitationId: row.invitation_id,
    generationId: row.generation_id,
    phoneNormalized: row.phone_normalized,
    status: row.status,
    version: toSafeInteger(row.version),
    snapshotSealed: row.snapshot_sealed,
    expiresAtMs: toSafeInteger(row.expires_at_ms),
  };
}

/**
 * SQL for app.admin_invitations and app.admin_invitation_permissions (M01-D-ADMIN-1A). Every method receives the
 * caller's TransactionContext; none opens, commits or rolls back a transaction. Lock order stays the coordinator's
 * (phone advisory lock -> actor rows -> invitation -> permissions): nothing here takes a lock "backwards", and the
 * permission insert trigger locks the invitation row before it looks at the snapshot.
 */
@Injectable()
export class AdminInvitationRepository {
  /** Inserts the PENDING, unsealed, version 1 invitation. created_at / expires_at come from one database clock read. */
  async insert(context: TransactionContext, row: NewInvitationRow): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_invitations
         (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by,
          created_at, expires_at, snapshot_sealed)
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, 'PENDING', 1, $7::uuid,
              clock.t, clock.t + ($8::integer * interval '1 second'), false
         FROM (${CLOCK_CTE}) AS clock`,
      [
        row.invitationId,
        row.generationId,
        row.phoneNormalized,
        row.fullName,
        row.note,
        row.tokenDigest,
        row.createdBy,
        row.ttlSeconds,
      ],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Invitation was not written');
    }
  }

  async insertPermission(context: TransactionContext, invitationId: string, permission: InvitationPermission): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock, can_manage_catalog)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [invitationId, permission.app, permission.canView, permission.canReviewProfile, permission.canLock, permission.canManageCatalog === true],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Invitation permission was not written');
    }
  }

  /** The single allowed false -> true change of snapshot_sealed (PENDING only, version unchanged). */
  async seal(context: TransactionContext, invitationId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_invitations
          SET snapshot_sealed = true
        WHERE invitation_id = $1::uuid AND status = 'PENDING' AND snapshot_sealed = false`,
      [invitationId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Invitation snapshot was not sealed');
    }
  }

  async lock(context: TransactionContext, invitationId: string): Promise<InvitationRow | undefined> {
    const result = await context.query<RawInvitation>(
      `SELECT ${COLUMNS} FROM app.admin_invitations WHERE invitation_id = $1::uuid FOR UPDATE`,
      [invitationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toInvitation(row);
  }

  /** The PENDING invitation of a phone (at most one, by the partial unique index), expired or not, locked FOR UPDATE. */
  async lockPendingByPhone(context: TransactionContext, phoneNormalized: string): Promise<InvitationRow | undefined> {
    const result = await context.query<RawInvitation>(
      `SELECT ${COLUMNS} FROM app.admin_invitations WHERE phone_normalized = $1 AND status = 'PENDING' FOR UPDATE`,
      [phoneNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toInvitation(row);
  }

  /**
   * PENDING -> terminal. Compare-and-set on (status = PENDING, version): returns the new version, or undefined when
   * the row is no longer that PENDING version (the caller decides what that means). terminal_at is the database clock.
   * The database trigger additionally refuses an unsealed snapshot, a non-terminal target and any version but +1.
   */
  async transition(
    context: TransactionContext,
    invitationId: string,
    expectedVersion: number,
    to: TerminalInvitationStatus,
    acceptedUserId: string | null,
    successorId: string | null,
  ): Promise<number | undefined> {
    const result = await context.query<{ version: string }>(
      `UPDATE app.admin_invitations AS invitation
          SET status = $3, version = invitation.version + 1, terminal_at = clock.t,
              accepted_user_id = $4::uuid, successor_id = $5::uuid
         FROM (${CLOCK_CTE}) AS clock
        WHERE invitation.invitation_id = $1::uuid AND invitation.status = 'PENDING' AND invitation.version = $2::bigint
        RETURNING invitation.version`,
      [invitationId, expectedVersion, to, acceptedUserId, successorId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSafeInteger(row.version);
  }
}
