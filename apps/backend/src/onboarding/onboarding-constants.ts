// Fixed vocabulary of Shop onboarding (M01-A2S). Nothing here is configuration: the names are part of the locked
// contract (docs/tasks/M01-A2-onboarding.md sections 11 and 13 and the A2S handoff) and are deliberately not
// readable from the environment.

/** Idempotency identity (ADR-003 section 3.1): scope is the authenticated user, never a client value. */
export const ONBOARDING_SCOPE_TYPE = 'user';
export const SHOP_PROFILE_SAVE_OPERATION_ID = 'onboarding.shop.profile.save.v1';
export const SHOP_COMPLETE_OPERATION_ID = 'onboarding.shop.complete.v1';

/** Audit action names (dotted, versioned). */
export const ONBOARDING_AUDIT_ACTIONS = Object.freeze({
  shopProfileSave: 'onboarding.shop.profile.save.v1',
  shopComplete: 'onboarding.shop.complete.v1',
});

/** Resource kind of the audit rows and outbox events of a shop. */
export const SHOP_RESOURCE_TYPE = 'shop';

/**
 * Outbox event of a completed Shop onboarding. Its payload is exactly {"shop_id","user_id"}: no contact phone,
 * no address, no GPS and nothing the client sent.
 */
export const SHOP_ONBOARDED_EVENT_TYPE = 'shop.onboarded.v1';
export const SHOP_ONBOARDED_EVENT_SCHEMA_VERSION = 1;

/** Column widths of app.shops. Text is counted in characters (code points), as varchar(n) counts them. */
export const SHOP_NAME_MAX_LENGTH = 120;
export const SHOP_ZALO_MAX_LENGTH = 160;
export const SHOP_FACEBOOK_MAX_LENGTH = 300;
export const SHOP_ADDRESS_MAX_LENGTH = 500;
