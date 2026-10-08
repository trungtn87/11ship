// Fixed vocabulary of Shop management (M02-A). Nothing here is configuration: the names are part of the locked
// contract (docs/tasks/M02-A-shop-management.md sections 4, 6 and 7) and are deliberately not readable from the
// environment.

/** Idempotency identity (ADR-003 section 3.1): scope is the authenticated user, never a client value. */
export const SHOP_MANAGEMENT_SCOPE_TYPE = 'user';
export const SHOP_PROFILE_UPDATE_OPERATION_ID = 'shop.profile.update.v1';
export const SHOP_BUSINESS_HOURS_REPLACE_OPERATION_ID = 'shop.business_hours.replace.v1';

/** Audit action names (dotted, versioned): one SUCCESS row per committed mutation, never one per replay. */
export const SHOP_MANAGEMENT_AUDIT_ACTIONS = Object.freeze({
  profileUpdate: 'shop.profile.update.v1',
  businessHoursReplace: 'shop.business_hours.replace.v1',
});

/** Resource kind of the audit rows and outbox events of a shop. */
export const SHOP_MANAGEMENT_RESOURCE_TYPE = 'shop';

/**
 * Outbox events of a committed mutation. The payload of both is exactly {"shop_id","version"}: no name, phone,
 * address, GPS or schedule content. Nothing is emitted when a shop opens or closes: availability is computed.
 */
export const SHOP_PROFILE_UPDATED_EVENT_TYPE = 'shop.profile_updated.v1';
export const SHOP_BUSINESS_HOURS_UPDATED_EVENT_TYPE = 'shop.business_hours_updated.v1';
export const SHOP_MANAGEMENT_EVENT_SCHEMA_VERSION = 1;
