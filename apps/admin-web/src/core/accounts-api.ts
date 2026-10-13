// HTTP client of the read-only account data (M01 account read): GET /v1/admin-auth/permissions, /v1/admin/users,
// /v1/admin/users/:id and /v1/admin/administrators. Cookie-only (HttpOnly session, same origin); nothing is stored here.
// Every answer is parsed strictly: a body that does not have the documented shape is "unknown", never half-shown data.

import {
  AccountsSource,
  AdministratorFilter,
  AdministratorRow,
  Failure,
  GrantsResult,
  LockCommand,
  LockResult,
  PageState,
  UserDetail,
  UserDetailState,
  UserFilter,
  UserRole,
  UserRow,
  UserStatus,
  USER_ROLE_LABEL,
} from './accounts.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { AppPermission, grantsFromPermissions } from './menu.js';

/** The transport's base: this client's paths start with /admin-auth or /admin. */
export const ACCOUNTS_BASE = '/v1';
export const PAGE_SIZE = 20;

const APPS: readonly AppPermission['app'][] = ['CUSTOMER', 'SHOP', 'DRIVER'];
const PUBLIC_ROLES: readonly UserRole[] = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'];
const ROLE_OF_APP: Record<AppPermission['app'], UserRole> = { CUSTOMER: 'CUSTOMER', SHOP: 'SHOP_OWNER', DRIVER: 'DRIVER' };

export interface PermissionsData {
  readonly adminRole: 'SYSTEM' | 'ADMIN';
  readonly permissions: readonly AppPermission[];
}

export interface Page<Row> {
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
}

function permissionOf(value: unknown): AppPermission | undefined {
  const row = record(value);
  if (row === undefined || typeof row.app !== 'string' || !APPS.includes(row.app as AppPermission['app'])) {
    return undefined;
  }
  if (typeof row.can_view !== 'boolean' || typeof row.can_review_profile !== 'boolean' || typeof row.can_lock !== 'boolean') {
    return undefined;
  }
  return { app: row.app as AppPermission['app'], canView: row.can_view, canReviewProfile: row.can_review_profile, canLock: row.can_lock };
}

function permissionList(value: unknown): readonly AppPermission[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows: AppPermission[] = [];
  for (const item of value) {
    const row = permissionOf(item);
    if (row === undefined || rows.some((known) => known.app === row.app)) {
      return undefined;
    }
    rows.push(row);
  }
  return rows;
}

function isoOf(value: unknown): string | undefined {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function summaryOf(data: Record<string, unknown>): UserRow | undefined {
  const id = str(data.user_id);
  const phoneMasked = str(data.phone_masked);
  const createdAt = isoOf(data.created_at);
  const name = data.display_name;
  if (id === undefined || phoneMasked === undefined || createdAt === undefined || (name !== null && typeof name !== 'string')) {
    return undefined;
  }
  if (!Array.isArray(data.roles_visible) || !data.roles_visible.every((role) => typeof role === 'string' && PUBLIC_ROLES.includes(role as UserRole))) {
    return undefined;
  }
  const status: UserStatus | undefined = data.account_status === 'ACTIVE' ? 'ACTIVE' : data.account_status === 'DISABLED' ? 'LOCKED' : undefined;
  if (status === undefined) {
    return undefined;
  }
  return { id, fullName: name === '' ? null : name, phoneMasked, roles: data.roles_visible as UserRole[], status, createdAt };
}

function cursorOf(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' && value.length > 0 && value.length <= 600 ? value : undefined;
}

export type UserPage = Page<UserRow> & { readonly roleFilters: readonly UserRole[] };

export function parseUserPage(data: Record<string, unknown>): UserPage | undefined {
  const nextCursor = cursorOf(data.next_cursor);
  if (!Array.isArray(data.items) || nextCursor === undefined || !Array.isArray(data.available_role_filters)) {
    return undefined;
  }
  const roleFilters = data.available_role_filters.filter((role): role is UserRole => typeof role === 'string' && PUBLIC_ROLES.includes(role as UserRole));
  const items: UserRow[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const row = raw === undefined ? undefined : summaryOf(raw);
    if (row === undefined) {
      return undefined;
    }
    items.push(row);
  }
  return { items, nextCursor, roleFilters };
}

export function parseUserDetail(data: Record<string, unknown>): UserDetail | undefined {
  const base = summaryOf(data);
  const version = data.version;
  const profiles = record(data.profiles);
  if (base === undefined || typeof version !== 'number' || !Number.isSafeInteger(version) || profiles === undefined || isoOf(data.updated_at) === undefined) {
    return undefined;
  }
  const actions = allowedActionsOf(data.allowed_actions);
  if (actions === undefined) {
    return undefined;
  }
  const customer = profiles.customer === undefined ? undefined : record(profiles.customer);
  const shop = profiles.shop === undefined ? undefined : record(profiles.shop);
  const driver = profiles.driver === undefined ? undefined : record(profiles.driver);
  if ((profiles.customer !== undefined && customer === undefined) || (profiles.shop !== undefined && shop === undefined) || (profiles.driver !== undefined && driver === undefined)) {
    return undefined;
  }
  const customerName = customer?.full_name;
  const shopName = shop?.name;
  if ((customerName !== undefined && customerName !== null && typeof customerName !== 'string') || (shopName !== undefined && shopName !== null && typeof shopName !== 'string')) {
    return undefined;
  }
  if ((shop !== undefined && str(shop.status) === undefined) || (driver !== undefined && str(driver.status) === undefined)) {
    return undefined;
  }
  return {
    ...base,
    version,
    profile: {
      ...(customer === undefined ? {} : { customer: { fullName: typeof customerName === 'string' && customerName !== '' ? customerName : null } }),
      ...(shop === undefined ? {} : { shop: { name: typeof shopName === 'string' && shopName !== '' ? shopName : null, state: str(shop.status) as string } }),
      ...(driver === undefined ? {} : { driver: { state: str(driver.status) as string } }),
    },
    // No timeline yet: the page shows nothing it did not receive. The actions are exactly what the server allows right now.
    events: [],
    allowedActions: actions,
  };
}

/** [] | ["LOCK"] | ["UNLOCK"]; anything else is not the documented shape. */
function allowedActionsOf(value: unknown): readonly ('LOCK' | 'UNLOCK')[] | undefined {
  if (!Array.isArray(value) || value.length > 1) {
    return undefined;
  }
  if (value.length === 0) {
    return [];
  }
  return value[0] === 'LOCK' || value[0] === 'UNLOCK' ? [value[0]] : undefined;
}

const RIGHT_LABEL: readonly (readonly [keyof Pick<AppPermission, 'canView' | 'canReviewProfile' | 'canLock'>, string])[] = [
  ['canView', 'Xem'],
  ['canReviewProfile', 'Duyệt hồ sơ'],
  ['canLock', 'Khóa'],
];

/** "Khách hàng: Xem, Khóa" per app that has at least one right; "Chưa cấp quyền" when none. */
export function scopeLabels(permissions: readonly AppPermission[]): readonly string[] {
  const labels: string[] = [];
  for (const row of permissions) {
    const rights = RIGHT_LABEL.filter(([key]) => row[key]).map(([, label]) => label);
    if (rights.length > 0) {
      labels.push(`${USER_ROLE_LABEL[ROLE_OF_APP[row.app]]}: ${rights.join(', ')}`);
    }
  }
  return labels.length > 0 ? labels : ['Chưa cấp quyền'];
}

export function parseAdministratorPage(data: Record<string, unknown>): Page<AdministratorRow> | undefined {
  const nextCursor = cursorOf(data.next_cursor);
  if (!Array.isArray(data.items) || nextCursor === undefined) {
    return undefined;
  }
  const items: AdministratorRow[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const id = str(raw?.user_id);
    const fullName = str(raw?.full_name);
    const phoneMasked = str(raw?.phone_masked);
    const createdAt = isoOf(raw?.created_at);
    const permissions = permissionList(raw?.permissions);
    const status = raw?.status === 'ACTIVE' ? 'ACTIVE' : raw?.status === 'DISABLED' ? 'LOCKED' : undefined;
    if (raw === undefined || raw.admin_role !== 'ADMIN' || id === undefined || fullName === undefined || phoneMasked === undefined || createdAt === undefined || permissions === undefined || status === undefined) {
      return undefined;
    }
    items.push({ id, fullName, phoneMasked, scopes: scopeLabels(permissions), status, createdAt });
  }
  return { items, nextCursor };
}

export function parsePermissions(data: Record<string, unknown>): PermissionsData | undefined {
  const permissions = permissionList(data.permissions);
  if (permissions === undefined || (data.admin_role !== 'SYSTEM' && data.admin_role !== 'ADMIN')) {
    return undefined;
  }
  return { adminRole: data.admin_role, permissions };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export interface LockAcknowledgement {
  readonly userId: string;
  readonly accountStatus: 'ACTIVE' | 'DISABLED';
  readonly version: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** {command_id, user_id, account_status, version, changed_at}: an acknowledgement of the intent, not the current state. */
export function parseLockAcknowledgement(data: Record<string, unknown>): LockAcknowledgement | undefined {
  const userId = str(data.user_id);
  const commandId = str(data.command_id);
  const version = data.version;
  if (
    userId === undefined ||
    commandId === undefined ||
    !UUID_RE.test(commandId) ||
    (data.account_status !== 'ACTIVE' && data.account_status !== 'DISABLED') ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    isoOf(data.changed_at) === undefined
  ) {
    return undefined;
  }
  return { userId, accountStatus: data.account_status, version };
}

/** The CSRF token of the shell session (from memory) and the way to read a fresh one. */
export interface CsrfPort {
  csrf(): string | undefined;
  refresh(): Promise<boolean>;
}

export class AdminAccountsApi extends ApiClient {
  permissions(): Promise<ApiResult<PermissionsData>> {
    return this.call({ method: 'GET', path: '/admin-auth/permissions' }, parsePermissions);
  }

  users(filter: UserFilter, cursor: string | null): Promise<ApiResult<UserPage>> {
    const path = `/admin/users${query({
      q: filter.query.trim(),
      role: filter.role === 'ALL' ? undefined : filter.role,
      status: filter.status === 'ALL' ? undefined : filter.status === 'LOCKED' ? 'DISABLED' : 'ACTIVE',
      limit: String(PAGE_SIZE),
      cursor: cursor ?? undefined,
    })}`;
    return this.call({ method: 'GET', path }, parseUserPage);
  }

  user(id: string): Promise<ApiResult<UserDetail>> {
    return this.call({ method: 'GET', path: `/admin/users/${encodeURIComponent(id)}` }, parseUserDetail);
  }

  /** POST /v1/admin/users/:id/lock|unlock. One request; the caller owns the key and never repeats the call by itself. */
  changeLock(csrf: string, command: LockCommand): Promise<ApiResult<LockAcknowledgement>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/users/${encodeURIComponent(command.id)}/${command.action === 'LOCK' ? 'lock' : 'unlock'}`,
        body: { expected_version: command.version, reason: command.reason },
        csrf,
        idempotencyKey: command.key,
      },
      parseLockAcknowledgement,
    );
  }

  administrators(filter: AdministratorFilter, cursor: string | null): Promise<ApiResult<Page<AdministratorRow>>> {
    const path = `/admin/administrators${query({
      q: filter.query.trim(),
      status: filter.status === 'ALL' || filter.status === 'PENDING' ? undefined : filter.status === 'LOCKED' ? 'DISABLED' : 'ACTIVE',
      limit: String(PAGE_SIZE),
      cursor: cursor ?? undefined,
    })}`;
    return this.call({ method: 'GET', path }, parseAdministratorPage);
  }
}

type Failed = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/** Why a call did not give data. A lost answer is "offline": reading again is always safe. */
export function failureOf(result: Exclude<ApiResult<unknown>, { kind: 'ok' }>): Failed {
  if (result.kind === 'network') {
    return { kind: 'failed', failure: 'offline' };
  }
  switch (result.status) {
    case 401:
      return { kind: 'failed', failure: 'session-expired' };
    case 403:
      return { kind: 'failed', failure: 'forbidden' };
    case 429:
      return { kind: 'failed', failure: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return { kind: 'failed', failure: 'unknown' };
  }
}

function pageState<Row>(items: readonly Row[], nextCursor: string | null): PageState<Row> {
  return items.length === 0 ? { kind: 'empty' } : { kind: 'rows', rows: items, nextCursor };
}

const isCursorInvalid = (result: Exclude<ApiResult<unknown>, { kind: 'ok' }>, cursor: string | null): boolean =>
  cursor !== null && result.kind === 'error' && result.status === 400 && result.code === 'ADMIN_INPUT_INVALID';

/** The real AccountsSource over the read-only endpoints. It keeps nothing: no rows, no cursor, no grants. */
export function createAccountsSource(api: AdminAccountsApi, session?: CsrfPort): AccountsSource {
  return {
    async lock(command): Promise<LockResult> {
      const csrf = session?.csrf();
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.changeLock(csrf, command);
      if (result.kind === 'ok') {
        return { kind: 'ok' };
      }
      // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the command may have been executed.
      if (result.kind === 'network' || result.status >= 500) {
        return { kind: 'unknown' };
      }
      switch (result.code) {
        case 'ADMIN_CSRF_INVALID':
          // Refused before anything ran; a fresh token is read and the admin retries with the SAME key.
          await session.refresh();
          return { kind: 'unknown' };
        case 'ADMIN_SESSION_INVALID':
          return { kind: 'session-expired' };
        case 'ADMIN_FORBIDDEN':
          return { kind: 'forbidden' };
        case 'USER_NOT_AVAILABLE':
          return { kind: 'not-found' };
        case 'USER_ACCOUNT_VERSION_CONFLICT':
        case 'USER_ACCOUNT_ALREADY_IN_STATE':
          return { kind: 'conflict' };
        case 'USER_ACCOUNT_IMPACT_REVIEW_REQUIRED':
          return { kind: 'review-required' };
        case 'IDEMPOTENCY_BUSY':
          // The same key is still being processed: asking again with it is exactly right.
          return { kind: 'unknown' };
        case 'ADMIN_AUTH_RATE_LIMITED':
          return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
        default:
          return { kind: 'rejected' };
      }
    },
    async grants(): Promise<GrantsResult> {
      const result = await api.permissions();
      if (result.kind !== 'ok') {
        return failureOf(result);
      }
      const { permissions } = result.data;
      const roles = APPS.filter((app) => permissions.some((row) => row.app === app && row.canView)).map((app) => ROLE_OF_APP[app]);
      return { kind: 'ok', grants: grantsFromPermissions(permissions), roles };
    },
    async users(filter, cursor) {
      const result = await api.users(filter, cursor);
      if (result.kind !== 'ok') {
        return isCursorInvalid(result, cursor) ? { kind: 'cursor-invalid' } : failureOf(result);
      }
      return pageState(result.data.items, result.data.nextCursor);
    },
    async user(id) {
      const result = await api.user(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', user: result.data } satisfies UserDetailState;
      }
      if (result.kind === 'error' && result.status === 404 && result.code === 'USER_NOT_AVAILABLE') {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async administrators(filter, cursor) {
      const result = await api.administrators(filter, cursor);
      if (result.kind !== 'ok') {
        return isCursorInvalid(result, cursor) ? { kind: 'cursor-invalid' } : failureOf(result);
      }
      return pageState(result.data.items, result.data.nextCursor);
    },
  };
}
