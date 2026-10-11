import { BadRequestException } from '@nestjs/common';
import { normalizeIp } from '../config/admin-auth-config';

/**
 * The client address used for rate limits (M01-D-LOGIN). It is the socket's remote address. Only when that address is
 * one of the exactly configured trusted proxies is a forwarded address believed, and then exactly ONE X-Forwarded-For
 * entry (as set by the last proxy, which overwrites the header) must be present. A trusted proxy without the header,
 * several entries, or anything that is not exactly one IP literal is refused with a plain 400: such a request would
 * otherwise be limited under a wrong identity. An untrusted remote address never reads the header at all.
 * Several proxy hops and CIDR ranges are out of scope and need their own design.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyIps: ReadonlySet<string>,
): string {
  const remote = remoteAddress === undefined ? undefined : normalizeIp(remoteAddress);
  if (remote === undefined) {
    throw new BadRequestException();
  }
  if (!trustedProxyIps.has(remote)) {
    return remote;
  }
  if (typeof forwardedFor !== 'string') {
    // Missing, or a repeated header (an array): refuse.
    throw new BadRequestException();
  }
  const forwarded = normalizeIp(forwardedFor.trim());
  if (forwarded === undefined) {
    throw new BadRequestException();
  }
  return forwarded;
}

/**
 * The limiter identity of an address: IPv4 as is, IPv6 as its /64 prefix (an attacker commonly owns a whole /64, so a
 * single host address would be trivially rotated).
 */
export function ipLimiterIdentity(ip: string): string {
  if (!ip.includes(':')) {
    return ip;
  }
  const groups = expandIpv6(ip);
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] {
  const [head = '', tail = ''] = ip.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = ip.includes('::') ? (tail === '' ? [] : tail.split(':')) : [];
  const missing = ip.includes('::') ? 8 - headGroups.length - tailGroups.length : 0;
  const all = ip.includes('::')
    ? [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups]
    : headGroups;
  return all.map((group) => group.padStart(4, '0'));
}
