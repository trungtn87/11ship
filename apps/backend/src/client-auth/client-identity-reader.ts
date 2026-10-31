import { Injectable } from '@nestjs/common';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { PhoneVerificationStatus, phoneVerificationStatusOf } from '../auth/account-origin';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { UserRepository } from '../auth/user-repository';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { DriverOnboardingState } from '../driver/driver-types';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { ShopOnboardingState } from '../shop/shop-types';
import { TransactionContext } from '../transaction/transaction-context';
import { ClientApp, PUBLIC_CUSTOMER, PUBLIC_DRIVER, PUBLIC_SHOP_OWNER } from './client-auth-constants';
import { publicContextOf } from './client-context';

/** The identity block of every client-auth success response (contract11 section 2). */
export interface ClientIdentity {
  readonly user_id: string;
  readonly phone_normalized: string;
  /** SELECTABLE contexts, in the fixed order CUSTOMER, SHOP_OWNER, DRIVER. */
  readonly available_roles: string[];
  /** The EFFECTIVE active context: the stored one while it is still selectable, otherwise null. */
  readonly active_role: string | null;
  readonly profile: { readonly full_name: string | null; readonly version: number | null };
  /**
   * Whether the phone number was proven by an OTP: VERIFIED, UNVERIFIED (made while SYSTEM had the registration OTP off) or UNVERIFIED_TEST.
   * Read from the stored origin; nothing ever turns UNVERIFIED into VERIFIED except a registration that carried a real proof.
   */
  readonly phone_verification_status: PhoneVerificationStatus;
  readonly capabilities: {
    readonly customer_access: boolean;
    readonly shop_profile_read: boolean;
    readonly shop_manage: boolean;
    readonly driver_profile_read: boolean;
  };
  readonly onboarding: { readonly shop: ShopOnboardingState; readonly driver: DriverOnboardingState };
  readonly onboarding_required: boolean;
  readonly role_selection_required: boolean;
  /**
   * Present ONLY for a LOCKED driver served through the limited access (Owner decision 2026-10-14): the account is locked and may use
   * the wallet and nothing else. Absent for every other identity, so the shape every other client already parses is unchanged.
   */
  readonly account_status?: 'LOCKED';
  readonly limited_access?: 'WALLET_ONLY';
}

export interface ClientIdentityInput {
  readonly userId: string;
  readonly phoneNormalized: string;
  /** The client app of the request: it only decides the routing hint onboarding_required, never a right. */
  readonly app: ClientApp;
  /**
   * True when the CALLER, holding the user row lock, has established that the account is an ordinary enabled one (ACTIVE,
   * PHONE_VERIFIED, no administration membership, an origin the process policy allows). Every capability needs it.
   */
  readonly enabled: boolean;
  /** The role stored on the CURRENT session row (the caller holds the session lock), or null for a roleless session. */
  readonly storedActiveRole: string | null;
  /** The caller established that the account is LOCKED and served through the limited wallet-only access: no capability, no context. */
  readonly limited?: boolean;
}

/**
 * Builds the CURRENT identity of one user from the roles, the customer profile and the Shop and Driver eligibility ports
 * (contract11 sections 1-2). It is a pure read: it issues no write, takes no lock and opens no transaction; it runs on the
 * caller's TransactionContext, which must already hold the user root lock (and, for the session role, the session lock) so
 * that roles, profile and statuses are one coherent state. The register response and every replay of it go through here,
 * which is why a replay never serves a snapshot of rights taken at registration (R15). Login, me and context (M01.04) share it.
 */
@Injectable()
export class ClientIdentityReader {
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerProfileRepository,
    private readonly shops: ShopEligibilityReader,
    private readonly drivers: DriverEligibilityReader,
  ) {}

  /**
   * The SELECTABLE contexts of a user, in the fixed order, from the same rule as read(). Login uses it to pick the context
   * BEFORE the session row is written (the session stores the chosen role from its first instant), and the context switch
   * uses it to decide a request. Same locking contract as read(): the caller holds the user root lock.
   */
  async selectableContexts(context: TransactionContext, userId: string): Promise<string[]> {
    const held = new Set(await this.users.rolesAmong(context, userId, [CUSTOMER_ROLE, 'SHOP', 'DRIVER']));
    const shop = await this.shops.ownerShopEligibility(context, userId);
    const driver = await this.drivers.ownerDriverEligibility(context, userId);
    return selectableOf(held, shop.selectable, driver.selectable);
  }

  async read(context: TransactionContext, input: ClientIdentityInput): Promise<ClientIdentity> {
    if (input.limited === true) {
      // A locked driver: the identity says so and offers no context and no capability. The app shows the locked state with the wallet.
      const profile = await this.customers.findProfile(context, input.userId);
      return {
        user_id: input.userId,
        phone_normalized: input.phoneNormalized,
        available_roles: [],
        active_role: null,
        profile: { full_name: profile?.fullName ?? null, version: profile?.version ?? null },
        phone_verification_status: await this.#verificationOf(context, input.userId),
        capabilities: { customer_access: false, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
        onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
        onboarding_required: false,
        role_selection_required: false,
        account_status: 'LOCKED',
        limited_access: 'WALLET_ONLY',
      };
    }
    const held = new Set(await this.users.rolesAmong(context, input.userId, [CUSTOMER_ROLE, 'SHOP', 'DRIVER']));
    const profile = await this.customers.findProfile(context, input.userId);
    const shop = await this.shops.ownerShopEligibility(context, input.userId);
    const driver = await this.drivers.ownerDriverEligibility(context, input.userId);

    // available_roles lists what is SELECTABLE, not what is held: SHOP_OWNER needs an ACTIVE owned shop, DRIVER a profile
    // that is not CLOSED; a stray membership without its profile is not offered.
    const available = selectableOf(held, shop.selectable, driver.selectable);

    const storedPublic = input.storedActiveRole === null ? undefined : publicContextOf(input.storedActiveRole);
    const activeRole = storedPublic !== undefined && available.includes(storedPublic) ? storedPublic : null;

    const onboardingRequired =
      input.app === 'FOOD' ? !(held.has(CUSTOMER_ROLE) && profile !== undefined) : driver.onboarding === 'NOT_STARTED';

    return {
      user_id: input.userId,
      phone_normalized: input.phoneNormalized,
      available_roles: available,
      active_role: activeRole,
      profile: { full_name: profile?.fullName ?? null, version: profile?.version ?? null },
      phone_verification_status: await this.#verificationOf(context, input.userId),
      capabilities: {
        customer_access: input.enabled && held.has(CUSTOMER_ROLE),
        shop_profile_read: input.enabled && shop.onboarding !== 'NOT_STARTED',
        shop_manage: input.enabled && held.has('SHOP') && shop.selectable,
        driver_profile_read: input.enabled && driver.onboarding !== 'NOT_STARTED',
      },
      onboarding: { shop: shop.onboarding, driver: driver.onboarding },
      onboarding_required: onboardingRequired,
      role_selection_required: available.length > 0 && activeRole === null,
    };
  }

  /** The caller holds the user row lock; a missing row cannot be called verified. */
  async #verificationOf(context: TransactionContext, userId: string): Promise<PhoneVerificationStatus> {
    const user = await this.users.findById(context, userId);
    return user === undefined ? 'UNVERIFIED' : phoneVerificationStatusOf(user.accountOrigin);
  }
}

/** The one rule of "selectable": a held role, plus an ACTIVE owned shop for SHOP_OWNER and a not-CLOSED profile for DRIVER. */
function selectableOf(held: ReadonlySet<string>, shopSelectable: boolean, driverSelectable: boolean): string[] {
  const available: string[] = [];
  if (held.has(CUSTOMER_ROLE)) {
    available.push(PUBLIC_CUSTOMER);
  }
  if (held.has('SHOP') && shopSelectable) {
    available.push(PUBLIC_SHOP_OWNER);
  }
  if (held.has('DRIVER') && driverSelectable) {
    available.push(PUBLIC_DRIVER);
  }
  return available;
}
