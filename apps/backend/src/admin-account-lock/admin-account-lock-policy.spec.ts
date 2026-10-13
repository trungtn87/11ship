import { describe, expect, it } from '@jest/globals';
import { PermissionRow } from '../admin-accounts/admin-account-read-repository';
import { ACCOUNT_ORIGIN_POLICY } from '../auth/account-origin';
import { allowedLockActions, lockEligibility } from './admin-account-lock-policy';

const row = (app: PermissionRow['app'], canView: boolean, canLock: boolean): PermissionRow => ({ app, canView, canReviewProfile: false, canLock });
const admin = (...permissions: PermissionRow[]) => ({ role: 'ADMIN' as const, permissions });

describe('lockEligibility (D15)', () => {
  it('SYSTEM may lock any ordinary account, also one without a role', () => {
    expect(lockEligibility({ role: 'SYSTEM', permissions: [] }, [])).toBe('OK');
    expect(lockEligibility({ role: 'SYSTEM', permissions: [] }, ['CUSTOMER', 'DRIVER', 'WHATEVER'])).toBe('OK');
  });

  it('an ADMIN needs view AND lock on EVERY domain of the target', () => {
    const both = admin(row('CUSTOMER', true, true), row('DRIVER', true, true));
    expect(lockEligibility(both, ['CUSTOMER', 'DRIVER'])).toBe('OK');
    expect(lockEligibility(both, ['CUSTOMER'])).toBe('OK');
    // One scope short: the account is visible, so it is FORBIDDEN, never "not available".
    expect(lockEligibility(admin(row('CUSTOMER', true, true), row('DRIVER', true, false)), ['CUSTOMER', 'DRIVER'])).toBe('FORBIDDEN');
    expect(lockEligibility(admin(row('CUSTOMER', true, true)), ['CUSTOMER', 'DRIVER'])).toBe('FORBIDDEN');
    expect(lockEligibility(admin(row('CUSTOMER', true, true), row('DRIVER', false, true)), ['CUSTOMER', 'DRIVER'])).toBe('FORBIDDEN');
  });

  it('lock without view, or no overlap with the target, is not even readable: NOT_AVAILABLE', () => {
    expect(lockEligibility(admin(row('SHOP', true, true)), ['CUSTOMER'])).toBe('NOT_AVAILABLE');
    expect(lockEligibility(admin(row('CUSTOMER', false, true)), ['CUSTOMER'])).toBe('NOT_AVAILABLE');
    expect(lockEligibility(admin(row('CUSTOMER', true, true)), [])).toBe('NOT_AVAILABLE');
  });

  it('a role outside the three domains is never covered by an ADMIN', () => {
    expect(lockEligibility(admin(row('CUSTOMER', true, true)), ['CUSTOMER', 'PLATFORM'])).toBe('FORBIDDEN');
  });
});

describe('allowedLockActions', () => {
  it('offers LOCK for ACTIVE and UNLOCK for DISABLED, and nothing without the right or the gate', () => {
    expect(allowedLockActions({ eligible: true, gateOpen: true, status: 'ACTIVE' })).toEqual(['LOCK']);
    expect(allowedLockActions({ eligible: true, gateOpen: true, status: 'DISABLED' })).toEqual(['UNLOCK']);
    expect(allowedLockActions({ eligible: false, gateOpen: true, status: 'ACTIVE' })).toEqual([]);
    expect(allowedLockActions({ eligible: true, gateOpen: false, status: 'DISABLED' })).toEqual([]);
  });
});

describe('module wiring symbol', () => {
  it('the account origin policy token is a symbol (exported by Auth for the lock)', () => {
    expect(typeof ACCOUNT_ORIGIN_POLICY).toBe('symbol');
  });
});
