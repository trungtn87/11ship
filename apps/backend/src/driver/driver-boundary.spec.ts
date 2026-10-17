import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';
import { DRIVER_STATUSES, DRIVER_TYPES } from './driver-types';

// Structural facts of the M01-A2D module split, proven on the code with comments removed.

function filesOf(directory: string): string[] {
  return readdirSync(sourcePath(directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${directory}/${name}`);
}

function codeIn(directory: string): string {
  return filesOf(directory)
    .map((file) => codeOf(file))
    .join('\n');
}

function productionFiles(): string[] {
  return readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'));
}

describe('Driver (M03) module boundary', () => {
  it('imports nothing from Auth, Onboarding or Shop and imports no Nest module: every dependency runs towards it', () => {
    const code = codeIn('driver');
    expect(code).not.toMatch(/from '\.\.\/(auth|onboarding|shop)\//);
    expect(codeOf('driver/driver.module.ts')).not.toMatch(/imports:/);
  });

  it('never opens, commits or rolls back a transaction and never touches the pool', () => {
    expect(codeIn('driver')).not.toMatch(/DATABASE_POOL|from 'pg'|new Pool|\.connect\(|BEGIN|COMMIT|ROLLBACK|TransactionManager|withTransaction/);
  });

  it('has no wallet balance or transaction table, no order or delivery table and no top-up or withdrawal command (the wallet is M04)', () => {
    // M03 owns the bank account, the history and the two wallet PARAMETERS (a minimum per request); it never holds a balance.
    expect(codeIn('driver')).not.toMatch(/app\.(wallets?|driver_wallets?|wallet_\w+|wallet_transactions?|orders?|deliver\w*)\b/i);
    expect(codeIn('driver')).not.toMatch(/\b(creditWallet|debitWallet|requestTopup|requestWithdraw|topupWallet|withdrawFromWallet)\b/);
  });

  it('interpolates nothing but fixed fragments chosen by code into SQL (the clock, the column lists, the patch whitelist, the number of a bind parameter)', () => {
    // Never a request value: every interpolated name is a constant of the file or the column of a closed whitelist (DriverPatch).
    const fixed = /^\$\{(CLOCK_CTE|DRIVER_COLUMNS|COLUMNS|clause|sets\.join\(', '\)|ms\('[a-z_.]+'\)|alternatives\.join\(' OR '\)|params\.length( - 1)?|column|spec\.column|spec\.cast \?\? ''|parts\.join\(' AND '\))\}$/;
    for (const file of filesOf('driver').filter((name) => name.endsWith('-repository.ts') || name.endsWith('shipper-wallet-parameters.ts'))) {
      const interpolations = codeOf(file).match(/\$\{[^}]*\}/g) ?? [];
      expect([file, interpolations.filter((i) => !fixed.test(i))]).toEqual([file, []]);
    }
  });

  it('the eligibility reader and the active guard only read: no INSERT, UPDATE, DELETE or lock clause', () => {
    for (const file of ['driver/driver-eligibility-reader.ts', 'driver/driver-active-guard.ts']) {
      expect([file, /\b(INSERT|UPDATE|DELETE)\b|FOR (UPDATE|SHARE)/.test(codeOf(file))]).toEqual([file, false]);
    }
  });

  it('only the Driver module issues SQL against its table', () => {
    const outside = productionFiles()
      .filter((name) => !name.startsWith('driver/'))
      // The one read-only projection of the administration web (M01-ADMIN account read), pinned by its own boundary spec.
      .filter((name) => name !== 'admin-accounts/admin-account-read-repository.ts')
      .filter((name) => /app\.drivers\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });

  it('Driver registration has no operating area anywhere in production code (Owner revision, task section 22)', () => {
    const named = productionFiles().filter((name) => /driver_service_areas|DRIVER_SERVICE_AREAS|insertServiceAreas/.test(codeOf(name)));
    expect(named).toEqual([]);
    // Driver code and the Driver coordinator never touch M02's service areas.
    for (const file of [...filesOf('driver'), 'onboarding/driver-onboarding-service.ts', 'onboarding/driver-onboarding-validation.ts']) {
      expect([file, /service_?area|ServiceArea/i.test(codeOf(file))]).toEqual([file, false]);
    }
  });

  it('the vocabulary is the contract one: EXTERNAL | PLATFORM and PENDING | ACTIVE | SUSPENDED | CLOSING | CLOSED, no SYSTEM', () => {
    expect([...DRIVER_TYPES]).toEqual(['EXTERNAL', 'PLATFORM']);
    expect([...DRIVER_STATUSES]).toEqual(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']);
    // 'SYSTEM' is the actor kind of the history rows (driver-event-repository), never a driver type or status.
    expect(codeOf('driver/driver-types.ts')).not.toMatch(/'SYSTEM'/);
    expect(codeOf('driver/driver-repository.ts')).not.toMatch(/'SYSTEM'/);
  });

  it('the Driver repository inserts only the fixed self-onboarding shape; every later change is one version-checked UPDATE through the DriverPatch whitelist; nothing is deleted', () => {
    const repository = codeOf('driver/driver-repository.ts');
    expect(repository.match(/INSERT INTO app\.drivers\b/g) ?? []).toHaveLength(1);
    expect(repository.match(/UPDATE app\.drivers\b/g) ?? []).toHaveLength(1);
    expect(repository).toContain('d.version = $2::bigint');
    expect(codeIn('driver')).not.toMatch(/DELETE FROM/);
    const insert = repository.slice(repository.indexOf('INSERT INTO app.drivers'), repository.indexOf('ON CONFLICT (user_id) DO NOTHING'));
    expect(insert).toContain("'EXTERNAL', 'PENDING', false, 1");
    // The four fixed values are literals: none of them is a bind parameter.
    expect(insert.match(/\$\d+/g)).toEqual(['$1', '$2', '$3', '$4']);
  });

  it('the active guard is not wired to any endpoint yet: only the Driver module and its own spec name it', () => {
    const users = productionFiles()
      .filter((name) => !name.startsWith('driver/'))
      .filter((name) => /DriverActiveGuard|driver-active-guard/.test(codeOf(name)));
    expect(users).toEqual([]);
  });
});

describe('Auth reads the Driver only through the owner read port', () => {
  it('Auth imports from the Driver module only the eligibility reader and the shared types, never the repository or the guard', () => {
    const imports = codeIn('auth').match(/from '\.\.\/driver\/[^']+'/g) ?? [];
    expect([...new Set(imports)].sort()).toEqual([
      "from '../driver/driver-eligibility-reader'",
      "from '../driver/driver-types'",
      "from '../driver/driver.module'",
    ]);
  });

  it('Auth names no Driver table', () => {
    expect(codeIn('auth')).not.toMatch(/app\.(drivers?|driver_\w+)\b/i);
  });
});

describe('Driver onboarding coordinator boundary', () => {
  const driverFiles = () => filesOf('onboarding').filter((file) => file.startsWith('onboarding/driver-'));

  it('issues no SQL itself and never opens a transaction: it composes the repositories inside the executor transaction', () => {
    const code = driverFiles()
      .map((file) => codeOf(file))
      .join('\n');
    expect(code).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|BEGIN|COMMIT|ROLLBACK|TransactionManager|withTransaction/);
  });

  it('has no Wallet, bank, approval, activation, topup or business-hours code', () => {
    const code = driverFiles()
      .map((file) => codeOf(file))
      .join('\n');
    expect(code).not.toMatch(/wallet|bank|approv|activat|topup|withdraw|menu|business_hours/i);
    // The one allowed "delivery" word is the flag the contract answer reports as false.
    expect(code.replace(/accepting_deliveries/g, '')).not.toMatch(/deliver/i);
  });

  it('writes only through the M00 idempotency executor, once', () => {
    expect(codeOf('onboarding/driver-onboarding-service.ts').split('this.executor.execute(').length - 1).toBe(1);
  });

  it('the controller selects no role and mints no token: it never touches the session service', () => {
    expect(codeOf('onboarding/driver-onboarding.controller.ts')).not.toMatch(/SessionService|setActiveRole|selectRole|access_token|accessToken/);
  });

  it('the Driver files add no import from Auth beyond the guard, the principal, the participants and the text helper', () => {
    const imports = driverFiles()
      .map((file) => codeOf(file))
      .join('\n')
      .match(/from '\.\.\/auth\/[^']+'/g);
    expect([...new Set(imports)].sort()).toEqual([
      "from '../auth/auth-principal'",
      "from '../auth/auth-validation'",
      "from '../auth/role-grant-participant'",
      "from '../auth/session-auth.guard'",
      "from '../auth/session-authorization-participant'",
    ]);
  });
});
