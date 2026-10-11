import { describe, expect, it } from '@jest/globals';
import { connectedIdentityMatches, resolveCliTarget } from './cli-target-guard';

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
