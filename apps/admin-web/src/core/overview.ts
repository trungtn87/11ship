// Model of "Tổng quan điều hành" (M12-A): KPI of the chosen period, the CURRENT state, and the work waiting for an administrator. PLAIN DATA plus the
// port the page talks to (dom/overview-view.ts draws it, core/overview-api.ts reads it). Every figure is a Metric with its own status: a figure the
// administrator may not see is FORBIDDEN, one whose module is not built is NOT_READY and one that failed to load is ERROR. None of them is ever
// shown as 0: the page prints "—" and the reason. Period figures and current-state figures are separate groups and labelled so.

import { Failure } from './accounts.js';

export const OVERVIEW_RANGES = ['today', 'yesterday', '7d', 'month', 'custom'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const OVERVIEW_RANGE_LABEL: Record<OverviewRange, string> = {
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  '7d': '7 ngày',
  month: 'Tháng này',
  custom: 'Tùy chọn',
};

export interface OverviewQuery {
  readonly range: OverviewRange;
  /** `YYYY-MM-DD` days of the Vietnam calendar; only for `custom`. */
  readonly from?: string;
  readonly to?: string;
}

/** Where a figure leads: the area of the web and the filter its list opens with (the list shows the same number). */
export interface MetricLink {
  readonly area: 'deliveries' | 'shippers' | 'finance-topups';
  readonly query: Readonly<Record<string, string>>;
}

export type Metric =
  | { readonly status: 'OK'; readonly value: number; readonly link?: MetricLink; readonly detail?: Readonly<Record<string, number>> }
  | { readonly status: 'FORBIDDEN' }
  | { readonly status: 'NOT_READY'; readonly reason: string }
  | { readonly status: 'ERROR' };

export interface MetricGroup {
  readonly scope: 'PERIOD' | 'CURRENT';
  readonly metrics: Readonly<Record<string, Metric>>;
}

export type SuccessRate = { readonly numerator: number; readonly denominator: number } | { readonly status: Exclude<Metric['status'], 'OK'> };

export interface TodoItem {
  readonly key: string;
  readonly metric: Metric;
}

export interface Overview {
  /** ISO instant (database clock) the figures were read at. */
  readonly generatedAt: string;
  readonly period: { readonly range: OverviewRange; readonly from: string; readonly to: string; readonly fromDay: string; readonly toDay: string };
  readonly groups: Readonly<Record<string, MetricGroup>>;
  readonly successRate: SuccessRate;
  readonly todo: readonly TodoItem[];
}

export type OverviewRead = { readonly kind: 'ready'; readonly overview: Overview } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export interface OverviewSource {
  read(query: OverviewQuery): Promise<OverviewRead>;
}

export const NOT_WIRED_OVERVIEW_REASON = 'Tổng quan điều hành chưa được nối với máy chủ. Không có số liệu nào được hiển thị.';

export const NOT_WIRED_OVERVIEW: OverviewSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_OVERVIEW_REASON }),
};

/** Why a figure is not there, in the words an administrator reads. Unknown reasons are shown as a neutral sentence, never as the raw code. */
export const NOT_READY_TEXT: Record<string, string> = {
  M10_ORDER_NOT_CONNECTED: 'Order (M10) chưa được xây dựng',
  M04C_WITHDRAWAL_NOT_CONNECTED: 'Rút tiền (M04-C) chưa được xây dựng',
  M11_FEEDBACK_NOT_CONNECTED: 'Phản ánh (M11) chưa được xây dựng',
  M02_NO_SHOP_REVIEW_FLOW: 'Hồ sơ quán không có bước duyệt',
};

export function notReadyText(reason: string): string {
  return NOT_READY_TEXT[reason] ?? 'Chưa sẵn sàng';
}

/** The pause-free date `YYYY-MM-DD` of an instant on the Vietnam calendar (the browser's own zone is never used for a period). */
export function vietnamToday(nowMs: number): string {
  return new Date(nowMs + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** A custom range the server would accept: both days real, from <= to, to not after today, at most 92 days. The server checks again. */
export function customRangeError(from: string, to: string, nowMs: number): string | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/;
  const parse = (text: string): number | undefined => {
    const match = day.exec(text);
    if (match === null) {
      return undefined;
    }
    const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const check = new Date(at);
    return check.getUTCFullYear() === Number(match[1]) && check.getUTCMonth() === Number(match[2]) - 1 && check.getUTCDate() === Number(match[3]) ? at : undefined;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === undefined || end === undefined) {
    return 'Chọn đủ ngày bắt đầu và ngày kết thúc.';
  }
  if (start > end) {
    return 'Ngày bắt đầu phải trước hoặc cùng ngày kết thúc.';
  }
  if (end > (parse(vietnamToday(nowMs)) as number)) {
    return 'Ngày kết thúc không được sau hôm nay.';
  }
  if ((end - start) / 86_400_000 + 1 > 92) {
    return 'Khoảng thời gian tối đa là 92 ngày.';
  }
  return undefined;
}
