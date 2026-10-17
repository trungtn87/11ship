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

// M04-A2.1: the hold read model. A hold reserves part of a wallet balance for one business source; nothing here creates or changes one.
export type HoldPurpose = 'COMMISSION' | 'WITHDRAWAL';
export type HoldStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED';

export interface HoldRow {
  readonly holdId: string;
  readonly walletId: string;
  readonly purpose: HoldPurpose;
  readonly amountVnd: bigint;
  readonly status: HoldStatus;
  /** Exactly one of the two sources is set, the one of the purpose. */
  readonly commissionAssignmentId: string | null;
  readonly withdrawalId: string | null;
  readonly version: bigint;
  readonly createdAtMs: number;
  readonly resolvedAtMs: number | null;
}

/** The holds of a Shipper and their ACTIVE total, which always equals the wallet's held amount (checked on read, never repaired). */
export interface HoldSummary {
  readonly driverId: string;
  readonly provisioned: boolean;
  readonly holds: readonly HoldRow[];
  readonly activeCount: number;
  readonly activeVnd: bigint;
}

export function assertHoldRowSound(row: HoldRow): HoldRow {
  const sourceOk =
    (row.purpose === 'COMMISSION' && row.commissionAssignmentId !== null && row.withdrawalId === null) ||
    (row.purpose === 'WITHDRAWAL' && row.withdrawalId !== null && row.commissionAssignmentId === null);
  if (row.amountVnd <= 0n || row.amountVnd > MAX_WALLET_VND || !sourceOk || (row.status === 'ACTIVE') !== (row.resolvedAtMs === null)) {
    throw new WalletInvariantError();
  }
  return row;
}

export function summaryOfHolds(driverId: string, wallet: WalletRow | undefined, holds: readonly HoldRow[]): HoldSummary {
  if (wallet === undefined) {
    if (holds.length > 0) {
      throw new WalletInvariantError();
    }
    return { driverId, provisioned: false, holds: [], activeCount: 0, activeVnd: 0n };
  }
  const active = holds.filter((hold) => hold.status === 'ACTIVE');
  const activeVnd = active.reduce((sum, hold) => sum + hold.amountVnd, 0n);
  if (activeVnd !== wallet.heldVnd) {
    throw new WalletInvariantError();
  }
  return { driverId, provisioned: true, holds, activeCount: active.length, activeVnd };
}
