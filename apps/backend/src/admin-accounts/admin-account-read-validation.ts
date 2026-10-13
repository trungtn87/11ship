import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the three account-read queries (M01-ADMIN account read). Anything that is not exactly the documented
// shape is ADMIN_INPUT_INVALID: a repeated parameter, an unknown key, a padded number, a control character.

export const PUBLIC_ROLES = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;
export const SEARCH_MAX_CODEPOINTS = 120;

/** The opaque cursor as the client sent it: timestamp (microseconds), id, key id and the HMAC binding. Verified by the service. */
export interface RawCursor {
  readonly createdAtUs: string;
  readonly userId: string;
  readonly keyId: string;
  readonly binding: string;
}

export interface UserListQuery {
  readonly q: string | null;
  readonly role: PublicRole | null;
  readonly status: AccountStatus | null;
  readonly limit: number;
  readonly cursor: RawCursor | null;
}

export interface AdministratorListQuery {
  readonly q: string | null;
  readonly status: AccountStatus | null;
  readonly limit: number;
  readonly cursor: RawCursor | null;
}

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid();
    }
  }
}

function single(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    invalid();
  }
  return value;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return LIST_DEFAULT_LIMIT;
  }
  if (!/^[1-9][0-9]?$/.test(raw) || Number(raw) > LIST_MAX_LIMIT) {
    invalid();
  }
  return Number(raw);
}

/** Trimmed, at most 120 code points, no control characters. Empty after trimming means "no search". */
export function parseSearch(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const text = raw.normalize('NFC').trim();
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text) || [...text].length > SEARCH_MAX_CODEPOINTS) {
    invalid();
  }
  return text === '' ? null : text;
}

function parseStatus(raw: string | undefined): AccountStatus | null {
  if (raw === undefined) {
    return null;
  }
  if (!(ACCOUNT_STATUSES as readonly string[]).includes(raw)) {
    invalid();
  }
  return raw as AccountStatus;
}

const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;

export function encodeCursor(cursor: RawCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAtUs, cursor.userId, cursor.keyId, cursor.binding]), 'utf8').toString('base64url');
}

/** Structure only; whether the server issued it for THIS endpoint, filter and actor is the service's check (HMAC binding). */
export function decodeCursor(raw: string): RawCursor {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(raw)) {
    invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    invalid();
  }
  const [createdAtUs, userId, keyId, binding] = parsed as unknown[];
  if (
    typeof createdAtUs !== 'string' ||
    !CURSOR_TIME.test(createdAtUs) ||
    !isCanonicalUuid(userId) ||
    typeof keyId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(keyId) ||
    typeof binding !== 'string' ||
    !/^[0-9a-f]{64}$/.test(binding)
  ) {
    return invalid();
  }
  const cursor = { createdAtUs, userId, keyId, binding };
  if (encodeCursor(cursor) !== raw) {
    invalid();
  }
  return cursor;
}

export function parseUserListQuery(query: unknown): UserListQuery {
  const root = query === undefined ? {} : plainObject(query);
  onlyKeys(root, ['q', 'role', 'status', 'limit', 'cursor']);
  const role = single(root.role);
  if (role !== undefined && !(PUBLIC_ROLES as readonly string[]).includes(role)) {
    invalid();
  }
  const cursor = single(root.cursor);
  return {
    q: parseSearch(single(root.q)),
    role: role === undefined ? null : (role as PublicRole),
    status: parseStatus(single(root.status)),
    limit: parseLimit(single(root.limit)),
    cursor: cursor === undefined ? null : decodeCursor(cursor),
  };
}

export function parseAdministratorListQuery(query: unknown): AdministratorListQuery {
  const root = query === undefined ? {} : plainObject(query);
  onlyKeys(root, ['q', 'status', 'limit', 'cursor']);
  const cursor = single(root.cursor);
  return {
    q: parseSearch(single(root.q)),
    status: parseStatus(single(root.status)),
    limit: parseLimit(single(root.limit)),
    cursor: cursor === undefined ? null : decodeCursor(cursor),
  };
}

/** GET /admin-auth/permissions and GET /admin/users/:id take no query. */
export function parseNoQuery(query: unknown): void {
  if (query === undefined) {
    return;
  }
  if (Object.keys(plainObject(query)).length > 0) {
    invalid();
  }
}

export function parseUserId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
}

// ----- Vietnamese-insensitive search ------------------------------------------------------------------------------------

const VIETNAMESE_LOWER = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';

function baseLetter(char: string): string {
  return char === 'đ' ? 'd' : (char.normalize('NFD')[0] as string);
}

/** Both strings for SQL translate(): every accented letter, lower and upper case, to its base ASCII letter. Same length by construction. */
export const FOLD_FROM = VIETNAMESE_LOWER + VIETNAMESE_LOWER.toUpperCase();
export const FOLD_TO = [...VIETNAMESE_LOWER].map(baseLetter).join('') + [...VIETNAMESE_LOWER].map(baseLetter).join('');

/** The same folding in JavaScript, then lower case: what the SQL side computes for a stored name. */
export function foldSearchText(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    const index = FOLD_FROM.indexOf(char);
    out += index >= 0 ? (FOLD_TO[index] as string) : char;
  }
  return out.toLowerCase();
}

/** A LIKE pattern body with `!` as the escape character: %, _ and ! are literal. */
export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, (match) => `!${match}`);
}

/** National or international digits of a phone-looking search, as the part after "+": 0912.. -> 84912.. ; null when it is not one. */
export function phoneSearchDigits(q: string): string | null {
  const compact = q.replace(/[\s.\-()]/g, '');
  if (!/^\+?[0-9]{3,15}$/.test(compact)) {
    return null;
  }
  const digits = compact.replace('+', '');
  return digits.startsWith('0') ? `84${digits.slice(1)}` : digits;
}
