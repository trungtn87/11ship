import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M04-B2.2b, proven on the code with comments removed.

const files = (): string[] =>
  readdirSync(sourcePath('admin-topups'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((name) => `admin-topups/${name}`);

describe('M04-B2.2b admin top-up boundary', () => {
  it('exposes exactly the documented routes: list, read, confirm, reject', () => {
    const controller = codeOf('admin-topups/admin-topup.controller.ts');
    expect(controller).toContain("@Controller('admin/finance/topup-requests')");
    expect(controller).not.toMatch(/SessionAuthGuard|AuthPrincipal/);
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\([^)]*\)/g)).toEqual(['@Get()', "@Get(':request_id')", "@Post(':request_id/confirm')", "@Post(':request_id/reject')"]);
  });

  it('issues no SQL and opens no transaction of its own: money is written by the wallet package inside the executor transaction', () => {
    for (const file of files()) {
      const code = codeOf(file);
      expect(code).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|\bBEGIN\b|COMMIT|ROLLBACK|app\.\w+/);
    }
  });

  it('every write asks the finance right again under the locks and writes in the idempotency executor; confirm needs the record right', () => {
    const service = codeOf('admin-topups/admin-topup-service.ts');
    expect(service).toContain('this.access.require(context, locked, permission, nowMs)');
    expect(service).toContain('FINANCE_PERMISSION_TOPUP_RECORD');
    expect(service).toContain('this.executor.execute');
    expect(service).not.toMatch(/activate|ACTIVE'|DRIVER_WALLET_PORT/);
  });

  it('never puts the bank account, the holder or the bank transaction code into the audit row or the event', () => {
    const service = codeOf('admin-topups/admin-topup-service.ts');
    const metadata = service.slice(service.indexOf('metadata:'), service.indexOf('metadata:') + 60);
    expect(metadata).toContain('state: row.state');
    expect(service.slice(service.indexOf('payload: {'))).not.toMatch(/canonical|account_number|account_holder/);
    expect(service).not.toMatch(/metadata:[^}]*(canonical|accountNumber|accountHolder)/);
  });
});
