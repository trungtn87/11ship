import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { isAllocatedMobile, normalizeVietnamMobile, normalizeVietnamPhone, requireNormalizedPhone, requireVietnamMobile } from './phone';
import { VN_MOBILE_PREFIXES } from './vn-mobile-prefixes.generated';

describe('normalizeVietnamPhone (task section 4)', () => {
  it('normalizes the three accepted forms to +84XXXXXXXXX', () => {
    expect(normalizeVietnamPhone('0987654321')).toBe('+84987654321');
    expect(normalizeVietnamPhone('84987654321')).toBe('+84987654321');
    expect(normalizeVietnamPhone('+84987654321')).toBe('+84987654321');
  });

  it('trims only the outer whitespace', () => {
    expect(normalizeVietnamPhone('  0987654321\n')).toBe('+84987654321');
    expect(normalizeVietnamPhone('\t+84987654321 ')).toBe('+84987654321');
    expect(normalizeVietnamPhone('098 7654321')).toBeUndefined();
  });

  it('requires exactly nine ASCII subscriber digits', () => {
    expect(normalizeVietnamPhone('098765432')).toBeUndefined(); // 8
    expect(normalizeVietnamPhone('09876543210')).toBeUndefined(); // 10
    expect(normalizeVietnamPhone('+8498765432')).toBeUndefined();
    expect(normalizeVietnamPhone('+849876543210')).toBeUndefined();
    expect(normalizeVietnamPhone('84')).toBeUndefined();
    expect(normalizeVietnamPhone('0')).toBeUndefined();
  });

  it('rejects separators, other countries, other prefixes and non-ASCII digits', () => {
    const bad = [
      '',
      ' ',
      '098-765-4321',
      '(098)7654321',
      '098.765.4321',
      '+1987654321',
      '+85987654321',
      '0084987654321',
      '++84987654321',
      '+0987654321',
      '098765432a',
      '０９８７６５４３２１', // full-width digits
      '٠٩٨٧٦٥٤٣٢١', // Arabic-Indic digits
      '098765432١',
      '​0987654321',
      '0987654321​',
    ];
    for (const value of bad) {
      expect([JSON.stringify(value), normalizeVietnamPhone(value)]).toEqual([JSON.stringify(value), undefined]);
    }
  });

  it('rejects non-strings and enormous input without running the pattern on it', () => {
    for (const value of [undefined, null, 987654321, {}, [], true]) {
      expect(normalizeVietnamPhone(value)).toBeUndefined();
    }
    expect(normalizeVietnamPhone('0'.repeat(100_000))).toBeUndefined();
  });

  it('is idempotent on its own output', () => {
    const once = normalizeVietnamPhone('0912345678') as string;
    expect(normalizeVietnamPhone(once)).toBe(once);
  });
});

describe('requireNormalizedPhone', () => {
  it('returns the normalized phone', () => {
    expect(requireNormalizedPhone('0987654321')).toBe('+84987654321');
  });

  it('throws the typed INVALID_PHONE error without echoing the input', () => {
    try {
      requireNormalizedPhone('SECRET_MARKER_PHONE_77');
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('INVALID_PHONE');
      expect((error as AppError).status).toBe(400);
      expect((error as AppError).message).not.toContain('SECRET_MARKER_PHONE_77');
    }
  });
});

describe('Vietnamese mobile allocation rule for OTP (issue #117)', () => {
  const NINE = '123456789';

  it('normalizes 0…, 84… and +84… to one number and accepts the same number in every form', () => {
    for (const input of ['0912345678', '84912345678', '+84912345678', '  0912345678  ']) {
      expect(normalizeVietnamMobile(input)).toBe('+84912345678');
    }
  });

  it('accepts the first and the last number of an allocated prefix, for every prefix', () => {
    for (const prefix of VN_MOBILE_PREFIXES) {
      const rest = 10 - prefix.length;
      expect(normalizeVietnamMobile(`${prefix}${'0'.repeat(rest)}`)).toBe(`+84${prefix.slice(1)}${'0'.repeat(rest)}`);
      expect(normalizeVietnamMobile(`${prefix}${'9'.repeat(rest)}`)).toBe(`+84${prefix.slice(1)}${'9'.repeat(rest)}`);
    }
  });

  it('accepts the small networks and the virtual networks (Vietnamobile, Gmobile, Wintel, iTel), whichever form is typed', () => {
    for (const prefix of ['052', '055', '056', '058', '059', '087', '092', '099']) {
      expect(normalizeVietnamMobile(`${prefix}${NINE.slice(0, 7)}`)).toBeDefined();
      expect(normalizeVietnamMobile(`84${prefix.slice(1)}${NINE.slice(0, 7)}`)).toBeDefined();
    }
  });

  it('refuses prefixes that are not allocated, although the old broad 03/05/07/08/09 pattern would accept them', () => {
    for (const prefix of ['030', '031', '050', '051', '053', '054', '057', '071', '072', '073', '074', '080']) {
      expect(normalizeVietnamMobile(`${prefix}${NINE.slice(0, 7)}`)).toBeUndefined();
      // The looser format rule (used by login) still accepts the shape: only the OTP request is stricter.
      expect(normalizeVietnamPhone(`${prefix}${NINE.slice(0, 7)}`)).toBeDefined();
    }
  });

  it('refuses landlines, switchboards, short codes and numbers of other countries', () => {
    for (const input of ['0241234567', '02838123456', '024123456789', '1900123456', '18001234', '113', '+14155550123', '+8613800138000', '+84 91 234 5678', '091-234-5678', '0091234567']) {
      expect(normalizeVietnamMobile(input)).toBeUndefined();
    }
  });

  it('refuses a missing or an extra digit and the old 11-digit mobile numbers', () => {
    expect(normalizeVietnamMobile('091234567')).toBeUndefined(); // 9 digits
    expect(normalizeVietnamMobile('09123456789')).toBeUndefined(); // 11 digits
    expect(normalizeVietnamMobile('84912345')).toBeUndefined();
    expect(normalizeVietnamMobile('+849123456789')).toBeUndefined();
    for (const old of ['01201234567', '01631234567', '01861234567', '01991234567', '0169 1234567']) {
      expect(normalizeVietnamMobile(old)).toBeUndefined();
    }
    for (const input of [undefined, null, 912345678, '', '+84', 'abc', '０９１２３４５６７８']) {
      expect(normalizeVietnamMobile(input)).toBeUndefined();
    }
  });

  it('supports allocations longer than 3 digits: only the allocated block of a range is accepted', () => {
    const table = ['0299', '0777'];
    expect(isAllocatedMobile('+84299123456', table)).toBe(true); // 0299123456
    expect(isAllocatedMobile('+84298123456', table)).toBe(false); // 0298… is not in the block
    expect(isAllocatedMobile('+84777123456', table)).toBe(true);
    expect(isAllocatedMobile('+84778123456', table)).toBe(false);
  });

  it('requireVietnamMobile raises INVALID_PHONE and never echoes the input', () => {
    try {
      requireVietnamMobile('0301234567');
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_PHONE');
      expect((error as Error).message).not.toContain('0301234567');
    }
    expect(requireVietnamMobile('0987654321')).toBe('+84987654321');
  });
});
