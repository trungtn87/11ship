import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import {
  normalizeFullName,
  parseClientContextBody,
  parseClientLoginBody,
  parseClientLogoutBody,
  parseClientRegisterBody,
  parseClientUnverifiedRegisterBody,
} from './client-auth-validation';

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

describe('parseClientLoginBody', () => {
  const login = () => ({
    phone: '0912345678',
    password: 'whatever',
    device: { device_id: 'web-device-0001', platform: 'WEB', app: 'SHIP' },
  });

  it('parses exactly {phone,password,device} and keeps the password untouched', () => {
    const parsed = parseClientLoginBody({ ...login(), password: ' x ' });
    expect(parsed.phoneNormalized).toBe('+84912345678');
    expect(parsed.password).toBe(' x ');
    expect(parsed.device).toEqual({ deviceId: 'web-device-0001', platform: 'WEB', app: 'SHIP' });
  });

  it('does not apply the registration length policy (a short password is just a wrong password)', () => {
    expect(parseClientLoginBody({ ...login(), password: 'x' }).password).toBe('x');
  });

  it('refuses extra or missing keys, bad device enums, lone surrogates and oversized passwords', () => {
    const cases: unknown[] = [
      { ...login(), role: 'DRIVER' },
      { ...login(), device: { ...login().device, x: 1 } },
      { ...login(), device: { ...login().device, platform: 'IOS' } },
      { ...login(), device: { ...login().device, app: 'SHIP11' } },
      { ...login(), password: '\ud800' },
      { ...login(), password: 'x'.repeat(1025) },
      { ...login(), password: 5 },
      Object.fromEntries(Object.entries(login()).filter(([key]) => key !== 'device')),
      [],
      null,
    ];
    for (const candidate of cases) {
      expect(() => parseClientLoginBody(candidate)).toThrow();
    }
  });
});

describe('parseClientContextBody', () => {
  it('accepts exactly one of the three public contexts', () => {
    for (const context of ['CUSTOMER', 'SHOP_OWNER', 'DRIVER']) {
      expect(parseClientContextBody({ context })).toEqual({ context });
    }
  });

  it('refuses the storage name SHOP, other values, extra keys and non-objects', () => {
    for (const candidate of [{ context: 'SHOP' }, { context: 'ADMIN' }, { context: 1 }, {}, { context: 'CUSTOMER', x: 1 }, [], null]) {
      expect(() => parseClientContextBody(candidate)).toThrow();
    }
  });
});

describe('parseClientLogoutBody', () => {
  it('accepts exactly {}', () => {
    expect(() => parseClientLogoutBody({})).not.toThrow();
  });

  it('refuses any key, a missing body and non-objects', () => {
    for (const candidate of [{ user_id: 'x' }, undefined, null, [], 'text']) {
      expect(() => parseClientLogoutBody(candidate)).toThrow();
    }
  });
});

describe('parseClientUnverifiedRegisterBody', () => {
  const noToken = () => {
    const { verification_token: _token, ...rest } = valid();
    return rest;
  };

  it('accepts exactly the five keys of the DISABLED_TEST body', () => {
    const parsed = parseClientUnverifiedRegisterBody({ ...noToken(), full_name: '  An   Binh ' });
    expect(parsed.fullName).toBe('An Binh');
    expect(parsed).not.toHaveProperty('verificationToken');
  });

  it('refuses a token, role, permission, accepted_at, an unknown key or a missing field', () => {
    const cases: unknown[] = [
      valid(),
      { ...noToken(), verification_token: 'abc' },
      { ...noToken(), role: 'ADMIN' },
      { ...noToken(), permission: 'x' },
      { ...noToken(), consent: { ...valid().consent, accepted_at: '2026-10-12T00:00:00Z' } },
      { ...noToken(), accepted_at: '2026-10-12T00:00:00Z' },
      { ...noToken(), extra: 1 },
      Object.fromEntries(Object.entries(noToken()).filter(([key]) => key !== 'consent')),
      [],
      null,
    ];
    for (const candidate of cases) {
      expect(() => parseClientUnverifiedRegisterBody(candidate)).toThrow(BadRequestException);
    }
  });
});
