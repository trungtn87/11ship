import { afterAll, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseUrlHasQuery, parseCaBundle, resolveDatabaseTls } from './tls-config';
import { createTestPki } from './test-tls.fixture';

const pki = createTestPki();
const PASSWORD = 'SECRET_MARKER_TLS_7c1d';
const BASE_URL = `postgres://ship11_app.projref:${PASSWORD}@pooler.example.test:5432/postgres`;
const workDir = mkdtempSync(join(tmpdir(), 'ship11-tls-spec-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function invalidOf(result: ReturnType<typeof resolveDatabaseTls>): readonly string[] {
  if (result.ok) {
    throw new Error('expected the TLS configuration to be rejected');
  }
  return result.invalid;
}

function tlsOf(result: ReturnType<typeof resolveDatabaseTls>) {
  if (!result.ok || result.tls === undefined) {
    throw new Error('expected a TLS configuration');
  }
  return result.tls;
}

// A rejected result is printed by startup (names only). Whatever it contains must never echo a secret.
function expectNoSecretIn(value: unknown, ...secrets: string[]): void {
  const text = JSON.stringify(value);
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

describe('resolveDatabaseTls: fail closed in staging and production', () => {
  it('refuses to start without any CA and names both ways to supply it', () => {
    const result = resolveDatabaseTls({ env: {}, required: true, databaseUrl: BASE_URL });
    expect(invalidOf(result)).toEqual(['DB_SSL_CA', 'DB_SSL_CA_FILE']);
  });

  it('accepts a CA only as verified, strict TLS (rejectUnauthorized is always true)', () => {
    const tls = tlsOf(
      resolveDatabaseTls({ env: { DB_SSL_CA: pki.caPem }, required: true, databaseUrl: BASE_URL }),
    );
    expect(tls.rejectUnauthorized).toBe(true);
    expect(tls.ca).toBe(pki.caPem.trim() + '\n');
  });

  it('refuses the process-wide switch that turns certificate verification off', () => {
    const env = { DB_SSL_CA: pki.caPem, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    expect(invalidOf(resolveDatabaseTls({ env, required: true, databaseUrl: BASE_URL }))).toEqual([
      'NODE_TLS_REJECT_UNAUTHORIZED',
    ]);
    // Even padded with whitespace, and even when the CA is missing as well.
    expect(
      invalidOf(
        resolveDatabaseTls({
          env: { NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' },
          required: true,
          databaseUrl: BASE_URL,
        }),
      ),
    ).toEqual(['NODE_TLS_REJECT_UNAUTHORIZED', 'DB_SSL_CA', 'DB_SSL_CA_FILE']);
  });

  it('leaves NODE_TLS_REJECT_UNAUTHORIZED alone outside staging/production (not this module’s business)', () => {
    const result = resolveDatabaseTls({
      env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      required: false,
      databaseUrl: BASE_URL,
    });
    expect(result).toEqual({ ok: true, tls: undefined });
  });
});

describe('resolveDatabaseTls: development and test keep the previous behaviour', () => {
  it('produces no TLS configuration and does not touch the URL when no CA is supplied', () => {
    for (const url of [
      BASE_URL,
      `${BASE_URL}?sslmode=disable`,
      `${BASE_URL}?sslmode=require&application_name=local`,
    ]) {
      expect(resolveDatabaseTls({ env: {}, required: false, databaseUrl: url })).toEqual({
        ok: true,
        tls: undefined,
      });
    }
  });

  it('applies strict TLS as soon as a CA is supplied, so the remote path can be tried locally', () => {
    const tls = tlsOf(
      resolveDatabaseTls({ env: { DB_SSL_CA: pki.caPem }, required: false, databaseUrl: BASE_URL }),
    );
    expect(tls.rejectUnauthorized).toBe(true);
  });
});

describe('resolveDatabaseTls: where the CA comes from', () => {
  it('reads a PEM stored in an environment variable, including the literal \\n form secret stores produce', () => {
    const escaped = pki.caPem.trim().replace(/\n/g, '\\n');
    expect(escaped).not.toContain('\n');
    const tls = tlsOf(
      resolveDatabaseTls({ env: { DB_SSL_CA: escaped }, required: true, databaseUrl: BASE_URL }),
    );
    expect(tls.ca).toBe(pki.caPem.trim() + '\n');
  });

  it('reads a PEM from a secret file (Windows line endings included)', () => {
    const path = join(workDir, 'ca.crt');
    writeFileSync(path, pki.caPem.replace(/\n/g, '\r\n'));
    const tls = tlsOf(
      resolveDatabaseTls({ env: { DB_SSL_CA_FILE: path }, required: true, databaseUrl: BASE_URL }),
    );
    expect(tls.rejectUnauthorized).toBe(true);
    // CRLF is normalized: the CA handed to TLS is byte-identical to the LF form.
    expect(tls.ca).toBe(pki.caPem.trim() + '\n');
  });

  it('refuses two sources at once: they could silently disagree after a half-finished rotation', () => {
    const result = resolveDatabaseTls({
      env: { DB_SSL_CA: pki.caPem, DB_SSL_CA_FILE: join(workDir, 'ca.crt') },
      required: true,
      databaseUrl: BASE_URL,
    });
    expect(invalidOf(result)).toEqual(['DB_SSL_CA', 'DB_SSL_CA_FILE']);
  });

  it('reports an unreadable file by variable name only, never the path or the system error', () => {
    const path = `/run/secrets/SECRET_PATH_MARKER_${PASSWORD}`;
    const result = resolveDatabaseTls({
      env: { DB_SSL_CA_FILE: path },
      required: true,
      databaseUrl: BASE_URL,
      readFile: () => {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      },
    });
    expect(invalidOf(result)).toEqual(['DB_SSL_CA_FILE']);
    expectNoSecretIn(result, 'SECRET_PATH_MARKER', PASSWORD, 'ENOENT');
  });

  it('refuses an empty variable instead of treating it as "not set"', () => {
    expect(
      invalidOf(resolveDatabaseTls({ env: { DB_SSL_CA: '' }, required: true, databaseUrl: BASE_URL })),
    ).toEqual(['DB_SSL_CA']);
    expect(
      invalidOf(resolveDatabaseTls({ env: { DB_SSL_CA_FILE: '' }, required: true, databaseUrl: BASE_URL })),
    ).toEqual(['DB_SSL_CA_FILE']);
  });
});

describe('resolveDatabaseTls: a CA that is not a clean certificate bundle is refused', () => {
  const firstBase64Line = (pki.caPem.split('\n')[1] ?? '').slice(0, 40);
  const cases: ReadonlyArray<[string, string]> = [
    ['plain text', 'not a certificate'],
    ['a truncated certificate', pki.caPem.slice(0, pki.caPem.length - 60)],
    [
      'a certificate block with corrupt content',
      '-----BEGIN CERTIFICATE-----\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END CERTIFICATE-----\n',
    ],
    [
      'a private key, even next to a valid certificate (a pasted key must never be accepted or echoed)',
      `${pki.caPem}${pki.serverKeyPem}`,
    ],
    ['a certificate followed by stray text', `${pki.caPem}\nignored? no.\n`],
    ['more certificates than any real bundle holds', pki.caPem.repeat(11)],
  ];

  for (const [label, text] of cases) {
    it(`rejects ${label}, naming only DB_SSL_CA`, () => {
      const result = resolveDatabaseTls({ env: { DB_SSL_CA: text }, required: true, databaseUrl: BASE_URL });
      expect(invalidOf(result)).toEqual(['DB_SSL_CA']);
      expectNoSecretIn(result, firstBase64Line, 'PRIVATE KEY', 'not a certificate', PASSWORD);
    });
  }

  it('names DB_SSL_CA_FILE (not DB_SSL_CA) when the bad content came from the file', () => {
    const result = resolveDatabaseTls({
      env: { DB_SSL_CA_FILE: '/some/file' },
      required: true,
      databaseUrl: BASE_URL,
      readFile: () => 'garbage',
    });
    expect(invalidOf(result)).toEqual(['DB_SSL_CA_FILE']);
  });
});

describe('resolveDatabaseTls: the connection URL may not override the verified TLS', () => {
  // node-postgres merges URL query parameters OVER the explicit pool options, so each of these would silently
  // replace the verified `ssl` object (or another explicit option) if it reached the driver.
  const overrides = [
    '?sslmode=no-verify',
    '?sslmode=disable',
    '?sslmode=require',
    '?sslmode=verify-full',
    '?ssl=false',
    '?ssl=0',
    '?ssl=true',
    '?sslrootcert=/tmp/other-ca.crt',
    '?sslcert=/tmp/a.crt&sslkey=/tmp/a.key',
    '?uselibpqcompat=true&sslmode=require',
    '?SSLMODE=disable',
    '?statement_timeout=0',
    '?host=attacker.example.test',
    '?application_name=x',
  ];

  for (const query of overrides) {
    for (const [label, required] of [
      ['staging/production', true],
      ['development with a CA', false],
    ] as const) {
      it(`rejects ${query} in ${label}, naming only DATABASE_URL`, () => {
        const result = resolveDatabaseTls({
          env: { DB_SSL_CA: pki.caPem },
          required,
          databaseUrl: `${BASE_URL}${query}`,
        });
        expect(invalidOf(result)).toEqual(['DATABASE_URL']);
        expectNoSecretIn(result, PASSWORD, 'no-verify', 'attacker.example.test', 'pooler.example.test');
      });
    }
  }

  it('accepts a URL without a query (the only form allowed once TLS is active)', () => {
    expect(
      resolveDatabaseTls({ env: { DB_SSL_CA: pki.caPem }, required: true, databaseUrl: BASE_URL }).ok,
    ).toBe(true);
  });

  it('reports a bad CA and a bad URL together, each by its own name', () => {
    const result = resolveDatabaseTls({
      env: { DB_SSL_CA: 'nope' },
      required: true,
      databaseUrl: `${BASE_URL}?sslmode=disable`,
    });
    expect(invalidOf(result)).toEqual(['DB_SSL_CA', 'DATABASE_URL']);
  });

  it('does not judge a URL that is missing; loadConfig already reports that as DATABASE_URL', () => {
    expect(
      resolveDatabaseTls({ env: { DB_SSL_CA: pki.caPem }, required: true, databaseUrl: undefined }).ok,
    ).toBe(true);
  });
});

describe('databaseUrlHasQuery', () => {
  it('is true for any query parameter and for a URL that cannot be parsed (fail closed)', () => {
    expect(databaseUrlHasQuery(BASE_URL)).toBe(false);
    expect(databaseUrlHasQuery(`${BASE_URL}?a=b`)).toBe(true);
    expect(databaseUrlHasQuery('not a url')).toBe(true);
  });
});

describe('parseCaBundle', () => {
  it('accepts a bundle of several certificates and normalizes the line endings', () => {
    const bundle = `${pki.caPem.replace(/\n/g, '\r\n')}\r\n\r\n${pki.otherCaPem}`;
    const parsed = parseCaBundle(bundle);
    expect(parsed?.certificateCount).toBe(2);
    expect(parsed?.ca).toBe(`${pki.caPem.trim()}\n${pki.otherCaPem.trim()}\n`);
  });

  it('refuses an empty bundle and an oversized one', () => {
    expect(parseCaBundle('')).toBeUndefined();
    expect(parseCaBundle(`${pki.caPem}${' '.repeat(70_000)}`)).toBeUndefined();
  });
});
