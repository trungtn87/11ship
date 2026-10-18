import { describe, expect, it } from '@jest/globals';
import { parseM14Routing } from './m14-routing-config';

const parse = (env: Record<string, string | undefined>, appEnv = 'production') => parseM14Routing({ env, appEnv });

describe('M14 routing configuration', () => {
  it('is absent by default: routes are then unavailable, never invented', () => {
    expect(parse({})).toEqual({ ok: true, config: undefined });
    expect(parse({ M14_ROUTING_ORIGIN: '' })).toEqual({ ok: true, config: undefined });
  });

  it('accepts an https origin and normalizes it (no trailing slash)', () => {
    expect(parse({ M14_ROUTING_ORIGIN: 'https://routing.example.vn/' })).toEqual({ ok: true, config: { origin: 'https://routing.example.vn', timeoutMs: 8000 } });
    expect(parse({ M14_ROUTING_ORIGIN: 'https://routing.example.vn:8443', M14_ROUTING_TIMEOUT_MS: '3000' })).toEqual({ ok: true, config: { origin: 'https://routing.example.vn:8443', timeoutMs: 3000 } });
  });

  it('refuses cleartext except loopback in development / test, and anything that is not a bare origin', () => {
    expect(parse({ M14_ROUTING_ORIGIN: 'http://routing.example.vn' })).toEqual({ ok: false, invalid: ['M14_ROUTING_ORIGIN'] });
    expect(parse({ M14_ROUTING_ORIGIN: 'http://127.0.0.1:8080' }, 'production')).toEqual({ ok: false, invalid: ['M14_ROUTING_ORIGIN'] });
    expect(parse({ M14_ROUTING_ORIGIN: 'http://127.0.0.1:8080' }, 'development')).toMatchObject({ ok: true, config: { origin: 'http://127.0.0.1:8080' } });
    for (const bad of ['https://u:p@host.example', 'https://host.example/path', 'https://host.example/?q=1', 'https://host.example/#x', 'ftp://host.example', 'not a url']) {
      expect([bad, parse({ M14_ROUTING_ORIGIN: bad })]).toEqual([bad, { ok: false, invalid: ['M14_ROUTING_ORIGIN'] }]);
    }
  });

  it('bounds the timeout and names only the variable', () => {
    for (const bad of ['499', '20001', 'x', '-1', '1.5']) {
      expect([bad, parse({ M14_ROUTING_ORIGIN: 'https://r.example.vn', M14_ROUTING_TIMEOUT_MS: bad })]).toEqual([bad, { ok: false, invalid: ['M14_ROUTING_TIMEOUT_MS'] }]);
    }
  });
});
