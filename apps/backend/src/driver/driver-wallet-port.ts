import { TransactionContext } from '../transaction/transaction-context';

/**
 * What M03 needs from the Shipper wallet (M04) and nothing more. M04 is not built yet: the default binding answers "not available",
 * so everything that depends on the wallet is blocked safely and honestly. No balance is ever invented here. When M04 lands it binds
 * its own implementation to DRIVER_WALLET_PORT and the blocked paths open without a change in M03.
 */
export type WalletReadiness = { readonly ready: true } | { readonly ready: false; readonly reason: 'WALLET_NOT_AVAILABLE' | 'BALANCE_TOO_LOW' };
export type WalletSettlement = { readonly settled: true } | { readonly settled: false; readonly reason: 'WALLET_NOT_AVAILABLE' | 'BALANCE_REMAINING' };

export interface DriverWalletPort {
  /** May the driver take new orders as far as the wallet is concerned (the M04 balance rule)? */
  readinessForOrders(context: TransactionContext, driverId: string): Promise<WalletReadiness>;
  /** Is there nothing left to settle with the driver (no balance and no pending transaction) so the profile may be closed? */
  settlementForClosure(context: TransactionContext, driverId: string): Promise<WalletSettlement>;
}

export const DRIVER_WALLET_PORT = Symbol('DRIVER_WALLET_PORT');

/** M04 has not delivered a wallet: nothing is ready and nothing is settled. */
export class NotIntegratedDriverWalletPort implements DriverWalletPort {
  readinessForOrders(): Promise<WalletReadiness> {
    return Promise.resolve({ ready: false, reason: 'WALLET_NOT_AVAILABLE' });
  }

  settlementForClosure(): Promise<WalletSettlement> {
    return Promise.resolve({ settled: false, reason: 'WALLET_NOT_AVAILABLE' });
  }
}
