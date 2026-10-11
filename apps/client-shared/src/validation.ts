// Input rules of the phone apps. They mirror the backend contract (design set 04-data-api section 2 and 10-m01-client-
// contract section 3) and never "repair" a value the backend would refuse. They validate FORM INPUT only; the server
// stays the authority (a value that passes here can still be refused there).

export const OTP_LENGTH = 6;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PERSON_NAME_MAX = 120;
export const SHOP_NAME_MAX = 120;
export const ADDRESS_MAX = 500;
export const ZALO_MAX = 160;
export const FACEBOOK_MAX = 300;
export const PLATE_MAX = 32;

// Same contract as apps/backend/src/auth/phone.ts: after trimming the outer whitespace, 0XXXXXXXXX, 84XXXXXXXXX or
// +84XXXXXXXXX with exactly nine ASCII digits. Nothing inside the number is repaired.
const VIETNAM_MOBILE = /^(?:\+84|84|0)[0-9]{9}$/;
const MAX_PHONE_INPUT = 64;

export function isValidPhone(input: string): boolean {
  return input.length <= MAX_PHONE_INPUT && VIETNAM_MOBILE.test(input.trim());
}

/** `098 •••• 123` for display (first three and last three digits). Returns undefined for an invalid phone. */
export function maskPhone(input: string): string | undefined {
  if (!isValidPhone(input)) {
    return undefined;
  }
  const trimmed = input.trim();
  const national = trimmed.startsWith('+84') ? `0${trimmed.slice(3)}` : trimmed.startsWith('84') ? `0${trimmed.slice(2)}` : trimmed;
  return `${national.slice(0, 3)} •••• ${national.slice(7)}`;
}

/** What the OTP field keeps from typing or pasting: ASCII digits only, at most six. A string, so a leading zero stays. */
export function sanitizeOtp(raw: string): string {
  let digits = '';
  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      digits += char;
      if (digits.length === OTP_LENGTH) {
        break;
      }
    }
  }
  return digits;
}

export function isCompleteOtp(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

function codePoints(text: string): number {
  return [...text].length;
}

/** True when `text` has no lone surrogate (the backend refuses ill-formed strings). */
export function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** 8-128 code points, well-formed. The password is never trimmed or changed. No composition rule (backend has none). */
export function isValidPassword(password: string): boolean {
  const length = codePoints(password);
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX && isWellFormed(password);
}

/**
 * Person name (customer profile, register): NFC, trim, collapse Unicode whitespace to one U+0020, reject control and
 * format characters (zero-width included), 1-120 code points. Does not filter by script or require two words.
 */
export function normalizePersonName(input: string): string | undefined {
  if (!isWellFormed(input)) {
    return undefined;
  }
  const collapsed = input.normalize('NFC').replace(/\p{White_Space}+/gu, ' ').trim();
  if (/[\p{Cc}\p{Cf}]/u.test(collapsed)) {
    return undefined;
  }
  const length = codePoints(collapsed);
  return length >= 1 && length <= PERSON_NAME_MAX ? collapsed : undefined;
}

/** Required free text (shop name, address): trimmed, 1..max code points, well-formed. */
export function normalizeRequiredText(input: string, max: number): string | undefined {
  if (!isWellFormed(input)) {
    return undefined;
  }
  const trimmed = input.trim();
  const length = codePoints(trimmed);
  return length >= 1 && length <= max ? trimmed : undefined;
}

export type Optional<T> = { readonly ok: true; readonly value: T | null } | { readonly ok: false };

/** Optional link (Zalo, Facebook): empty = absent (null); otherwise an http(s) URL of at most `max` characters. */
export function normalizeOptionalLink(input: string, max: number): Optional<string> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (!isWellFormed(trimmed) || codePoints(trimmed) > max) {
    return { ok: false };
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? { ok: true, value: trimmed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Optional vehicle plate: empty = absent (null); otherwise at most 32 code points without control characters. */
export function normalizePlate(input: string): Optional<string> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (!isWellFormed(trimmed) || codePoints(trimmed) > PLATE_MAX || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

/** Latitude and longitude come together and stay inside +-90 / +-180 (backend bounds). */
export function isValidCoordinatePair(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}
