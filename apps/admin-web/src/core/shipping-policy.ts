import { Refused } from './shippers.js';

// "Phí & điều kiện giao › Bảng giá ship" (M06-A): the model, the editing rules and the port the page talks to. The backend decides every
// rule again (SYSTEM only writes; a table that is not continuous is refused); the checks here only tell the person what is wrong while
// typing. Distances are whole metres on the wire and in the model; the screen shows and accepts km with up to three decimals.

export const SHIPPING_MAX_TIERS = 50;
export const SHIPPING_MAX_FEE_VND = 10_000_000;
export const SHIPPING_MAX_DISTANCE_M = 1_000_000;
export const SHIPPING_MAX_STEP_M = 100_000;
export const NOT_WIRED_SHIPPING_REASON = 'Bảng giá ship chưa được nối với máy chủ ở bản này.';

export interface PolicyTier {
  readonly fromM: number;
  readonly toM: number;
  readonly feeVnd: number;
}

export interface PolicyTail {
  readonly baseFeeVnd: number;
  readonly stepM: number;
  readonly stepFeeVnd: number;
}

export interface PolicyTable {
  readonly tiers: readonly PolicyTier[];
  readonly tail: PolicyTail;
}

export interface PolicyVersionInfo extends PolicyTable {
  readonly versionNo: number;
  readonly note: string | null;
  readonly appliedBy: string;
  readonly appliedAt: string;
}

export interface PolicyState {
  readonly active: PolicyVersionInfo | null;
  /** `table` is null while nothing is saved as a draft. `version` is the draft's own concurrency version. */
  readonly draft: { readonly version: number; readonly table: PolicyTable | null; readonly updatedAt: string };
  readonly history: readonly PolicyVersionInfo[];
}

export type PolicyRead = { readonly kind: 'ready'; readonly state: PolicyState } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export type PolicyWriteResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  /** The server looked at it and said no (a code the page turns into a sentence). Nothing changed. */
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the write MAY have happened. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export type PreviewResult =
  | { readonly kind: 'priced'; readonly feeVnd: number; readonly band: number | 'TAIL'; readonly basedOn: 'ACTIVE' | 'EDITING' }
  | { readonly kind: 'unpriced'; readonly reason: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'not-wired' };

export interface ShippingPolicySource {
  read(): Promise<PolicyRead>;
  saveDraft(command: { readonly version: number; readonly table: PolicyTable; readonly key: string }): Promise<PolicyWriteResult>;
  apply(command: { readonly version: number; readonly note: string | null; readonly key: string }): Promise<PolicyWriteResult>;
  /** Prices a distance against `table`, or against the table in force when `table` is null. Writes nothing. */
  preview(distanceM: number, table: PolicyTable | null): Promise<PreviewResult>;
  readConditions(): Promise<ConditionsRead>;
  saveConditions(command: { readonly version: number; readonly values: ConditionValues; readonly key: string }): Promise<PolicyWriteResult>;
}

// ---- "Điều kiện nhận & ghép" (M06-B/C parameters) ---------------------------------------------------------------------

export interface ConditionValues {
  readonly externalMax: number;
  readonly delaySeconds: number;
  readonly pickupSeconds: number;
  readonly handoffSeconds: number;
}

export interface ConditionChange {
  readonly versionAfter: number;
  readonly old: ConditionValues;
  readonly new: ConditionValues;
  readonly changedBy: string;
  readonly changedAt: string;
}

export interface ConditionsState extends ConditionValues {
  readonly version: number;
  readonly updatedAt: string;
  /** The fixed 5 km search radius: shown read-only, never a setting. */
  readonly searchRadiusM: number;
  readonly history: readonly ConditionChange[];
}

export type ConditionsRead = { readonly kind: 'ready'; readonly state: ConditionsState } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export const CONDITION_BOUNDS = { externalMax: [1, 20], delaySeconds: [0, 3600], pickupSeconds: [0, 1800], handoffSeconds: [0, 1800] } as const;

/** "5", "5.5", "5,5" minutes -> whole seconds (at most two decimals); undefined for anything else or out of range. */
export function parseMinutes(text: string): number | undefined {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const seconds = Math.round(Number(`${match[1] as string}.${match[2] ?? '0'}`) * 60);
  return seconds <= CONDITION_BOUNDS.delaySeconds[1] ? seconds : undefined;
}

export function formatMinutes(seconds: number): string {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : String(Math.round(minutes * 100) / 100);
}

/** A whole number within [min, max] typed by a person; undefined otherwise. */
export function parseBounded(text: string, [min, max]: readonly [number, number]): number | undefined {
  const cleaned = text.trim();
  if (!/^\d{1,5}$/.test(cleaned)) {
    return undefined;
  }
  const value = Number(cleaned);
  return value >= min && value <= max ? value : undefined;
}

export const NOT_WIRED_SHIPPING: ShippingPolicySource = {
  readConditions: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHIPPING_REASON }),
  saveConditions: () => Promise.resolve({ kind: 'not-wired' }),
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHIPPING_REASON }),
  saveDraft: () => Promise.resolve({ kind: 'not-wired' }),
  apply: () => Promise.resolve({ kind: 'not-wired' }),
  preview: () => Promise.resolve({ kind: 'not-wired' }),
};

export const SHIPPING_REFUSAL_MESSAGE: Record<string, string> = {
  SHIPPING_POLICY_INVALID: 'Bảng giá chưa hợp lệ (có hở, chồng lấn hoặc giá âm). Chưa có gì được lưu.',
  SHIPPING_DRAFT_EMPTY: 'Chưa có bản nháp nào để áp dụng. Hãy lưu bản nháp trước.',
  SHIPPING_ELIGIBILITY_VERSION_CONFLICT: 'Tham số vừa được thay đổi ở nơi khác. Hãy tải lại để xem giá trị hiện tại.',
  SHIPPING_POLICY_UNCHANGED: 'Bản nháp giống hệt bảng giá đang áp dụng, không cần áp dụng lại.',
  ADMIN_INPUT_INVALID: 'Dữ liệu không hợp lệ. Hãy kiểm tra lại các ô đã nhập.',
};

// ---- typing: km text <-> whole metres, VND text <-> whole VND ---------------------------------------------------------

/** "2", "2.5", "2,5", "0.125" -> metres (at most 3 decimals); undefined for anything else (so a rounding never happens silently). */
export function parseKm(text: string): number | undefined {
  const cleaned = text.trim().replace(',', '.');
  const match = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (match === null) {
    return undefined;
  }
  const metres = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return metres <= SHIPPING_MAX_DISTANCE_M ? metres : undefined;
}

/** Whole metres -> km text without trailing zeros ("2", "2.5", "0.125"). */
export function formatKm(metres: number): string {
  const whole = Math.floor(metres / 1000);
  const rest = metres % 1000;
  return rest === 0 ? String(whole) : `${String(whole)}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

/** "10000", "10.000" -> 10000; undefined for anything that is not a whole, non-negative amount within the limit. */
export function parseFee(text: string): number | undefined {
  const cleaned = text.trim().replace(/[.\s]/g, '');
  if (!/^\d{1,8}$/.test(cleaned)) {
    return undefined;
  }
  const value = Number(cleaned);
  return value <= SHIPPING_MAX_FEE_VND ? value : undefined;
}

export function formatFee(vnd: number): string {
  return `${vnd.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

// ---- editing model ----------------------------------------------------------------------------------------------------

/** One row as typed. Nothing here is a number until `validateEditing` reads it. */
export interface EditRow {
  from: string;
  to: string;
  fee: string;
}

export interface EditTail {
  base: string;
  step: string;
  stepFee: string;
}

export interface EditingModel {
  rows: EditRow[];
  tail: EditTail;
}

export function toEditing(table: PolicyTable | null): EditingModel {
  if (table === null) {
    return { rows: [], tail: { base: '', step: '', stepFee: '' } };
  }
  return {
    rows: table.tiers.map((t) => ({ from: formatKm(t.fromM), to: formatKm(t.toM), fee: String(t.feeVnd) })),
    tail: { base: String(table.tail.baseFeeVnd), step: formatKm(table.tail.stepM), stepFee: String(table.tail.stepFeeVnd) },
  };
}

export interface EditingProblems {
  /** One message per row field that is wrong, by row index. */
  readonly rows: ReadonlyArray<{ readonly from?: string; readonly to?: string; readonly fee?: string }>;
  readonly tail: { readonly base?: string; readonly step?: string; readonly stepFee?: string };
  /** A problem of the table as a whole ("add at least one tier"). */
  readonly table?: string;
}

export interface EditingResult {
  readonly table: PolicyTable | undefined;
  readonly problems: EditingProblems;
}

/** Reads what was typed and says what is wrong; `table` is set only when nothing is wrong (the same rules the backend enforces). */
export function validateEditing(model: EditingModel): EditingResult {
  const rows: Array<{ from?: string; to?: string; fee?: string }> = [];
  const tiers: PolicyTier[] = [];
  let expectedFrom = 0;
  let valid = true;
  model.rows.forEach((row, index) => {
    const problems: { from?: string; to?: string; fee?: string } = {};
    const from = parseKm(row.from);
    const to = parseKm(row.to);
    const fee = parseFee(row.fee);
    if (from === undefined) {
      problems.from = 'Nhập số km (tối đa 3 chữ số thập phân).';
    } else if (index === 0 && from !== 0) {
      problems.from = 'Mốc đầu tiên phải bắt đầu từ 0 km.';
    } else if (index > 0 && from < expectedFrom) {
      problems.from = 'Chồng lấn với mốc trước.';
    } else if (index > 0 && from > expectedFrom) {
      problems.from = 'Hở khoảng so với mốc trước.';
    }
    if (to === undefined) {
      problems.to = 'Nhập số km (tối đa 3 chữ số thập phân).';
    } else if (from !== undefined && to <= from) {
      problems.to = '“Đến dưới” phải lớn hơn “Từ”.';
    }
    if (fee === undefined) {
      problems.fee = `Nhập số VND nguyên từ 0 đến ${formatFee(SHIPPING_MAX_FEE_VND)}.`;
    }
    if (from !== undefined && to !== undefined && fee !== undefined && Object.keys(problems).length === 0) {
      tiers.push({ fromM: from, toM: to, feeVnd: fee });
    } else {
      valid = false;
    }
    if (Object.keys(problems).length > 0) {
      valid = false;
    }
    rows.push(problems);
    expectedFrom = to ?? expectedFrom;
  });
  const base = parseFee(model.tail.base);
  const stepM = parseKm(model.tail.step);
  const stepFee = parseFee(model.tail.stepFee);
  const tail: { base?: string; step?: string; stepFee?: string } = {};
  if (base === undefined) {
    tail.base = `Nhập số VND nguyên từ 0 đến ${formatFee(SHIPPING_MAX_FEE_VND)}.`;
  }
  if (stepM === undefined || stepM < 1 || stepM > SHIPPING_MAX_STEP_M) {
    tail.step = 'Nhập bước km lớn hơn 0.';
  }
  if (stepFee === undefined) {
    tail.stepFee = `Nhập số VND nguyên từ 0 đến ${formatFee(SHIPPING_MAX_FEE_VND)}.`;
  }
  let table: string | undefined;
  if (model.rows.length === 0) {
    table = 'Thêm ít nhất một mốc giá.';
  } else if (model.rows.length > SHIPPING_MAX_TIERS) {
    table = `Tối đa ${String(SHIPPING_MAX_TIERS)} mốc.`;
  }
  const clean = valid && table === undefined && Object.keys(tail).length === 0 && base !== undefined && stepM !== undefined && stepFee !== undefined;
  return {
    table: clean ? { tiers, tail: { baseFeeVnd: base, stepM, stepFeeVnd: stepFee } } : undefined,
    problems: { rows, tail, ...(table === undefined ? {} : { table }) },
  };
}

/** What changed from `before` to `after`, as short lines for the history comparison. */
export function describeChanges(before: PolicyTable | null, after: PolicyTable): string[] {
  if (before === null) {
    return ['Bảng giá đầu tiên.'];
  }
  const lines: string[] = [];
  const max = Math.max(before.tiers.length, after.tiers.length);
  for (let i = 0; i < max; i += 1) {
    const a = before.tiers[i];
    const b = after.tiers[i];
    if (a === undefined && b !== undefined) {
      lines.push(`Thêm mốc ${formatKm(b.fromM)}–${formatKm(b.toM)} km: ${formatFee(b.feeVnd)}`);
    } else if (a !== undefined && b === undefined) {
      lines.push(`Bỏ mốc ${formatKm(a.fromM)}–${formatKm(a.toM)} km (${formatFee(a.feeVnd)})`);
    } else if (a !== undefined && b !== undefined && (a.fromM !== b.fromM || a.toM !== b.toM || a.feeVnd !== b.feeVnd)) {
      lines.push(`Mốc ${i + 1}: ${formatKm(a.fromM)}–${formatKm(a.toM)} km ${formatFee(a.feeVnd)} → ${formatKm(b.fromM)}–${formatKm(b.toM)} km ${formatFee(b.feeVnd)}`);
    }
  }
  const t = before.tail;
  const n = after.tail;
  if (t.baseFeeVnd !== n.baseFeeVnd || t.stepM !== n.stepM || t.stepFeeVnd !== n.stepFeeVnd) {
    lines.push(`Sau mốc cuối: ${formatFee(t.baseFeeVnd)} + ${formatFee(t.stepFeeVnd)}/${formatKm(t.stepM)} km → ${formatFee(n.baseFeeVnd)} + ${formatFee(n.stepFeeVnd)}/${formatKm(n.stepM)} km`);
  }
  return lines.length === 0 ? ['Không đổi nội dung.'] : lines;
}
