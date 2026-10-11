import { Injectable } from '@nestjs/common';
import { CLOCK_CTE, epochMs, toSafeInteger } from '../auth/auth-db';
import {
  InvitationApp,
  InvitationPermission,
  InvitationStatus,
} from '../admin-invitations/admin-invitation-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { ListCursor } from './admin-provisioning-validation';

/** Everything the SYSTEM administrator may see of an invitation. Never the token digest, never a link. */
export interface InvitationDetail {
  readonly invitationId: string;
  readonly generationId: string;
  readonly phoneNormalized: string;
  readonly fullName: string;
  readonly note: string | null;
  readonly status: InvitationStatus;
  readonly version: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly terminalAtMs: number | null;
  readonly successorId: string | null;
}

export interface InvitationListItem extends InvitationDetail {
  /** status = PENDING and the statement's database clock >= expires_at. Computed, never written. */
  readonly expired: boolean;
}

interface RawDetail {
  invitation_id: string;
  generation_id: string;
  phone_normalized: string;
  full_name: string;
  note: string | null;
  status: InvitationStatus;
  version: string;
  created_ms: string;
  expires_ms: string;
  terminal_ms: string | null;
  successor_id: string | null;
}

const COLUMNS = `invitation_id, generation_id, phone_normalized, full_name, note, status, version,
       ${epochMs('created_at')} AS created_ms, ${epochMs('expires_at')} AS expires_ms,
       CASE WHEN terminal_at IS NULL THEN NULL ELSE ${epochMs('terminal_at')} END AS terminal_ms, successor_id`;

function toDetail(row: RawDetail): InvitationDetail {
  return {
    invitationId: row.invitation_id,
    generationId: row.generation_id,
    phoneNormalized: row.phone_normalized,
    fullName: row.full_name,
    note: row.note,
    status: row.status,
    version: toSafeInteger(row.version),
    createdAtMs: toSafeInteger(row.created_ms),
    expiresAtMs: toSafeInteger(row.expires_ms),
    terminalAtMs: row.terminal_ms === null ? null : toSafeInteger(row.terminal_ms),
    successorId: row.successor_id,
  };
}

/**
 * Read side of the invitations for M01-D-ADMIN-1B. Writes stay in the 1A participant (unchanged). A row read UNDER A
 * LOCK carries no "expired" flag: the caller compares expiresAtMs with a database clock read after its last lock.
 */
@Injectable()
export class AdminInvitationReader {
  /** Plain read without a lock: the IMMUTABLE phone of a target, to derive the phone advisory lock before any lock. */
  async peekPhone(context: TransactionContext, invitationId: string): Promise<string | undefined> {
    const result = await context.query<{ phone_normalized: string }>(
      'SELECT phone_normalized FROM app.admin_invitations WHERE invitation_id = $1::uuid',
      [invitationId],
    );
    return result.rows[0]?.phone_normalized;
  }

  /** L8 in shared mode (create-operation, verify, GET, replay hook): waits for a writer, lets readers through. */
  async lockShared(context: TransactionContext, invitationId: string): Promise<InvitationDetail | undefined> {
    const result = await context.query<RawDetail>(
      `SELECT ${COLUMNS} FROM app.admin_invitations WHERE invitation_id = $1::uuid FOR SHARE`,
      [invitationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDetail(row);
  }

  /** Plain read of a row the caller already holds (or has just written) in this transaction. */
  async read(context: TransactionContext, invitationId: string): Promise<InvitationDetail | undefined> {
    const result = await context.query<RawDetail>(`SELECT ${COLUMNS} FROM app.admin_invitations WHERE invitation_id = $1::uuid`, [
      invitationId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toDetail(row);
  }

  /** Plain read of a PENDING invitation of a phone (no lock): only the early check of create-operation. */
  async findPending(context: TransactionContext, phoneNormalized: string): Promise<InvitationDetail | undefined> {
    const result = await context.query<RawDetail>(
      `SELECT ${COLUMNS} FROM app.admin_invitations WHERE phone_normalized = $1 AND status = 'PENDING'`,
      [phoneNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDetail(row);
  }

  /** The sealed, immutable permission snapshot, sorted by app. */
  async permissions(context: TransactionContext, invitationId: string): Promise<InvitationPermission[]> {
    const result = await context.query<{
      app: InvitationApp;
      can_view: boolean;
      can_review_profile: boolean;
      can_lock: boolean;
    }>(
      `SELECT app, can_view, can_review_profile, can_lock FROM app.admin_invitation_permissions
        WHERE invitation_id = $1::uuid ORDER BY app`,
      [invitationId],
    );
    return result.rows.map((row) => ({
      app: row.app,
      canView: row.can_view,
      canReviewProfile: row.can_review_profile,
      canLock: row.can_lock,
    }));
  }

  /**
   * One page, newest first (admin_invitations_list_idx), in ONE statement: one snapshot and one database clock for
   * the `expired` flags. No invitation row is locked. Returns limit + 1 rows at most so the caller knows if more exist.
   */
  async list(
    context: TransactionContext,
    query: { status: InvitationStatus | null; limit: number; cursor: ListCursor | null },
  ): Promise<InvitationListItem[]> {
    const result = await context.query<RawDetail & { expired: boolean }>(
      `SELECT ${COLUMNS}, (i.status = 'PENDING' AND i.expires_at <= clock.t) AS expired
         FROM app.admin_invitations i CROSS JOIN (${CLOCK_CTE}) AS clock
        WHERE ($1::text IS NULL OR i.status = $1::text)
          AND ($2::bigint IS NULL
               OR (i.created_at, i.invitation_id) < (timestamptz 'epoch' + $2::bigint * interval '1 millisecond', $3::uuid))
        ORDER BY i.created_at DESC, i.invitation_id DESC
        LIMIT $4::int`,
      [
        query.status,
        query.cursor === null ? null : query.cursor.createdAtMs,
        query.cursor === null ? null : query.cursor.invitationId,
        query.limit + 1,
      ],
    );
    return result.rows.map((row) => ({ ...toDetail(row), expired: row.expired }));
  }
}
