// The name of a dish group (M02 administration). One rule for what is stored and what is compared:
//  * Unicode canonical composition (NFC), so a name typed with combining marks equals the same name typed precomposed;
//  * white space at both ends removed and runs of white space collapsed to one space;
//  * 1..80 code points, no control or format character.
// Two names are the SAME group when they are equal ignoring case after this normalisation. Vietnamese marks are never removed
// for that comparison ("Ốc" and "Oc" are two groups); the database key app.menu_category_key (migration 1793232000000) does the same.

export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_ORDER_MAX = 100000;

const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;

/** The stored form of a typed name, or undefined when it is empty, too long or contains forbidden characters. */
export function normalizeCategoryName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const collapsed = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...collapsed].length;
  if (length < 1 || length > CATEGORY_NAME_MAX || FORBIDDEN.test(collapsed)) {
    return undefined;
  }
  return collapsed;
}

/** The comparison key: what makes two names the same group (case only; marks stay). */
export function categoryNameKey(normalized: string): string {
  return normalized.toLowerCase();
}
