import { AdminApp } from '../admin-accounts/admin-account-read-repository';

/**
 * OD-27: every `wallet.*` right is a Shipper money right, so it is only effective for an ADMIN who also holds the DRIVER app scope (a CURRENT
 * admin_app_permissions row for DRIVER with can_view). A grant row alone is not enough; an ADMIN with the grant but only the SHOP scope is refused
 * (ADMIN_FORBIDDEN). SYSTEM is exempt. There is no fallback: the one rule lives here and every reader/command goes through it.
 */
export const WALLET_SCOPE_APP: AdminApp = 'DRIVER';

export function isWalletPermission(key: string): boolean {
  return key.startsWith('wallet.');
}

/** True when the permission rows carry the DRIVER view scope that wallet rights need. */
export function holdsWalletScope(rows: ReadonlyArray<{ readonly app: AdminApp; readonly canView: boolean }>): boolean {
  return rows.some((row) => row.app === WALLET_SCOPE_APP && row.canView);
}
