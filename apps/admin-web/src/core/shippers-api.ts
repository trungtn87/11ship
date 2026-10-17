// HTTP client of Shipper management (M03): GET /v1/admin/shippers (list), GET /v1/admin/shippers/:id (detail), one POST per command and
// the SYSTEM-only wallet parameters. Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is
// parsed strictly: a body that does not have the documented shape is "unknown", never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  BankState,
  DriverStatus,
  DriverType,
  ReviewState,
  ShipperBankInfo,
  ShipperCommandRequest,
  ShipperCommandResult,
  ShipperDetail,
  ShipperDetailRead,
  ShipperEvent,
  ShipperListRead,
  ShipperQuery,
  ShipperRow,
  ShipperSource,
  SHIPPER_PAGE_SIZE,
  WalletParameterChange,
  WalletParameters,
  WalletRead,
  WalletSaveCommand,
} from './shippers.js';

/** The transport's base: this client's paths start with /admin. */
export const SHIPPERS_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly string[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'];
const REVIEW_STATES: readonly string[] = ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'];
const BANK_STATES: readonly string[] = ['UNVERIFIED', 'VERIFIED', 'REJECTED'];
const TYPES: readonly string[] = ['EXTERNAL', 'PLATFORM'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));

export function parseRow(value: unknown): ShipperRow | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const id = str(raw.driver_id);
  const code = str(raw.shipper_code);
  const name = str(raw.full_name);
  const phone = str(raw.phone);
  const updatedAt = iso(raw.updated_at);
  const bankState = raw.bank_state === null ? null : typeof raw.bank_state === 'string' && BANK_STATES.includes(raw.bank_state) ? (raw.bank_state as BankState) : undefined;
  const bankName = nullableStr(raw.bank_name);
  if (
    id === undefined || !UUID_RE.test(id) || code === undefined || name === undefined || phone === undefined || updatedAt === undefined ||
    typeof raw.driver_type !== 'string' || !TYPES.includes(raw.driver_type) ||
    typeof raw.status !== 'string' || !STATUSES.includes(raw.status) ||
    typeof raw.review_state !== 'string' || !REVIEW_STATES.includes(raw.review_state) ||
    typeof raw.accepting_deliveries !== 'boolean' || bankState === undefined || bankName === undefined
  ) {
    return undefined;
  }
  return {
    id, code, fullName: name, phone, driverType: raw.driver_type as DriverType, status: raw.status as DriverStatus, reviewState: raw.review_state as ReviewState,
    accepting: raw.accepting_deliveries, bankState, bankName, updatedAt,
  };
}

function parseBank(value: unknown): ShipperBankInfo | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const bankCode = str(raw.bank_code);
  const bankName = str(raw.bank_name);
  const accountNumber = str(raw.account_number);
  const accountHolder = str(raw.account_holder);
  const rejectionReason = nullableStr(raw.rejection_reason);
  const verifiedAt = nullableIso(raw.verified_at);
  if (
    bankCode === undefined || bankName === undefined || accountNumber === undefined || accountHolder === undefined || rejectionReason === undefined || verifiedAt === undefined ||
    typeof raw.verification_state !== 'string' || !BANK_STATES.includes(raw.verification_state)
  ) {
    return undefined;
  }
  return { bankCode, bankName, accountNumber, accountHolder, state: raw.verification_state as BankState, rejectionReason, verifiedAt };
}

function parseEvent(value: unknown): ShipperEvent | undefined {
  const raw = record(value);
  const id = str(raw?.event_id);
  const type = str(raw?.event_type);
  const createdAt = iso(raw?.created_at);
  const reason = nullableStr(raw?.reason);
  const actor = raw?.actor_type;
  if (raw === undefined || id === undefined || type === undefined || createdAt === undefined || reason === undefined || (actor !== 'DRIVER' && actor !== 'ADMIN' && actor !== 'SYSTEM')) {
    return undefined;
  }
  return { id, type, actor, reason, createdAt };
}

export function parseDetail(data: Record<string, unknown>): ShipperDetail | undefined {
  const id = str(data.driver_id);
  const code = str(data.shipper_code);
  const name = str(data.full_name);
  const phone = str(data.phone);
  const createdAt = iso(data.created_at);
  const bank = parseBank(data.bank);
  const readiness = record(data.readiness);
  const closure = data.closure === null ? null : record(data.closure);
  const rejectionReason = nullableStr(data.rejection_reason);
  const suspensionReason = nullableStr(data.suspension_reason);
  const plate = nullableStr(data.plate_number);
  const submittedAt = nullableIso(data.submitted_at);
  if (
    id === undefined || !UUID_RE.test(id) || code === undefined || name === undefined || phone === undefined || createdAt === undefined || bank === undefined ||
    readiness === undefined || closure === undefined || rejectionReason === undefined || suspensionReason === undefined || plate === undefined || submittedAt === undefined ||
    typeof data.driver_type !== 'string' || !TYPES.includes(data.driver_type) ||
    typeof data.status !== 'string' || !STATUSES.includes(data.status) ||
    typeof data.review_state !== 'string' || !REVIEW_STATES.includes(data.review_state) ||
    typeof data.accepting_deliveries !== 'boolean' || !whole(data.version) || data.version < 1 ||
    !Array.isArray(readiness.blocks) || !readiness.blocks.every((entry) => typeof entry === 'string') || typeof readiness.can_accept !== 'boolean' || !Array.isArray(data.history)
  ) {
    return undefined;
  }
  const history: ShipperEvent[] = [];
  for (const entry of data.history) {
    const event = parseEvent(entry);
    if (event === undefined) {
      return undefined;
    }
    history.push(event);
  }
  return {
    id, code, fullName: name, phone, plate, driverType: data.driver_type as DriverType, status: data.status as DriverStatus, reviewState: data.review_state as ReviewState,
    rejectionReason, suspensionReason, accepting: data.accepting_deliveries, version: data.version, bank, blocks: readiness.blocks as string[], canAccept: readiness.can_accept,
    closureNote: closure === null ? null : (nullableStr(closure.note) ?? null), closureRequestedAt: closure === null ? null : (nullableIso(closure.requested_at) ?? null),
    submittedAt, createdAt, history,
  };
}

export interface ShipperPage {
  readonly rows: readonly ShipperRow[];
  readonly total: number;
}

export function parsePage(data: Record<string, unknown>): ShipperPage | undefined {
  if (!Array.isArray(data.items) || !whole(data.total)) {
    return undefined;
  }
  const rows: ShipperRow[] = [];
  for (const entry of data.items) {
    const row = parseRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total };
}

export function parseWalletParameters(data: Record<string, unknown>): WalletParameters | undefined {
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
  const updatedAt = nullableIso(data.updated_at);
  if (!whole(data.version) || !positive(data.topup_min_vnd) || !positive(data.withdraw_min_vnd) || updatedAt === undefined || !Array.isArray(data.history)) {
    return undefined;
  }
  const history: WalletParameterChange[] = [];
  for (const entry of data.history) {
    const raw = record(entry);
    const id = str(raw?.change_id);
    const changedBy = str(raw?.changed_by);
    const changedAt = iso(raw?.changed_at);
    const key = raw?.param_key;
    if (raw === undefined || id === undefined || changedBy === undefined || changedAt === undefined || (key !== 'topup_min_vnd' && key !== 'withdraw_min_vnd') || !positive(raw.old_value) || !positive(raw.new_value)) {
      return undefined;
    }
    history.push({ id, key, oldValue: raw.old_value, newValue: raw.new_value, changedBy, changedAt });
  }
  return { version: data.version, topupMinVnd: data.topup_min_vnd, withdrawMinVnd: data.withdraw_min_vnd, updatedAt, history };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export class AdminShipperApi extends ApiClient {
  list(filter: ShipperQuery): Promise<ApiResult<ShipperPage>> {
    const path = `/admin/shippers${query({
      q: filter.query.trim(),
      status: filter.status === 'ALL' ? undefined : filter.status,
      limit: String(SHIPPER_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * SHIPPER_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parsePage);
  }

  detail(id: string): Promise<ApiResult<ShipperDetail>> {
    return this.call({ method: 'GET', path: `/admin/shippers/${encodeURIComponent(id)}` }, parseDetail);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  command(csrf: string, request: ShipperCommandRequest): Promise<ApiResult<ShipperDetail>> {
    const body: Record<string, unknown> = { expected_version: request.version };
    if (request.reason !== undefined) {
      body.reason = request.reason;
    }
    if (request.driverType !== undefined) {
      body.driver_type = request.driverType;
    }
    return this.call({ method: 'POST', path: `/admin/shippers/${encodeURIComponent(request.id)}/${request.name}`, body, csrf, idempotencyKey: request.key }, parseDetail);
  }

  walletParameters(): Promise<ApiResult<WalletParameters>> {
    return this.call({ method: 'GET', path: '/admin/system-settings/shipper-wallet' }, parseWalletParameters);
  }

  saveWalletParameters(csrf: string, command: WalletSaveCommand): Promise<ApiResult<WalletParameters>> {
    return this.call(
      {
        method: 'POST',
        path: '/admin/system-settings/shipper-wallet',
        body: { expected_version: command.version, topup_min_vnd: command.topupMinVnd, withdraw_min_vnd: command.withdrawMinVnd },
        csrf,
        idempotencyKey: command.key,
      },
      parseWalletParameters,
    );
  }
}

/** Codes that mean "the server looked at it and said no": nothing changed, the page shows a sentence. */
const REFUSALS: readonly string[] = [
  'DRIVER_NOT_FOUND',
  'DRIVER_STATE_CONFLICT',
  'DRIVER_PROFILE_INCOMPLETE',
  'BANK_HOLDER_MISMATCH',
  'DRIVER_BANK_NOT_VERIFIED',
  'DRIVER_HAS_ACTIVE_WORK',
  'DRIVER_WALLET_NOT_SETTLED',
  'DRIVER_SELF_ACTION_FORBIDDEN',
  'ADMIN_INPUT_INVALID',
];

async function resultOf(result: ApiResult<unknown>, session: CsrfPort, conflictCodes: readonly string[]): Promise<ShipperCommandResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the command may have been executed.
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (conflictCodes.includes(result.code)) {
    return { kind: 'conflict' };
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
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return REFUSALS.includes(result.code) ? { kind: 'refused', code: result.code } : { kind: 'refused', code: 'ADMIN_INPUT_INVALID' };
  }
}

/** The real ShipperSource. It keeps nothing: no rows, no versions, no keys. */
export function createShipperSource(api: AdminShipperApi, session?: CsrfPort): ShipperSource {
  return {
    async list(filter): Promise<ShipperListRead> {
      const result = await api.list(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total } : failureOf(result);
    },
    async detail(id): Promise<ShipperDetailRead> {
      const result = await api.detail(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', shipper: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async command(request): Promise<ShipperCommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return resultOf(await api.command(csrf, request), session, ['VERSION_CONFLICT']);
    },
    async walletParameters(): Promise<WalletRead> {
      const result = await api.walletParameters();
      return result.kind === 'ok' ? { kind: 'ready', parameters: result.data } : failureOf(result);
    },
    async saveWalletParameters(command): Promise<ShipperCommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return resultOf(await api.saveWalletParameters(csrf, command), session, ['WALLET_PARAMETER_VERSION_CONFLICT']);
    },
  };
}
