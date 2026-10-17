import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M04-A1, proven on the code with comments removed.

function walletFiles(): string[] {
  return readdirSync(sourcePath('wallet'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `wallet/${name}`);
}

function walletCode(): string {
  return walletFiles()
    .map((file) => codeOf(file))
    .join('\n');
}

function productionFiles(): string[] {
  return readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'));
}

describe('M04-A1 wallet core boundary', () => {
  it('exposes no endpoint: no controller, no route decorator, and the application module does not import it yet', () => {
    expect(walletCode()).not.toMatch(/@Controller|@Get\(|@Post\(|@Put\(|@Patch\(|@Delete\(|@UseGuards/);
    expect(codeOf('app.module.ts')).not.toMatch(/WalletModule|wallet\//);
  });

  it('moves no money: no UPDATE, DELETE or TRUNCATE of the wallet tables, no INSERT into the ledger, a single INSERT of a literal-zero wallet', () => {
    const code = walletCode();
    expect(code).not.toMatch(/\bUPDATE\s+app\./i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/INSERT\s+INTO\s+app\.wallet_ledger_entries/i);
    expect(code.match(/INSERT INTO app\.driver_wallets\b/g) ?? []).toHaveLength(1);
    const insert = code.slice(code.indexOf('INSERT INTO app.driver_wallets'), code.indexOf('ON CONFLICT (driver_id) DO NOTHING'));
    expect(insert).toContain('SELECT $1::uuid, $2::uuid, 0, 0, 1, clock.t, clock.t');
    expect(insert.match(/\$\d+/g)).toEqual(['$1', '$2']);
  });

  it('only reads holds (M04-A2.1): no INSERT, UPDATE or DELETE of app.wallet_holds, and no helper that sets the held amount', () => {
    const code = walletCode();
    expect(code).toMatch(/FROM app\.wallet_holds/);
    expect(code).not.toMatch(/INSERT\s+INTO\s+app\.wallet_holds/i);
    expect(code).not.toMatch(/UPDATE\s+app\.wallet_holds/i);
    expect(code).not.toMatch(/DELETE\s+FROM\s+app\.wallet_holds/i);
    expect(code).not.toMatch(/\b(setHeld|postMoney|placeHold|addHold|createHold)\b/);
    expect(code).not.toMatch(/held_vnd\s*=/);
  });

  it('has no top-up, withdrawal, adjustment, hold or commission command', () => {
    expect(walletCode()).not.toMatch(/\b(creditTopup|requestTopup|requestWithdraw|postAdjustment|reserve|capture|release|chargeCommission|debitWallet|creditWallet)\b/);
  });

  it('is a participant: it opens no transaction, holds no pool and calls no network', () => {
    expect(walletCode()).not.toMatch(/DATABASE_POOL|from 'pg'|new Pool|\.connect\(|BEGIN|COMMIT|ROLLBACK|TransactionManager|withTransaction|fetch\(|from 'node:https?'/);
  });

  it('never turns an amount into a JavaScript number: bigint in, bigint out', () => {
    const code = walletCode();
    expect(code).not.toMatch(/\bparseInt\(|\bparseFloat\(|Number\(\s*(row|raw)\.(balance|held)/);
    expect(code).toContain('BigInt(');
  });

  it('only the wallet package issues SQL against the wallet tables, and M03 does not import it (the dependency runs one way)', () => {
    const outside = productionFiles()
      .filter((name) => !name.startsWith('wallet/'))
      .filter((name) => /app\.(driver_wallets|wallet_\w+)\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
    const driverImports = productionFiles()
      .filter((name) => name.startsWith('driver/'))
      .filter((name) => /from '\.\.\/wallet\//.test(codeOf(name)));
    expect(driverImports).toEqual([]);
  });

  it('reaches the driver only through the Driver module repository lock, never through its own SQL on app.drivers', () => {
    expect(walletCode()).not.toMatch(/app\.drivers\b/);
    expect(codeOf('wallet/wallet-service.ts')).toContain('lockById');
  });

  it('leaves the M03 wallet port as it is: not integrated, so a wallet never makes a Shipper ready for orders', () => {
    expect(codeOf('driver/driver.module.ts')).toMatch(/provide: DRIVER_WALLET_PORT, useClass: NotIntegratedDriverWalletPort/);
    expect(walletCode()).not.toMatch(/DRIVER_WALLET_PORT|readinessForOrders|settlementForClosure/);
  });
});
