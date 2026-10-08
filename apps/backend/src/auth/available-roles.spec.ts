import { describe, expect, it } from '@jest/globals';
import { OwnerDriverEligibility } from '../driver/driver-types';
import { OwnerShopEligibility } from '../shop/shop-types';
import { codeOf } from '../shared/source-scan.fixture';
import { availableRoles, effectiveActiveRole, roleContext } from './available-roles';

// The single rule behind `available_roles`, `onboarding_required` and `role_selection_required` (A2S review
// addendum, extended by A2D). Login, /me and role selection all report through it, so the matrix is proven
// once, here.

const NOT_STARTED: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const INCOMPLETE: OwnerShopEligibility = { onboarding: 'INCOMPLETE', selectable: false };
const ACTIVE: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: true };
const DISABLED: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: false };

// Driver eligibility as M03's read port reports it.
const NO_DRIVER: OwnerDriverEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const PENDING: OwnerDriverEligibility = { onboarding: 'PENDING_APPROVAL', selectable: true };
const DRIVER_ACTIVE: OwnerDriverEligibility = { onboarding: 'ACTIVE', selectable: true };
const SUSPENDED: OwnerDriverEligibility = { onboarding: 'SUSPENDED', selectable: true };
const CLOSING: OwnerDriverEligibility = { onboarding: 'CLOSING', selectable: true };
const CLOSED: OwnerDriverEligibility = { onboarding: 'CLOSED', selectable: false };

describe('availableRoles', () => {
  it('lists SHOP only with a selectable (ACTIVE) shop, whatever the Driver profile is', () => {
    expect(availableRoles(['DRIVER', 'SHOP'], ACTIVE, PENDING)).toEqual(['DRIVER', 'SHOP']);
    for (const shop of [NOT_STARTED, INCOMPLETE, DISABLED]) {
      expect(availableRoles(['DRIVER', 'SHOP'], shop, PENDING)).toEqual(['DRIVER']);
      expect(availableRoles(['SHOP'], shop, PENDING)).toEqual([]);
    }
    expect(availableRoles([], ACTIVE, NO_DRIVER)).toEqual([]);
  });

  it('lists DRIVER only with a Driver profile that is not CLOSED, whatever the shop is', () => {
    for (const driver of [PENDING, DRIVER_ACTIVE, SUSPENDED, CLOSING]) {
      expect([driver.onboarding, availableRoles(['DRIVER'], NOT_STARTED, driver)]).toEqual([driver.onboarding, ['DRIVER']]);
      expect([driver.onboarding, availableRoles(['DRIVER', 'SHOP'], ACTIVE, driver)]).toEqual([
        driver.onboarding,
        ['DRIVER', 'SHOP'],
      ]);
    }
    for (const driver of [NO_DRIVER, CLOSED]) {
      expect([driver.onboarding, availableRoles(['DRIVER'], ACTIVE, driver)]).toEqual([driver.onboarding, []]);
      expect([driver.onboarding, availableRoles(['DRIVER', 'SHOP'], ACTIVE, driver)]).toEqual([driver.onboarding, ['SHOP']]);
    }
  });

  it('a Driver profile without the DRIVER role row offers nothing: the held roles decide what can be listed', () => {
    expect(availableRoles([], NOT_STARTED, PENDING)).toEqual([]);
    expect(availableRoles(['SHOP'], ACTIVE, PENDING)).toEqual(['SHOP']);
  });
});

describe('effectiveActiveRole', () => {
  it('keeps the stored role only while it is one of the available roles, otherwise null', () => {
    expect(effectiveActiveRole(['DRIVER', 'SHOP'], 'DRIVER')).toBe('DRIVER');
    expect(effectiveActiveRole(['DRIVER', 'SHOP'], 'SHOP')).toBe('SHOP');
    expect(effectiveActiveRole(['SHOP'], 'DRIVER')).toBeNull();
    expect(effectiveActiveRole([], 'SHOP')).toBeNull();
    expect(effectiveActiveRole(['SHOP'], null)).toBeNull();
    expect(effectiveActiveRole([], null)).toBeNull();
  });

  it('never invents a role: an unknown or differently-cased stored value is not effective', () => {
    expect(effectiveActiveRole(['SHOP'], 'shop')).toBeNull();
    expect(effectiveActiveRole(['SHOP'], 'ADMIN')).toBeNull();
    expect(effectiveActiveRole(['SHOP'], '')).toBeNull();
  });
});

describe('roleContext', () => {
  it('NOT_STARTED without a usable role: onboarding is required (a stray SHOP role changes nothing)', () => {
    for (const held of [[], ['SHOP']]) {
      expect(roleContext(held, NOT_STARTED, NO_DRIVER, null)).toEqual({
        available_roles: [],
        onboarding_required: true,
        role_selection_required: false,
      });
    }
  });

  it('INCOMPLETE without a usable role: onboarding is still required', () => {
    for (const held of [[], ['SHOP']]) {
      expect(roleContext(held, INCOMPLETE, NO_DRIVER, null)).toEqual({
        available_roles: [],
        onboarding_required: true,
        role_selection_required: false,
      });
    }
  });

  it('ACTIVE: SHOP is available and onboarding is not required', () => {
    expect(roleContext(['SHOP'], ACTIVE, NO_DRIVER, null)).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: true,
    });
    expect(roleContext(['SHOP'], ACTIVE, NO_DRIVER, 'SHOP')).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: false,
    });
  });

  it('DISABLED: completed but not selectable is neither "onboard again" nor "select a role"', () => {
    expect(roleContext(['SHOP'], DISABLED, NO_DRIVER, null)).toEqual({
      available_roles: [],
      onboarding_required: false,
      role_selection_required: false,
    });
    // Even without the role row: a finished onboarding is never asked for again.
    expect(roleContext([], DISABLED, NO_DRIVER, null).onboarding_required).toBe(false);
  });

  it('DRIVER + DISABLED shop: DRIVER alone is offered and must be selected', () => {
    expect(roleContext(['DRIVER', 'SHOP'], DISABLED, PENDING, null)).toEqual({
      available_roles: ['DRIVER'],
      onboarding_required: false,
      role_selection_required: true,
    });
    expect(roleContext(['DRIVER', 'SHOP'], DISABLED, PENDING, 'DRIVER').role_selection_required).toBe(false);
  });

  it('a selectable Driver profile makes DRIVER available whatever the shop state, and onboarding is not required', () => {
    for (const shop of [NOT_STARTED, INCOMPLETE, ACTIVE, DISABLED]) {
      for (const driver of [PENDING, DRIVER_ACTIVE, SUSPENDED, CLOSING]) {
        const context = roleContext(['DRIVER'], shop, driver, null);
        expect([shop, driver, context.available_roles, context.onboarding_required, context.role_selection_required]).toEqual([
          shop,
          driver,
          ['DRIVER'],
          false,
          true,
        ]);
      }
    }
  });

  it('a stray DRIVER role without a Driver profile is not offered and onboarding is still required (A03-C06)', () => {
    expect(roleContext(['DRIVER'], NOT_STARTED, NO_DRIVER, null)).toEqual({
      available_roles: [],
      onboarding_required: true,
      role_selection_required: false,
    });
    expect(roleContext(['DRIVER'], INCOMPLETE, NO_DRIVER, null)).toEqual({
      available_roles: [],
      onboarding_required: true,
      role_selection_required: false,
    });
    // A stray DRIVER role beside an ACTIVE shop: the shop alone is offered.
    expect(roleContext(['DRIVER', 'SHOP'], ACTIVE, NO_DRIVER, null).available_roles).toEqual(['SHOP']);
  });

  it('a CLOSED Driver profile is not offered, and the user is NOT sent back to onboarding (it would be a dead end)', () => {
    for (const shop of [NOT_STARTED, INCOMPLETE]) {
      for (const held of [['DRIVER'], []]) {
        expect([shop, held, roleContext(held, shop, CLOSED, null)]).toEqual([
          shop,
          held,
          { available_roles: [], onboarding_required: false, role_selection_required: false },
        ]);
      }
    }
    // The other roles still work around it.
    expect(roleContext(['DRIVER', 'SHOP'], ACTIVE, CLOSED, null)).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: true,
    });
    expect(roleContext(['DRIVER', 'SHOP'], ACTIVE, CLOSED, 'SHOP').role_selection_required).toBe(false);
  });

  it('with no Driver profile the rule is exactly the A2S one, state by state', () => {
    const expected: ReadonlyArray<readonly [OwnerShopEligibility, boolean]> = [
      [NOT_STARTED, true],
      [INCOMPLETE, true],
      [ACTIVE, false],
      [DISABLED, false],
    ];
    for (const [shop, required] of expected) {
      expect([shop.onboarding, roleContext([], shop, NO_DRIVER, null).onboarding_required]).toEqual([shop.onboarding, required]);
    }
  });

  it('a stored role that is no longer available does not count as selected: selection is required again, or not at all', () => {
    // DRIVER stored, Driver now CLOSED, SHOP still usable: something to select, nothing selected.
    expect(roleContext(['DRIVER', 'SHOP'], ACTIVE, CLOSED, 'DRIVER')).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: true,
    });
    // SHOP stored, Shop now DISABLED, DRIVER usable.
    expect(roleContext(['DRIVER', 'SHOP'], DISABLED, PENDING, 'SHOP')).toEqual({
      available_roles: ['DRIVER'],
      onboarding_required: false,
      role_selection_required: true,
    });
    // Nothing usable at all: no selection and no onboarding loop, whatever is stored.
    expect(roleContext(['SHOP'], DISABLED, NO_DRIVER, 'SHOP')).toEqual({
      available_roles: [],
      onboarding_required: false,
      role_selection_required: false,
    });
    expect(roleContext(['DRIVER'], NOT_STARTED, CLOSED, 'DRIVER')).toEqual({
      available_roles: [],
      onboarding_required: false,
      role_selection_required: false,
    });
  });

  it('login and /me both report through roleContext and compute neither flag themselves', () => {
    for (const file of ['auth/login-service.ts', 'auth/role-context-service.ts']) {
      const code = codeOf(file);
      expect([file, code.includes('roleContext(')]).toEqual([file, true]);
      expect([file, /onboarding_required: [^,\n]*length|role_selection_required: [^,\n]*length/.test(code)]).toEqual([
        file,
        false,
      ]);
    }
  });
});
