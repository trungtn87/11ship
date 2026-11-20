// Icon picture of a dish group (issue #412), client side. This is a PRE-CHECK only: the backend (apps/backend/src/menu/menu-category-image.ts)
// checks the same rules again and is the authority. The type is read from the bytes (magic numbers), never from the file name or the
// browser's declared type. Rules: PNG or WebP, at most 1 MiB, square, at least 256 x 256 px. Messages are Vietnamese and say the limit.

export const ICON_MAX_BYTES = 1_048_576;
export const ICON_MIN_SIDE = 256;
export const ICON_ACCEPT = 'image/png,image/webp';

export type IconContentType = 'image/png' | 'image/webp';

export type IconCheck = { readonly ok: true; readonly contentType: IconContentType } | { readonly ok: false; readonly message: string };

export const ICON_MESSAGE = {
  empty: 'Tệp trống. Chọn một ảnh PNG hoặc WebP.',
  tooLarge: 'Ảnh vượt quá 1 MB. Hãy chọn ảnh nhỏ hơn hoặc nén lại.',
  format: 'Chỉ chấp nhận ảnh PNG hoặc WebP thật. Tệp này không phải PNG hoặc WebP.',
  unreadable: 'Không đọc được kích thước ảnh. Hãy xuất lại ảnh dưới dạng PNG hoặc WebP.',
  tooSmall: `Ảnh phải có kích thước tối thiểu ${String(ICON_MIN_SIDE)} × ${String(ICON_MIN_SIDE)} px.`,
  notSquare: 'Ảnh phải vuông (chiều rộng bằng chiều cao).',
} as const;

function readU32BE(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
}

function readU16LE(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function readU24LE(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** The type from the first bytes: PNG signature or RIFF....WEBP. Anything else is not accepted (JPEG included). */
export function iconTypeOf(bytes: Uint8Array): IconContentType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Width and height from the header (PNG IHDR; WebP VP8, VP8L or VP8X). null when the header cannot be read. */
export function iconSizeOf(bytes: Uint8Array, type: IconContentType): { readonly width: number; readonly height: number } | null {
  if (type === 'image/png') {
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return null;
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  if (bytes.length < 25) return null;
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: readU16LE(bytes, 26) & 0x3fff, height: readU16LE(bytes, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    return { width: 1 + readU24LE(bytes, 24), height: 1 + readU24LE(bytes, 27) };
  }
  return null;
}

/** Checks a picked file's bytes. The first failing rule is reported. */
export function checkCategoryIcon(bytes: Uint8Array): IconCheck {
  if (bytes.length === 0) return { ok: false, message: ICON_MESSAGE.empty };
  if (bytes.length > ICON_MAX_BYTES) return { ok: false, message: ICON_MESSAGE.tooLarge };
  const type = iconTypeOf(bytes);
  if (type === null) return { ok: false, message: ICON_MESSAGE.format };
  const size = iconSizeOf(bytes, type);
  if (size === null) return { ok: false, message: ICON_MESSAGE.unreadable };
  if (size.width < ICON_MIN_SIDE || size.height < ICON_MIN_SIDE) return { ok: false, message: ICON_MESSAGE.tooSmall };
  if (size.width !== size.height) return { ok: false, message: ICON_MESSAGE.notSquare };
  return { ok: true, contentType: type };
}

/** Standard base64 of the bytes (for the JSON body). Chunked so a 1 MB file does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
