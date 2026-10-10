import { describe, expect, it } from '@jest/globals';
import { EMPTY_PERMISSIONS, groupSecret, hasAnyPermission, isCompleteCode, isValidPassword, isValidPhone, normalizeFullName, normalizeNote, normalizeReason, sanitizeCodeInput, togglePermission } from './inputs';
import { formatCountdown } from './messages';

describe('admin web inputs', () => {
  it('accepts exactly the backend phone forms', () => {
    for (const valid of ['0912345678', '84912345678', '+84912345678', '  0912345678\t']) {
      expect(isValidPhone(valid)).toBe(true);
    }
    for (const invalid of ['091234567', '09123456789', '091 2345678', '091-234-5678', '+8491234567', '０912345678', '', 'abc', '0'.repeat(65)]) {
      expect(isValidPhone(invalid)).toBe(false);
    }
  });

  it('keeps a leading zero and the code as a string', () => {
    expect(sanitizeCodeInput('012345')).toBe('012345');
    expect(isCompleteCode('012345')).toBe(true);
  });

  it('cleans a pasted code: spaces and dashes dropped, at most six digits', () => {
    expect(sanitizeCodeInput('012 345')).toBe('012345');
    expect(sanitizeCodeInput(' 01-23-45 ')).toBe('012345');
    expect(sanitizeCodeInput('0123456789')).toBe('012345');
  });

  it('never converts non-ASCII digits', () => {
    expect(sanitizeCodeInput('０１２３４５')).toBe('');
    expect(sanitizeCodeInput('٠١٢٣٤٥')).toBe('');
    expect(isCompleteCode('０１２３４５')).toBe(false);
  });

  it('refuses anything that is not exactly six ASCII digits', () => {
    for (const code of ['', '12345', '1234567', '12345a', ' 123456', '123456 ']) {
      expect(isCompleteCode(code)).toBe(false);
    }
  });

  it('groups the setup key by four for reading', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDE')).toBe('ABCD E');
  });

  it('formats the countdown as mm:ss', () => {
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(61)).toBe('01:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-3)).toBe('00:00');
  });
});

describe('invitation form rules', () => {
  it('trims and bounds name and reason in code points; the note is kept as typed', () => {
    expect(normalizeFullName('  Nguyễn Văn A  ')).toBe('Nguyễn Văn A');
    expect(normalizeFullName('   ')).toBeUndefined();
    expect(normalizeFullName('😀'.repeat(120))).toBe('😀'.repeat(120));
    expect(normalizeFullName('😀'.repeat(121))).toBeUndefined();
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote(' x ')).toBe(' x ');
    expect(normalizeNote('a'.repeat(1001))).toBeUndefined();
    expect(normalizeReason(' lý do ')).toBe('lý do');
    expect(normalizeReason('a'.repeat(501))).toBeUndefined();
  });

  it('password: 8-128 code points, well-formed, never trimmed', () => {
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('        ')).toBe(true);
    expect(isValidPassword('😀'.repeat(8))).toBe(true);
    expect(isValidPassword('a'.repeat(129))).toBe(false);
    expect(isValidPassword('abcdefg\ud800')).toBe(false);
  });

  it('permission toggles follow the backend rules', () => {
    let draft = togglePermission(EMPTY_PERMISSIONS, 'SHOP', 'canLock', true);
    expect(draft.SHOP).toEqual({ canView: true, canReviewProfile: false, canLock: true });
    draft = togglePermission(draft, 'SHOP', 'canView', false);
    expect(draft.SHOP).toEqual({ canView: false, canReviewProfile: false, canLock: false });
    expect(togglePermission(EMPTY_PERMISSIONS, 'CUSTOMER', 'canReviewProfile', true)).toBe(EMPTY_PERMISSIONS);
    expect(hasAnyPermission(EMPTY_PERMISSIONS)).toBe(false);
    expect(hasAnyPermission(togglePermission(EMPTY_PERMISSIONS, 'DRIVER', 'canView', true))).toBe(true);
  });
});
