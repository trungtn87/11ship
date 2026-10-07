// Shape rules for the short identifiers that audit and outbox rows carry. Each pattern is the exact
// twin of a CHECK constraint in the C1B migration (1791417600000_create-audit-outbox.sql): the
// application refuses a value before the INSERT, the database refuses it again as a backstop. Keep the
// two in step.
//
// Nothing here is a classifier of "safe" content. It only bounds the vocabulary of identifier columns so
// that a free-form string (a URL, an error message, a request field) cannot end up in them.

export const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Server-derived actor kind, an UPPER_SNAKE token such as ANONYMOUS, USER, ADMIN, SYSTEM. */
export const ACTOR_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
export const ACTOR_TYPE_MAX_LENGTH = 32;

/** Short stable code (audit reason code, outbox error code). Never a raw message. */
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
export const CODE_MAX_LENGTH = 64;

/** Stable dotted name with 2..8 lower-case segments: auth.register.v1, order.created. Never a path. */
export const DOTTED_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,7}$/;
export const DOTTED_NAME_MAX_LENGTH = 128;

/** Resource kind such as user, order, verification_proof. */
export const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const RESOURCE_TYPE_MAX_LENGTH = 64;

/** Opaque identifier of an actor or a resource (UUID, numeric id, composite key with : . _ -). */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const SAFE_ID_MAX_LENGTH = 128;

/** event_schema_version is a smallint column. */
export const MAX_EVENT_SCHEMA_VERSION = 32_767;

export function matches(value: unknown, pattern: RegExp, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && pattern.test(value);
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && value !== NIL_UUID && CANONICAL_UUID_PATTERN.test(value);
}

/** A resource version is a positive safe integer (bigint column, JavaScript number input). */
export function isResourceVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
