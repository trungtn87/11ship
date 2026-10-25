import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

export const invalid = (): never => { throw new AppError('ADMIN_INPUT_INVALID'); };
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.keys(value).every((k) => keys.includes(k))) return invalid();
  return value as Record<string, unknown>;
}
export function id(value: unknown): string { return isCanonicalUuid(value) ? value : invalid(); }
export function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || value.trim().length < 1 || [...value.trim()].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return invalid();
  return value.trim();
}
export function positive(value: unknown, max = 1_000_000_000_000): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max ? value : invalid();
}
export function sequence(value: unknown): string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(value) ? value : invalid();
}
export function page(query: unknown): { before: string | null; state: string | null } {
  const q = object(query, ['before','state']);
  if (q.state !== undefined && (typeof q.state !== 'string' || !['PENDING','CONFIRMED','REJECTED','CANCELLED'].includes(q.state))) return invalid();
  return { before: q.before === undefined ? null : isCanonicalUuid(q.before) ? q.before : sequence(q.before), state: typeof q.state === 'string' ? q.state : null };
}
// Endpoints are sent by the browser but called by the server. Only real Web Push providers are allowed (SSRF boundary).
export const PUSH_HOSTS = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
export function subscription(value: unknown): { endpoint: string; p256dh: string; auth: string } {
  const b = object(value, ['endpoint','keys']); const keys = object(b.keys, ['p256dh','auth']);
  if (typeof b.endpoint !== 'string' || b.endpoint.length > 2048) return invalid();
  let u: URL; try { u = new URL(b.endpoint); } catch { return invalid(); }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.has(u.hostname) || u.port !== '' || u.username || u.password || u.hash) return invalid();
  if (typeof keys.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh) || typeof keys.auth !== 'string' || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth)) return invalid();
  const point = Buffer.from(keys.p256dh,'base64url');
  if (point.length !== 65 || point[0] !== 4 || Buffer.from(keys.auth,'base64url').length !== 16) return invalid();
  return { endpoint: u.href, p256dh: keys.p256dh, auth: keys.auth };
}
