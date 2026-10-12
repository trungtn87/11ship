import { describe, expect, it } from '@jest/globals';
import { contextAllowedForApp, defaultContextFor, isPublicContext, publicContextOf, storageRoleOf } from './client-context';

describe('client contexts', () => {
  it('maps SHOP_OWNER to the SHOP storage role and back, and never stores SHOP_OWNER', () => {
    expect(storageRoleOf('SHOP_OWNER')).toBe('SHOP');
    expect(storageRoleOf('CUSTOMER')).toBe('CUSTOMER');
    expect(storageRoleOf('DRIVER')).toBe('DRIVER');
    expect(publicContextOf('SHOP')).toBe('SHOP_OWNER');
    expect(publicContextOf('CUSTOMER')).toBe('CUSTOMER');
    expect(publicContextOf('DRIVER')).toBe('DRIVER');
    expect(publicContextOf('SHOP_OWNER')).toBeUndefined();
    expect(publicContextOf('ADMIN')).toBeUndefined();
  });

  it('accepts exactly the three public contexts', () => {
    for (const value of ['CUSTOMER', 'SHOP_OWNER', 'DRIVER']) {
      expect(isPublicContext(value)).toBe(true);
    }
    for (const value of ['SHOP', 'ADMIN', 'customer', '', null, undefined, 7, {}]) {
      expect(isPublicContext(value)).toBe(false);
    }
  });

  it('FOOD never wears DRIVER and SHIP never wears SHOP_OWNER; CUSTOMER belongs to both', () => {
    expect(contextAllowedForApp('FOOD', 'CUSTOMER')).toBe(true);
    expect(contextAllowedForApp('FOOD', 'SHOP_OWNER')).toBe(true);
    expect(contextAllowedForApp('FOOD', 'DRIVER')).toBe(false);
    expect(contextAllowedForApp('SHIP', 'CUSTOMER')).toBe(true);
    expect(contextAllowedForApp('SHIP', 'DRIVER')).toBe(true);
    expect(contextAllowedForApp('SHIP', 'SHOP_OWNER')).toBe(false);
  });

  it('login default: FOOD picks CUSTOMER only; SHIP prefers DRIVER, then CUSTOMER; otherwise none', () => {
    const all = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'];
    expect(defaultContextFor('FOOD', all)).toBe('CUSTOMER');
    expect(defaultContextFor('FOOD', ['SHOP_OWNER', 'DRIVER'])).toBeNull();
    expect(defaultContextFor('SHIP', all)).toBe('DRIVER');
    expect(defaultContextFor('SHIP', ['CUSTOMER', 'SHOP_OWNER'])).toBe('CUSTOMER');
    expect(defaultContextFor('SHIP', ['SHOP_OWNER'])).toBeNull();
    expect(defaultContextFor('FOOD', [])).toBeNull();
    expect(defaultContextFor('SHIP', [])).toBeNull();
  });
});
