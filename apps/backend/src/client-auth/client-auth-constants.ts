// Fixed vocabulary of the client authentication (M01.03). Nothing here is configuration: the names are part of the
// contract (docs/design/system-v2-20261011/10-m01-client-contract.md section 4, 11-m01-session-device-contract.md section 5).

/** The client apps (contract10 section 3). The app label grants nothing and proves nothing about the device. */
export const CLIENT_APPS = ['FOOD', 'SHIP'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

/** The client platforms of the new API. ANDROID has no proof verifier yet; WEB exists only in the explicit local mode. */
export const CLIENT_PLATFORMS = ['WEB', 'ANDROID'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export function isClientApp(value: unknown): value is ClientApp {
  return typeof value === 'string' && (CLIENT_APPS as readonly string[]).includes(value);
}

export function isClientPlatform(value: unknown): value is ClientPlatform {
  return typeof value === 'string' && (CLIENT_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Idempotency identity of the client registration. The scope type is NOT the legacy 'verification_proof' and the operation
 * is NOT 'auth.register.v1', so a record of one endpoint can never be found, replayed or fingerprint-compared by the other;
 * both still use the same proof id as scope id, so the proof stays the one-use resource they compete for.
 */
export const CLIENT_REGISTER_SCOPE_TYPE = 'client_verification_proof';
export const CLIENT_REGISTER_OPERATION_ID = 'client.auth.register.v1';

/** Audit action and outbox event of a completed client registration. */
export const CLIENT_REGISTER_AUDIT_ACTION = 'client.auth.register.v1';
export const CLIENT_USER_REGISTERED_EVENT_TYPE = 'client.auth.user_registered.v1';
export const CLIENT_USER_REGISTERED_EVENT_SCHEMA_VERSION = 1;

/** Public names of the selectable contexts, in the order of the role array (contract11 section 1). */
export const PUBLIC_CUSTOMER = 'CUSTOMER';
export const PUBLIC_SHOP_OWNER = 'SHOP_OWNER';
export const PUBLIC_DRIVER = 'DRIVER';

/**
 * Idempotency identity of the client login (M01.04). Its scope type is neither the register one nor any legacy one, so a
 * record of one endpoint can never be found, replayed or fingerprint-compared by another. The scope id is the user id, which
 * is only known after the credentials were verified (see ClientLoginService), so a wrong password never reaches a record.
 */
export const CLIENT_LOGIN_SCOPE_TYPE = 'client_login';
export const CLIENT_LOGIN_OPERATION_ID = 'client.auth.login.v1';

/** Idempotency identity of the context switch: scoped to the SESSION that asks (contract11 section 3). */
export const CLIENT_CONTEXT_SCOPE_TYPE = 'client_session';
export const CLIENT_CONTEXT_OPERATION_ID = 'client.auth.context.v1';

/** Audit actions of M01.04 (contract11 section 4 and contract10 logout). No outbox event: nothing consumes them. */
export const CLIENT_LOGIN_AUDIT_ACTION = 'client.auth.login.v1';
export const CLIENT_CONTEXT_AUDIT_ACTION = 'client.auth.context.v1';
export const CLIENT_LOGOUT_AUDIT_ACTION = 'client.auth.logout.v1';

