import { describe, expect, it } from '@jest/globals';
import { createTestPki } from '../database/test-tls.fixture';
import { loadConfig } from './app-config';
import { parseClientDevice, parseRevocationSnapshot } from './client-device-config';

// M01-ANDROID: the native gate is local/test only, fail-closed, and only variable NAMES are ever reported.
const SIGNER = 'ab'.repeat(32);
const SIGNERS = JSON.stringify({
  FOOD: { package_name: 'vn.eleven.food.test', signer_sha256: SIGNER },
  SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: SIGNER },
});
const REVOCATION = JSON.stringify({ fetched_at: '2026-10-13T00:00:00Z', entries: { '1a2b': { status: 'REVOKED', reason: 'KEY_COMPROMISE' } } });

// parseCaBundle needs a real X.509 PEM; the unit-test PKI (generated in memory on every run) provides one.
const rootPem = (): string => createTestPki().caPem;

const files = (extra: Record<string, string> = {}): ((path: string) => string) => {
  const store: Record<string, string> = { '/signers.json': SIGNERS, '/roots.pem': rootPem(), '/revocation.json': REVOCATION, ...extra };
  return (path) => {
    const value = store[path];
    if (value === undefined) {
      throw new Error('ENOENT');
    }
    return value;
  };
};

const env = (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  CLIENT_AUTH_ANDROID_ENABLED: 'true',
  CLIENT_DEVICE_ENVIRONMENT: 'local-test',
  CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: '/signers.json',
  CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: '/roots.pem',
  CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: '/revocation.json',
  ...overrides,
});

describe('parseClientDevice', () => {
  it('accepts the full fleet revocation list above 16 KiB without dropping revoked serials', () => {
    const entries = Object.fromEntries(Array.from({ length: 1759 }, (_, i) => [
      (0x100000000000 + i).toString(16), { status: 'REVOKED' },
    ]));
    const snapshot = { fetched_at: '2026-10-14T10:26:30.514Z', entries };
    const json = JSON.stringify(snapshot);
    expect(Buffer.byteLength(json)).toBeGreaterThan(16 * 1024);
    const result = parseClientDevice({
      appEnv: 'production', host: '127.0.0.1', env: env(), readFile: files({ '/revocation.json': json }),
    });
    expect(result.ok && result.enabled).toBe(true);
    expect(parseRevocationSnapshot(snapshot)?.revokedSerials).toEqual(new Set(Object.keys(entries)));
  });

  it('still refuses oversized revocation and signer files by variable name', () => {
    const readFile = files();
    for (const [file, name, size] of [
      ['/revocation.json', 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE', 8 * 1024 * 1024],
      ['/signers.json', 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE', 16 * 1024],
    ] as const) {
      const oversized = readFile(file) + ' '.repeat(size);
      expect(parseClientDevice({
        appEnv: 'production', host: '127.0.0.1', env: env(), readFile: files({ [file]: oversized }),
      })).toEqual({ ok: false, invalid: [name] });
    }
  });

  it('is off by default and when explicitly false, and reads no file', () => {
    expect(parseClientDevice({ appEnv: 'test', host: '127.0.0.1', env: {} })).toEqual({ ok: true, enabled: false, config: undefined });
    expect(parseClientDevice({ appEnv: 'production', host: '0.0.0.0', env: { CLIENT_AUTH_ANDROID_ENABLED: 'false' } })).toEqual({ ok: true, enabled: false, config: undefined });
  });

  it('accepts the gate for development/test/production on a loopback bind only, naming only the variable otherwise', () => {
    for (const [appEnv, host] of [['staging', '127.0.0.1'], ['production', '0.0.0.0'], ['production', '10.0.0.5'], ['test', '0.0.0.0'], ['development', '10.0.0.5']] as const) {
      expect(parseClientDevice({ appEnv, host, env: env(), readFile: files() })).toEqual({ ok: false, invalid: ['CLIENT_AUTH_ANDROID_ENABLED'] });
    }
    expect(parseClientDevice({ appEnv: 'test', host: '127.0.0.1', env: env({ CLIENT_AUTH_ANDROID_ENABLED: 'yes' }), readFile: files() })).toEqual({
      ok: false,
      invalid: ['CLIENT_AUTH_ANDROID_ENABLED'],
    });
    // Production on loopback: every trust input is still required (no signer file, no roots, no revocation snapshot => refused).
    const prod = parseClientDevice({ appEnv: 'production', host: '127.0.0.1', env: env(), readFile: files() });
    expect(prod.ok && prod.enabled).toBe(true);
    expect(parseClientDevice({ appEnv: 'production', host: '127.0.0.1', env: env({ CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: undefined }), readFile: files() })).toEqual({ ok: false, invalid: ['CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'] });
    expect(parseClientDevice({ appEnv: 'production', host: '127.0.0.1', env: env({ CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: undefined }), readFile: files() })).toEqual({ ok: false, invalid: ['CLIENT_DEVICE_ATTESTATION_ROOTS_FILE'] });
    expect(parseClientDevice({ appEnv: 'production', host: '127.0.0.1', env: env({ CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: undefined }), readFile: files() })).toEqual({ ok: false, invalid: ['CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE'] });
    const ok = parseClientDevice({ appEnv: 'development', host: 'localhost', env: env(), readFile: files() });
    expect(ok.ok && ok.enabled && ok.config?.environment).toBe('local-test');
    expect(ok.ok && ok.config?.signers.FOOD.signerSha256).toBe(SIGNER);
  });

  it('refuses a missing or invalid trust input by NAME only, never echoing a path or a content', () => {
    const cases: Array<[Record<string, string | undefined>, Record<string, string>, string]> = [
      [{ CLIENT_DEVICE_ENVIRONMENT: undefined }, {}, 'CLIENT_DEVICE_ENVIRONMENT'],
      [{ CLIENT_DEVICE_ENVIRONMENT: 'has space' }, {}, 'CLIENT_DEVICE_ENVIRONMENT'],
      [{ CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: '/nope.json' }, {}, 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'],
      [{}, { '/signers.json': '{"FOOD":{}}' }, 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'],
      [{}, { '/signers.json': JSON.stringify({ FOOD: { package_name: 'vn.eleven.food.test', signer_sha256: SIGNER }, SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: 'cd'.repeat(32) } }) }, 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'],
      [{}, { '/signers.json': JSON.stringify({ FOOD: { package_name: 'other.pkg', signer_sha256: SIGNER }, SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: SIGNER } }) }, 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'],
      [{ CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: '/missing.pem' }, {}, 'CLIENT_DEVICE_ATTESTATION_ROOTS_FILE'],
      [{}, { '/roots.pem': 'not a pem' }, 'CLIENT_DEVICE_ATTESTATION_ROOTS_FILE'],
      [{ CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: undefined }, {}, 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE'],
      [{}, { '/revocation.json': '{"entries":{}}' }, 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE'],
    ];
    for (const [overrides, fileOverrides, name] of cases) {
      const result = parseClientDevice({ appEnv: 'test', host: '127.0.0.1', env: env(overrides), readFile: files(fileOverrides) });
      expect(result).toEqual({ ok: false, invalid: [name] });
      expect(JSON.stringify(result)).not.toContain('/signers.json');
    }
  });

  it('loadConfig stops startup for the gate outside local test, naming only the variable', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@127.0.0.1:5433/ship11_test',
      APP_ENV: 'test',
      HOST: '0.0.0.0',
      CLIENT_AUTH_ANDROID_ENABLED: 'true',
    };
    const result = loadConfig(base);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.invalid).toContain('CLIENT_AUTH_ANDROID_ENABLED');
  });
});

describe('parseRevocationSnapshot', () => {
  it('reads fetched_at and the revoked serials, and refuses any other shape', () => {
    const snapshot = parseRevocationSnapshot(JSON.parse(REVOCATION));
    expect(snapshot?.revokedSerials.has('1a2b')).toBe(true);
    expect(snapshot?.fetchedAtMs).toBe(Date.parse('2026-10-13T00:00:00Z'));
    for (const bad of [null, [], {}, { fetched_at: 'x', entries: {} }, { fetched_at: '2026-10-13T00:00:00Z', entries: { 'ZZ': { status: 'REVOKED' } } }, { fetched_at: '2026-10-13T00:00:00Z', entries: {}, extra: 1 }]) {
      expect(parseRevocationSnapshot(bad)).toBeUndefined();
    }
  });
});
