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

  it('moves money only through the commission hold service (M04-A2.2): reserve, capture and release of one assignment, nothing else', () => {
    const code = walletCode();
    const writers = walletFiles().filter((file) => /\b(UPDATE\s+app\.(driver_wallets|wallet_holds)|INSERT\s+INTO\s+app\.(wallet_holds|wallet_ledger_entries))\b/i.test(codeOf(file)));
    expect(writers).toEqual(['wallet/commission-hold-service.ts']);
    // M04-B2.1 still updates a top-up REQUEST (no money); the wallet and the hold are updated by the commission service only.
    expect([...(code.match(/\bUPDATE\s+app\.\w+/gi) ?? [])].sort()).toEqual(['UPDATE app.driver_wallets', 'UPDATE app.wallet_holds', 'UPDATE app.wallet_topup_requests']);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    // The one ledger INSERT is the commission debit; the one hold INSERT is a COMMISSION hold; a literal-zero wallet is the only wallet INSERT.
    expect(code.match(/INSERT INTO app\.wallet_ledger_entries\b/g) ?? []).toHaveLength(1);
    expect(code).toContain("'COMMISSION_DEBIT'");
    expect(codeOf('wallet/commission-hold-service.ts')).not.toMatch(/'(TOPUP|WITHDRAWAL_DEBIT|ADJUSTMENT_CREDIT|ADJUSTMENT_DEBIT)'/);
    expect(code.match(/INSERT INTO app\.wallet_holds\b/g) ?? []).toHaveLength(1);
    expect(codeOf('wallet/commission-hold-service.ts')).not.toMatch(/WITHDRAWAL/);
    expect(code.match(/INSERT INTO app\.driver_wallets\b/g) ?? []).toHaveLength(1);
    const insert = code.slice(code.indexOf('INSERT INTO app.driver_wallets'), code.indexOf('ON CONFLICT (driver_id) DO NOTHING'));
    expect(insert).toContain('SELECT $1::uuid, $2::uuid, 0, 0, 1, clock.t, clock.t');
    expect(insert.match(/\$\d+/g)).toEqual(['$1', '$2']);
  });

  it('holds are written only by the commission service, and it has no withdrawal hold and no free "set held" helper', () => {
    const code = walletCode();
    expect(code).toMatch(/FROM app\.wallet_holds/);
    expect(code).not.toMatch(/DELETE\s+FROM\s+app\.wallet_holds/i);
    expect(code).not.toMatch(/\b(setHeld|postMoney|placeHold|addHold|createHold)\b/);
    expect(codeOf('wallet/wallet-service.ts')).not.toMatch(/held_vnd\s*=|balance_vnd\s*=/);
    expect(codeOf('wallet/wallet-repository.ts')).not.toMatch(/held_vnd\s*=|balance_vnd\s*=/);
  });

  it('M04-B2.1: topup requests are written here only (INSERT PENDING, conditional cancel); no code writes a topup, a bank record or a system account', () => {
    const code = walletCode();
    expect([...(code.match(/INSERT\s+INTO\s+app\.\w+/gi) ?? [])].sort()).toEqual(['INSERT INTO app.driver_wallets', 'INSERT INTO app.wallet_holds', 'INSERT INTO app.wallet_ledger_entries', 'INSERT INTO app.wallet_topup_requests']);
    expect(code).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+app\.(wallet_topups|wallet_bank_transactions|system_owned_bank_accounts)/i);
    // Outside the wallet package nothing issues SQL on these tables, and the topup module issues no SQL at all.
    const outside = productionFiles().filter((name) => !name.startsWith('wallet/') && /app\.(system_owned_bank_accounts|wallet_topup_requests|wallet_bank_transactions|wallet_topups)\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });

  it('has no top-up, withdrawal or adjustment command, and no free credit / debit: only the three commission steps', () => {
    expect(walletCode()).not.toMatch(/\b(creditTopup|requestTopup|requestWithdraw|postAdjustment|reserve|capture|release|chargeCommission|debitWallet|creditWallet)\b/);
    expect(walletCode()).toMatch(/\breserveCommission\b[\s\S]*\bcaptureCommission\b[\s\S]*\breleaseCommission\b/);
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
