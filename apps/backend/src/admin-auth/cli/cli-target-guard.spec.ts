import { describe, expect, it } from '@jest/globals';
import {
  SELF_HOSTED_IDENTITY_SQL,
  SELF_HOSTED_TARGET,
  connectedIdentityMatches,
  resolveCliTarget,
  selfHostedIdentityProblem,
} from './cli-target-guard';

const REF = 'abcdefghijklmnopqrst';
const RUNTIME = `postgres://app_runtime.${REF}:pw@aws-0-eu.pooler.supabase.com:5432/postgres`;
const MIGRATION = `postgres://ship_migrator.${REF}:pw@aws-0-eu.pooler.supabase.com:5432/postgres`;

describe('resolveCliTarget', () => {
  it('refuses production and unknown environments', () => {
    expect(resolveCliTarget({ APP_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost/ship11_dev' })).toMatchObject({ ok: false });
    expect(resolveCliTarget({ APP_ENV: 'prod' })).toMatchObject({ ok: false });
    expect(resolveCliTarget({})).toMatchObject({ ok: false });
  });

  it('development: loopback only, expecting ship11_dev', () => {
    const ok = resolveCliTarget({ APP_ENV: 'development', DATABASE_URL: 'postgres://ship11_dev:p@localhost:5432/ship11_dev' });
    expect(ok).toMatchObject({ ok: true, target: { appEnv: 'development', expected: { database: 'ship11_dev', user: 'ship11_dev' } } });
    const remote = resolveCliTarget({ APP_ENV: 'development', DATABASE_URL: 'postgres://u:p@db.example.test/ship11_dev' });
    expect(remote.ok).toBe(false);
  });

  it('test: expects ship11_test whatever the URL says', () => {
    const result = resolveCliTarget({ APP_ENV: 'test', DATABASE_URL: 'postgres://u:p@db.example.test/anything' });
    expect(result).toMatchObject({ ok: true, target: { expected: { database: 'ship11_test', user: 'ship11_test' } } });
    if (result.ok) {
      expect(connectedIdentityMatches(result.target, { database: 'ship11_test', user: 'ship11_test' })).toBe(true);
      expect(connectedIdentityMatches(result.target, { database: 'postgres', user: 'ship11_test' })).toBe(false);
      expect(connectedIdentityMatches(result.target, { database: 'ship11_test', user: 'postgres' })).toBe(false);
    }
  });

  it('names a variable but never prints a value in a problem', () => {
    const results = [
      resolveCliTarget({ APP_ENV: 'test', DATABASE_URL: 'not a url with secret-pw' }),
      resolveCliTarget({ APP_ENV: 'staging', DATABASE_URL: RUNTIME, MIGRATION_DATABASE_URL: 'postgres://x.y:secret-pw@h:6543/d' }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problem).not.toContain('secret-pw');
      }
    }
  });

  it('staging: needs the migration session pooler, a different role, TLS and the typed confirmation', () => {
    const base = { APP_ENV: 'staging', DATABASE_URL: RUNTIME, MIGRATION_DATABASE_URL: MIGRATION };
    expect(resolveCliTarget(base)).toMatchObject({ ok: false });
    expect(resolveCliTarget({ ...base, MIGRATION_DATABASE_URL: MIGRATION.replace(':5432', ':6543') })).toMatchObject({ ok: false });
    expect(resolveCliTarget({ ...base, MIGRATION_DATABASE_URL: RUNTIME })).toMatchObject({ ok: false });
    expect(resolveCliTarget({ ...base, MIGRATION_DATABASE_URL: undefined })).toMatchObject({ ok: false });
    expect(
      resolveCliTarget({ ...base, MIGRATION_DATABASE_URL: MIGRATION.replace('/postgres', '/other') }),
    ).toMatchObject({ ok: false });
    // Without a CA the target is refused before the confirmation is even compared.
    expect(resolveCliTarget({ ...base, MIGRATION_CONFIRM_TARGET: `aws-0-eu.pooler.supabase.com:5432/postgres/${REF}` })).toMatchObject({ ok: false });
  });
});

// M00-VPS-01 package A: DB_REMOTE_TARGET selects the target of the staging operator commands. Not set means SUPABASE
// (the tests above); SELF_HOSTED is the one PostgreSQL 17 on the same machine. tests/deploy/db-remote-target-parity.test.mjs
// runs a wider case matrix through this guard and the JavaScript operator commands and requires the same verdicts.
// A public self-signed certificate that only exists so that DB_SSL_CA parses; it is trusted nowhere.
const TEST_CA =
  '-----BEGIN CERTIFICATE-----\n' +
  'MIIB8TCCAZegAwIBAgIUA1t34UidnUnWoldq7eY5gacRngEwCgYIKoZIzj0EAwIw\n' +
  'RTFDMEEGA1UEAww6MTFzaGlwIHVuaXQtdGVzdCBDQSAobm90IGEgc2VjcmV0LCBu\n' +
  'ZXZlciB0cnVzdGVkIGFueXdoZXJlKTAgFw0yNjEwMTExOTIyMTZaGA8yMTI2MDkx\n' +
  'NzE5MjIxNlowRTFDMEEGA1UEAww6MTFzaGlwIHVuaXQtdGVzdCBDQSAobm90IGEg\n' +
  'c2VjcmV0LCBuZXZlciB0cnVzdGVkIGFueXdoZXJlKTBZMBMGByqGSM49AgEGCCqG\n' +
  'SM49AwEHA0IABIBI6jQxtHbiYQBL5SIFFXMvXFtub6ZgcWDLpJn/1SdBVPr9DWid\n' +
  'tctkfnTmBmiQREy1vvDcnowl+iTrA3UnEZijYzBhMB0GA1UdDgQWBBSizeRwPKr5\n' +
  'Joy0ZM1jUsSjv7gVwzAfBgNVHSMEGDAWgBSizeRwPKr5Joy0ZM1jUsSjv7gVwzAP\n' +
  'BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNIADBF\n' +
  'AiAI3S0f/5tjAfPycCK18MomN6/YHV+tT40ygInIn3tb+AIhANJm3cPirmTVq1tf\n' +
  'vBLn+b7utaSKnZo5BVBAo5Ah9Bmz\n' +
  '-----END CERTIFICATE-----\n';
const SH_MIGRATION = 'postgres://ship11_migrator:pw@localhost:5432/ship11_staging';
const SH_RUNTIME = 'postgres://ship11_app:pw@localhost:5432/ship11_staging';
const SH_ENV = {
  APP_ENV: 'staging',
  DB_REMOTE_TARGET: 'SELF_HOSTED',
  MIGRATION_DATABASE_URL: SH_MIGRATION,
  DATABASE_URL: SH_RUNTIME,
  MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_staging',
  DB_SSL_CA: TEST_CA,
};

describe('resolveCliTarget — DB_REMOTE_TARGET', () => {
  it('SELF_HOSTED accepts exactly localhost:5432/ship11_staging with the two roles, strict TLS and the typed target', () => {
    const result = resolveCliTarget(SH_ENV);
    expect(result).toMatchObject({
      ok: true,
      target: {
        appEnv: 'staging',
        connectionString: SH_MIGRATION,
        selfHosted: true,
        expected: { database: 'ship11_staging', user: 'ship11_migrator' },
      },
    });
    if (result.ok) {
      expect(result.target.tls?.rejectUnauthorized).toBe(true);
      expect(connectedIdentityMatches(result.target, { database: 'ship11_staging', user: 'ship11_migrator' })).toBe(true);
      expect(connectedIdentityMatches(result.target, { database: 'ship11_staging', user: 'ship11_app' })).toBe(false);
      expect(connectedIdentityMatches(result.target, { database: 'postgres', user: 'ship11_migrator' })).toBe(false);
    }
  });

  it('an unknown selector is refused whatever else is right, and its value is never printed', () => {
    for (const selector of ['', 'self_hosted', ' SELF_HOSTED', 'LOCAL', 'TRUE']) {
      const result = resolveCliTarget({ ...SH_ENV, DB_REMOTE_TARGET: selector });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problem).toContain('DB_REMOTE_TARGET must be SUPABASE or SELF_HOSTED');
        if (selector !== '') {
          expect(result.problem).not.toContain(`'${selector}'`);
        }
      }
    }
  });

  it('SUPABASE or no selector keeps the Supabase rules: the self-hosted URLs are refused', () => {
    for (const selector of [undefined, 'SUPABASE']) {
      const env = { ...SH_ENV, DB_REMOTE_TARGET: selector };
      expect(resolveCliTarget(env)).toMatchObject({ ok: false });
    }
  });

  it('SELF_HOSTED never reaches production, and development/test ignore the selector', () => {
    expect(resolveCliTarget({ ...SH_ENV, APP_ENV: 'production' })).toMatchObject({ ok: false });
    const dev = resolveCliTarget({ APP_ENV: 'development', DB_REMOTE_TARGET: 'SELF_HOSTED', DATABASE_URL: 'postgres://ship11_dev:p@localhost:5432/ship11_dev' });
    expect(dev).toMatchObject({ ok: true, target: { appEnv: 'development', selfHosted: false } });
  });

  it('refuses every URL that is not the one target, naming the variable and never the value', () => {
    const urls = (user: string, over: { host?: string; port?: number; db?: string; suffix?: string } = {}): string =>
      `postgres://${user}:SECRET_URL_PW@${over.host ?? 'localhost'}:${over.port ?? 5432}/${over.db ?? 'ship11_staging'}${over.suffix ?? ''}`;
    const cases: Array<[string, Record<string, string | undefined>]> = [
      ['IP address host', { MIGRATION_DATABASE_URL: urls('ship11_migrator', { host: '127.0.0.1' }) }],
      ['upper-case host', { MIGRATION_DATABASE_URL: urls('ship11_migrator', { host: 'LOCALHOST' }) }],
      ['remote host', { DATABASE_URL: urls('ship11_app', { host: 'db.example.test' }) }],
      ['port', { MIGRATION_DATABASE_URL: urls('ship11_migrator', { port: 5433 }) }],
      ['database', { DATABASE_URL: urls('ship11_app', { db: 'postgres' }) }],
      ['query string', { MIGRATION_DATABASE_URL: urls('ship11_migrator', { suffix: '?sslmode=no-verify' }) }],
      ['fragment', { DATABASE_URL: urls('ship11_app', { suffix: '#x' }) }],
      ['same role', { DATABASE_URL: SH_MIGRATION }],
      ['wrong migration role', { MIGRATION_DATABASE_URL: urls('postgres') }],
      ['wrong runtime role', { DATABASE_URL: urls('postgres') }],
      ['swapped roles', { MIGRATION_DATABASE_URL: SH_RUNTIME, DATABASE_URL: SH_MIGRATION }],
      ['missing runtime url', { DATABASE_URL: undefined }],
      ['missing migration url', { MIGRATION_DATABASE_URL: undefined }],
      ['garbage url', { MIGRATION_DATABASE_URL: 'not a url SECRET_URL_PW' }],
    ];
    for (const [name, mutation] of cases) {
      const result = resolveCliTarget({ ...SH_ENV, ...mutation });
      expect([name, result.ok]).toEqual([name, false]);
      if (!result.ok) {
        expect(result.problem).not.toContain('SECRET_URL_PW');
        expect(result.problem).toMatch(/MIGRATION_DATABASE_URL|DATABASE_URL/);
      }
    }
  });

  it('needs strict TLS and the typed target', () => {
    expect(resolveCliTarget({ ...SH_ENV, DB_SSL_CA: undefined })).toMatchObject({ ok: false });
    expect(resolveCliTarget({ ...SH_ENV, DB_SSL_CA: 'not a certificate' })).toMatchObject({ ok: false });
    expect(resolveCliTarget({ ...SH_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toMatchObject({ ok: false });
    for (const confirm of [undefined, '', 'localhost:5432/ship11_staging ', 'localhost:5432/ship11_test', '127.0.0.1:5432/ship11_staging']) {
      const result = resolveCliTarget({ ...SH_ENV, MIGRATION_CONFIRM_TARGET: confirm });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problem).toContain('MIGRATION_CONFIRM_TARGET=localhost:5432/ship11_staging');
      }
    }
  });

  it('keeps the contract constants in one place', () => {
    expect(SELF_HOSTED_TARGET).toEqual({
      appEnv: 'staging',
      host: 'localhost',
      port: 5432,
      database: 'ship11_staging',
      migrationRole: 'ship11_migrator',
      runtimeRole: 'ship11_app',
      confirmTarget: 'localhost:5432/ship11_staging',
    });
  });
});

describe('selfHostedIdentityProblem — the server must report the operator target', () => {
  const good = { database_name: 'ship11_staging', user_name: 'ship11_migrator', session_user_name: 'ship11_migrator', server_port: 5432, tls: true, privileged: false };

  it('accepts the exact identity', () => {
    expect(selfHostedIdentityProblem(good)).toBeUndefined();
    expect(selfHostedIdentityProblem({ ...good, server_port: '5432' })).toBeUndefined();
  });

  it('refuses every deviation with a fixed sentence that echoes nothing from the row', () => {
    const rows: Array<[string, Parameters<typeof selfHostedIdentityProblem>[0]]> = [
      ['database', { ...good, database_name: 'SECRET_ROW_MARKER' }],
      ['current role', { ...good, user_name: 'SECRET_ROW_MARKER' }],
      ['session role', { ...good, session_user_name: 'postgres' }],
      ['elevated role', { ...good, privileged: true }],
      ['unknown privilege', { ...good, privileged: null }],
      ['port', { ...good, server_port: 5433 }],
      ['unix socket', { ...good, server_port: null }],
      ['no TLS', { ...good, tls: false }],
      ['TLS unknown', { ...good, tls: null }],
      ['empty row', {}],
      ['no row', undefined],
    ];
    for (const [name, row] of rows) {
      const problem = selfHostedIdentityProblem(row);
      expect([name, typeof problem]).toEqual([name, 'string']);
      expect(problem).not.toContain('SECRET_ROW_MARKER');
    }
  });

  it('uses a read-only query', () => {
    expect(SELF_HOSTED_IDENTITY_SQL).toMatch(/^SELECT /);
    expect(SELF_HOSTED_IDENTITY_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b/i);
  });
});
