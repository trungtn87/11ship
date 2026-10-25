// HTTP client of "Thanh toán quán" (issue #198): /v1/admin/shop-payments (queue, detail, confirm, reject, receiving accounts) and
// /v1/admin/shop-payments/shops/:id/menu-expanded/grant|revoke. Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is
// parsed strictly: a body without the documented shape is "no usable answer", never half-shown data. Nothing is stored: no row, no version, no key.

import { CsrfPort } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { ConfirmCommand, FinanceOutcome, ReceivingAccount, RejectCommand } from './finance-admin.js';
import { outcomeOf, readOf } from './finance-api.js';
import {
  EntitlementEvent,
  GrantCommand,
  RevokeCommand,
  SHOP_PAYMENT_PAGE_SIZE,
  SHOP_PAYMENT_PURPOSES,
  SHOP_PAYMENT_STATES,
  ShopPaymentDetail,
  ShopPaymentFilter,
  ShopPaymentItem,
  ShopPaymentPage,
  ShopPaymentPurpose,
  ShopPaymentSource,
  ShopPaymentState,
  ShopSettlement,
} from './shop-payments.js';

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

export function parseItem(value: unknown): ShopPaymentItem | undefined {
  const raw = record(value);
  const shop = record(raw?.shop);
  const requestId = uuid(raw?.request_id);
  const shopId = uuid(shop?.shop_id);
  const createdAt = iso(raw?.created_at);
  const reportedAt = nullableIso(raw?.reported_at);
  const resolvedAt = nullableIso(raw?.resolved_at);
  if (
    raw === undefined || shop === undefined || requestId === undefined || shopId === undefined || typeof shop.name !== 'string' || createdAt === undefined || reportedAt === undefined || resolvedAt === undefined ||
    typeof raw.purpose !== 'string' || !(SHOP_PAYMENT_PURPOSES as readonly string[]).includes(raw.purpose) || typeof raw.state !== 'string' || !(SHOP_PAYMENT_STATES as readonly string[]).includes(raw.state) ||
    !whole(raw.amount_requested_vnd) || raw.amount_requested_vnd < 1 || !whole(raw.version) || raw.version < 1 || (raw.reject_reason_code !== null && typeof raw.reject_reason_code !== 'string')
  ) {
    return undefined;
  }
  return {
    requestId,
    shopId,
    shopName: shop.name,
    purpose: raw.purpose as ShopPaymentPurpose,
    requestedVnd: raw.amount_requested_vnd,
    state: raw.state as ShopPaymentState,
    rejectReason: raw.reject_reason_code,
    version: raw.version,
    createdAt,
    reportedAt,
    resolvedAt,
  };
}

export function parsePage(data: Record<string, unknown>): ShopPaymentPage | undefined {
  const next = data.next_cursor === null ? null : str(data.next_cursor);
  if (!Array.isArray(data.items) || next === undefined) {
    return undefined;
  }
  const items: ShopPaymentItem[] = [];
  for (const entry of data.items) {
    const item = parseItem(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { items, nextCursor: next };
}

function parseSettlement(value: unknown): ShopSettlement | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  const receivedAt = iso(raw?.received_at);
  const recordedAt = iso(raw?.recorded_at);
  if (raw === undefined || typeof raw.bank_id !== 'string' || typeof raw.canonical_transaction_id !== 'string' || !whole(raw.amount_vnd) || receivedAt === undefined || recordedAt === undefined) {
    return undefined;
  }
  return { bankId: raw.bank_id, transactionId: raw.canonical_transaction_id, amountVnd: raw.amount_vnd, receivedAt, recordedAt };
}

function parseHistory(value: unknown): EntitlementEvent[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: EntitlementEvent[] = [];
  for (const entry of value) {
    const raw = record(entry);
    const at = iso(raw?.at);
    if (raw === undefined || (raw.action !== 'GRANT' && raw.action !== 'REVOKE') || typeof raw.reason !== 'string' || at === undefined || (raw.payment_request_id !== null && uuid(raw.payment_request_id) === undefined)) {
      return undefined;
    }
    out.push({ action: raw.action, reason: raw.reason, at, paymentRequestId: raw.payment_request_id === null ? null : (raw.payment_request_id as string) });
  }
  return out;
}

export function parseDetail(data: Record<string, unknown>): ShopPaymentDetail | undefined {
  const item = parseItem(data);
  const shop = record(data.shop);
  const settlement = parseSettlement(data.settlement);
  const history = parseHistory(data.entitlement_history);
  const since = nullableIso(data.menu_expanded_since);
  if (
    item === undefined || shop === undefined || typeof shop.status !== 'string' || settlement === undefined || history === undefined || since === undefined || typeof data.menu_expanded !== 'boolean' || !whole(data.visible_count) ||
    (data.visible_limit !== null && !whole(data.visible_limit)) || typeof data.over_limit !== 'boolean' || typeof data.may_record !== 'boolean' || typeof data.may_manage !== 'boolean'
  ) {
    return undefined;
  }
  return {
    ...item,
    shopStatus: shop.status,
    settlement,
    grantedByThisPayment: data.entitlement !== null && data.entitlement !== undefined,
    menuExpanded: data.menu_expanded,
    menuExpandedSince: since,
    visibleCount: data.visible_count,
    visibleLimit: data.visible_limit,
    overLimit: data.over_limit,
    history,
    mayRecord: data.may_record,
    mayManage: data.may_manage,
  };
}

export function parseAccounts(data: Record<string, unknown>): readonly ReceivingAccount[] | undefined {
  if (!Array.isArray(data.accounts)) {
    return undefined;
  }
  const accounts: ReceivingAccount[] = [];
  for (const entry of data.accounts) {
    const raw = record(entry);
    const accountId = uuid(raw?.account_id);
    if (raw === undefined || accountId === undefined || typeof raw.bank_id !== 'string' || typeof raw.account_number_masked !== 'string' || typeof raw.can_receive !== 'boolean') {
      return undefined;
    }
    accounts.push({ accountId, bankId: raw.bank_id, numberMasked: raw.account_number_masked, canReceive: raw.can_receive });
  }
  return accounts;
}

const query = (values: Record<string, string | undefined>): string => {
  const parts = Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

/** The filters of the queue as the server's own switches: one state and/or "reported". */
function serverFilter(filter: ShopPaymentFilter): { status?: string; reported?: string } {
  switch (filter) {
    case 'CHECK':
      return { status: 'PENDING', reported: 'true' };
    case 'NOT_REPORTED':
      return { status: 'PENDING', reported: 'false' };
    case 'ALL':
      return {};
    default:
      return { status: filter };
  }
}

export class AdminShopPaymentApi extends ApiClient {
  list(filter: ShopPaymentFilter, cursor: string | null): Promise<ApiResult<ShopPaymentPage>> {
    return this.call({ method: 'GET', path: `/admin/shop-payments${query({ ...serverFilter(filter), limit: String(SHOP_PAYMENT_PAGE_SIZE), cursor: cursor ?? undefined })}` }, parsePage);
  }
  detail(id: string): Promise<ApiResult<ShopPaymentDetail>> {
    return this.call({ method: 'GET', path: `/admin/shop-payments/${encodeURIComponent(id)}` }, parseDetail);
  }
  accounts(): Promise<ApiResult<readonly ReceivingAccount[]>> {
    return this.call({ method: 'GET', path: '/admin/shop-payments/receiving-accounts' }, parseAccounts);
  }
  confirm(csrf: string, c: ConfirmCommand): Promise<ApiResult<unknown>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/shop-payments/${encodeURIComponent(c.requestId)}/confirm`,
        body: { expected_version: c.version, actual_amount_vnd: c.actualVnd, bank_id: c.bankId, system_owned_account_id: c.accountId, canonical_transaction_id: c.transactionId, received_at: c.receivedAt },
        csrf,
        idempotencyKey: c.key,
      },
      (data) => data,
    );
  }
  reject(csrf: string, c: RejectCommand): Promise<ApiResult<unknown>> {
    return this.call({ method: 'POST', path: `/admin/shop-payments/${encodeURIComponent(c.requestId)}/reject`, body: { expected_version: c.version, reason_code: c.reason }, csrf, idempotencyKey: c.key }, (data) => data);
  }
  grant(csrf: string, c: GrantCommand): Promise<ApiResult<unknown>> {
    return this.call({ method: 'POST', path: `/admin/shop-payments/shops/${encodeURIComponent(c.shopId)}/menu-expanded/grant`, body: { reason: c.reason, payment_request_id: c.paymentRequestId }, csrf, idempotencyKey: c.key }, (data) => data);
  }
  revoke(csrf: string, c: RevokeCommand): Promise<ApiResult<unknown>> {
    return this.call({ method: 'POST', path: `/admin/shop-payments/shops/${encodeURIComponent(c.shopId)}/menu-expanded/revoke`, body: { reason: c.reason }, csrf, idempotencyKey: c.key }, (data) => data);
  }
}

/** The real ShopPaymentSource. It keeps nothing: no rows, no versions, no keys, no account numbers. */
export function createShopPaymentSource(api: AdminShopPaymentApi, session: CsrfPort): ShopPaymentSource {
  const send = async (call: (csrf: string) => Promise<ApiResult<unknown>>): Promise<FinanceOutcome> => {
    const csrf = session.csrf();
    if (csrf === undefined) {
      return { kind: 'session-expired' };
    }
    return outcomeOf(await call(csrf), session);
  };
  return {
    list: async (filter, cursor) => readOf(await api.list(filter, cursor)),
    detail: async (id) => readOf(await api.detail(id)),
    receivingAccounts: async () => readOf(await api.accounts()),
    confirm: (command) => send((csrf) => api.confirm(csrf, command)),
    reject: (command) => send((csrf) => api.reject(csrf, command)),
    grant: (command) => send((csrf) => api.grant(csrf, command)),
    revoke: (command) => send((csrf) => api.revoke(csrf, command)),
  };
}
