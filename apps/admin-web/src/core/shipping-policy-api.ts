// HTTP client of the shipping-fee table (M06-A): GET /v1/admin/shipping-fee-policy, POST .../draft, .../apply, .../preview. Cookie-only
// (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body without the documented
// shape is "unknown", never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { ConditionChange, ConditionsRead, ConditionsState, ConditionValues, LegacyTail, PolicyRead, PolicyState, PolicyTable, PolicyTier, PolicyVersionInfo, PolicyWriteResult, PreviewResult, ShippingPolicySource } from './shipping-policy.js';

/** The transport's base: this client's paths start with /admin. */
export const SHIPPING_POLICY_BASE = '/v1';

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

function parseTiers(value: unknown): PolicyTier[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tiers: PolicyTier[] = [];
  for (const raw of value as unknown[]) {
    const tier = record(raw);
    if (tier === undefined || !whole(tier.from_m) || !whole(tier.to_m) || !whole(tier.fee_vnd)) {
      return undefined;
    }
    tiers.push({ fromM: tier.from_m, toM: tier.to_m, feeVnd: tier.fee_vnd });
  }
  return tiers;
}

function parseTable(source: Record<string, unknown>): PolicyTable | undefined {
  const tiers = parseTiers(source.tiers);
  return tiers === undefined ? undefined : { tiers };
}

export function parseVersion(value: unknown): PolicyVersionInfo | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const table = parseTable(raw);
  const appliedAt = iso(raw.applied_at);
  const appliedBy = str(raw.applied_by);
  const note = raw.note === null ? null : str(raw.note);
  const tailRaw = raw.tail === null ? null : record(raw.tail);
  const tail: LegacyTail | null | undefined =
    tailRaw === null ? null : tailRaw !== undefined && whole(tailRaw.base_fee_vnd) && whole(tailRaw.step_m) && whole(tailRaw.step_fee_vnd) ? { baseFeeVnd: tailRaw.base_fee_vnd, stepM: tailRaw.step_m, stepFeeVnd: tailRaw.step_fee_vnd } : undefined;
  if (table === undefined || appliedAt === undefined || appliedBy === undefined || note === undefined || tail === undefined || typeof raw.legacy !== 'boolean' || !whole(raw.version_no) || raw.version_no < 1) {
    return undefined;
  }
  // A current (v1.1) version has exactly three bands and no tail; only a legacy one may differ.
  if (!raw.legacy && (table.tiers.length !== 3 || tail !== null)) {
    return undefined;
  }
  return { ...table, versionNo: raw.version_no, legacy: raw.legacy, tail, note, appliedBy, appliedAt };
}

export function parseState(data: Record<string, unknown>): PolicyState | undefined {
  const active = data.active === null ? null : parseVersion(data.active);
  const draftRaw = record(data.draft);
  const updatedAt = iso(draftRaw?.updated_at);
  if (active === undefined || draftRaw === undefined || updatedAt === undefined || !whole(draftRaw.version) || draftRaw.version < 1) {
    return undefined;
  }
  const draftTable = draftRaw.tiers === null ? null : parseTable(draftRaw);
  if (draftTable === undefined || (draftTable !== null && draftTable.tiers.length !== 3) || !Array.isArray(data.history)) {
    return undefined;
  }
  const history: PolicyVersionInfo[] = [];
  for (const item of data.history as unknown[]) {
    const version = parseVersion(item);
    if (version === undefined) {
      return undefined;
    }
    history.push(version);
  }
  return { active, draft: { version: draftRaw.version, table: draftTable, updatedAt }, history };
}

function parseValues(raw: Record<string, unknown> | undefined): ConditionValues | undefined {
  if (raw === undefined || !whole(raw.external_max_deliveries) || !whole(raw.batch_max_delay_seconds) || !whole(raw.pickup_service_seconds) || !whole(raw.handoff_service_seconds)) {
    return undefined;
  }
  return { externalMax: raw.external_max_deliveries, delaySeconds: raw.batch_max_delay_seconds, pickupSeconds: raw.pickup_service_seconds, handoffSeconds: raw.handoff_service_seconds };
}

export function parseConditions(data: Record<string, unknown>): ConditionsState | undefined {
  const values = parseValues(data);
  const fixed = record(data.fixed);
  const updatedAt = iso(data.updated_at);
  if (values === undefined || fixed === undefined || !whole(fixed.search_radius_m) || updatedAt === undefined || !whole(data.version) || data.version < 1 || !Array.isArray(data.history)) {
    return undefined;
  }
  const history: ConditionChange[] = [];
  for (const item of data.history as unknown[]) {
    const raw = record(item);
    const before = parseValues(record(raw?.old));
    const after = parseValues(record(raw?.new));
    const changedAt = iso(raw?.changed_at);
    const changedBy = str(raw?.changed_by);
    if (raw === undefined || before === undefined || after === undefined || changedAt === undefined || changedBy === undefined || !whole(raw.version_after)) {
      return undefined;
    }
    history.push({ versionAfter: raw.version_after, old: before, new: after, changedBy, changedAt });
  }
  return { ...values, version: data.version, updatedAt, searchRadiusM: fixed.search_radius_m, history };
}

/** A write answers with the active table and the draft only (no history); the page reads the whole state again afterwards. */
const parseWriteAck = (data: Record<string, unknown>): true | undefined => (record(data.draft) !== undefined && 'active' in data ? true : undefined);

const toBody = (table: PolicyTable): Record<string, unknown> => ({ tiers: table.tiers.map((t) => ({ from_m: t.fromM, to_m: t.toM, fee_vnd: t.feeVnd })) });

interface PreviewData {
  readonly status: 'PRICED' | 'UNPRICED';
  readonly feeVnd: number | null;
  readonly band: number | null;
  readonly reason: string | null;
  readonly basedOn: 'ACTIVE' | 'EDITING';
}

function parsePreview(data: Record<string, unknown>): PreviewData | undefined {
  const basedOn = data.based_on === 'ACTIVE' || data.based_on === 'EDITING' ? data.based_on : undefined;
  if (basedOn === undefined) {
    return undefined;
  }
  if (data.status === 'PRICED' && whole(data.fee_vnd) && whole(data.band)) {
    return { status: 'PRICED', feeVnd: data.fee_vnd, band: data.band, reason: null, basedOn };
  }
  if (data.status === 'UNPRICED' && data.fee_vnd === null && str(data.reason) !== undefined) {
    return { status: 'UNPRICED', feeVnd: null, band: null, reason: str(data.reason) as string, basedOn };
  }
  return undefined;
}

export class ShippingPolicyApi extends ApiClient {
  read(): Promise<ApiResult<PolicyState>> {
    return this.call({ method: 'GET', path: '/admin/shipping-fee-policy' }, parseState);
  }

  saveDraft(csrf: string, command: { version: number; table: PolicyTable; key: string }): Promise<ApiResult<true>> {
    return this.call({ method: 'POST', path: '/admin/shipping-fee-policy/draft', body: { expected_version: command.version, ...toBody(command.table) }, csrf, idempotencyKey: command.key }, parseWriteAck);
  }

  apply(csrf: string, command: { version: number; note: string | null; key: string }): Promise<ApiResult<true>> {
    return this.call(
      { method: 'POST', path: '/admin/shipping-fee-policy/apply', body: { expected_version: command.version, ...(command.note === null ? {} : { note: command.note }) }, csrf, idempotencyKey: command.key },
      parseWriteAck,
    );
  }

  readConditions(): Promise<ApiResult<ConditionsState>> {
    return this.call({ method: 'GET', path: '/admin/shipping-eligibility-policy' }, parseConditions);
  }

  saveConditions(csrf: string, command: { version: number; values: ConditionValues; key: string }): Promise<ApiResult<ConditionsState>> {
    return this.call(
      {
        method: 'POST',
        path: '/admin/shipping-eligibility-policy',
        body: {
          expected_version: command.version,
          external_max_deliveries: command.values.externalMax,
          batch_max_delay_seconds: command.values.delaySeconds,
          pickup_service_seconds: command.values.pickupSeconds,
          handoff_service_seconds: command.values.handoffSeconds,
        },
        csrf,
        idempotencyKey: command.key,
      },
      parseConditions,
    );
  }

  preview(csrf: string, distanceM: number, table: PolicyTable | null): Promise<ApiResult<PreviewData>> {
    return this.call({ method: 'POST', path: '/admin/shipping-fee-policy/preview', body: { distance_m: distanceM, ...(table === null ? {} : toBody(table)) }, csrf }, parsePreview);
  }
}

async function writeResult(result: ApiResult<unknown>, session: CsrfPort): Promise<PolicyWriteResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the write may have happened.
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  switch (result.code) {
    case 'SHIPPING_DRAFT_VERSION_CONFLICT':
    case 'SHIPPING_ELIGIBILITY_VERSION_CONFLICT':
      return { kind: 'conflict' };
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
    case 'SHIPPING_POLICY_INVALID':
    case 'SHIPPING_DRAFT_EMPTY':
    case 'SHIPPING_POLICY_UNCHANGED':
      return { kind: 'refused', code: result.code };
    default:
      return { kind: 'refused', code: 'ADMIN_INPUT_INVALID' };
  }
}

/** The real ShippingPolicySource. It keeps nothing: no table, no version, no key. */
export function createShippingPolicySource(api: ShippingPolicyApi, session?: CsrfPort): ShippingPolicySource {
  return {
    async read(): Promise<PolicyRead> {
      const result = await api.read();
      return result.kind === 'ok' ? { kind: 'ready', state: result.data } : failureOf(result);
    },
    async saveDraft(command): Promise<PolicyWriteResult> {
      const csrf = session?.csrf();
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      return csrf === undefined ? { kind: 'session-expired' } : writeResult(await api.saveDraft(csrf, command), session);
    },
    async apply(command): Promise<PolicyWriteResult> {
      const csrf = session?.csrf();
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      return csrf === undefined ? { kind: 'session-expired' } : writeResult(await api.apply(csrf, command), session);
    },
    async readConditions(): Promise<ConditionsRead> {
      const result = await api.readConditions();
      return result.kind === 'ok' ? { kind: 'ready', state: result.data } : failureOf(result);
    },
    async saveConditions(command): Promise<PolicyWriteResult> {
      const csrf = session?.csrf();
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      return csrf === undefined ? { kind: 'session-expired' } : writeResult(await api.saveConditions(csrf, command), session);
    },
    async preview(distanceM, table): Promise<PreviewResult> {
      const csrf = session?.csrf();
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      if (csrf === undefined) {
        return { kind: 'failed' };
      }
      const result = await api.preview(csrf, distanceM, table);
      if (result.kind !== 'ok') {
        return { kind: 'failed' };
      }
      return result.data.status === 'PRICED'
        ? { kind: 'priced', feeVnd: result.data.feeVnd as number, band: result.data.band as number, basedOn: result.data.basedOn }
        : { kind: 'unpriced', reason: result.data.reason as string };
    },
  };
}
