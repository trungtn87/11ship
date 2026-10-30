import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountActivityRegistry, REQUIRED_ACTIVITY_CHECKS } from './account-activity-registry';
import { AccountRecordReader } from './account-record-reader';

const context = {} as TransactionContext;
const USER = '11111111-1111-4111-8111-111111111111';

function build(records: Partial<Record<keyof AccountRecordReader, () => Promise<unknown>>> = {}): AccountActivityRegistry {
  const none = (): Promise<boolean> => Promise.resolve(false);
  const zero = (): Promise<number> => Promise.resolve(0);
  const reader = {
    ordersExist: none, ordersActive: zero, deliveriesExist: none, deliveriesActive: zero, walletExists: none, walletActive: zero,
    reviewsExist: none, complaintsExist: none, linkedRecords: none, lockWorkSources: () => Promise.resolve(),
    ...records,
  } as unknown as AccountRecordReader;
  const shops = { hasAnyMembership: none } as unknown as ShopEligibilityReader;
  const drivers = { hasProfile: none } as unknown as DriverEligibilityReader;
  return new AccountActivityRegistry(shops, drivers, reader);
}

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR';
  }
};

describe('AccountActivityRegistry (M01-LOCK-01)', () => {
  it('registers a real check for every module whose data hangs off an account', () => {
    expect(REQUIRED_ACTIVITY_CHECKS).toEqual(['SHOP', 'DRIVER_PROFILE', 'ORDERS', 'DELIVERIES', 'WALLET', 'REVIEWS', 'DISPUTES', 'LINKED_RECORDS']);
  });

  it('keeps related data and active work apart and names the checks that found something', async () => {
    const registry = build({ ordersExist: () => Promise.resolve(true), ordersActive: () => Promise.resolve(2), walletExists: () => Promise.resolve(true), complaintsExist: () => Promise.resolve(true) });
    expect(await registry.relatedData(context, USER)).toEqual(['ORDERS', 'WALLET', 'DISPUTES']);
    expect(await registry.activeWork(context, USER)).toEqual(['ORDERS']);
  });

  it('a caller that judges the wallet itself can leave it out of the active work', async () => {
    const registry = build({ walletActive: () => Promise.resolve(1) });
    expect(await registry.activeWork(context, USER)).toEqual(['WALLET']);
    expect(await registry.activeWork(context, USER, ['WALLET'])).toEqual([]);
  });

  it('a failing check is a refusal (USER_ACCOUNT_ACTIVITY_UNVERIFIED), never "no data"', async () => {
    const registry = build({ deliveriesExist: () => Promise.reject(new Error('relation does not exist')), deliveriesActive: () => Promise.reject(new Error('timeout')) });
    expect(await codeOf(registry.relatedData(context, USER))).toBe('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
    expect(await codeOf(registry.activeWork(context, USER))).toBe('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
    expect(await codeOf(build({ lockWorkSources: () => Promise.reject(new Error('deadlock')) }).lockWorkSources(context, USER))).toBe('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
  });

  it('a missing required adapter is a refusal too: an unregistered module is not an empty one', async () => {
    for (const name of REQUIRED_ACTIVITY_CHECKS) {
      const registry = build();
      registry.unregister(name);
      expect(await codeOf(registry.relatedData(context, USER))).toBe('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
      expect(await codeOf(registry.activeWork(context, USER))).toBe('USER_ACCOUNT_ACTIVITY_UNVERIFIED');
    }
  });

  it('registration is by name: a second registration replaces the first', async () => {
    const registry = build();
    registry.register({ name: 'ORDERS', activeWork: () => Promise.resolve(1) });
    registry.register({ name: 'ORDERS', activeWork: () => Promise.resolve(0) });
    expect(await registry.activeWork(context, USER)).toEqual([]);
  });
});
