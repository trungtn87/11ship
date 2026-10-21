import { AppError } from '../common/app-errors';
export const TIMEOUT_DEFAULTS = { confirmation_reminder: 15, confirmation_interval: 5, confirmation_cancel: 30, search_stop: 30, search_cancel: 60, pickup_warning: 30, pickup_cancel: 60 } as const;
export type TimeoutParameters = { readonly [K in keyof typeof TIMEOUT_DEFAULTS]: number };
export const TIMEOUT_KEYS = Object.keys(TIMEOUT_DEFAULTS) as (keyof TimeoutParameters)[];
export function parseTimeoutParameters(raw: unknown): TimeoutParameters {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new AppError('ADMIN_INPUT_INVALID');
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== [...TIMEOUT_KEYS].sort().join() || TIMEOUT_KEYS.some(k => !Number.isSafeInteger(v[k]) || Number(v[k]) < 1 || Number(v[k]) > 1440)) throw new AppError('ADMIN_INPUT_INVALID');
  const p = v as TimeoutParameters;
  if (p.confirmation_reminder >= p.confirmation_cancel || p.confirmation_interval >= p.confirmation_cancel || p.search_stop > p.search_cancel || p.pickup_warning >= p.pickup_cancel) throw new AppError('ADMIN_INPUT_INVALID');
  return p;
}
export interface TimeoutSnapshot { readonly rule_version: number; readonly started_at: string; readonly warning_at: string; readonly cancel_at: string; readonly reminder_interval: number }
export const timeoutDue = (snapshot: TimeoutSnapshot, nowMs: number): boolean => nowMs >= Date.parse(snapshot.cancel_at);
