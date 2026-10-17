// Fixed vocabulary of M05 (customer record and delivery address book). Nothing here is configuration: the names are part of the
// contract (docs/current/11Ship-M05-design-approved-v1.0.md sections 2, 5 and 6).

/**
 * Idempotency identity of the address writes. The scope is the USER (not the session): any valid session of the same user may
 * replay, and the replay hook re-checks the session that asks. The scope type belongs to no other endpoint.
 */
export const CUSTOMER_ADDRESS_SCOPE_TYPE = 'customer_address_book';
export const CUSTOMER_ADDRESS_CREATE_OPERATION_ID = 'customer.address.create.v1';
export const CUSTOMER_ADDRESS_UPDATE_OPERATION_ID = 'customer.address.update.v1';
export const CUSTOMER_ADDRESS_DELETE_OPERATION_ID = 'customer.address.delete.v1';
export const CUSTOMER_ADDRESS_DEFAULT_OPERATION_ID = 'customer.address.set_default.v1';

/** Audit of a committed change: ids and versions only, never a name, a phone or an address text. No outbox event (no consumer yet). */
export const CUSTOMER_CREATE_AUDIT_ACTION = 'customer.create.v1';
export const CUSTOMER_RESOURCE_TYPE = 'customer';
export const CUSTOMER_ADDRESS_RESOURCE_TYPE = 'customer_address';

export const ADDRESS_LABELS = ['HOME', 'OFFICE', 'OTHER'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export const ADDRESS_RECIPIENT_NAME_MAX_LENGTH = 120;
export const ADDRESS_DESCRIPTION_MAX_LENGTH = 300;
export const ADDRESS_NOTE_MAX_LENGTH = 300;

/** The schema bound of customer_addresses.version (Number.MAX_SAFE_INTEGER): an address at this version cannot be raised. */
export const ADDRESS_MAX_VERSION = Number.MAX_SAFE_INTEGER;
