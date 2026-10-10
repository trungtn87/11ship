// Input rules shared by the controller and the view. They mirror the backend exactly and never "repair" a value the
// backend would refuse.

// Same contract as apps/backend/src/auth/phone.ts: after trimming the outer whitespace, 0XXXXXXXXX, 84XXXXXXXXX or
// +84XXXXXXXXX with exactly nine ASCII digits. Nothing inside the number is repaired (spaces, dots, Unicode digits).
const VIETNAM_MOBILE = /^(?:\+84|84|0)[0-9]{9}$/;
const MAX_PHONE_INPUT = 64;

export function isValidPhone(input: string): boolean {
  return input.length <= MAX_PHONE_INPUT && VIETNAM_MOBILE.test(input.trim());
}

const CODE_LENGTH = 6;

/**
 * What the code field keeps from typing or pasting: ASCII digits only (spaces, dashes and any other character of a
 * paste such as "123 456" are dropped; full-width or other non-ASCII digits are NOT converted), at most six. The
 * result is a string, so a leading zero is kept.
 */
export function sanitizeCodeInput(raw: string): string {
  let digits = '';
  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      digits += char;
      if (digits.length === CODE_LENGTH) {
        break;
      }
    }
  }
  return digits;
}

/** Exactly six ASCII digits: the only shape the backend accepts. */
export function isCompleteCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

/** The setup key in groups of four for reading; the copy/paste value stays the raw key. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}
