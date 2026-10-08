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

  it('has no Wallet, bank, closure, order or delivery table and no approval, activation or lifecycle command', () => {
    expect(codeIn('driver')).not.toMatch(/app\.(wallets?|driver_wallets?|driver_bank\w*|driver_closure\w*|wallet_\w+|orders?|deliver\w*)\b/i);
    // Case-sensitive on purpose: the STATUS names (SUSPENDED, ACTIVE, ...) are vocabulary, a command is a verb.
    expect(codeIn('driver')).not.toMatch(/[aA]pprove|[aA]ctivate|[sS]uspend\w*\(|[rR]esume|[tT]opup|[wW]ithdraw/);
  });

  it('interpolates nothing but the fixed clock fragment into SQL', () => {
    for (const file of filesOf('driver').filter((name) => name.endsWith('-repository.ts'))) {
      const interpolations = codeOf(file).match(/\$\{[^}]*\}/g) ?? [];
      expect([file, interpolations.filter((i) => i !== '${CLOCK_CTE}')]).toEqual([file, []]);
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
    expect(codeIn('driver')).not.toMatch(/'SYSTEM'/);
  });

  it('the Driver repository exposes no command that changes type, status or flags: one INSERT of fixed values, no UPDATE, no DELETE', () => {
    const repository = codeOf('driver/driver-repository.ts');
    expect(repository.match(/INSERT INTO app\.drivers\b/g) ?? []).toHaveLength(1);
    expect(repository).not.toMatch(/UPDATE app\.|DELETE FROM/);
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
