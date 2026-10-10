// Fixed values of M01-D-ADMIN-1B (ADMIN invitations by the SYSTEM administrator). Constants on purpose: the contract
// (docs/tasks/M01-D-ADMIN-1B-technical-contract.md, v2.1) fixes them and the Owner approved them; no environment
// variable can loosen them. The invitation lifetime and the activation origin are the only settings (AdminAuthConfig).

/** A step-up operation lives 120 seconds from its creation and is never extended (Owner decision Q4). */
export const OPERATION_TTL_SECONDS = 120;
/** Wrong TOTP codes one operation can take; the fifth invalidates it in the same UPDATE. */
export const OPERATION_ATTEMPT_LIMIT = 5;

/** Idempotency of create / reissue / revoke: replay 15 minutes (the link), dedupe 24 hours (Owner decision). */
export const INVITATION_REPLAY_SECONDS = 900;
export const INVITATION_DEDUPE_SECONDS = 86_400;
export const PROVISIONING_SCOPE_TYPE = 'admin_user';
export const PROVISIONING_OPERATION_IDS = Object.freeze({
  create: 'admin.invitation.create.v1',
  reissue: 'admin.invitation.reissue.v1',
  revoke: 'admin.invitation.revoke.v1',
});

export const OPERATION_ACTIONS = ['CREATE_INVITATION', 'REISSUE_INVITATION', 'REVOKE_INVITATION'] as const;
export type OperationAction = (typeof OPERATION_ACTIONS)[number];

/** L3 of the lock order: one advisory lock per normalized phone (contract section 8.1). */
export const PHONE_LOCK_DOMAIN = '11ship.admin-provisioning.phone.v1';
export const PHONE_LOCK_LIMITER_KIND = 'PROVISIONING_PHONE';

export const FULL_NAME_MAX_CODE_POINTS = 120;
export const NOTE_MAX_LENGTH = 1000;
export const REASON_MAX_LENGTH = 500;
export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;

export const ACTOR_TYPE_SYSTEM = 'SYSTEM';
export const RESOURCE_INVITATION = 'admin_invitation';
export const RESOURCE_OPERATION = 'admin_sensitive_operation';

export const PROVISIONING_AUDIT_ACTIONS = Object.freeze({
  operationCreated: 'admin_invitation.operation_created.v1',
  operationVerified: 'admin_invitation.operation_verified.v1',
  operationVerifyDenied: 'admin_invitation.operation_verify_denied.v1',
  created: 'admin_invitation.created.v1',
  reissued: 'admin_invitation.reissued.v1',
  revoked: 'admin_invitation.revoked.v1',
  expired: 'admin_invitation.expired.v1',
});
