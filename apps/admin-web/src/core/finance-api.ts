// HTTP client of the finance routes of the administration (M04-B3a): /v1/admin/finance/{access,topup-requests,topup-receiving-accounts,bank-accounts}.
// Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the
// documented shape is "no usable answer", never half-shown data. Nothing is stored here: no row, no version, no key, no account number.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  AccessCommand,
  AdminFinanceAccess,
  AdminFinancePermission,
  ConfirmCommand,
  CreateAccountCommand,
  FinanceAdminSource,
  FinanceOutcome,
  FinancePermissionKey,
  FinanceRead,
  FinanceRights,
  FINANCE_PERMISSIONS,
  GrantState,
  ReceivingAccount,
  ReceivingCommand,
  RejectCommand,
  SystemAccount,
  TopupFilter,
  TopupItem,
  TopupPage,
  TopupState,
  TOPUP_PAGE_SIZE,
  TOPUP_STATES,
} from './finance-admin.js';

export const FINANCE_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && UUID_RE.test(text) ? text : undefined;
};
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableWhole = (value: unknown): number | null | undefined => (value === null ? null : whole(value) ? value : undefined);

export function parseRights(data: Record<string, unknown>): FinanceRights | undefined {
  if ((data.role !== 'SYSTEM' && data.role !== 'ADMIN') || typeof data.implicit !== 'boolean' || !Array.isArray(data.permissions)) {
    return undefined;
  }
  const held = new Set<string>();
  for (const entry of data.permissions) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    held.add(entry);
  }
  // SYSTEM has every right implicitly; an ADMIN only the ones listed. Unknown keys are ignored: they open nothing.
  const every = data.role === 'SYSTEM' && data.implicit;
  return {
    role: data.role,
    implicit: data.implicit,
    canRead: every || held.has('wallet.read'),
    canRecord: every || held.has('wallet.topup.record'),
    canProcess: every || held.has('wallet.withdrawal.process'),
    canConfirm: every || held.has('wallet.withdrawal.confirm'),
    canReconcile: every || held.has('wallet.withdrawal.reconcile'),
  };
}

export function parseTopup(value: unknown): TopupItem | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const requestId = uuid(raw.request_id);
  const driverId = uuid(raw.driver_id);
  const createdAt = iso(raw.created_at);
  const resolvedAt = nullableIso(raw.resolved_at);
  const receivedAt = nullableIso(raw.received_at);
  const actual = nullableWhole(raw.actual_amount_vnd);
  if (
    requestId === undefined || driverId === undefined || createdAt === undefined || resolvedAt === undefined || receivedAt === undefined || actual === undefined ||
    !whole(raw.amount_requested_vnd) || raw.amount_requested_vnd < 1 || !whole(raw.version) || raw.version < 1 ||
    typeof raw.state !== 'string' || !(TOPUP_STATES as readonly string[]).includes(raw.state)
  ) {
    return undefined;
  }
  return { requestId, driverId, requestedVnd: raw.amount_requested_vnd, actualVnd: actual, state: raw.state as TopupState, version: raw.version, createdAt, resolvedAt, receivedAt };
}

export function parseTopupPage(data: Record<string, unknown>): TopupPage | undefined {
  const next = data.next_cursor === null ? null : str(data.next_cursor);
  if (!Array.isArray(data.items) || next === undefined) {
    return undefined;
  }
  const items: TopupItem[] = [];
  for (const entry of data.items) {
    const item = parseTopup(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { items, nextCursor: next };
}

export function parseReceivingAccounts(data: Record<string, unknown>): readonly ReceivingAccount[] | undefined {
  if (!Array.isArray(data.accounts)) {
    return undefined;
  }
  const accounts: ReceivingAccount[] = [];
  for (const entry of data.accounts) {
    const raw = record(entry);
    const accountId = uuid(raw?.account_id);
    const bankId = str(raw?.bank_id);
    const masked = str(raw?.account_number_masked);
    if (raw === undefined || accountId === undefined || bankId === undefined || masked === undefined || typeof raw.can_receive !== 'boolean') {
      return undefined;
    }
    accounts.push({ accountId, bankId, numberMasked: masked, canReceive: raw.can_receive });
  }
  return accounts;
}

function parseSystemAccount(value: unknown): SystemAccount | undefined {
  const raw = record(value);
  const accountId = uuid(raw?.account_id);
  const bankId = str(raw?.bank_id);
  const accountNumber = str(raw?.account_number);
  const accountHolder = str(raw?.account_holder);
  const createdAt = iso(raw?.created_at);
  if (raw === undefined || accountId === undefined || bankId === undefined || accountNumber === undefined || accountHolder === undefined || createdAt === undefined || typeof raw.can_receive !== 'boolean' || !whole(raw.version) || raw.version < 1) {
    return undefined;
  }
  return { accountId, bankId, accountNumber, accountHolder, canReceive: raw.can_receive, version: raw.version, createdAt };
}

export function parseSystemAccounts(data: Record<string, unknown>): readonly SystemAccount[] | undefined {
  if (!Array.isArray(data.accounts)) {
    return undefined;
  }
  const accounts: SystemAccount[] = [];
  for (const entry of data.accounts) {
    const account = parseSystemAccount(entry);
    if (account === undefined) {
      return undefined;
    }
    accounts.push(account);
  }
  return accounts;
}

export function parseAdminAccess(data: Record<string, unknown>): AdminFinanceAccess | undefined {
  const userId = uuid(data.user_id);
  if (userId === undefined || !Array.isArray(data.permissions)) {
    return undefined;
  }
  const permissions: AdminFinancePermission[] = [];
  for (const entry of data.permissions) {
    const raw = record(entry);
    const grantedAt = nullableIso(raw?.granted_at);
    const revokedAt = nullableIso(raw?.revoked_at);
    if (
      raw === undefined || typeof raw.permission_key !== 'string' || !(FINANCE_PERMISSIONS as readonly string[]).includes(raw.permission_key) ||
      (raw.state !== 'NONE' && raw.state !== 'GRANTED' && raw.state !== 'REVOKED') || !whole(raw.version) || grantedAt === undefined || revokedAt === undefined
    ) {
      return undefined;
    }
    permissions.push({ key: raw.permission_key as FinancePermissionKey, state: raw.state as GrantState, version: raw.version, grantedAt, revokedAt });
  }
  return { userId, permissions };
}

/** Anything the server answers with a body we only need to know arrived (the page reads the state again afterwards). */
const anyData = (data: Record<string, unknown>): Record<string, unknown> => data;

const query = (values: Record<string, string | undefined>): string => {
  const parts = Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

export class AdminFinanceApi extends ApiClient {
  rights(): Promise<ApiResult<FinanceRights>> {
    return this.call({ method: 'GET', path: '/admin/finance/access/me' }, parseRights);
  }
  topups(filter: TopupFilter, cursor: string | null): Promise<ApiResult<TopupPage>> {
    return this.call({ method: 'GET', path: `/admin/finance/topup-requests${query({ status: filter === 'ALL' ? undefined : filter, limit: String(TOPUP_PAGE_SIZE), cursor: cursor ?? undefined })}` }, parseTopupPage);
  }
  topup(id: string): Promise<ApiResult<TopupItem>> {
    return this.call({ method: 'GET', path: `/admin/finance/topup-requests/${encodeURIComponent(id)}` }, (data) => parseTopup(data));
  }
  receivingAccounts(): Promise<ApiResult<readonly ReceivingAccount[]>> {
    return this.call({ method: 'GET', path: '/admin/finance/topup-receiving-accounts' }, parseReceivingAccounts);
  }
  /** One request; the caller owns the key and never repeats the call with another one. */
  confirm(csrf: string, command: ConfirmCommand): Promise<ApiResult<unknown>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/finance/topup-requests/${encodeURIComponent(command.requestId)}/confirm`,
        body: {
          expected_version: command.version,
          actual_amount_vnd: command.actualVnd,
          bank_id: command.bankId,
          system_owned_account_id: command.accountId,
          canonical_transaction_id: command.transactionId,
          received_at: command.receivedAt,
        },
        csrf,
        idempotencyKey: command.key,
      },
      anyData,
    );
  }
  reject(csrf: string, command: RejectCommand): Promise<ApiResult<unknown>> {
    return this.call(
      { method: 'POST', path: `/admin/finance/topup-requests/${encodeURIComponent(command.requestId)}/reject`, body: { expected_version: command.version, reason_code: command.reason }, csrf, idempotencyKey: command.key },
      anyData,
    );
  }
  systemAccounts(): Promise<ApiResult<readonly SystemAccount[]>> {
    return this.call({ method: 'GET', path: '/admin/finance/bank-accounts' }, parseSystemAccounts);
  }
  createAccount(csrf: string, command: CreateAccountCommand): Promise<ApiResult<unknown>> {
    return this.call(
      { method: 'POST', path: '/admin/finance/bank-accounts', body: { bank_id: command.bankId, account_number: command.accountNumber, account_holder: command.accountHolder }, csrf, idempotencyKey: command.key },
      anyData,
      [200, 201],
    );
  }
  setReceiving(csrf: string, command: ReceivingCommand): Promise<ApiResult<unknown>> {
    return this.call(
      { method: 'POST', path: `/admin/finance/bank-accounts/${encodeURIComponent(command.accountId)}/receiving`, body: { expected_version: command.version, can_receive: command.canReceive }, csrf, idempotencyKey: command.key },
      anyData,
    );
  }
  adminAccess(userId: string): Promise<ApiResult<AdminFinanceAccess>> {
    return this.call({ method: 'GET', path: `/admin/finance/access/admins/${encodeURIComponent(userId)}` }, parseAdminAccess);
  }
  changeAccess(csrf: string, command: AccessCommand): Promise<ApiResult<unknown>> {
    return this.call(
      { method: 'POST', path: `/admin/finance/access/admins/${encodeURIComponent(command.userId)}/${command.action}`, body: { permission_key: command.permission, expected_version: command.version }, csrf, idempotencyKey: command.key },
      anyData,
    );
  }
}

/** Codes that mean "the server looked at it and said the state is not what you saw": nothing changed, the page reloads and says so. */
const CONFLICTS: readonly string[] = [
  'VERSION_CONFLICT',
  'TOPUP_REQUEST_STATE_CONFLICT',
  'BANK_TRANSACTION_ALREADY_RECORDED',
  'TOPUP_ACCOUNT_NOT_RECEIVING',
  'TOPUP_WALLET_LIMIT_EXCEEDED',
  'DRIVER_STATE_CONFLICT',
  'FINANCE_VERSION_CONFLICT',
  'FINANCE_GRANT_STATE_CONFLICT',
  'FINANCE_BANK_ACCOUNT_STATE_CONFLICT',
  'FINANCE_BANK_ACCOUNT_EXISTS',
  'WITHDRAWAL_STATE_CONFLICT',
  'BANK_SNAPSHOT_STALE',
  'COMMISSION_POLICY_VERSION_CONFLICT',
];

export async function outcomeOf(result: ApiResult<unknown>, session: CsrfPort): Promise<FinanceOutcome> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the command may have been executed.
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (CONFLICTS.includes(result.code)) {
    return { kind: 'conflict', code: result.code };
  }
  switch (result.code) {
    case 'ADMIN_CSRF_INVALID':
      // Refused before anything ran; a fresh token is read and the Admin sends the SAME command again with the SAME key.
      await session.refresh();
      return { kind: 'unknown' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
      return { kind: 'forbidden' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return { kind: 'refused', code: result.code };
  }
}

export function readOf<T>(result: ApiResult<T>): FinanceRead<T> {
  if (result.kind === 'ok') {
    return { kind: 'ready', data: result.data };
  }
  if (result.kind === 'error' && result.status === 404) {
    return { kind: 'not-found' };
  }
  return failureOf(result);
}

/** The real FinanceAdminSource. It keeps nothing: no rows, no versions, no keys, no account numbers. */
export function createFinanceAdminSource(api: AdminFinanceApi, session: CsrfPort): FinanceAdminSource {
  const send = async (call: (csrf: string) => Promise<ApiResult<unknown>>): Promise<FinanceOutcome> => {
    const csrf = session.csrf();
    if (csrf === undefined) {
      return { kind: 'session-expired' };
    }
    return outcomeOf(await call(csrf), session);
  };
  return {
    rights: async () => readOf(await api.rights()),
    topups: async (filter, cursor) => readOf(await api.topups(filter, cursor)),
    topup: async (id) => readOf(await api.topup(id)),
    receivingAccounts: async () => readOf(await api.receivingAccounts()),
    confirm: (command) => send((csrf) => api.confirm(csrf, command)),
    reject: (command) => send((csrf) => api.reject(csrf, command)),
    systemAccounts: async () => readOf(await api.systemAccounts()),
    createAccount: (command) => send((csrf) => api.createAccount(csrf, command)),
    setReceiving: (command) => send((csrf) => api.setReceiving(csrf, command)),
    adminAccess: async (userId) => readOf(await api.adminAccess(userId)),
    changeAccess: (command) => send((csrf) => api.changeAccess(csrf, command)),
  };
}
