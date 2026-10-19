// The finance rights of the administration (M04-B2.2a, ADR-004 section 9). A right is a dotted name. SYSTEM has all of them implicitly; an ADMIN has
// only those SYSTEM granted, one by one, and none by default. Nothing here is derived from the app permissions (can_view, can_review_profile,
// the sidebar) or from the Shipper review rights: those never imply money.

export const FINANCE_PERMISSION_READ = 'wallet.read';
export const FINANCE_PERMISSION_TOPUP_RECORD = 'wallet.topup.record';

// M12-C: the same table carries the function rights of the administration beyond money (it is key-format-only by design). Each is separate: viewing a report is
// not exporting it, and neither opens the audit log. SYSTEM holds them implicitly.
export const PERMISSION_REPORT_READ = 'report.read';
export const PERMISSION_REPORT_EXPORT = 'report.export';
export const PERMISSION_AUDIT_READ = 'audit.read';

/** The rights that can be granted TODAY. */
export const GRANTABLE_FINANCE_PERMISSIONS = [FINANCE_PERMISSION_READ, FINANCE_PERMISSION_TOPUP_RECORD] as const;

/** The function rights beyond money (M12-C). They live in the same table and are given by the same SYSTEM-only routes, but are not finance rights. */
export const GRANTABLE_FUNCTION_PERMISSIONS = [PERMISSION_REPORT_READ, PERMISSION_REPORT_EXPORT, PERMISSION_AUDIT_READ] as const;
export const GRANTABLE_PERMISSIONS = [...GRANTABLE_FINANCE_PERMISSIONS, ...GRANTABLE_FUNCTION_PERMISSIONS] as const;
export type GrantablePermissionKey = (typeof GRANTABLE_PERMISSIONS)[number];

export function isGrantablePermission(value: unknown): value is GrantablePermissionKey {
  return typeof value === 'string' && (GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}
export type FinancePermissionKey = (typeof GRANTABLE_FINANCE_PERMISSIONS)[number];

/**
 * Names reserved for the packages that will use them (withdrawals, adjustments, the Shipper bank read). The table accepts them (format only), but
 * the service refuses to grant any of them until its package defines what it protects: reserving a name grants nothing to anybody.
 */
export const RESERVED_FINANCE_PERMISSIONS = [
  'wallet.withdrawal.process',
  'wallet.withdrawal.confirm',
  'wallet.withdrawal.reconcile',
  'wallet.adjustment.post',
  'driver.bank.read',
] as const;

export function isGrantableFinancePermission(value: unknown): value is FinancePermissionKey {
  return typeof value === 'string' && (GRANTABLE_FINANCE_PERMISSIONS as readonly string[]).includes(value);
}

export type FinanceGrantState = 'GRANTED' | 'REVOKED';
