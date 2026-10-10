import { describe, expect, it } from '@jest/globals';
import { inspect } from 'node:util';
import { loadConfig } from './app-config';
import {
  MAX_STAGING_ALLOWED_PHONES,
  parseAllowedPhones,
  parseStagingFixtures,
  PhoneAllowlist,
} from './staging-fixtures-config';

// M00-D2 section 3: the fixture mode is fail-closed in every environment, and no value is ever echoed.
const PHONE_A = '+84911111111';
const PHONE_B = '+84922222222';
const phones = (...list: string[]) => JSON.stringify(list);

describe('parseAllowedPhones', () => {
  it('accepts a JSON array of normalized +84 numbers and answers has()', () => {
    const list = parseAllowedPhones(phones(PHONE_A, PHONE_B));
    expect(list?.size).toBe(2);
    expect(list?.has(PHONE_A)).toBe(true);
    expect(list?.has('+84933333333')).toBe(false);
  });

  const malformed: ReadonlyArray<readonly [string, string]> = [
    ['empty string', ''],
    ['not JSON', '+84911111111'],
    ['not an array', '{"a":1}'],
    ['empty list', '[]'],
    ['a number entry', '[84911111111]'],
    ['a non-normalized number (0 prefix)', '["0911111111"]'],
    ['a number with spaces', '["+84 911111111"]'],
    ['a foreign number', '["+14155550123"]'],
    ['too short', '["+8491111111"]'],
    ['duplicate numbers', phones(PHONE_A, PHONE_A)],
    ['21 numbers', phones(...Array.from({ length: MAX_STAGING_ALLOWED_PHONES + 1 }, (_, i) => `+8491${String(1000000 + i)}`))],
    ['an enormous string', `["${'9'.repeat(4000)}"]`],
  ];
  it.each(malformed)('rejects %s', (_label, raw) => {
    expect(parseAllowedPhones(raw)).toBeUndefined();
  });

  it('accepts exactly 20 numbers', () => {
    const twenty = Array.from({ length: MAX_STAGING_ALLOWED_PHONES }, (_, i) => `+8491${String(1000000 + i)}`);
    expect(parseAllowedPhones(JSON.stringify(twenty))?.size).toBe(20);
  });
});

describe('PhoneAllowlist redaction', () => {
  it('never prints the numbers through JSON, string conversion or inspect', () => {
    const list = new PhoneAllowlist([PHONE_A]);
    for (const text of [JSON.stringify({ list }), String(list), `${list}`, inspect(list), inspect({ nested: { list } }, { depth: 5 })]) {
      expect(text).not.toContain('911111111');
    }
  });
});

describe('parseStagingFixtures', () => {
  const ok = (appEnv: string, enabledRaw: string | undefined, phonesRaw: string | undefined) =>
    parseStagingFixtures({ appEnv, enabledRaw, phonesRaw });

  it('is off by default: nothing set means no fixture mode', () => {
    expect(ok('staging', undefined, undefined)).toEqual({ ok: true, config: undefined });
    expect(ok('production', undefined, undefined)).toEqual({ ok: true, config: undefined });
    expect(ok('staging', 'false', undefined)).toEqual({ ok: true, config: undefined });
  });

  it('accepts exactly "true" and "false"', () => {
    for (const raw of ['TRUE', 'True', '1', 'yes', ' true', 'true ', '', 'on']) {
      expect(ok('staging', raw, phones(PHONE_A))).toEqual({ ok: false, invalid: ['AUTH_STAGING_FIXTURES_ENABLED'] });
    }
  });

  it('turns on only for staging, with a valid allowlist', () => {
    const result = ok('staging', 'true', phones(PHONE_A));
    expect(result.ok && result.config?.enabled).toBe(true);
    expect(result.ok && result.config?.allowedPhones.has(PHONE_A)).toBe(true);
  });

  it.each(['production', 'development', 'test'])('refuses true in %s, naming only the flag', (appEnv) => {
    expect(ok(appEnv, 'true', phones(PHONE_A))).toEqual({ ok: false, invalid: ['AUTH_STAGING_FIXTURES_ENABLED'] });
  });

  it('refuses a missing, empty, malformed, duplicate or oversized allowlist when on', () => {
    for (const raw of [undefined, '', '[]', 'nope', phones(PHONE_A, PHONE_A)]) {
      expect(ok('staging', 'true', raw)).toEqual({ ok: false, invalid: ['AUTH_STAGING_ALLOWED_PHONES'] });
    }
  });

  it('refuses an allowlist while the mode is off, even an empty one', () => {
    for (const enabled of [undefined, 'false']) {
      for (const raw of [phones(PHONE_A), '', '[]']) {
        expect(ok('staging', enabled, raw)).toEqual({ ok: false, invalid: ['AUTH_STAGING_ALLOWED_PHONES'] });
        expect(ok('production', enabled, raw)).toEqual({ ok: false, invalid: ['AUTH_STAGING_ALLOWED_PHONES'] });
      }
    }
  });

  it('reports both names when production turns the mode on without a valid allowlist', () => {
    expect(ok('production', 'true', undefined)).toEqual({
      ok: false,
      invalid: ['AUTH_STAGING_FIXTURES_ENABLED', 'AUTH_STAGING_ALLOWED_PHONES'],
    });
  });
});

describe('loadConfig with the staging fixture mode', () => {
  const CA_FREE_BASE = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' };
  const base = (extra: Record<string, string>) => ({ ...CA_FREE_BASE, ...extra });

  it('never starts with the mode on outside staging, and names only the variable', () => {
    for (const appEnv of ['development', 'test']) {
      const result = loadConfig(base({ APP_ENV: appEnv, AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: phones(PHONE_A) }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.invalid).toEqual(['AUTH_STAGING_FIXTURES_ENABLED']);
        expect(JSON.stringify(result)).not.toContain('911111111');
      }
    }
  });

  it('local and CI configs are unchanged: no stagingFixtures key at all', () => {
    const result = loadConfig(base({ APP_ENV: 'development' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.hasOwn(result.config, 'stagingFixtures')).toBe(false);
    }
  });

  it('a staging allowlist without the mode is an error naming only the allowlist variable', () => {
    const result = loadConfig(base({ APP_ENV: 'development', AUTH_STAGING_ALLOWED_PHONES: phones(PHONE_A) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid).toEqual(['AUTH_STAGING_ALLOWED_PHONES']);
    }
  });
});
