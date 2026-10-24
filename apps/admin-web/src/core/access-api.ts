// HTTP client of the administrator management (M12-C): GET /v1/admin/access/matrix, the four POST commands under /v1/admin/access/administrators/:id, and the
// function-right grants (/v1/admin/finance/access/admins/:id/grant|revoke). Cookie-only; the CSRF token is passed in from memory. Every answer is parsed strictly.

import { CsrfPort, failureOf } from './accounts-api.js';
import { AccessCommand, AccessMatrix, AccessRead, AccessSource, AdministratorAccess, AppName, AppPermissionRow, RIGHT_KEYS, RightKey, RightState } from './access.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { CommandResult, commandResultOf } from './commands.js';

export const ACCESS_BASE = '/v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPS: readonly string[] = ['CUSTOMER', 'SHOP', 'DRIVER'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

function parsePermission(value: unknown): AppPermissionRow | undefined {
  const raw = record(value);
  if (raw === undefined || typeof raw.app !== 'string' || !APPS.includes(raw.app) || typeof raw.can_view !== 'boolean' || typeof raw.can_review_profile !== 'boolean' || typeof raw.can_lock !== 'boolean' || typeof raw.can_manage_catalog !== 'boolean' || typeof raw.can_manage_shops !== 'boolean') {
    return undefined;
  }
  return { app: raw.app as AppName, canView: raw.can_view, canReviewProfile: raw.can_review_profile, canLock: raw.can_lock, canManageCatalog: raw.can_manage_catalog, canManageShops: raw.can_manage_shops };
}

function parseRight(value: unknown): RightState | undefined {
  const raw = record(value);
  if (raw === undefined || typeof raw.permission_key !== 'string' || !(RIGHT_KEYS as readonly string[]).includes(raw.permission_key) || !whole(raw.version) || (raw.state !== 'GRANTED' && raw.state !== 'REVOKED' && raw.state !== 'NONE')) {
    return undefined;
  }
  return { key: raw.permission_key as RightKey, granted: raw.state === 'GRANTED', version: raw.version };
}

export function parseAdministrator(value: unknown): AdministratorAccess | undefined {
  const raw = record(value);
  const userId = str(raw?.user_id);
  const name = str(raw?.full_name);
  const phone = str(raw?.phone_masked);
  const createdAt = iso(raw?.created_at);
  const lastLogin = raw?.last_login_at === null ? null : iso(raw?.last_login_at);
  const fingerprint = str(raw?.permissions_fingerprint);
  if (
    raw === undefined || userId === undefined || !UUID_RE.test(userId) || name === undefined || phone === undefined || createdAt === undefined || lastLogin === undefined || fingerprint === undefined ||
    (raw.status !== 'ACTIVE' && raw.status !== 'DISABLED') || (raw.membership_status !== 'ACTIVE' && raw.membership_status !== 'DISABLED') || !whole(raw.membership_version) || !whole(raw.live_sessions) ||
    !Array.isArray(raw.permissions) || !Array.isArray(raw.rights)
  ) {
    return undefined;
  }
  const permissions: AppPermissionRow[] = [];
  for (const entry of raw.permissions) {
    const parsed = parsePermission(entry);
    if (parsed === undefined) {
      return undefined;
    }
    permissions.push(parsed);
  }
  const rights: RightState[] = [];
  for (const entry of raw.rights) {
    const parsed = parseRight(entry);
    if (parsed === undefined) {
      return undefined;
    }
    rights.push(parsed);
  }
  return {
    userId, fullName: name, phoneMasked: phone, status: raw.status, membershipStatus: raw.membership_status, membershipVersion: raw.membership_version, createdAt, liveSessions: raw.live_sessions,
    lastLoginAt: lastLogin, permissions, fingerprint, rights,
  };
}

export function parseMatrix(data: Record<string, unknown>): AccessMatrix | undefined {
  if (!Array.isArray(data.items) || typeof data.truncated !== 'boolean') {
    return undefined;
  }
  const items: AdministratorAccess[] = [];
  for (const entry of data.items) {
    const parsed = parseAdministrator(entry);
    if (parsed === undefined) {
      return undefined;
    }
    items.push(parsed);
  }
  return { items, truncated: data.truncated };
}

const permissionBody = (row: AppPermissionRow): Record<string, unknown> => ({ app: row.app, can_view: row.canView, can_review_profile: row.canReviewProfile, can_lock: row.canLock, can_manage_catalog: row.canManageCatalog, can_manage_shops: row.canManageShops });

export class AdminAccessApi extends ApiClient {
  matrix(): Promise<ApiResult<AccessMatrix>> {
    return this.call({ method: 'GET', path: '/admin/access/matrix' }, parseMatrix);
  }

  send(csrf: string, command: AccessCommand): Promise<ApiResult<Record<string, unknown>>> {
    const base = `/admin/access/administrators/${encodeURIComponent(command.userId)}`;
    const accept = (data: Record<string, unknown>): Record<string, unknown> => data;
    switch (command.name) {
      case 'permissions':
        return this.call({ method: 'POST', path: `${base}/permissions`, body: { permissions: command.permissions.map(permissionBody), expected_fingerprint: command.fingerprint, reason: command.reason }, csrf, idempotencyKey: command.key }, accept);
      case 'lock':
      case 'unlock':
        return this.call({ method: 'POST', path: `${base}/${command.name}`, body: { expected_version: command.version, reason: command.reason }, csrf, idempotencyKey: command.key }, accept);
      case 'revoke-sessions':
        return this.call({ method: 'POST', path: `${base}/revoke-sessions`, body: { reason: command.reason }, csrf, idempotencyKey: command.key }, accept);
      case 'grant':
      case 'revoke':
        return this.call({ method: 'POST', path: `/admin/finance/access/admins/${encodeURIComponent(command.userId)}/${command.name}`, body: { permission_key: command.right, expected_version: command.version }, csrf, idempotencyKey: command.key }, accept);
    }
  }
}

/** The real AccessSource. It keeps nothing: no rows, no versions, no keys. */
export function createAccessSource(api: AdminAccessApi, session?: CsrfPort): AccessSource {
  return {
    async read(): Promise<AccessRead> {
      const result = await api.matrix();
      return result.kind === 'ok' ? { kind: 'ready', matrix: result.data } : failureOf(result);
    },
    async command(command): Promise<CommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return commandResultOf(await api.send(csrf, command), session);
    },
  };
}
