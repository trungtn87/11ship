import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { GrantablePermissionKey, isGrantablePermission } from './finance-access-constants';

// Strict parsers of the finance routes of the administration (M04-B2.2a). The actor comes from the session and the target from the path; a body
// never names an actor, a role or a state. Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID, echoing nothing.

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  const actual = Object.keys(value);
  if ((proto !== Object.prototype && proto !== null) || actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

export function parseFinanceId(value: unknown): string {
  return isCanonicalUuid(value) ? value : invalid();
}

export function parseNoFinanceQuery(query: unknown): void {
  if (typeof query !== 'object' || query === null || Array.isArray(query) || Object.keys(query).length > 0) {
    invalid();
  }
}

export interface GrantBody {
  readonly permissionKey: GrantablePermissionKey;
  /** The version of the right row the screen saw; 0 when the administrator has no row for this right yet. */
  readonly expectedVersion: number;
}

/** POST grant / revoke: exact {permission_key, expected_version}. Only a right that can be granted today is accepted. */
export function parseGrantBody(body: unknown): GrantBody {
  const parsed = exact(body, ['permission_key', 'expected_version']);
  const version = parsed.expected_version;
  if (!isGrantablePermission(parsed.permission_key) || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return invalid();
  }
  return { permissionKey: parsed.permission_key, expectedVersion: version };
}

export interface BankAccountBody {
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
}

/** POST bank-accounts: exact {bank_id, account_number, account_holder}; the shapes the table's own constraints accept. */
export function parseBankAccountBody(body: unknown): BankAccountBody {
  const parsed = exact(body, ['bank_id', 'account_number', 'account_holder']);
  const bank = parsed.bank_id;
  const number = parsed.account_number;
  const holder = parsed.account_holder;
  if (typeof bank !== 'string' || !/^[A-Z0-9]{2,16}$/.test(bank) || typeof number !== 'string' || typeof holder !== 'string') {
    return invalid();
  }
  const digits = number.replace(/[\s-]/gu, '');
  const name = holder.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!/^[0-9]{6,20}$/.test(digits) || [...name].length < 1 || [...name].length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    return invalid();
  }
  return { bankId: bank, accountNumber: digits, accountHolder: name };
}

export interface ReceivingBody {
  readonly expectedVersion: number;
  readonly canReceive: boolean;
}

/** POST bank-accounts/:id/receiving: exact {expected_version, can_receive}; the version the screen saw and the wanted state. */
export function parseReceivingBody(body: unknown): ReceivingBody {
  const parsed = exact(body, ['expected_version', 'can_receive']);
  const version = parsed.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || typeof parsed.can_receive !== 'boolean') {
    return invalid();
  }
  return { expectedVersion: version, canReceive: parsed.can_receive };
}
