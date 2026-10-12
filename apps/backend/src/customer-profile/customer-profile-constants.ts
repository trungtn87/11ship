// Fixed vocabulary of the own-profile read model (M01.05). Nothing here is configuration: the names are part of the contract
// (docs/evidence/M01-05.md, contract10 section 3 for the name rules, contract11 sections 1-2 for the capabilities).

/**
 * Idempotency identity of PUT /v1/customer/me/profile. The scope is the USER (not the session): any valid session of the same
 * user may replay, and the replay hook re-checks the session that asks. The scope type belongs to no other endpoint, so a
 * record of another operation can never be found, replayed or fingerprint-compared here.
 */
export const CUSTOMER_PROFILE_SCOPE_TYPE = 'customer_profile';
export const CUSTOMER_PROFILE_UPDATE_OPERATION_ID = 'customer.profile.update.v1';

/** Audit of a committed profile change: ids and versions only, never the name or a token. No outbox event (no consumer). */
export const CUSTOMER_PROFILE_UPDATE_AUDIT_ACTION = 'customer.profile.update.v1';
export const CUSTOMER_PROFILE_RESOURCE_TYPE = 'customer_profile';

/** The schema bound of customer_profiles.version (Number.MAX_SAFE_INTEGER): a profile at this version cannot be raised. */
export const CUSTOMER_PROFILE_MAX_VERSION = Number.MAX_SAFE_INTEGER;
