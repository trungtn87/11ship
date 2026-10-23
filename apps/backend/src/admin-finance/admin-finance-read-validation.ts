import { AppError } from '../common/app-errors';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShipperListFilter } from '../driver/driver-admin-query-repository';
import { ADMIN_LEDGER_KINDS, AdminLedgerCursor, AdminLedgerKind, WalletCursor } from '../wallet/wallet-read-repository';
import { COMMISSION_POLICY_MAX_VND } from '../wallet/commission-policy-repository';
import { TOPUP_LIST_DEFAULT_LIMIT, TOPUP_LIST_MAX_LIMIT } from '../wallet-topup/topup-request-validation';

// Strict parsers of the administration finance reads and of the commission change (M04-C). Anything unknown is ADMIN_INPUT_INVALID, echoing nothing.

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function source(query: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (query === undefined) {
    return {};
  }
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return invalid();
  }
  const record = query as Record<string, unknown>;
  if (!Object.keys(record).every((key) => allowed.includes(key))) {
    return invalid();
  }
  return record;
}

function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return value === undefined ? undefined : typeof value === 'string' ? value : invalid();
}

function limitOf(record: Record<string, unknown>): number {
  const raw = text(record, 'limit');
  if (raw === undefined) {
    return TOPUP_LIST_DEFAULT_LIMIT;
  }
  if (!/^[0-9]{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > TOPUP_LIST_MAX_LIMIT) {
    return invalid();
  }
  return Number(raw);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function cursorOf(raw: string | undefined, tail: string): { ms: number; id: string } | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]{1,140}$/.test(raw)) {
    return invalid();
  }
  const match = new RegExp(`^([0-9]{1,16})\\.(${tail})$`).exec(Buffer.from(raw, 'base64url').toString('utf8'));
  const ms = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(ms)) {
    return invalid();
  }
  return { ms, id: match[2] as string };
}

export function encodeWalletCursor(updatedAtMs: number, walletId: string): string {
  return Buffer.from(`${updatedAtMs}.${walletId}`, 'utf8').toString('base64url');
}
export function encodeLedgerCursor(atMs: number, rowId: string): string {
  return Buffer.from(`${atMs}.${rowId}`, 'utf8').toString('base64url');
}

export interface AdminWalletListQuery {
  readonly search: NonNullable<ShipperListFilter['pattern']> | null;
  readonly limit: number;
  readonly after: WalletCursor | undefined;
}
/** GET wallets: `q` (Shipper code, name or phone, at most 60 characters), `limit` (1..50) and `cursor`. */
export function parseWalletListQuery(query: unknown): AdminWalletListQuery {
  const record = source(query, ['q', 'limit', 'cursor']);
  const q = text(record, 'q');
  let search: AdminWalletListQuery['search'] = null;
  if (q !== undefined && q.trim() !== '') {
    const typed = q.trim();
    if ([...typed].length > 60 || /[\p{Cc}]/u.test(typed)) {
      return invalid();
    }
    const digits = /^[+0-9][0-9 .+-]*$/u.test(typed) ? typed.replace(/\D/gu, '').replace(/^0+/u, '') : '';
    search = { name: likeContains(foldVietnamese(typed)), code: likeContains(typed), phone: digits.length >= 3 ? likeContains(digits) : null };
  }
  const cursor = cursorOf(text(record, 'cursor'), UUID);
  return { search, limit: limitOf(record), after: cursor === undefined ? undefined : { updatedAtMs: cursor.ms, walletId: cursor.id } };
}

export interface AdminLedgerQuery {
  readonly kind: AdminLedgerKind | undefined;
  readonly driverId: string | undefined;
  readonly limit: number;
  readonly after: AdminLedgerCursor | undefined;
}
/** GET transactions: `kind`, `driver_id`, `limit` (1..50) and `cursor`. */
export function parseLedgerQuery(query: unknown): AdminLedgerQuery {
  const record = source(query, ['kind', 'driver_id', 'limit', 'cursor']);
  const kind = text(record, 'kind');
  if (kind !== undefined && !(ADMIN_LEDGER_KINDS as readonly string[]).includes(kind)) {
    return invalid();
  }
  const driverId = text(record, 'driver_id');
  if (driverId !== undefined && !isCanonicalUuid(driverId)) {
    return invalid();
  }
  const cursor = cursorOf(text(record, 'cursor'), `[LH]:${UUID}`);
  return { kind: kind as AdminLedgerKind | undefined, driverId, limit: limitOf(record), after: cursor === undefined ? undefined : { atMs: cursor.ms, rowId: cursor.id } };
}

export interface CommissionBody {
  readonly expectedVersion: number;
  readonly commissionVnd: number;
}
/** POST commission: exact {expected_version (the policy version in force), commission_vnd (1..1.000.000.000)}. */
export function parseCommissionBody(body: unknown): CommissionBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid();
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes('expected_version') || !keys.includes('commission_vnd')) {
    return invalid();
  }
  const version = record.expected_version;
  const amount = record.commission_vnd;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > COMMISSION_POLICY_MAX_VND) {
    return invalid();
  }
  return { expectedVersion: version, commissionVnd: amount };
}
