import { InvitationPermission } from '../admin-invitations/admin-invitation-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { InvitationDetail } from './admin-invitation-reader';
import { OperationRow } from './admin-operation-repository';
import { OPERATION_ATTEMPT_LIMIT } from './admin-provisioning-constants';

// Response shapes of M01-D-ADMIN-1B (contract section 6). The full phone number, the token digest and the token never
// appear here; only the creation/reissue response (and its replay) carries the activation link, built separately.

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** UI-06 mask: the first two and the last three digits of the local form, e.g. +84912345101 -> "09•• ••• 101". */
export function maskPhone(phoneNormalized: string): string {
  const match = /^\+84([0-9]{9})$/.exec(phoneNormalized);
  if (match === null) {
    return '•• ••• •••';
  }
  const local = `0${match[1] as string}`;
  return `${local.slice(0, 2)}•• ••• ${local.slice(-3)}`;
}

/** `<origin>/activate#t=<token>`: the token sits in the fragment, so it is never sent to a server by the browser. */
export function activationLink(origin: string, token: string): string {
  return `${origin}/activate#t=${token}`;
}

export function permissionsView(permissions: readonly InvitationPermission[]): JsonObject[] {
  return permissions.map((permission) => ({
    app: permission.app,
    can_view: permission.canView,
    can_review_profile: permission.canReviewProfile,
    can_lock: permission.canLock,
    can_manage_catalog: permission.canManageCatalog === true,
    can_manage_shops: permission.canManageShops === true,
  }));
}

/** Short audit form of a snapshot: ["CUSTOMER:V--", "SHOP:VRL"] (+"C" when the catalog right is granted). Not a secret, not personal data. */
export function permissionsAudit(permissions: readonly InvitationPermission[]): string[] {
  return permissions.map(
    (permission) =>
      `${permission.app}:${permission.canView ? 'V' : '-'}${permission.canReviewProfile ? 'R' : '-'}${permission.canLock ? 'L' : '-'}${permission.canManageCatalog === true ? 'C' : ''}${permission.canManageShops === true ? 'S' : ''}`,
  );
}

/** Contract 6.6: the invitation in the create / reissue response. */
export function createdInvitationView(detail: InvitationDetail, permissions: readonly InvitationPermission[]): JsonObject {
  return {
    invitation_id: detail.invitationId,
    status: detail.status,
    version: detail.version,
    full_name: detail.fullName,
    phone_masked: maskPhone(detail.phoneNormalized),
    note: detail.note,
    permissions: permissionsView(permissions),
    created_at: iso(detail.createdAtMs),
    expires_at: iso(detail.expiresAtMs),
  };
}

/** Contract 6.7: one invitation, with its terminal data and the read-only `expired` flag (database clock). */
export function invitationView(
  detail: InvitationDetail,
  permissions: readonly InvitationPermission[],
  nowMs: number,
): JsonObject {
  return {
    ...createdInvitationView(detail, permissions),
    terminal_at: detail.terminalAtMs === null ? null : iso(detail.terminalAtMs),
    successor_id: detail.successorId,
    expired: detail.status === 'PENDING' && nowMs >= detail.expiresAtMs,
  };
}

/** Contract 6.9: a list item, without the permission detail. */
export function invitationListItemView(detail: InvitationDetail & { expired: boolean }): JsonObject {
  return {
    invitation_id: detail.invitationId,
    status: detail.status,
    version: detail.version,
    full_name: detail.fullName,
    phone_masked: maskPhone(detail.phoneNormalized),
    note: detail.note,
    created_at: iso(detail.createdAtMs),
    expires_at: iso(detail.expiresAtMs),
    terminal_at: detail.terminalAtMs === null ? null : iso(detail.terminalAtMs),
    successor_id: detail.successorId,
    expired: detail.expired,
  };
}

/**
 * Contract 6.5 (F5). `status` is the STORED status; `expired`, `verifiable` and `usable` are computed with the database
 * clock read after the last lock and the CURRENT bindings. A VERIFIED operation that has expired or whose binding no
 * longer holds is reported usable=false while its status stays VERIFIED: a GET never writes.
 */
export function operationView(operation: OperationRow, nowMs: number, bindingOk: boolean): JsonObject {
  const expired = nowMs >= operation.expiresAtMs;
  return {
    operation_id: operation.operationId,
    action: operation.action,
    status: operation.status,
    expires_at: iso(operation.expiresAtMs),
    expired,
    verifiable:
      operation.status === 'PENDING' && !expired && bindingOk && operation.attemptCount < OPERATION_ATTEMPT_LIMIT,
    usable: operation.status === 'VERIFIED' && !expired && bindingOk,
    attempts_remaining: operation.status === 'PENDING' ? OPERATION_ATTEMPT_LIMIT - operation.attemptCount : null,
    verified_at: operation.verifiedAtMs === null ? null : iso(operation.verifiedAtMs),
    consumed_at: operation.consumedAtMs === null ? null : iso(operation.consumedAtMs),
    invalidated_reason: operation.invalidatedReason,
  };
}
