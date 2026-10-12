import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { ClientApp, PUBLIC_CUSTOMER, PUBLIC_DRIVER, PUBLIC_SHOP_OWNER } from './client-auth-constants';

// The public CONTEXT vocabulary of the client API and its mapping to the roles the database stores (contract11 sections 1
// and 3). Pure functions: no I/O, no configuration. A context is a name for "which hat the session wears"; it grants nothing,
// and whether it is selectable is always decided from the live role/profile state under the user lock.

/** The three public contexts, in the fixed order of the role array. */
export const PUBLIC_CONTEXTS = [PUBLIC_CUSTOMER, PUBLIC_SHOP_OWNER, PUBLIC_DRIVER] as const;
export type PublicContext = (typeof PUBLIC_CONTEXTS)[number];

export function isPublicContext(value: unknown): value is PublicContext {
  return typeof value === 'string' && (PUBLIC_CONTEXTS as readonly string[]).includes(value);
}

/** Storage role -> public context. SHOP_OWNER exists only in the client API; the database stores SHOP. */
export function publicContextOf(storageRole: string): PublicContext | undefined {
  switch (storageRole) {
    case CUSTOMER_ROLE:
      return PUBLIC_CUSTOMER;
    case 'SHOP':
      return PUBLIC_SHOP_OWNER;
    case 'DRIVER':
      return PUBLIC_DRIVER;
    default:
      return undefined;
  }
}

/** Public context -> the role stored on the session row and in user_roles. */
export function storageRoleOf(context: PublicContext): string {
  switch (context) {
    case PUBLIC_CUSTOMER:
      return CUSTOMER_ROLE;
    case PUBLIC_SHOP_OWNER:
      return 'SHOP';
    case PUBLIC_DRIVER:
      return 'DRIVER';
  }
}

/**
 * The contexts an app may ever wear: FOOD never DRIVER, SHIP never SHOP_OWNER; CUSTOMER belongs to both (contract11
 * section 3). The app label is a routing hint, not a right: this only NARROWS what the live state would allow.
 */
export function contextAllowedForApp(app: ClientApp, context: PublicContext): boolean {
  if (app === 'FOOD') {
    return context !== PUBLIC_DRIVER;
  }
  return context !== PUBLIC_SHOP_OWNER;
}

/**
 * The context a LOGIN selects (contract11 section 3). FOOD: CUSTOMER when selectable, otherwise none. SHIP: DRIVER when
 * selectable, else CUSTOMER when selectable, else none. Login never grants or backfills anything, so an account without
 * a selectable context simply gets null and role_selection_required/onboarding_required explain what is missing.
 */
export function defaultContextFor(app: ClientApp, selectable: readonly string[]): PublicContext | null {
  const preference: readonly PublicContext[] = app === 'FOOD' ? [PUBLIC_CUSTOMER] : [PUBLIC_DRIVER, PUBLIC_CUSTOMER];
  return preference.find((context) => selectable.includes(context)) ?? null;
}
