import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';
import { GRANTABLE_FINANCE_PERMISSIONS, isGrantableFinancePermission, RESERVED_FINANCE_PERMISSIONS } from './finance-access-constants';
import { parseBankAccountBody, parseFinanceId, parseGrantBody } from './finance-access-validation';

// Structural facts of M04-B2.2a (finance access and the receiving accounts of the system), proven on the code with comments removed.

const files = (): string[] =>
  readdirSync(sourcePath('finance-access'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => `finance-access/${name}`);
const code = (): string => files().map((file) => codeOf(file)).join('\n');
const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

describe('M04-B2.2a boundary', () => {
  it('exposes exactly the documented routes, none that changes or deletes an account or moves money (the receiving switch is the only change)', () => {
    const controller = codeOf('finance-access/finance-access.controller.ts');
    expect(controller).toContain("@Controller('admin/finance')");
    expect(controller).not.toMatch(/SessionAuthGuard|AuthPrincipal/);
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\('[^']*'\)/g)).toEqual([
      "@Get('access/me')",
      "@Get('access/admins/:user_id')",
      "@Post('access/admins/:user_id/grant')",
      "@Post('access/admins/:user_id/revoke')",
      "@Get('bank-accounts')",
      "@Get('bank-accounts/:account_id')",
      "@Post('bank-accounts')",
      "@Post('bank-accounts/:account_id/receiving')",
    ]);
    expect(controller).not.toMatch(/@(Put|Patch|Delete)\(/);
  });

  it('issues no SQL in services or controller, the grant SQL stays in the repository and touches no wallet, ledger, topup or bank table', () => {
    for (const file of files().filter((name) => !name.endsWith('finance-access-repository.ts'))) {
      expect(codeOf(file)).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|\bBEGIN\b|COMMIT|ROLLBACK/);
    }
    expect(code()).not.toMatch(/app\.(driver_wallets|wallet_\w+|system_owned_bank_accounts)\b/);
    expect(code()).not.toMatch(/\bledger\b|balance_vnd|held_vnd|wallet_ledger|can_receive\s*=\s*true|setCanReceive|enableReceiving/i);
    expect(codeOf('finance-access/finance-access-repository.ts')).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });

  it('every SYSTEM-only call re-checks the actor under the locks, after the database clock: no cookie-only decision', () => {
    for (const file of ['finance-access/finance-access-service.ts', 'finance-access/system-bank-account-service.ts']) {
      const service = codeOf(file);
      expect(service).toContain('this.actor.assertLive(locked, await freshClockMs(context))');
      expect(service.indexOf('this.actor.lock(context, known')).toBeLessThan(service.indexOf('assertLive'));
    }
    const access = codeOf('finance-access/finance-access-service.ts');
    // Lock order of a change: actor locks, then the target USER row, then its membership, then the right row.
    expect(access.indexOf('this.#lockSystem(context, known')).toBeLessThan(access.indexOf('this.users.lockById('));
    expect(access.indexOf('this.users.lockById(')).toBeLessThan(access.indexOf('this.memberships.lock('));
    expect(access.indexOf('this.memberships.lock(')).toBeLessThan(access.indexOf('this.grants.lockForUpdate('));
  });

  it('a right is never derived from the app permissions or the Shipper review rights, and SYSTEM is never given a row', () => {
    expect(code()).not.toMatch(/can_view|can_review_profile|can_lock|admin_app_permissions|AdminAccountReadRepository|canViewDriver|permissions\(/);
    expect(codeOf('finance-access/finance-access-participant.ts')).toContain("adminRole === 'SYSTEM'");
  });

  it('only the read, topup and the three withdrawal rights can be granted today; the reserved names grant nothing', () => {
    expect([...GRANTABLE_FINANCE_PERMISSIONS]).toEqual(['wallet.read', 'wallet.topup.record', 'wallet.withdrawal.process', 'wallet.withdrawal.confirm', 'wallet.withdrawal.reconcile']);
    for (const reserved of RESERVED_FINANCE_PERMISSIONS) {
      expect(isGrantableFinancePermission(reserved)).toBe(false);
      expect(() => parseGrantBody({ permission_key: reserved, expected_version: 0 })).toThrow();
    }
  });
});

describe('M04-B2.2a validation', () => {
  it('grant / revoke: exact {permission_key, expected_version >= 0}', () => {
    expect(parseGrantBody({ permission_key: 'wallet.read', expected_version: 0 })).toEqual({ permissionKey: 'wallet.read', expectedVersion: 0 });
    for (const bad of [{}, { permission_key: 'wallet.read' }, { permission_key: 'wallet.read', expected_version: -1 }, { permission_key: 'wallet.read', expected_version: 1.5 },
      { permission_key: 'wallet.*', expected_version: 0 }, { permission_key: 'wallet.read', expected_version: 0, user_id: ID }, { permission_key: 'wallet.read', expected_version: 0, role: 'SYSTEM' }, null, []]) {
      expect(() => parseGrantBody(bad)).toThrow();
    }
    expect(parseFinanceId(ID)).toBe(ID);
    expect(() => parseFinanceId('x')).toThrow();
  });

  it('bank account: exact {bank_id, account_number, account_holder} in the shapes the table accepts', () => {
    expect(parseBankAccountBody({ bank_id: 'VCB', account_number: '0123 456-789', account_holder: '  CONG   TY 11SHIP ' })).toEqual({ bankId: 'VCB', accountNumber: '0123456789', accountHolder: 'CONG TY 11SHIP' });
    for (const bad of [{}, { bank_id: 'vcb', account_number: '0123456789', account_holder: 'A' }, { bank_id: 'V', account_number: '0123456789', account_holder: 'A' }, { bank_id: 'VCB', account_number: '12345', account_holder: 'A' },
      { bank_id: 'VCB', account_number: '0123456789', account_holder: '' }, { bank_id: 'VCB', account_number: '0123456789', account_holder: 'A\u0000' }, { bank_id: 'VCB', account_number: '0123456789', account_holder: 'A'.repeat(121) },
      { bank_id: 'VCB', account_number: '0123456789', account_holder: 'A', can_receive: true }, { bank_id: 'VCB', account_number: 1234567890, account_holder: 'A' }]) {
      expect(() => parseBankAccountBody(bad)).toThrow();
    }
  });
});
