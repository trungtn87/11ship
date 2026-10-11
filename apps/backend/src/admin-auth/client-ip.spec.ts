import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ipLimiterIdentity, resolveClientIp } from './client-ip';

const TRUSTED = new Set(['10.0.0.5', '2001:db8::5']);
const NONE = new Set<string>();

describe('resolveClientIp', () => {
  it('uses the socket address and ignores X-Forwarded-For when the remote is not a trusted proxy', () => {
    expect(resolveClientIp('203.0.113.9', '198.51.100.1', TRUSTED)).toBe('203.0.113.9');
    expect(resolveClientIp('203.0.113.9', undefined, NONE)).toBe('203.0.113.9');
    expect(resolveClientIp('::ffff:203.0.113.9', 'garbage', NONE)).toBe('203.0.113.9');
    // Even a malformed or repeated header is irrelevant for an untrusted remote.
    expect(resolveClientIp('203.0.113.9', ['a', 'b'], TRUSTED)).toBe('203.0.113.9');
  });

  it('believes exactly one forwarded IP from an exactly trusted proxy', () => {
    expect(resolveClientIp('10.0.0.5', '198.51.100.1', TRUSTED)).toBe('198.51.100.1');
    expect(resolveClientIp('::ffff:10.0.0.5', ' 198.51.100.2 ', TRUSTED)).toBe('198.51.100.2');
    expect(resolveClientIp('2001:db8::5', '2001:DB8::99', TRUSTED)).toBe('2001:db8::99');
  });

  it.each([
    ['missing header', undefined],
    ['several entries', '198.51.100.1, 198.51.100.2'],
    ['repeated header', ['198.51.100.1', '198.51.100.2']],
    ['not an IP', 'unknown'],
    ['with a port', '198.51.100.1:443'],
    ['empty', ''],
  ])('refuses a trusted proxy with %s', (_name, header) => {
    expect(() => resolveClientIp('10.0.0.5', header as string | undefined, TRUSTED)).toThrow(BadRequestException);
  });

  it('refuses an unknown or malformed socket address', () => {
    expect(() => resolveClientIp(undefined, undefined, NONE)).toThrow(BadRequestException);
    expect(() => resolveClientIp('not-an-ip', undefined, NONE)).toThrow(BadRequestException);
  });

  it('trusts nothing by default (no trust-all, no CIDR)', () => {
    expect(resolveClientIp('10.0.0.5', '198.51.100.1', NONE)).toBe('10.0.0.5');
  });
});

describe('ipLimiterIdentity', () => {
  it('keeps IPv4 and collapses IPv6 to its /64', () => {
    expect(ipLimiterIdentity('203.0.113.9')).toBe('203.0.113.9');
    expect(ipLimiterIdentity('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:0001:0002::/64');
    expect(ipLimiterIdentity('2001:db8:1:2::1')).toBe('2001:0db8:0001:0002::/64');
    expect(ipLimiterIdentity('2001:db8:1:2::2')).toBe(ipLimiterIdentity('2001:db8:1:2:ffff::'));
    expect(ipLimiterIdentity('::1')).toBe('0000:0000:0000:0000::/64');
    expect(ipLimiterIdentity('2001:db8:1:3::1')).not.toBe(ipLimiterIdentity('2001:db8:1:2::1'));
  });
});
