// HTTP client of the operating finance routes of the administration (M04-C): /v1/admin/finance/{overview,wallets,transactions,reconciliation,commission-policy,
// withdrawals,withdrawal-source-accounts}. Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a
// body that does not have the documented shape is "no usable answer", never half-shown data. Nothing is stored here: no row, no version, no key, no account number.

import { CsrfPort } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { FinanceOutcome } from './finance-admin.js';
import { outcomeOf, readOf } from './finance-api.js';
import {
  CheckCommand,
  CheckResult,
  CommissionCommand,
  CommissionPolicyView,
  CommissionVersion,
  CountAmount,
  Destination,
  DriftItem,
  FinanceOpsSource,
  HoldItem,
  HoldStatus,
  LedgerFilterOps,
  LedgerItem,
  LedgerKind,
  LedgerPage,
  LEDGER_KINDS,
  MarkPaidCommand,
  OPS_PAGE_SIZE,
  OpsOverview,
  OutgoingEvidenceInput,
  ReconcileCommand,
  ReconciliationReason,
  ReconciliationView,
  RECONCILIATION_REASONS,
  ReportCommand,
  ShipperIdentity,
  SourceAccount,
  StartCommand,
  WalletDetail,
  WalletItem,
  WalletPage,
  WithdrawalDetailOps,
  WithdrawalEvent,
  WithdrawalFilterOps,
  WithdrawalItem,
  WithdrawalPage,
  WithdrawalState,
  WITHDRAWAL_STATES,
} from './finance-ops.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && UUID_RE.test(text) ? text : undefined;
};
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const signed = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableText = (value: unknown): string | null | undefined => (value === null ? null : str(value));

function shipper(value: unknown): ShipperIdentity | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const code = nullableText(raw.code);
  const name = nullableText(raw.name_masked);
  const phone = nullableText(raw.phone_masked);
  const status = nullableText(raw.status);
  return code === undefined || name === undefined || phone === undefined || status === undefined ? undefined : { code, nameMasked: name, phoneMasked: phone, status };
}

function countAmount(value: unknown, withAmount = true): CountAmount | undefined {
  const raw = record(value);
  if (raw === undefined || !whole(raw.count)) {
    return undefined;
  }
  if (!withAmount) {
    return { count: raw.count, amountVnd: 0 };
  }
  return whole(raw.amount_vnd) ? { count: raw.count, amountVnd: raw.amount_vnd } : undefined;
}

export function parseOverview(data: Record<string, unknown>): OpsOverview | undefined {
  const last = record(data.last_24h);
  const drift = record(data.drift);
  const topup = countAmount(data.topup_pending);
  const pending = countAmount(data.withdrawal_pending);
  const processing = countAmount(data.withdrawal_processing, false);
  const reconciliation = countAmount(data.withdrawal_reconciliation);
  const l1 = countAmount(last?.topup);
  const l2 = countAmount(last?.withdrawal_paid);
  const l3 = countAmount(last?.commission);
  if (
    !whole(data.wallets) || !whole(data.total_balance_vnd) || !whole(data.total_held_vnd) || !whole(data.total_available_vnd) || !whole(data.commission_vnd) ||
    topup === undefined || pending === undefined || processing === undefined || reconciliation === undefined || l1 === undefined || l2 === undefined || l3 === undefined ||
    drift === undefined || !whole(drift.wallets) || !whole(drift.withdrawals)
  ) {
    return undefined;
  }
  return {
    wallets: data.wallets,
    totalBalanceVnd: data.total_balance_vnd,
    totalHeldVnd: data.total_held_vnd,
    totalAvailableVnd: data.total_available_vnd,
    topupPending: topup,
    withdrawalPending: pending,
    withdrawalProcessing: processing.count,
    withdrawalReconciliation: reconciliation,
    last24h: { topup: l1, withdrawalPaid: l2, commission: l3 },
    driftWallets: drift.wallets,
    driftWithdrawals: drift.withdrawals,
    commissionVnd: data.commission_vnd,
  };
}

function cursorOf(data: Record<string, unknown>): string | null | undefined {
  return data.next_cursor === null ? null : str(data.next_cursor);
}

function wallet(value: unknown): WalletItem | undefined {
  const raw = record(value);
  const walletId = uuid(raw?.wallet_id);
  const driverId = uuid(raw?.driver_id);
  const who = shipper(raw?.shipper);
  const updatedAt = iso(raw?.updated_at);
  if (raw === undefined || walletId === undefined || driverId === undefined || who === undefined || updatedAt === undefined || !whole(raw.balance_vnd) || !whole(raw.held_vnd) || !whole(raw.available_vnd)) {
    return undefined;
  }
  return { walletId, driverId, shipper: who, balanceVnd: raw.balance_vnd, heldVnd: raw.held_vnd, availableVnd: raw.available_vnd, updatedAt };
}

export function parseWalletPage(data: Record<string, unknown>): WalletPage | undefined {
  const next = cursorOf(data);
  if (!Array.isArray(data.items) || next === undefined) {
    return undefined;
  }
  const items: WalletItem[] = [];
  for (const entry of data.items) {
    const item = wallet(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { items, nextCursor: next };
}

const HOLD_STATUSES: readonly string[] = ['ACTIVE', 'CAPTURED', 'RELEASED'];

function hold(value: unknown): HoldItem | undefined {
  const raw = record(value);
  const holdId = uuid(raw?.hold_id);
  const createdAt = iso(raw?.created_at);
  const resolvedAt = nullableIso(raw?.resolved_at);
  const orderRef = nullableText(raw?.order_ref);
  if (
    raw === undefined || holdId === undefined || createdAt === undefined || resolvedAt === undefined || orderRef === undefined || !whole(raw.amount_vnd) ||
    (raw.purpose !== 'COMMISSION' && raw.purpose !== 'WITHDRAWAL') || typeof raw.status !== 'string' || !HOLD_STATUSES.includes(raw.status)
  ) {
    return undefined;
  }
  return { holdId, purpose: raw.purpose, amountVnd: raw.amount_vnd, status: raw.status as HoldStatus, orderRef, createdAt, resolvedAt };
}

function ledger(value: unknown): LedgerItem | undefined {
  const raw = record(value);
  const at = iso(raw?.at);
  const orderRef = nullableText(raw?.order_ref);
  const sourceId = nullableText(raw?.source_id);
  const holdStatus = nullableText(raw?.hold_status);
  if (
    raw === undefined || at === undefined || orderRef === undefined || sourceId === undefined || holdStatus === undefined || typeof raw.id !== 'string' || !signed(raw.amount_vnd) ||
    typeof raw.kind !== 'string' || !(LEDGER_KINDS as readonly string[]).includes(raw.kind) || (raw.balance_after_vnd !== null && !whole(raw.balance_after_vnd)) ||
    (holdStatus !== null && !HOLD_STATUSES.includes(holdStatus))
  ) {
    return undefined;
  }
  const who = raw.shipper === undefined ? null : shipper(raw.shipper);
  const driverId = raw.driver_id === undefined ? null : (uuid(raw.driver_id) ?? undefined);
  if (who === undefined || driverId === undefined) {
    return undefined;
  }
  return { id: raw.id, kind: raw.kind as LedgerKind, amountVnd: raw.amount_vnd, balanceAfterVnd: raw.balance_after_vnd as number | null, holdStatus: holdStatus as HoldStatus | null, orderRef, sourceId, at, driverId, shipper: who };
}

export function parseLedgerPage(data: Record<string, unknown>): LedgerPage | undefined {
  const next = cursorOf(data);
  if (!Array.isArray(data.items) || next === undefined) {
    return undefined;
  }
  const items: LedgerItem[] = [];
  for (const entry of data.items) {
    const item = ledger(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { items, nextCursor: next };
}

export function parseWalletDetail(data: Record<string, unknown>): WalletDetail | undefined {
  const who = shipper(data.shipper);
  if (who === undefined || !Array.isArray(data.holds) || !Array.isArray(data.recent)) {
    return undefined;
  }
  let walletView: WalletDetail['wallet'] = null;
  if (data.wallet !== null) {
    const raw = record(data.wallet);
    const walletId = uuid(raw?.wallet_id);
    if (raw === undefined || walletId === undefined || !whole(raw.balance_vnd) || !whole(raw.held_vnd) || !whole(raw.available_vnd) || !whole(raw.version)) {
      return undefined;
    }
    walletView = { walletId, balanceVnd: raw.balance_vnd, heldVnd: raw.held_vnd, availableVnd: raw.available_vnd, version: raw.version };
  }
  const holds: HoldItem[] = [];
  for (const entry of data.holds) {
    const item = hold(entry);
    if (item === undefined) {
      return undefined;
    }
    holds.push(item);
  }
  const recent: LedgerItem[] = [];
  for (const entry of data.recent) {
    const item = ledger(entry);
    if (item === undefined) {
      return undefined;
    }
    recent.push(item);
  }
  return { shipper: who, wallet: walletView, holds, recent };
}

function withdrawalItem(raw: Record<string, unknown>): WithdrawalItem | undefined {
  const withdrawalId = uuid(raw.withdrawal_id);
  const driverId = uuid(raw.driver_id);
  const who = shipper(raw.shipper);
  const createdAt = iso(raw.created_at);
  const resolvedAt = nullableIso(raw.resolved_at);
  const code = str(raw.request_code);
  const bank = str(raw.destination_bank);
  const masked = str(raw.destination_masked);
  if (
    withdrawalId === undefined || driverId === undefined || who === undefined || createdAt === undefined || resolvedAt === undefined || code === undefined || bank === undefined || masked === undefined ||
    !whole(raw.amount_vnd) || raw.amount_vnd < 1 || !whole(raw.version) || raw.version < 1 || typeof raw.state !== 'string' || !(WITHDRAWAL_STATES as readonly string[]).includes(raw.state)
  ) {
    return undefined;
  }
  return { withdrawalId, requestCode: code, driverId, shipper: who, amountVnd: raw.amount_vnd, state: raw.state as WithdrawalState, version: raw.version, createdAt, resolvedAt, destinationBank: bank, destinationMasked: masked };
}

export function parseWithdrawalPage(data: Record<string, unknown>): WithdrawalPage | undefined {
  const next = cursorOf(data);
  if (!Array.isArray(data.items) || next === undefined) {
    return undefined;
  }
  const items: WithdrawalItem[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const item = raw === undefined ? undefined : withdrawalItem(raw);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { items, nextCursor: next };
}

function destination(value: unknown): Destination | undefined {
  const raw = record(value);
  const bankCode = str(raw?.bank_code);
  const bankName = str(raw?.bank_name);
  if (raw === undefined || bankCode === undefined || bankName === undefined) {
    return undefined;
  }
  if (raw.full === true) {
    const number = str(raw.account_number);
    const holder = str(raw.account_holder);
    return number === undefined || holder === undefined ? undefined : { full: true, bankCode, bankName, accountNumber: number, accountHolder: holder };
  }
  const masked = str(raw.account_number_masked);
  const holderMasked = str(raw.account_holder_masked);
  return raw.full === false && masked !== undefined && holderMasked !== undefined ? { full: false, bankCode, bankName, accountNumberMasked: masked, accountHolderMasked: holderMasked } : undefined;
}

export function parseWithdrawalDetail(data: Record<string, unknown>): WithdrawalDetailOps | undefined {
  const base = withdrawalItem(data);
  const dest = destination(data.destination);
  const paidAt = nullableIso(data.paid_at);
  const outcome = nullableText(data.outcome);
  const rights = record(data.rights);
  if (base === undefined || dest === undefined || paidAt === undefined || outcome === undefined || rights === undefined || !Array.isArray(data.events)) {
    return undefined;
  }
  if (typeof rights.can_process !== 'boolean' || typeof rights.can_confirm !== 'boolean' || typeof rights.can_report !== 'boolean' || typeof rights.can_reconcile !== 'boolean') {
    return undefined;
  }
  if (data.snapshot_current !== null && typeof data.snapshot_current !== 'boolean') {
    return undefined;
  }
  let processing: WithdrawalDetailOps['processing'] = null;
  if (data.processing !== null) {
    const raw = record(data.processing);
    const startedAt = iso(raw?.started_at);
    if (raw === undefined || startedAt === undefined || typeof raw.is_owner !== 'boolean') {
      return undefined;
    }
    processing = { startedAt, isOwner: raw.is_owner };
  }
  let reconciliation: WithdrawalDetailOps['reconciliation'] = null;
  if (data.reconciliation !== null) {
    const raw = record(data.reconciliation);
    const reportedAt = iso(raw?.reported_at);
    if (raw === undefined || reportedAt === undefined || typeof raw.reason_code !== 'string' || !(RECONCILIATION_REASONS as readonly string[]).includes(raw.reason_code)) {
      return undefined;
    }
    reconciliation = { reasonCode: raw.reason_code as ReconciliationReason, reportedAt };
  }
  let outgoing: WithdrawalDetailOps['outgoing'] = null;
  if (data.outgoing !== null) {
    const raw = record(data.outgoing);
    const bankId = str(raw?.bank_id);
    const occurredAt = iso(raw?.occurred_at);
    if (raw === undefined || bankId === undefined || occurredAt === undefined || !whole(raw.amount_vnd) || typeof raw.matches_amount !== 'boolean') {
      return undefined;
    }
    outgoing = { bankId, amountVnd: raw.amount_vnd, occurredAt, matchesAmount: raw.matches_amount };
  }
  const events: WithdrawalEvent[] = [];
  for (const entry of data.events) {
    const raw = record(entry);
    const at = iso(raw?.at);
    const reason = nullableText(raw?.reason_code);
    if (
      raw === undefined || at === undefined || reason === undefined || typeof raw.kind !== 'string' || typeof raw.by_me !== 'boolean' ||
      typeof raw.to_state !== 'string' || !(WITHDRAWAL_STATES as readonly string[]).includes(raw.to_state) ||
      (raw.from_state !== null && (typeof raw.from_state !== 'string' || !(WITHDRAWAL_STATES as readonly string[]).includes(raw.from_state)))
    ) {
      return undefined;
    }
    events.push({ kind: raw.kind, fromState: raw.from_state as WithdrawalState | null, toState: raw.to_state as WithdrawalState, reasonCode: reason, at, byMe: raw.by_me });
  }
  return {
    ...base,
    destination: dest,
    snapshotCurrent: data.snapshot_current as boolean | null,
    processing,
    reconciliation,
    outgoing,
    paidAt,
    outcome,
    events,
    rights: { canProcess: rights.can_process, canConfirm: rights.can_confirm, canReport: rights.can_report, canReconcile: rights.can_reconcile },
  };
}

export function parseSourceAccounts(data: Record<string, unknown>): readonly SourceAccount[] | undefined {
  if (!Array.isArray(data.accounts)) {
    return undefined;
  }
  const accounts: SourceAccount[] = [];
  for (const entry of data.accounts) {
    const raw = record(entry);
    const accountId = uuid(raw?.account_id);
    const bankId = str(raw?.bank_id);
    const masked = str(raw?.account_number_masked);
    if (raw === undefined || accountId === undefined || bankId === undefined || masked === undefined) {
      return undefined;
    }
    accounts.push({ accountId, bankId, numberMasked: masked });
  }
  return accounts;
}

export function parseReconciliation(data: Record<string, unknown>): ReconciliationView | undefined {
  if (!whole(data.checked_wallets) || !whole(data.drift_wallets) || !whole(data.drift_withdrawals) || !whole(data.withdrawals_in_reconciliation) || !Array.isArray(data.drift)) {
    return undefined;
  }
  const drift: DriftItem[] = [];
  for (const entry of data.drift) {
    const raw = record(entry);
    const walletId = uuid(raw?.wallet_id);
    const driverId = uuid(raw?.driver_id);
    const who = shipper(raw?.shipper);
    if (
      raw === undefined || walletId === undefined || driverId === undefined || who === undefined || !whole(raw.balance_vnd) || !whole(raw.held_vnd) || !signed(raw.ledger_sum_vnd) ||
      !whole(raw.last_balance_after_vnd) || !whole(raw.active_holds_vnd)
    ) {
      return undefined;
    }
    drift.push({ walletId, driverId, shipper: who, balanceVnd: raw.balance_vnd, heldVnd: raw.held_vnd, ledgerSumVnd: raw.ledger_sum_vnd, lastBalanceAfterVnd: raw.last_balance_after_vnd, activeHoldsVnd: raw.active_holds_vnd });
  }
  return { checkedWallets: data.checked_wallets, driftWallets: data.drift_wallets, driftWithdrawals: data.drift_withdrawals, withdrawalsInReconciliation: data.withdrawals_in_reconciliation, drift };
}

function commissionVersion(value: unknown): CommissionVersion | undefined {
  const raw = record(value);
  const createdAt = iso(raw?.created_at);
  if (raw === undefined || createdAt === undefined || !whole(raw.version) || raw.version < 1 || !whole(raw.commission_vnd) || raw.commission_vnd < 1) {
    return undefined;
  }
  return { version: raw.version, commissionVnd: raw.commission_vnd, createdAt };
}

export function parseCommissionPolicy(data: Record<string, unknown>): CommissionPolicyView | undefined {
  const current = commissionVersion(data.current);
  if (current === undefined || !Array.isArray(data.history)) {
    return undefined;
  }
  const history: CommissionVersion[] = [];
  for (const entry of data.history) {
    const item = commissionVersion(entry);
    if (item === undefined) {
      return undefined;
    }
    history.push(item);
  }
  return { current, history };
}

export function parseCheckResult(data: Record<string, unknown>): CheckResult | undefined {
  if (!whole(data.checked_wallets) || !whole(data.drift_wallets) || !whole(data.drift_withdrawals) || typeof data.recorded !== 'boolean') {
    return undefined;
  }
  return { checkedWallets: data.checked_wallets, driftWallets: data.drift_wallets, driftWithdrawals: data.drift_withdrawals, recorded: data.recorded };
}

const anyData = (data: Record<string, unknown>): Record<string, unknown> => data;

const query = (values: Record<string, string | undefined>): string => {
  const parts = Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

const evidenceBody = (e: OutgoingEvidenceInput): Record<string, unknown> => ({
  actual_amount_vnd: e.actualVnd,
  bank_id: e.bankId,
  system_owned_account_id: e.accountId,
  canonical_transaction_id: e.transactionId,
  paid_at: e.paidAt,
});

export class AdminFinanceOpsApi extends ApiClient {
  overview(): Promise<ApiResult<OpsOverview>> {
    return this.call({ method: 'GET', path: '/admin/finance/overview' }, parseOverview);
  }
  wallets(search: string, cursor: string | null): Promise<ApiResult<WalletPage>> {
    return this.call({ method: 'GET', path: `/admin/finance/wallets${query({ q: search.trim() === '' ? undefined : search.trim(), limit: String(OPS_PAGE_SIZE), cursor: cursor ?? undefined })}` }, parseWalletPage);
  }
  wallet(driverId: string): Promise<ApiResult<WalletDetail>> {
    return this.call({ method: 'GET', path: `/admin/finance/wallets/${encodeURIComponent(driverId)}` }, parseWalletDetail);
  }
  ledger(filter: LedgerFilterOps, cursor: string | null): Promise<ApiResult<LedgerPage>> {
    return this.call(
      { method: 'GET', path: `/admin/finance/transactions${query({ kind: filter.kind === 'ALL' ? undefined : filter.kind, driver_id: filter.driverId ?? undefined, limit: String(OPS_PAGE_SIZE), cursor: cursor ?? undefined })}` },
      parseLedgerPage,
    );
  }
  withdrawals(filter: WithdrawalFilterOps, cursor: string | null): Promise<ApiResult<WithdrawalPage>> {
    return this.call({ method: 'GET', path: `/admin/finance/withdrawals${query({ status: filter === 'ALL' ? undefined : filter, limit: String(OPS_PAGE_SIZE), cursor: cursor ?? undefined })}` }, parseWithdrawalPage);
  }
  withdrawal(id: string): Promise<ApiResult<WithdrawalDetailOps>> {
    return this.call({ method: 'GET', path: `/admin/finance/withdrawals/${encodeURIComponent(id)}` }, parseWithdrawalDetail);
  }
  sourceAccounts(): Promise<ApiResult<readonly SourceAccount[]>> {
    return this.call({ method: 'GET', path: '/admin/finance/withdrawal-source-accounts' }, parseSourceAccounts);
  }
  reconciliation(): Promise<ApiResult<ReconciliationView>> {
    return this.call({ method: 'GET', path: '/admin/finance/reconciliation' }, parseReconciliation);
  }
  commissionPolicy(): Promise<ApiResult<CommissionPolicyView>> {
    return this.call({ method: 'GET', path: '/admin/finance/commission-policy' }, parseCommissionPolicy);
  }
  startProcessing(csrf: string, command: StartCommand): Promise<ApiResult<unknown>> {
    return this.call({ method: 'POST', path: `/admin/finance/withdrawals/${encodeURIComponent(command.withdrawalId)}/start-processing`, body: { expected_version: command.version }, csrf, idempotencyKey: command.key }, anyData);
  }
  markPaid(csrf: string, command: MarkPaidCommand): Promise<ApiResult<unknown>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/finance/withdrawals/${encodeURIComponent(command.withdrawalId)}/mark-paid`,
        body: { expected_version: command.version, destination_checked: true, ...evidenceBody(command.evidence) },
        csrf,
        idempotencyKey: command.key,
      },
      anyData,
    );
  }
  report(csrf: string, command: ReportCommand): Promise<ApiResult<unknown>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/finance/withdrawals/${encodeURIComponent(command.withdrawalId)}/report-reconciliation`,
        body: { expected_version: command.version, reason_code: command.reason, ...(command.evidence === undefined ? {} : { evidence: evidenceBody(command.evidence) }) },
        csrf,
        idempotencyKey: command.key,
      },
      anyData,
    );
  }
  reconcile(csrf: string, command: ReconcileCommand): Promise<ApiResult<unknown>> {
    return this.call(
      {
        method: 'POST',
        path: `/admin/finance/withdrawals/${encodeURIComponent(command.withdrawalId)}/reconcile`,
        body: {
          expected_version: command.version,
          outcome: command.outcome,
          reason_code: command.reasonCode,
          ...(command.outcome === 'CONFIRMED_PAID' ? { destination_checked: true } : {}),
          ...(command.outcome === 'CONFIRMED_NOT_SENT_FINAL' ? { bank_confirmed_not_sent: true } : {}),
          ...(command.evidence === undefined ? {} : { evidence: evidenceBody(command.evidence) }),
        },
        csrf,
        idempotencyKey: command.key,
      },
      anyData,
    );
  }
  check(csrf: string, command: CheckCommand): Promise<ApiResult<CheckResult>> {
    return this.call({ method: 'POST', path: '/admin/finance/reconciliation/check', body: {}, csrf, idempotencyKey: command.key }, parseCheckResult);
  }
  changeCommission(csrf: string, command: CommissionCommand): Promise<ApiResult<unknown>> {
    return this.call({ method: 'POST', path: '/admin/finance/commission-policy', body: { expected_version: command.version, commission_vnd: command.commissionVnd }, csrf, idempotencyKey: command.key }, anyData);
  }
}

/** The real FinanceOpsSource. It keeps nothing: no rows, no versions, no keys, no account numbers. */
export function createFinanceOpsSource(api: AdminFinanceOpsApi, session: CsrfPort): FinanceOpsSource {
  const send = async (call: (csrf: string) => Promise<ApiResult<unknown>>): Promise<FinanceOutcome> => {
    const csrf = session.csrf();
    if (csrf === undefined) {
      return { kind: 'session-expired' };
    }
    return outcomeOf(await call(csrf), session);
  };
  return {
    overview: async () => readOf(await api.overview()),
    wallets: async (search, cursor) => readOf(await api.wallets(search, cursor)),
    wallet: async (driverId) => readOf(await api.wallet(driverId)),
    ledger: async (filter, cursor) => readOf(await api.ledger(filter, cursor)),
    withdrawals: async (filter, cursor) => readOf(await api.withdrawals(filter, cursor)),
    withdrawal: async (id) => readOf(await api.withdrawal(id)),
    sourceAccounts: async () => readOf(await api.sourceAccounts()),
    reconciliation: async () => readOf(await api.reconciliation()),
    commissionPolicy: async () => readOf(await api.commissionPolicy()),
    startProcessing: (command) => send((csrf) => api.startProcessing(csrf, command)),
    markPaid: (command) => send((csrf) => api.markPaid(csrf, command)),
    reportReconciliation: (command) => send((csrf) => api.report(csrf, command)),
    reconcile: (command) => send((csrf) => api.reconcile(csrf, command)),
    runCheck: async (command) => {
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.check(csrf, command);
      const outcome = await outcomeOf(result, session);
      return result.kind === 'ok' ? { ...outcome, result: result.data } : outcome;
    },
    changeCommission: (command) => send((csrf) => api.changeCommission(csrf, command)),
  };
}
