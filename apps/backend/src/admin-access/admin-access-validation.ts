import { createHash } from 'node:crypto';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the administrator-management routes (M12-C). The actor comes from the session and the target from the path; a body never names an actor,
// a role or a membership. Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID, echoing nothing.

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  const keys = Object.keys(value);
  if ((proto !== Object.prototype && proto !== null) || !required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

export const parseAccessId = (value: unknown): string => (isCanonicalUuid(value) ? value : invalid());

export function parseNoAccessQuery(query: unknown): void {
  if (typeof query !== 'object' || query === null || Array.isArray(query) || Object.keys(query).length > 0) {
    invalid();
  }
}

export const REASON_MAX_CODEPOINTS = 500;

/** A reason is mandatory for every change and is audited: 1-500 characters, one line of text, no control characters. */
export function parseReason(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...text].length;
  return length < 1 || length > REASON_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(text) ? invalid() : text;
}

export const ADMIN_APPS = ['CUSTOMER', 'SHOP', 'DRIVER'] as const;
export type AdminAppName = (typeof ADMIN_APPS)[number];

export interface AppPermissionInput {
  readonly app: AdminAppName;
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  readonly canManageCatalog: boolean;
}

/** The rules the table's own checks enforce, said here first so a bad set is a 400 and not a database error. At least one app must be viewable. */
export function normalizePermissions(value: unknown): AppPermissionInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ADMIN_APPS.length) {
    return invalid();
  }
  const seen = new Set<string>();
  const out: AppPermissionInput[] = [];
  for (const entry of value) {
    const row = exact(entry, ['app', 'can_view', 'can_review_profile', 'can_lock'], ['can_manage_catalog']);
    const app = row.app;
    if (typeof app !== 'string' || !(ADMIN_APPS as readonly string[]).includes(app) || seen.has(app)) {
      return invalid();
    }
    seen.add(app);
    const flags = [row.can_view, row.can_review_profile, row.can_lock, row.can_manage_catalog ?? false];
    if (!flags.every((flag) => typeof flag === 'boolean')) {
      return invalid();
    }
    const [canView, canReviewProfile, canLock, canManageCatalog] = flags as [boolean, boolean, boolean, boolean];
    if ((canReviewProfile && !canView) || (canLock && !canView) || (canManageCatalog && (!canView || app !== 'SHOP')) || (app === 'CUSTOMER' && canReviewProfile)) {
      return invalid();
    }
    out.push({ app: app as AdminAppName, canView, canReviewProfile, canLock, canManageCatalog });
  }
  if (!out.some((row) => row.canView)) {
    return invalid();
  }
  return out.sort((a, b) => ADMIN_APPS.indexOf(a.app) - ADMIN_APPS.indexOf(b.app));
}

/** The token a screen gives back to say "I changed the permissions I saw": a digest of the canonical current rows. A change made meanwhile makes it differ. */
export function permissionsFingerprint(rows: readonly AppPermissionInput[]): string {
  const canonical = [...rows]
    .sort((a, b) => ADMIN_APPS.indexOf(a.app) - ADMIN_APPS.indexOf(b.app))
    .map((row) => `${row.app}:${row.canView ? 1 : 0}${row.canReviewProfile ? 1 : 0}${row.canLock ? 1 : 0}${row.canManageCatalog ? 1 : 0}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface PermissionsBody {
  readonly permissions: AppPermissionInput[];
  readonly expectedFingerprint: string;
  readonly reason: string;
}

export function parsePermissionsBody(body: unknown): PermissionsBody {
  const parsed = exact(body, ['permissions', 'expected_fingerprint', 'reason']);
  if (typeof parsed.expected_fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.expected_fingerprint)) {
    return invalid();
  }
  return { permissions: normalizePermissions(parsed.permissions), expectedFingerprint: parsed.expected_fingerprint, reason: parseReason(parsed.reason) };
}

export interface StatusBody {
  readonly expectedVersion: number;
  readonly reason: string;
}

/** lock / unlock: the membership version the screen saw and a reason. */
export function parseStatusBody(body: unknown): StatusBody {
  const parsed = exact(body, ['expected_version', 'reason']);
  const version = parsed.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return invalid();
  }
  return { expectedVersion: version, reason: parseReason(parsed.reason) };
}

export interface RevokeBody {
  readonly reason: string;
}

export function parseRevokeBody(body: unknown): RevokeBody {
  return { reason: parseReason(exact(body, ['reason']).reason) };
}
