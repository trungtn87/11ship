import { describe, expect, it } from '@jest/globals';
import { assertHoldRowSound, assertWalletRowSound, availableOf, HoldRow, MAX_WALLET_VND, summaryOfHolds, unprovisionedView, viewOfRow, WalletInvariantError, WalletRow } from './wallet-types';

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

const hold = (overrides: Partial<HoldRow> = {}): HoldRow => ({
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

describe('M04-A2.1 hold read model', () => {
  it('sums only ACTIVE holds and requires the total to equal the wallet held amount', () => {
    const wallet = row({ balanceVnd: 10_000n, heldVnd: 3_000n });
    const holds = [
      hold({ amountVnd: 1_000n }),
      hold({ holdId: 'b', purpose: 'WITHDRAWAL', amountVnd: 2_000n, commissionAssignmentId: null, withdrawalId: 'w' }),
      hold({ holdId: 'c', amountVnd: 9_000n, status: 'RELEASED', resolvedAtMs: 2 }),
    ];
    expect(summaryOfHolds('d', wallet, holds)).toMatchObject({ provisioned: true, activeCount: 2, activeVnd: 3_000n });
    expect(() => summaryOfHolds('d', row({ balanceVnd: 10_000n, heldVnd: 2_999n }), holds)).toThrow(WalletInvariantError);
  });

  it('is empty without a wallet and refuses holds that have no wallet', () => {
    expect(summaryOfHolds('d', undefined, [])).toEqual({ driverId: 'd', provisioned: false, holds: [], activeCount: 0, activeVnd: 0n });
    expect(() => summaryOfHolds('d', undefined, [hold()])).toThrow(WalletInvariantError);
  });

  it('a stored hold that breaks the hold rules is a loud internal error', () => {
    for (const bad of [{ amountVnd: 0n }, { amountVnd: MAX_WALLET_VND + 1n }, { withdrawalId: 'w' }, { commissionAssignmentId: null }, { status: 'RELEASED' as const }, { resolvedAtMs: 5 }]) {
      expect(() => assertHoldRowSound(hold(bad))).toThrow(WalletInvariantError);
    }
    expect(assertHoldRowSound(hold())).toEqual(hold());
  });
});
