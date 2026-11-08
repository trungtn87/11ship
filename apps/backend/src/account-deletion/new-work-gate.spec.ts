import { describe, expect, it } from '@jest/globals';
import { codeOf } from '../shared/source-scan.fixture';

// P5-6a (OD-26): while an owner's account deletion is pending, every entry point that STARTS or TAKES new work must refuse (ACCOUNT_DELETE_PENDING),
// and the ordinary lock methods must NOT (the running work is finished normally). The gate is opt-in per entry point, so this list is the contract:
// a route that creates new work and is added later has to be added here too (and to the integration suite tests/integration/account-deletion.int.spec.ts).

const read = codeOf;

const ENTRY_POINTS: ReadonlyArray<readonly [file: string, calls: number, what: string]> = [
  ['orders/order-customer-service.ts', 2, 'place an order; reorder'],
  ['delivery/delivery-customer-service.ts', 1, 'customer creates a delivery'],
  ['delivery/delivery-shop-service.ts', 1, 'shop recalls a delivery (the direct create is closed, OD-5)'],
  ['delivery/delivery-shipper-service.ts', 3, 'Shipper takes a delivery; fee actions on an untaken delivery; offers are empty'],
  ['wallet-topup/topup-request-service.ts', 1, 'new top-up request'],
  ['driver-wallet/driver-withdrawal-service.ts', 0, 'withdrawal is NOT gated (OD-31: the owner who asked for deletion keeps it to get the balance back)'],
  ['onboarding/driver-onboarding-service.ts', 1, 'new Shipper profile'],
  ['onboarding/shop-onboarding-service.ts', 1, 'new shop'],
  ['business-dashboard/finance-service.ts', 1, 'new shop payment request'],
];

describe('entry points of NEW work refuse while the account deletion is pending', () => {
  it.each(ENTRY_POINTS)('%s calls the gate %i time(s): %s', (file, calls) => {
    const source = read(file);
    expect(source.split('assertNewWorkAllowed(').length - 1).toBe(calls);
  });

  it('the session locks themselves do not refuse a pending account (its running work, reads and logout keep working)', () => {
    const participant = read('auth/session-authorization-participant.ts');
    const lockMethods = participant.slice(0, participant.indexOf('async assertNewWorkAllowed'));
    expect(lockMethods).not.toContain('ACCOUNT_DELETE_PENDING');
    expect(lockMethods).not.toContain('isDeleteRequested');
  });

  it('the withdrawal is the one exception (OD-31): it keeps working for the owner who asked for the deletion, but a VIOLATION / SECURITY lock never qualifies', () => {
    expect(read('driver-wallet/driver-withdrawal-service.ts')).toContain('deletionAllowsWithdrawal(');
    const repository = read('auth/user-repository.ts');
    const sql = repository.slice(repository.indexOf('async hasDeletionWalletException'));
    expect(sql).toContain("status = 'ACTIVE' AND delete_requested_at IS NOT NULL");
    expect(sql).toContain("status = 'DISABLED' AND lock_reason = 'DELETE_REQUEST'");
    expect(sql.slice(0, sql.indexOf('FROM app.users'))).not.toMatch(/VIOLATION|SECURITY/);
  });

  it('a shop whose OWNER is pending reads like a locked owner in the public listing and in the availability snapshot', () => {
    for (const file of ['shop/shop-availability-sql.ts', 'shop/shop-discovery-reader.ts']) {
      expect(read(file)).toContain('delete_requested_at IS NOT NULL');
    }
  });
});
