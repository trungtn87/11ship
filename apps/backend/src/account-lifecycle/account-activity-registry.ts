import { Injectable } from '@nestjs/common';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * One owner of business data that hangs off an APP_USER account (Owner decision 2026-10-14). The account lifecycle (delete / lock) asks
 * every registered check; it never reads another module's tables itself beyond the two built-in ones below.
 *
 *  - `relatedData`: does the user own data that must never be lost (orders, deliveries, wallet history, transactions, reviews,
 *    disputes, a shop, a driver profile ...)? Any such data turns a deletion into a lock: the account row, its roles and its history
 *    stay exactly as they are.
 *  - `activeWork`: how many orders / deliveries of the user are still being processed? Any blocks a lock (and so a deletion that would
 *    become a lock); completed and cancelled ones never do.
 *
 * The module that introduces such data (orders, deliveries, wallet ... : M03 onwards) MUST register its check here when it is added;
 * without a registration the account lifecycle cannot know about it. Registration is by name, so a second registration of the same
 * name replaces the first (a module that is imported twice or re-created in a test does not double-count).
 */
export interface AccountActivityCheck {
  readonly name: string;
  relatedData?(context: TransactionContext, userId: string): Promise<boolean>;
  activeWork?(context: TransactionContext, userId: string): Promise<number>;
}

@Injectable()
export class AccountActivityRegistry {
  readonly #checks = new Map<string, AccountActivityCheck>();

  constructor(shops: ShopEligibilityReader, drivers: DriverEligibilityReader) {
    // Built in: the two business records that exist today, read through their owners' ports (the Shop and Driver modules own their tables).
    this.register({ name: 'SHOP', relatedData: (context, userId) => shops.hasAnyMembership(context, userId) });
    this.register({ name: 'DRIVER_PROFILE', relatedData: (context, userId) => drivers.hasProfile(context, userId) });
  }

  register(check: AccountActivityCheck): void {
    this.#checks.set(check.name, check);
  }

  unregister(name: string): void {
    this.#checks.delete(name);
  }

  /** Names of the checks that found related data, in registration order. Empty = the account has no related data. */
  async relatedData(context: TransactionContext, userId: string): Promise<string[]> {
    const found: string[] = [];
    for (const check of this.#checks.values()) {
      if (check.relatedData !== undefined && (await check.relatedData(context, userId))) {
        found.push(check.name);
      }
    }
    return found;
  }

  /** Names of the checks that report orders / deliveries still being processed. Empty = nothing blocks a lock. */
  async activeWork(context: TransactionContext, userId: string): Promise<string[]> {
    const found: string[] = [];
    for (const check of this.#checks.values()) {
      if (check.activeWork !== undefined && (await check.activeWork(context, userId)) > 0) {
        found.push(check.name);
      }
    }
    return found;
  }
}
