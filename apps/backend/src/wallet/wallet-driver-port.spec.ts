import { describe, expect, it } from '@jest/globals';
import { DriverRepository } from '../driver/driver-repository';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { TransactionContext } from '../transaction/transaction-context';
import { CommissionPolicyRepository } from './commission-policy-repository';
import { WalletDriverPort } from './wallet-driver-port';
import { WalletReadRepository } from './wallet-read-repository';
import { WalletService } from './wallet-service';

const context = {} as TransactionContext;
function rig(over: { available?: bigint; confirmed?: bigint; initial?: boolean; minimum?: number; balance?: bigint; holds?: number; open?: number; pending?: boolean } = {}) {
  const available = over.available ?? 100_000n;
  return new WalletDriverPort(
    { readWallet: async () => ({ provisioned: true, walletId: 'wallet', availableVnd: available, balanceVnd: over.balance ?? available }), holdSummary: async () => ({ activeHoldCount: over.holds ?? 0 }) } as unknown as WalletService,
    { fundingOfDriver: async () => ({ confirmedTopupVnd: over.confirmed ?? 100_000n, availableVnd: available }), openWithdrawalCountOfDriver: async () => over.open ?? 0 } as unknown as WalletReadRepository,
    { current: async () => ({ amountVnd: 1000n }) } as unknown as CommissionPolicyRepository,
    { limits: async () => ({ topupMinVnd: over.minimum ?? 100_000 }) } as unknown as ShipperWalletParametersReader,
    { findById: async () => ({ initialFundingRequired: over.initial ?? true }) } as unknown as DriverRepository,
  );
}

describe('M03 wallet activity gates', () => {
  it('zero money never enables new orders', async () => {
    expect(await rig({ available: 0n }).readinessForOrders(context, 'driver')).toEqual({ ready: false, reason: 'BALANCE_TOO_LOW' });
  });
  it('names the cause: confirmed funding below the threshold is FUNDING_TOO_LOW, too little available money is BALANCE_TOO_LOW', async () => {
    expect(await rig({ confirmed: 99_999n }).readinessForOrders(context, 'driver')).toEqual({ ready: false, reason: 'FUNDING_TOO_LOW' });
    expect(await rig({ available: 999n }).readinessForOrders(context, 'driver')).toEqual({ ready: false, reason: 'BALANCE_TOO_LOW' });
  });
  it('unconfirmed or partial first funding does not activate a new shipper', async () => {
    expect((await rig({ confirmed: 0n }).readinessForOrders(context, 'driver')).ready).toBe(false);
    expect((await rig({ confirmed: 99_999n }).readinessForOrders(context, 'driver')).ready).toBe(false);
  });
  it('uses the configured initial minimum, with no bank or approval requirement', async () => {
    expect((await rig({ minimum: 120_000 }).readinessForOrders(context, 'driver')).ready).toBe(false);
    expect((await rig({ minimum: 120_000, confirmed: 120_000n }).readinessForOrders(context, 'driver')).ready).toBe(true);
  });
  it('after first funding, only the available expected commission is needed', async () => {
    expect((await rig({ available: 1000n }).readinessForOrders(context, 'driver')).ready).toBe(true);
    expect((await rig({ available: 999n }).readinessForOrders(context, 'driver')).ready).toBe(false);
  });
  it('preserves old shipper eligibility without imposing initial funding again', async () => {
    expect((await rig({ initial: false, confirmed: 0n, available: 1000n }).readinessForOrders(context, 'driver')).ready).toBe(true);
  });
  it('cannot close while money, holds, withdrawal or unconfirmed topup remains', async () => {
    for (const over of [{ balance: 1n }, { balance: 0n, holds: 1 }, { balance: 0n, open: 1 }, { balance: 0n, pending: true }]) {
      const tx = { query: async () => ({ rows: over.pending ? [{}] : [] }) } as unknown as TransactionContext;
      expect((await rig(over).settlementForClosure(tx, 'driver')).settled).toBe(false);
    }
    const tx = { query: async () => ({ rows: [] }) } as unknown as TransactionContext;
    expect((await rig({ balance: 0n }).settlementForClosure(tx, 'driver')).settled).toBe(true);
  });
});
