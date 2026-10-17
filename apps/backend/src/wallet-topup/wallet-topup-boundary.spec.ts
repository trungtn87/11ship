import { describe, expect, it } from '@jest/globals';
import { codeOf } from '../shared/source-scan.fixture';

// Structural facts of M04-B2.1 (Shipper top-up requests), proven on the code with comments removed.

describe('Shipper top-up request boundary (M04-B2.1)', () => {
  it('exposes exactly the documented routes behind the client session guard; the only path parameter is the request id', () => {
    const controller = codeOf('wallet-topup/wallet-topup.controller.ts');
    expect(controller).toContain('@UseGuards(SessionAuthGuard)');
    expect(controller).toContain("@Controller('driver/wallet')");
    expect(controller.match(/@(Get|Put|Post|Patch|Delete)\('[^']*'\)/g)).toEqual([
      "@Get('topup-receiving-accounts')",
      "@Get('topup-requests')",
      "@Post('topup-requests')",
      "@Get('topup-requests/:request_id')",
      "@Post('topup-requests/:request_id/cancel')",
    ]);
    expect(controller.match(/@Param\('[^']*'\)/g)).toEqual(["@Param('request_id')", "@Param('request_id')"]);
    expect(controller).not.toMatch(/driverId|driver_id|walletId|wallet_id|user_id|userId/);
  });

  it('issues no SQL, opens no transaction itself and writes only through the idempotency executor, once per command', () => {
    const service = codeOf('wallet-topup/topup-request-service.ts');
    expect(service).not.toMatch(/\.query\(|DATABASE_POOL|from 'pg'|\bBEGIN\b|COMMIT|ROLLBACK/);
    expect(service.split('this.executor.execute(').length - 1).toBe(2);
    // Lock order: the user and CURRENT session rows, then the driver row, before any request or wallet statement.
    expect(service.indexOf("this.authority.lock(context, principal, 'update')")).toBeLessThan(service.indexOf('this.drivers.lockByUserId('));
    const create = service.slice(service.indexOf('async create('));
    expect(create.indexOf('this.#writer(context, principal)')).toBeLessThan(create.indexOf('this.wallets.ensureZeroWallet('));
  });

  it('moves no money: it never touches the ledger, a topup, a bank record, a balance or a hold, and does not open a Shipper to orders', () => {
    const code = [codeOf('wallet-topup/topup-request-service.ts'), codeOf('wallet-topup/wallet-topup.controller.ts'), codeOf('wallet-topup/topup-request-validation.ts')].join('\n');
    expect(code).not.toMatch(/ledger|wallet_topups|bank_transactions|balance|held|reserve|capture|release|creditTopup|DRIVER_WALLET_PORT|readinessForOrders/i);
  });

  it('takes the minimum from the database parameter reader, with no amount of its own', () => {
    const service = codeOf('wallet-topup/topup-request-service.ts');
    expect(service).toContain('this.limits.limits(context)');
    expect(service).not.toMatch(/100_?000|100000/);
  });
});
