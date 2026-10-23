import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * What M03 needs from the Shipper wallet (M04) and nothing more. M04 is not built yet: the default binding answers "not available",
 * so everything that depends on the wallet is blocked safely and honestly. No balance is ever invented here. When M04 lands it binds
 * its own implementation to DRIVER_WALLET_PORT and the blocked paths open without a change in M03.
 */
export type WalletReadiness = { readonly ready: true } | { readonly ready: false; readonly reason: 'WALLET_NOT_AVAILABLE' | 'BALANCE_TOO_LOW' };
export type WalletSettlement = { readonly settled: true } | { readonly settled: false; readonly reason: 'WALLET_NOT_AVAILABLE' | 'BALANCE_REMAINING' };

/** The first activation needs real money: at least 100.000 VND of CONFIRMED top-ups, still available (ADR-004 6). */
export type WalletFunding = { readonly funded: true } | { readonly funded: false; readonly reason: 'WALLET_NOT_AVAILABLE' | 'FUNDING_TOO_LOW' };

export interface DriverWalletPort {
  /** May an administrator approve the profile for the first time as far as the wallet is concerned (the funding rule)? Never credits anything. */
  fundingForActivation(context: TransactionContext, driverId: string): Promise<WalletFunding>;
  /** May the driver take new orders as far as the wallet is concerned (the M04 balance rule)? */
  readinessForOrders(context: TransactionContext, driverId: string): Promise<WalletReadiness>;
  /** Is there nothing left to settle with the driver (no balance and no pending transaction) so the profile may be closed? */
  settlementForClosure(context: TransactionContext, driverId: string): Promise<WalletSettlement>;
}

export const DRIVER_WALLET_PORT = Symbol('DRIVER_WALLET_PORT');

/** M04 has not delivered a wallet: nothing is ready and nothing is settled. */
export class NotIntegratedDriverWalletPort implements DriverWalletPort {
  fundingForActivation(): Promise<WalletFunding> {
    return Promise.resolve({ funded: false, reason: 'WALLET_NOT_AVAILABLE' });
  }

  readinessForOrders(): Promise<WalletReadiness> {
    return Promise.resolve({ ready: false, reason: 'WALLET_NOT_AVAILABLE' });
  }

  settlementForClosure(): Promise<WalletSettlement> {
    return Promise.resolve({ settled: false, reason: 'WALLET_NOT_AVAILABLE' });
  }
}

/**
 * The binding point of the port (M04-C). The Driver module cannot import the Wallet (the dependency runs one way), so it provides THIS delegate under DRIVER_WALLET_PORT:
 * until the Wallet module binds its implementation at start-up, the answer is the fail-closed "not integrated" one (a build without the Wallet module stays blocked);
 * after the bind every call goes to the wallet. Binding twice is refused, so no later module can swap the answer.
 */
@Injectable()
export class DelegatingDriverWalletPort implements DriverWalletPort {
  #target: DriverWalletPort = new NotIntegratedDriverWalletPort();
  #bound = false;

  bind(target: DriverWalletPort): void {
    if (this.#bound) {
      throw new Error('The driver wallet port is already bound');
    }
    this.#target = target;
    this.#bound = true;
  }

  fundingForActivation(context: TransactionContext, driverId: string): Promise<WalletFunding> {
    return this.#target.fundingForActivation(context, driverId);
  }

  readinessForOrders(context: TransactionContext, driverId: string): Promise<WalletReadiness> {
    return this.#target.readinessForOrders(context, driverId);
  }

  settlementForClosure(context: TransactionContext, driverId: string): Promise<WalletSettlement> {
    return this.#target.settlementForClosure(context, driverId);
  }
}
