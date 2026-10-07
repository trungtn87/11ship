import { AppError } from '../common/app-errors';

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
