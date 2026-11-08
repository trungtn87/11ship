import { describe, expect, it } from '@jest/globals';
import { DEFAULT_ACCOUNT_DELETION_CONFIG, parseAccountDeletion } from './account-deletion-config';

describe('parseAccountDeletion', () => {
  it('defaults to IP 20/10 min, phone 5/15 min, 60 s sweep and no configured origin', () => {
    expect(parseAccountDeletion({ env: {} })).toEqual({ ok: true, config: DEFAULT_ACCOUNT_DELETION_CONFIG });
    expect(DEFAULT_ACCOUNT_DELETION_CONFIG.ip).toEqual({ limit: 20, windowSeconds: 600 });
    expect(DEFAULT_ACCOUNT_DELETION_CONFIG.phone).toEqual({ limit: 5, windowSeconds: 900 });
  });

  it('reads the limits and the origin from the environment', () => {
    const result = parseAccountDeletion({
      env: { PUBLIC_WEB_ORIGIN: 'https://example.test/', ACCOUNT_DELETE_IP_LIMIT: '7', ACCOUNT_DELETE_PHONE_WINDOW_SECONDS: '120', ACCOUNT_DELETE_SWEEP_INTERVAL_MS: '5000' },
    });
    expect(result).toEqual({
      ok: true,
      config: { publicOrigin: 'https://example.test', ip: { limit: 7, windowSeconds: 600 }, phone: { limit: 5, windowSeconds: 120 }, sweepIntervalMs: 5000 },
    });
  });

  it('accepts http only for a loopback host', () => {
    expect(parseAccountDeletion({ env: { PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:3000' } })).toMatchObject({ ok: true });
    expect(parseAccountDeletion({ env: { PUBLIC_WEB_ORIGIN: 'http://example.test' } })).toEqual({ ok: false, invalid: ['PUBLIC_WEB_ORIGIN'] });
  });

  it.each(['https://example.test/path', 'https://u:p@example.test', 'https://example.test?x=1', 'not a url'])('rejects origin %s, naming only the variable', (origin) => {
    expect(parseAccountDeletion({ env: { PUBLIC_WEB_ORIGIN: origin } })).toEqual({ ok: false, invalid: ['PUBLIC_WEB_ORIGIN'] });
  });

  it('rejects out-of-range numbers by name', () => {
    expect(parseAccountDeletion({ env: { ACCOUNT_DELETE_IP_LIMIT: '0', ACCOUNT_DELETE_PHONE_LIMIT: 'abc' } })).toEqual({
      ok: false,
      invalid: ['ACCOUNT_DELETE_IP_LIMIT', 'ACCOUNT_DELETE_PHONE_LIMIT'],
    });
  });
});
