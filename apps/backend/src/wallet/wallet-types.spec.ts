import { describe, expect, it } from '@jest/globals';
import { assertHoldRowSound, assertWalletRowSound, availableOf, MAX_WALLET_VND, unprovisionedView, viewOfRow, WalletHoldRow, WalletInvariantError, WalletRow } from './wallet-types';

const row = (overrides: Partial<WalletRow> = {}): WalletRow => ({
  walletId: '11111111-1111-4111-8111-111111111111',
  driverId: '22222222-2222-4222-8222-222222222222',
  balanceVnd: 0n,
  heldVnd: 0n,
  version: 1n,
  createdAtMs: 1,
  updatedAtMs: 1,
  ...overrides,
});

describe('M04-A1 wallet read model (pure rules, no database)', () => {
  it('A = B - H, computed and never stored, in bigint', () => {
    expect(availableOf(100_000n, 30_000n)).toBe(70_000n);
    expect(availableOf(0n, 0n)).toBe(0n);
    expect(viewOfRow(row({ balanceVnd: 5_000n, heldVnd: 2_000n, version: 3n }))).toEqual({
      provisioned: true,
      walletId: '11111111-1111-4111-8111-111111111111',
      driverId: '22222222-2222-4222-8222-222222222222',
      balanceVnd: 5_000n,
      heldVnd: 2_000n,
      availableVnd: 3_000n,
      version: 3n,
    });
  });

  it('keeps full precision at the largest amount (a JavaScript number would not)', () => {
    expect(MAX_WALLET_VND).toBe(9_007_199_254_740_991n);
    const view = viewOfRow(row({ balanceVnd: MAX_WALLET_VND, heldVnd: 1n }));
    expect(view.availableVnd).toBe(9_007_199_254_740_990n);
    expect(typeof view.balanceVnd).toBe('bigint');
  });

  it('an unprovisioned Shipper is reported as such, with zero amounts that are not a stored balance', () => {
    expect(unprovisionedView('d')).toEqual({ provisioned: false, driverId: 'd', balanceVnd: 0n, heldVnd: 0n, availableVnd: 0n });
  });

  it('a stored row that breaks the wallet rules is a loud internal error, never a wrong "available"', () => {
    for (const bad of [{ balanceVnd: -1n }, { balanceVnd: 10n, heldVnd: 11n }, { heldVnd: -1n }, { balanceVnd: MAX_WALLET_VND + 1n }, { version: 0n }]) {
      expect(() => assertWalletRowSound(row(bad))).toThrow(WalletInvariantError);
      expect(() => viewOfRow(row(bad))).toThrow('WALLET_INVARIANT_VIOLATION');
    }
    expect(assertWalletRowSound(row())).toEqual(row());
  });
});

const hold = (overrides: Partial<WalletHoldRow> = {}): WalletHoldRow => ({
  holdId: '33333333-3333-4333-8333-333333333333',
  walletId: '11111111-1111-4111-8111-111111111111',
  purpose: 'COMMISSION',
  amountVnd: 1_000n,
  status: 'ACTIVE',
  commissionAssignmentId: '44444444-4444-4444-8444-444444444444',
  withdrawalId: null,
  version: 1n,
  createdAtMs: 1,
  resolvedAtMs: null,
  ...overrides,
});

describe('M04-A2.1 hold read model (pure rules, no database)', () => {
  it('accepts a hold with exactly the source of its purpose and a status that matches resolved time', () => {
    expect(assertHoldRowSound(hold())).toEqual(hold());
    const withdrawal = hold({ purpose: 'WITHDRAWAL', commissionAssignmentId: null, withdrawalId: '55555555-5555-4555-8555-555555555555' });
    expect(assertHoldRowSound(withdrawal)).toEqual(withdrawal);
    expect(assertHoldRowSound(hold({ status: 'RELEASED', resolvedAtMs: 2 })).status).toBe('RELEASED');
    expect(assertHoldRowSound(hold({ amountVnd: MAX_WALLET_VND })).amountVnd).toBe(MAX_WALLET_VND);
  });

  it('a stored hold that breaks the hold rules is a loud internal error', () => {
    const bad: Array<Partial<WalletHoldRow>> = [
      { amountVnd: 0n },
      { amountVnd: -5n },
      { amountVnd: MAX_WALLET_VND + 1n },
      { commissionAssignmentId: null },
      { withdrawalId: '55555555-5555-4555-8555-555555555555' },
      { purpose: 'WITHDRAWAL' },
      { status: 'ACTIVE', resolvedAtMs: 2 },
      { status: 'CAPTURED', resolvedAtMs: null },
      { version: 0n },
    ];
    for (const overrides of bad) {
      expect(() => assertHoldRowSound(hold(overrides))).toThrow(WalletInvariantError);
    }
  });
});
