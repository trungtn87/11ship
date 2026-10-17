// M04-A1: the Shipper wallet core. Money is whole VND held as bigint in PostgreSQL AND in TypeScript: nothing here ever converts a
// balance to a JavaScript number (a balance past 2^53 would silently lose precision). The only product of this package is the
// read model below; no function of it moves money.

/** The largest amount the database accepts (the biggest integer a JSON number carries exactly). A technical limit, not a quota. */
export const MAX_WALLET_VND = 9_007_199_254_740_991n;

/** A wallet row as stored. A = balanceVnd - heldVnd is computed (availableOf), never stored. */
export interface WalletRow {
  readonly walletId: string;
  readonly driverId: string;
  readonly balanceVnd: bigint;
  readonly heldVnd: bigint;
  readonly version: bigint;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/**
 * What a reader gets for a Shipper. A Shipper who has no wallet yet is NOT given a stored zero: the projection says plainly that the
 * wallet is not provisioned (GET never creates a wallet), with zero amounts that are a statement of "nothing here", not a balance.
 */
export type WalletView =
  | { readonly provisioned: false; readonly driverId: string; readonly balanceVnd: 0n; readonly heldVnd: 0n; readonly availableVnd: 0n }
  | {
      readonly provisioned: true;
      readonly walletId: string;
      readonly driverId: string;
      readonly balanceVnd: bigint;
      readonly heldVnd: bigint;
      readonly availableVnd: bigint;
      readonly version: bigint;
    };

export function availableOf(balanceVnd: bigint, heldVnd: bigint): bigint {
  return balanceVnd - heldVnd;
}

/**
 * The same rules the database enforces (0 <= H <= B <= MAX), checked on what was read, so a row that somehow violates them is a loud
 * internal error and never a silently wrong "available". Returns the row unchanged when it is sound.
 */
export function assertWalletRowSound(row: WalletRow): WalletRow {
  if (row.balanceVnd < 0n || row.balanceVnd > MAX_WALLET_VND || row.heldVnd < 0n || row.heldVnd > row.balanceVnd || row.version < 1n) {
    throw new WalletInvariantError();
  }
  return row;
}

export function viewOfRow(row: WalletRow): WalletView {
  const sound = assertWalletRowSound(row);
  return {
    provisioned: true,
    walletId: sound.walletId,
    driverId: sound.driverId,
    balanceVnd: sound.balanceVnd,
    heldVnd: sound.heldVnd,
    availableVnd: availableOf(sound.balanceVnd, sound.heldVnd),
    version: sound.version,
  };
}

export function unprovisionedView(driverId: string): WalletView {
  return { provisioned: false, driverId, balanceVnd: 0n, heldVnd: 0n, availableVnd: 0n };
}

/** A stored wallet that breaks the wallet rules. It carries no data; the caller's transaction rolls back and nothing is repaired. */
export class WalletInvariantError extends Error {
  constructor() {
    super('WALLET_INVARIANT_VIOLATION');
    this.name = 'WalletInvariantError';
  }
}
