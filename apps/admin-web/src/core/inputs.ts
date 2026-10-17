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

// ---- Rules of the invitation form (1B) and of the activation password (1C). They mirror the backend validators
// (admin-provisioning-validation.ts, the registration password rule) so the form refuses what the server would refuse. ----

export const FULL_NAME_MAX = 120;
export const NOTE_MAX = 1000;
export const REASON_MAX = 500;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function codePoints(text: string): number {
  return [...text].length;
}

/** The server trims; so do we, and the trimmed value is what is sent. */
export function normalizeFullName(input: string): string | undefined {
  const trimmed = input.trim();
  const length = codePoints(trimmed);
  return length >= 1 && length <= FULL_NAME_MAX ? trimmed : undefined;
}

/** The note is optional and kept as typed; empty means "no note" (null). undefined = too long. */
export function normalizeNote(input: string): string | null | undefined {
  if (codePoints(input) > NOTE_MAX) {
    return undefined;
  }
  return input.length === 0 ? null : input;
}

export function normalizeReason(input: string): string | undefined {
  const trimmed = input.trim();
  const length = codePoints(trimmed);
  return length >= 1 && length <= REASON_MAX ? trimmed : undefined;
}

/** True when `text` has no lone surrogate (the backend refuses ill-formed strings). */
function isWellFormed(text: string): boolean {
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

/** 8-128 code points, well-formed. The password is never trimmed or changed. */
export function isValidPassword(password: string): boolean {
  const length = codePoints(password);
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX && isWellFormed(password);
}

export interface PermissionDraft {
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  /** Dish-group management (SHOP only; needs VIEW). Absent = off. */
  readonly canManageCatalog?: boolean;
}

export type PermissionsDraft = Readonly<Record<'CUSTOMER' | 'SHOP' | 'DRIVER', PermissionDraft>>;

export const EMPTY_PERMISSIONS: PermissionsDraft = {
  CUSTOMER: { canView: false, canReviewProfile: false, canLock: false },
  SHOP: { canView: false, canReviewProfile: false, canLock: false },
  DRIVER: { canView: false, canReviewProfile: false, canLock: false },
};

/**
 * Applies one checkbox the way the backend rules read: REVIEW/LOCK/CATALOG need VIEW (removing VIEW removes them, adding them
 * adds VIEW), the CUSTOMER app has no REVIEW, and only SHOP has the catalog (dish groups) right.
 */
export function togglePermission(
  draft: PermissionsDraft,
  app: 'CUSTOMER' | 'SHOP' | 'DRIVER',
  right: 'canView' | 'canReviewProfile' | 'canLock' | 'canManageCatalog',
  value: boolean,
): PermissionsDraft {
  if ((app === 'CUSTOMER' && right === 'canReviewProfile') || (app !== 'SHOP' && right === 'canManageCatalog')) {
    return draft;
  }
  const current = draft[app];
  let next: PermissionDraft = { ...current, [right]: value };
  if (right === 'canView' && !value) {
    next = { canView: false, canReviewProfile: false, canLock: false };
  } else if (right !== 'canView' && value) {
    next = { ...next, canView: true };
  }
  return { ...draft, [app]: next };
}

/** At least one app with VIEW; apps without VIEW are not sent at all. */
export function hasAnyPermission(draft: PermissionsDraft): boolean {
  return draft.CUSTOMER.canView || draft.SHOP.canView || draft.DRIVER.canView;
}
