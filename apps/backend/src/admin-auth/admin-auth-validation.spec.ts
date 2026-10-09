import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { isJsonContentType, parseAdminLoginBody, parseEmptyBody, parseTotpBody } from './admin-auth-validation';

const DEVICE = { device_id: 'admin-web-0001', platform: 'WEB', app: 'ADMIN_WEB' };
const login = (over: Record<string, unknown> = {}): unknown => ({
  phone: '0912345678',
  password: 'Correct-Horse-Battery-9',
  device: DEVICE,
  ...over,
});

describe('parseAdminLoginBody', () => {
  it('accepts the exact administration shape', () => {
    const parsed = parseAdminLoginBody(login());
    expect(parsed.device.platform).toBe('WEB');
    expect(parsed.device.app).toBe('ADMIN_WEB');
  });

  it('refuses application device labels, extra keys and non-objects', () => {
    expect(() => parseAdminLoginBody(login({ device: { ...DEVICE, app: 'CUSTOMER' } }))).toThrow(BadRequestException);
    expect(() => parseAdminLoginBody(login({ device: { ...DEVICE, platform: 'ANDROID' } }))).toThrow(BadRequestException);
    expect(() => parseAdminLoginBody(login({ role: 'SYSTEM' }))).toThrow(BadRequestException);
    expect(() => parseAdminLoginBody(null)).toThrow(BadRequestException);
    expect(() => parseAdminLoginBody([])).toThrow(BadRequestException);
  });
});

describe('parseEmptyBody', () => {
  it('accepts only {}', () => {
    expect(() => parseEmptyBody({})).not.toThrow();
    for (const bad of [undefined, null, [], { a: 1 }, 'x', 1]) {
      expect(() => parseEmptyBody(bad)).toThrow(BadRequestException);
    }
  });
});

describe('parseTotpBody', () => {
  it('accepts exactly six ASCII digits under the single key "code"', () => {
    expect(parseTotpBody({ code: '012345' })).toBe('012345');
  });

  it('never trims or repairs', () => {
    for (const code of [' 123456', '123456 ', '12345', '1234567', '12345a', '１２３４５６', 123456, null, undefined]) {
      expect(() => parseTotpBody({ code })).toThrow(BadRequestException);
    }
    expect(() => parseTotpBody({ code: '123456', extra: 1 })).toThrow(BadRequestException);
    expect(() => parseTotpBody({})).toThrow(BadRequestException);
    expect(() => parseTotpBody('123456')).toThrow(BadRequestException);
  });
});

describe('isJsonContentType', () => {
  it('accepts application/json with optional parameters only', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('Application/JSON')).toBe(true);
    for (const bad of [undefined, '', 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'text/json', ['application/json']]) {
      expect(isJsonContentType(bad as never)).toBe(false);
    }
  });
});
