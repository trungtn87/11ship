import { Refused } from './shippers.js';

// "Phí & điều kiện giao › Bảng giá ship" (M06-A): the model, the editing rules and the port the page talks to. The backend decides every
// rule again (SYSTEM only writes; a table that is not continuous is refused); the checks here only tell the person what is wrong while
// typing. Distances are whole metres on the wire and in the model; the screen shows and accepts km with up to three decimals.

export const SHIPPING_TIER_COUNT = 3;
export const SHIPPING_MAX_FEE_VND = 10_000_000;
export const SHIPPING_MAX_DISTANCE_M = 1_000_000;
export const NOT_WIRED_SHIPPING_REASON = 'Bảng giá ship chưa được nối với máy chủ ở bản này.';

export interface PolicyTier {
  readonly fromM: number;
  readonly toM: number;
  readonly feeVnd: number;
}

/** Exactly three bands: [0,b1) [b1,b2) [b2,b3] (the last bound is included). Beyond b3 there is no fee. */
export interface PolicyTable {
  readonly tiers: readonly PolicyTier[];
}

/** The v1.0 "after the last band" formula: shown for an OLD version in the history only; never edited, never used to price. */
export interface LegacyTail {
  readonly baseFeeVnd: number;
  readonly stepM: number;
  readonly stepFeeVnd: number;
}

export interface PolicyVersionInfo extends PolicyTable {
  readonly versionNo: number;
  /** A v1.0 version (any number of bands + a tail): history only. */
  readonly legacy: boolean;
  readonly tail: LegacyTail | null;
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
  | { readonly kind: 'priced'; readonly feeVnd: number; readonly band: number; readonly basedOn: 'ACTIVE' | 'EDITING' }
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
  /** The fixed search radius (3 km, from the server): shown read-only, never a setting. */
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
  SHIPPING_POLICY_INVALID: 'Bảng giá chưa hợp lệ (cần đúng 3 khung liên tục, 0 < mốc 1 < mốc 2 < mốc 3, phí không âm). Chưa có gì được lưu.',
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

/** The three bands as typed: the upper bound (km) and the fee of each. The lower bound of a band is the upper bound of the one before (0 for the first). */
export interface EditingModel {
  bounds: [string, string, string];
  fees: [string, string, string];
}

export function toEditing(table: PolicyTable | null): EditingModel {
  if (table === null || table.tiers.length !== SHIPPING_TIER_COUNT) {
    return { bounds: ['', '', ''], fees: ['', '', ''] };
  }
  const [a, b, c] = table.tiers as [PolicyTier, PolicyTier, PolicyTier];
  return { bounds: [formatKm(a.toM), formatKm(b.toM), formatKm(c.toM)], fees: [String(a.feeVnd), String(b.feeVnd), String(c.feeVnd)] };
}

export interface EditingProblems {
  /** One message per field that is wrong (index = band). */
  readonly bounds: ReadonlyArray<string | undefined>;
  readonly fees: ReadonlyArray<string | undefined>;
}

export interface EditingResult {
  readonly table: PolicyTable | undefined;
  readonly problems: EditingProblems;
}

/** Reads what was typed and says what is wrong; `table` is set only when nothing is wrong (0 < b1 < b2 < b3, whole fees 0..limit: the rules the server enforces). */
export function validateEditing(model: EditingModel): EditingResult {
  const bounds: Array<string | undefined> = [];
  const fees: Array<string | undefined> = [];
  const metres: Array<number | undefined> = [];
  let previous = 0;
  let valid = true;
  model.bounds.forEach((text, index) => {
    const m = parseKm(text);
    let problem: string | undefined;
    if (m === undefined) {
      problem = 'Nhập số km (tối đa 3 chữ số thập phân).';
    } else if (m <= previous) {
      problem = index === 0 ? '“Đến dưới” phải lớn hơn 0 km.' : 'Phải lớn hơn mốc của khung trước (không chồng lấn).';
    }
    if (problem !== undefined) {
      valid = false;
    }
    bounds.push(problem);
    metres.push(m);
    previous = m ?? previous;
  });
  const parsedFees = model.fees.map((text) => parseFee(text));
  parsedFees.forEach((fee) => {
    if (fee === undefined) {
      valid = false;
    }
    fees.push(fee === undefined ? `Nhập số VND nguyên từ 0 đến ${formatFee(SHIPPING_MAX_FEE_VND)}.` : undefined);
  });
  if (!valid) {
    return { table: undefined, problems: { bounds, fees } };
  }
  const [b1, b2, b3] = metres as [number, number, number];
  const [f1, f2, f3] = parsedFees as [number, number, number];
  return { table: { tiers: [{ fromM: 0, toM: b1, feeVnd: f1 }, { fromM: b1, toM: b2, feeVnd: f2 }, { fromM: b2, toM: b3, feeVnd: f3 }] }, problems: { bounds, fees } };
}

/** What changed from `before` to `after`, as short lines for the history comparison. A v1.0 (legacy) version has a different shape, so it is not compared line by line. */
export function describeChanges(before: PolicyTable | null, after: PolicyTable, beforeIsLegacy = false): string[] {
  if (before === null || beforeIsLegacy || before.tiers.length !== after.tiers.length) {
    return [before === null ? 'Bảng giá đầu tiên.' : 'Chuyển sang bảng giá 3 khung (phiên bản trước dùng định dạng cũ).'];
  }
  const lines: string[] = [];
  after.tiers.forEach((b, i) => {
    const a = before.tiers[i] as PolicyTier;
    if (a.toM !== b.toM || a.feeVnd !== b.feeVnd) {
      lines.push(`Khung ${String(i + 1)}: ${formatKm(a.fromM)}–${formatKm(a.toM)} km ${formatFee(a.feeVnd)} → ${formatKm(b.fromM)}–${formatKm(b.toM)} km ${formatFee(b.feeVnd)}`);
    }
  });
  return lines.length === 0 ? ['Không đổi nội dung.'] : lines;
}
