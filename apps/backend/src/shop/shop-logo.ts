import { createHash } from 'node:crypto';
import { AppError } from '../common/app-errors';

export interface ShopLogo {
  readonly content_type: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly data_base64: string;
}

/** Omitted preserves the current logo, null removes it. SVG and arbitrary URLs are never accepted. */
export function parseShopLogo(value: unknown): ShopLogo | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_SHOP_LOGO');
  const input = value as Record<string, unknown>;
  const data = input.data_base64;
  if (typeof data === 'string' && data.length > 1398104) throw new AppError('SHOP_LOGO_TOO_LARGE');
  if (Object.keys(input).length !== 2 || typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new AppError('INVALID_SHOP_LOGO');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 1048576) throw new AppError('SHOP_LOGO_TOO_LARGE');
  if (bytes.length === 0 || bytes.toString('base64') !== data) throw new AppError('INVALID_SHOP_LOGO');
  const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (type === null || input.content_type !== type) throw new AppError('INVALID_SHOP_LOGO');
  return { content_type: type, data_base64: data };
}

/** Bounded, content-sensitive idempotency input; the original bytes are still saved. */
export function shopLogoFingerprint(logo: ShopLogo | null): { content_type: string; sha256: string } | null {
  return logo === null ? null : { content_type: logo.content_type, sha256: createHash('sha256').update(Buffer.from(logo.data_base64, 'base64')).digest('hex') };
}
