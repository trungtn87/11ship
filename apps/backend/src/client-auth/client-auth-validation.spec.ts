import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { normalizeFullName, parseClientRegisterBody } from './client-auth-validation';

const valid = () => ({
  phone: '0912345678',
  password: 'Correct-Horse-Battery-9',
  verification_token: 'abc',
  device: { device_id: 'web-device-0001', platform: 'WEB', app: 'FOOD' },
  full_name: 'Nguyễn Văn An',
  consent: { terms_version: 'test-terms-20261011-v1', privacy_version: 'test-privacy-20261011-v1' },
});

describe('normalizeFullName', () => {
  it('applies NFC, collapses Unicode white space to one space and trims', () => {
    expect(normalizeFullName('Nguyễn 　Văn\n\tAn  ')).toBe('Nguyễn Văn An');
    expect(normalizeFullName('  A  ')).toBe('A');
  });

  it('counts code points, 1..120', () => {
    expect(normalizeFullName('😀'.repeat(120))).toHaveLength(240);
    expect(() => normalizeFullName('😀'.repeat(121))).toThrow(BadRequestException);
    expect(() => normalizeFullName('a'.repeat(121))).toThrow(BadRequestException);
    expect(() => normalizeFullName('')).toThrow(BadRequestException);
    expect(() => normalizeFullName(' \t\n ')).toThrow(BadRequestException);
  });

  it('refuses control, format (zero width, BOM), lone surrogates and non-strings', () => {
    for (const value of ['a\u0000b', 'a\u0007', 'a​b', 'a﻿b', 'a‮b', '\ud800', 7, null, undefined, {}]) {
      expect(() => normalizeFullName(value)).toThrow(BadRequestException);
    }
  });
});

describe('parseClientRegisterBody', () => {
  it('parses the six keys and returns normalized values', () => {
    const parsed = parseClientRegisterBody({ ...valid(), full_name: '  An   Binh ' });
    expect(parsed.fullName).toBe('An Binh');
    expect(parsed.phoneNormalized).toBe('+84912345678');
    expect(parsed.device).toEqual({ deviceId: 'web-device-0001', platform: 'WEB', app: 'FOOD' });
    expect(parsed.consent).toEqual({ termsVersion: 'test-terms-20261011-v1', privacyVersion: 'test-privacy-20261011-v1' });
    expect(parsed.password).toBe('Correct-Horse-Battery-9');
  });

  it('keeps the password untouched (no trim)', () => {
    expect(parseClientRegisterBody({ ...valid(), password: '  spaced pass  ' }).password).toBe('  spaced pass  ');
  });

  it('refuses extra keys at every level, missing keys and wrong shapes', () => {
    const cases: unknown[] = [
      { ...valid(), role: 'ADMIN' },
      { ...valid(), device: { ...valid().device, x: 1 } },
      { ...valid(), consent: { ...valid().consent, accepted_at: 'now' } },
      { ...valid(), device: { ...valid().device, platform: 'IOS' } },
      { ...valid(), device: { ...valid().device, app: 'SHIP11' } },
      { ...valid(), consent: { terms_version: 'bad value', privacy_version: 'ok' } },
      { ...valid(), verification_token: 'x'.repeat(257) },
      { ...valid(), verification_token: 5 },
      Object.fromEntries(Object.entries(valid()).filter(([key]) => key !== 'consent')),
      [],
      null,
      'text',
    ];
    for (const candidate of cases) {
      expect(() => parseClientRegisterBody(candidate)).toThrow();
    }
  });
});
