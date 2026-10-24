import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import {
  AdminInvitationRepository,
  InvitationApp,
  InvitationPermission,
  InvitationRow,
  NewInvitationRow,
  TerminalInvitationStatus,
} from './admin-invitation-repository';

export const INVITATION_APPS: readonly InvitationApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];
/** Contract v1: the invitation lifetime is configurable between 1 and 168 hours, snapshotted at creation. */
export const MIN_INVITATION_TTL_SECONDS = 3600;
export const MAX_INVITATION_TTL_SECONDS = 168 * 3600;

export interface CreateInvitationInput extends NewInvitationRow {
  readonly permissions: readonly InvitationPermission[];
}

export type InvitationTransition =
  | { readonly to: 'ACCEPTED'; readonly acceptedUserId: string }
  | { readonly to: 'SUPERSEDED'; readonly successorId: string }
  | { readonly to: Exclude<TerminalInvitationStatus, 'ACCEPTED' | 'SUPERSEDED'> };

const TERMINAL_STATUSES: readonly string[] = ['ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED', 'PHONE_CONFLICT'];

function invalid(reason: string): never {
  // A programming error of the coordinator (the public input is validated before it gets here), never client input.
  throw new TechnicalError('internal', `Invalid invitation write: ${reason}`);
}

/** The shape the database CHECKs also enforce; checked first so a bad call fails before any statement is sent. */
function assertPermissions(permissions: readonly InvitationPermission[]): void {
  const seen = new Set<InvitationApp>();
  for (const permission of permissions) {
    if (!INVITATION_APPS.includes(permission.app)) {
      invalid('unknown app');
    }
    if (seen.has(permission.app)) {
      invalid('duplicate app');
    }
    seen.add(permission.app);
    if ((permission.canReviewProfile || permission.canLock) && !permission.canView) {
      invalid('REVIEW and LOCK require VIEW');
    }
    if (permission.app === 'CUSTOMER' && permission.canReviewProfile) {
      invalid('CUSTOMER has no REVIEW');
    }
    if (permission.canManageCatalog === true && (!permission.canView || permission.app !== 'SHOP')) {
      invalid('CATALOG needs SHOP and VIEW');
    }
    if (permission.canManageShops === true && (!permission.canView || permission.app !== 'SHOP')) {
      invalid('SHOP MANAGEMENT needs SHOP and VIEW');
    }
  }
  if (!permissions.some((permission) => permission.canView)) {
    invalid('at least one VIEW permission is required');
  }
}

/**
 * The narrow M01-D-ADMIN-1A participant: writes an invitation together with its permission snapshot, and moves a
 * PENDING invitation to a terminal state. It is a PARTICIPANT: it receives the coordinator's TransactionContext and
 * nothing else, so it cannot open, commit or roll back a transaction, and a half-written invitation can only roll back
 * with the coordinator's transaction. It authorizes nobody: the coordinator has already checked the SYSTEM principal and
 * passes created_by from it (never from the request), holds the phone advisory lock and its other locks, and owns
 * idempotency, audit and the limiter (step 1B).
 *
 * Reissue order (coordinator): lock the phone, lockPendingByPhone, transition(old -> SUPERSEDED, successorId = the new
 * invitation id) FIRST, then create(new). successor_id is a deferred foreign key, so the old row may name a successor
 * that is inserted later in the same transaction; a successor PENDING is never inserted before the old row is terminal.
 */
@Injectable()
export class AdminInvitationParticipant {
  constructor(private readonly invitations: AdminInvitationRepository) {}

  /** Inserts the invitation, its whole permission snapshot, then seals it. All or nothing with the caller's transaction. */
  async create(context: TransactionContext, input: CreateInvitationInput): Promise<void> {
    assertPermissions(input.permissions);
    if (
      !Number.isSafeInteger(input.ttlSeconds) ||
      input.ttlSeconds < MIN_INVITATION_TTL_SECONDS ||
      input.ttlSeconds > MAX_INVITATION_TTL_SECONDS
    ) {
      invalid('ttl outside 1..168 hours');
    }
    const { permissions, ...row } = input;
    await this.invitations.insert(context, row);
    for (const permission of permissions) {
      await this.invitations.insertPermission(context, row.invitationId, permission);
    }
    await this.invitations.seal(context, row.invitationId);
  }

  /** Locks and reads an invitation (FOR UPDATE) so the coordinator knows its current version. */
  lock(context: TransactionContext, invitationId: string): Promise<InvitationRow | undefined> {
    return this.invitations.lock(context, invitationId);
  }

  lockPendingByPhone(context: TransactionContext, phoneNormalized: string): Promise<InvitationRow | undefined> {
    return this.invitations.lockPendingByPhone(context, phoneNormalized);
  }

  /**
   * PENDING -> terminal, once. Returns the new version, or undefined when the invitation is no longer that PENDING
   * version. Whether it has expired is decided by the coordinator with a fresh database clock after its locks.
   */
  async transition(
    context: TransactionContext,
    invitationId: string,
    expectedVersion: number,
    change: InvitationTransition,
  ): Promise<number | undefined> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      invalid('version');
    }
    if (!TERMINAL_STATUSES.includes(change.to)) {
      invalid('a transition always ends in a terminal status');
    }
    const acceptedUserId = change.to === 'ACCEPTED' ? change.acceptedUserId : null;
    const successorId = change.to === 'SUPERSEDED' ? change.successorId : null;
    if (change.to === 'ACCEPTED' && acceptedUserId === '') {
      invalid('ACCEPTED needs the accepted user');
    }
    if (change.to === 'SUPERSEDED' && (successorId === '' || successorId === invitationId)) {
      invalid('SUPERSEDED needs a different successor');
    }
    return this.invitations.transition(context, invitationId, expectedVersion, change.to, acceptedUserId, successorId);
  }
}
