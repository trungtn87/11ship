import { AppError } from '../common/app-errors';
import { VN_MOBILE_PREFIXES } from './vn-mobile-prefixes.generated';

// Phone contract (M01-A1 task section 7). A1 supports Vietnamese mobile numbers only. After the outer
// whitespace is trimmed, the accepted forms are
//   0XXXXXXXXX      84XXXXXXXXX      +84XXXXXXXXX
// where the subscriber part XXXXXXXXX is exactly nine ASCII digits, and the normalized form is
// +84XXXXXXXXX. No external locale parser is used: it would accept other countries, other separators and
// non-ASCII digits that A1 must refuse.
//
// Nothing inside the number is repaired: spaces, dashes, dots, parentheses and Unicode digits (including
// full-width and Arabic-Indic digits) all make it invalid.

const VIETNAM_MOBILE = /^(?:\+84|84|0)([0-9]{9})$/;

// A bound so that an enormous string never reaches the pattern. The longest valid input is "+84" + 9 digits.
const MAX_INPUT_LENGTH = 64;

/** The normalized +84XXXXXXXXX form, or undefined when the input is not a valid Vietnamese mobile number. */
export function normalizeVietnamPhone(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
    return undefined;
  }
  const match = VIETNAM_MOBILE.exec(input.trim());
  if (match === null) {
    return undefined;
  }
  return `+84${match[1]}`;
}

/** Like normalizeVietnamPhone but raises the typed INVALID_PHONE error. The input is never echoed. */
export function requireNormalizedPhone(input: unknown): string {
  const normalized = normalizeVietnamPhone(input);
  if (normalized === undefined) {
    throw new AppError('INVALID_PHONE');
  }
  return normalized;
}

/**
 * OTP rule (issue #117, Owner 2026-10-24): a number that may receive an OTP SMS must be a Vietnamese MOBILE number, that is a
 * well formed number (above) whose 10 national digits start with an allocated mobile prefix. The prefixes come from the central
 * table config/vn-mobile-prefixes.json (no lookup service is called per request). A prefix only says the range was allocated: it
 * does not say the subscriber exists or which operator holds the number now, and ported numbers are not refused.
 * Login and the other users of normalizeVietnamPhone keep the looser format rule on purpose, so no existing account is affected.
 */
export function isAllocatedMobile(normalized: string, prefixes: readonly string[] = VN_MOBILE_PREFIXES): boolean {
  if (!/^\+84[0-9]{9}$/.test(normalized)) {
    return false;
  }
  const national = `0${normalized.slice(3)}`;
  return prefixes.some((prefix) => national.startsWith(prefix));
}

/** The normalized +84XXXXXXXXX form of an allocated Vietnamese mobile number, or undefined. */
export function normalizeVietnamMobile(input: unknown, prefixes: readonly string[] = VN_MOBILE_PREFIXES): string | undefined {
  const normalized = normalizeVietnamPhone(input);
  return normalized !== undefined && isAllocatedMobile(normalized, prefixes) ? normalized : undefined;
}

/** Like normalizeVietnamMobile but raises INVALID_PHONE (the OTP request routes). The input is never echoed. */
export function requireVietnamMobile(input: unknown): string {
  const normalized = normalizeVietnamMobile(input);
  if (normalized === undefined) {
    throw new AppError('INVALID_PHONE');
  }
  return normalized;
}
