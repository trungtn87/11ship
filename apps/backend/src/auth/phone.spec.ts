import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { normalizeVietnamPhone, requireNormalizedPhone } from './phone';

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
