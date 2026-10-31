import { describe, expect, it } from '@jest/globals';
import { TransactionContext } from '../transaction/transaction-context';
import { ClientIdentityReader } from './client-identity-reader';

const CONTEXT = {} as TransactionContext;

function reader(options: {
  roles: string[];
  profile?: { fullName: string; version: number };
  shop?: { onboarding: string; selectable: boolean };
  driver?: { onboarding: string; selectable: boolean };
  origin?: string;
}) {
  const users = { rolesAmong: async () => options.roles, findById: async () => ({ accountOrigin: options.origin ?? 'PHONE_VERIFIED' }) };
  const customers = { findProfile: async () => options.profile };
  const shops = { ownerShopEligibility: async () => options.shop ?? { onboarding: 'NOT_STARTED', selectable: false } };
  const drivers = { ownerDriverEligibility: async () => options.driver ?? { onboarding: 'NOT_STARTED', selectable: false } };
  return new ClientIdentityReader(users as never, customers as never, shops as never, drivers as never);
}

const base = { userId: 'u-1', phoneNormalized: '+84912345678', app: 'FOOD', enabled: true, storedActiveRole: 'CUSTOMER' } as const;

describe('ClientIdentityReader', () => {
  it('builds the CUSTOMER identity of a new account', async () => {
    const identity = await reader({ roles: ['CUSTOMER'], profile: { fullName: 'An', version: 1 } }).read(CONTEXT, base);
    expect(identity).toMatchObject({
      available_roles: ['CUSTOMER'],
      active_role: 'CUSTOMER',
      profile: { full_name: 'An', version: 1 },
      capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
      onboarding_required: false,
      role_selection_required: false,
    });
  });

  it('reports the phone verification state from the stored origin: VERIFIED only when a proof backed the account', async () => {
    const status = async (origin: string): Promise<unknown> => (await reader({ roles: ['CUSTOMER'], origin }).read(CONTEXT, base)).phone_verification_status;
    expect(await status('PHONE_VERIFIED')).toBe('VERIFIED');
    expect(await status('PHONE_UNVERIFIED')).toBe('UNVERIFIED');
    expect(await status('TEST_UNVERIFIED')).toBe('UNVERIFIED_TEST');
  });

  it('SHIP asks for driver onboarding while NOT_STARTED', async () => {
    const identity = await reader({ roles: ['CUSTOMER'], profile: { fullName: 'An', version: 1 } }).read(CONTEXT, { ...base, app: 'SHIP' });
    expect(identity.onboarding_required).toBe(true);
  });

  it('orders the selectable roles CUSTOMER, SHOP_OWNER, DRIVER and hides unselectable ones', async () => {
    const identity = await reader({
      roles: ['DRIVER', 'SHOP', 'CUSTOMER'],
      profile: { fullName: 'An', version: 3 },
      shop: { onboarding: 'COMPLETED', selectable: true },
      driver: { onboarding: 'COMPLETED', selectable: false },
    }).read(CONTEXT, base);
    expect(identity.available_roles).toEqual(['CUSTOMER', 'SHOP_OWNER']);
    expect(identity.capabilities.shop_manage).toBe(true);
    expect(identity.capabilities.driver_profile_read).toBe(true);
  });

  it('drops the stored active role when it is no longer selectable and asks for a selection', async () => {
    const identity = await reader({ roles: ['SHOP', 'CUSTOMER'], shop: { onboarding: 'COMPLETED', selectable: true } }).read(CONTEXT, {
      ...base,
      storedActiveRole: 'DRIVER',
    });
    expect(identity.active_role).toBeNull();
    expect(identity.role_selection_required).toBe(true);
  });

  it('grants no capability for a disabled account', async () => {
    const identity = await reader({ roles: ['CUSTOMER'], profile: { fullName: 'An', version: 1 } }).read(CONTEXT, { ...base, enabled: false });
    expect(Object.values(identity.capabilities)).toEqual([false, false, false, false]);
  });

  it('selectableContexts is the same rule as available_roles', async () => {
    const options = {
      roles: ['DRIVER', 'SHOP', 'CUSTOMER'],
      profile: { fullName: 'An', version: 1 },
      shop: { onboarding: 'INCOMPLETE', selectable: false },
      driver: { onboarding: 'PENDING_APPROVAL', selectable: true },
    };
    const subject = reader(options);
    const identity = await subject.read(CONTEXT, base);
    expect(await subject.selectableContexts(CONTEXT, 'u-1')).toEqual(identity.available_roles);
    expect(identity.available_roles).toEqual(['CUSTOMER', 'DRIVER']);
  });
});

