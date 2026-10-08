import { describe, expect, it } from '@jest/globals';
import { OwnerShopEligibility } from '../shop/shop-types';
import { codeOf } from '../shared/source-scan.fixture';
import { availableRoles, roleContext } from './available-roles';

// The single rule behind `available_roles`, `onboarding_required` and `role_selection_required` (A2S review
// addendum). Login, /me and role selection all report through it, so the matrix is proven once, here.

const NOT_STARTED: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const INCOMPLETE: OwnerShopEligibility = { onboarding: 'INCOMPLETE', selectable: false };
const ACTIVE: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: true };
const DISABLED: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: false };

describe('availableRoles', () => {
  it('lists SHOP only with a selectable (ACTIVE) shop and never touches DRIVER', () => {
    expect(availableRoles(['DRIVER', 'SHOP'], ACTIVE)).toEqual(['DRIVER', 'SHOP']);
    for (const shop of [NOT_STARTED, INCOMPLETE, DISABLED]) {
      expect(availableRoles(['DRIVER', 'SHOP'], shop)).toEqual(['DRIVER']);
      expect(availableRoles(['SHOP'], shop)).toEqual([]);
    }
    expect(availableRoles([], ACTIVE)).toEqual([]);
  });
});

describe('roleContext', () => {
  it('NOT_STARTED without a usable role: onboarding is required (a stray SHOP role changes nothing)', () => {
    for (const held of [[], ['SHOP']]) {
      expect(roleContext(held, NOT_STARTED, null)).toEqual({
        available_roles: [],
        onboarding_required: true,
        role_selection_required: false,
      });
    }
  });

  it('INCOMPLETE without a usable role: onboarding is still required', () => {
    for (const held of [[], ['SHOP']]) {
      expect(roleContext(held, INCOMPLETE, null)).toEqual({
        available_roles: [],
        onboarding_required: true,
        role_selection_required: false,
      });
    }
  });

  it('ACTIVE: SHOP is available and onboarding is not required', () => {
    expect(roleContext(['SHOP'], ACTIVE, null)).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: true,
    });
    expect(roleContext(['SHOP'], ACTIVE, 'SHOP')).toEqual({
      available_roles: ['SHOP'],
      onboarding_required: false,
      role_selection_required: false,
    });
  });

  it('DISABLED: completed but not selectable is neither "onboard again" nor "select a role"', () => {
    expect(roleContext(['SHOP'], DISABLED, null)).toEqual({
      available_roles: [],
      onboarding_required: false,
      role_selection_required: false,
    });
    // Even without the role row: a finished onboarding is never asked for again.
    expect(roleContext([], DISABLED, null).onboarding_required).toBe(false);
  });

  it('DRIVER + DISABLED shop: DRIVER alone is offered and must be selected', () => {
    expect(roleContext(['DRIVER', 'SHOP'], DISABLED, null)).toEqual({
      available_roles: ['DRIVER'],
      onboarding_required: false,
      role_selection_required: true,
    });
    expect(roleContext(['DRIVER', 'SHOP'], DISABLED, 'DRIVER').role_selection_required).toBe(false);
  });

  it('DRIVER is unchanged: holding it is enough, whatever the shop state', () => {
    for (const shop of [NOT_STARTED, INCOMPLETE, ACTIVE, DISABLED]) {
      const context = roleContext(['DRIVER'], shop, null);
      expect([shop, context.available_roles, context.onboarding_required, context.role_selection_required]).toEqual([
        shop,
        ['DRIVER'],
        false,
        true,
      ]);
    }
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
