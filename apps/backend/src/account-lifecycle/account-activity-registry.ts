import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountRecordReader } from './account-record-reader';

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

/** The checks every decision depends on. Unregistering one of them makes every decision fail closed until it is registered again. */
export const REQUIRED_ACTIVITY_CHECKS: readonly string[] = [
  'SHOP',
  'DRIVER_PROFILE',
  'ORDERS',
  'DELIVERIES',
  'WALLET',
  'REVIEWS',
  'DISPUTES',
  'LINKED_RECORDS',
];

@Injectable()
export class AccountActivityRegistry {
  readonly #checks = new Map<string, AccountActivityCheck>();

  constructor(
    shops: ShopEligibilityReader,
    drivers: DriverEligibilityReader,
    private readonly records: AccountRecordReader,
  ) {
    // The Shop and Driver modules own their tables and answer through their own ports; the rest is read by the lifecycle's own reader.
    this.register({ name: 'SHOP', relatedData: (context, userId) => shops.hasAnyMembership(context, userId) });
    this.register({ name: 'DRIVER_PROFILE', relatedData: (context, userId) => drivers.hasProfile(context, userId) });
    this.register({
      name: 'ORDERS',
      relatedData: (context, userId) => records.ordersExist(context, userId),
      activeWork: (context, userId) => records.ordersActive(context, userId),
    });
    this.register({
      name: 'DELIVERIES',
      relatedData: (context, userId) => records.deliveriesExist(context, userId),
      activeWork: (context, userId) => records.deliveriesActive(context, userId),
    });
    this.register({
      name: 'WALLET',
      relatedData: (context, userId) => records.walletExists(context, userId),
      activeWork: (context, userId) => records.walletActive(context, userId),
    });
    this.register({ name: 'REVIEWS', relatedData: (context, userId) => records.reviewsExist(context, userId) });
    // An open complaint is history to keep, not work that stops a lock: the money it may lead to is counted by WALLET once it is pending.
    this.register({ name: 'DISPUTES', relatedData: (context, userId) => records.complaintsExist(context, userId) });
    this.register({ name: 'LINKED_RECORDS', relatedData: (context, userId) => records.linkedRecords(context, userId) });
  }

  register(check: AccountActivityCheck): void {
    this.#checks.set(check.name, check);
  }

  unregister(name: string): void {
    this.#checks.delete(name);
  }

  /**
   * Takes the locks that make the checks below mean something for a lock / delete: the account's shops and wallet, FOR UPDATE, so no
   * order or money can be added for them between the check and the status change. Call it after the target user row is locked.
   */
  async lockWorkSources(context: TransactionContext, userId: string): Promise<void> {
    await this.#answer(() => this.records.lockWorkSources(context, userId));
  }

  /** Names of the checks that found related data, in registration order. Empty = the account has no related data. */
  async relatedData(context: TransactionContext, userId: string): Promise<string[]> {
    this.#assertComplete();
    const found: string[] = [];
    for (const check of this.#checks.values()) {
      if (check.relatedData !== undefined) {
        const answer = check.relatedData.bind(check);
        if (await this.#answer(() => answer(context, userId))) {
          found.push(check.name);
        }
      }
    }
    return found;
  }

  /**
   * Names of the checks that report orders / deliveries / money still being processed. Empty = nothing blocks a lock. `except` leaves
   * named checks out for a caller that decides that part itself (the Shipper closure judges the wallet with its own settlement rules).
   */
  async activeWork(context: TransactionContext, userId: string, except: readonly string[] = []): Promise<string[]> {
    this.#assertComplete();
    const found: string[] = [];
    for (const check of this.#checks.values()) {
      if (check.activeWork !== undefined && !except.includes(check.name)) {
        const answer = check.activeWork.bind(check);
        if ((await this.#answer(() => answer(context, userId))) > 0) {
          found.push(check.name);
        }
      }
    }
    return found;
  }

  #assertComplete(): void {
    for (const name of REQUIRED_ACTIVITY_CHECKS) {
      if (!this.#checks.has(name)) {
        throw new AppError('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
      }
    }
  }

  /** A check that cannot answer is a refusal of the whole decision, never an empty answer. */
  async #answer<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
    }
  }
}
