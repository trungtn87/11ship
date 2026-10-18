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

  it('moves money only as a TOPUP posting: one literal-TOPUP ledger INSERT, the wallet UPDATE only in the settlement repository, no DELETE or TRUNCATE, a single INSERT of a literal-zero wallet', () => {
    const code = walletCode();
    // M04-B2.2b: the UPDATEs of this package are the conditional request change, the SYSTEM receiving switch and the balance move of the TOPUP posting.
    expect([...(code.match(/\bUPDATE\s+app\.\w+/gi) ?? [])].sort()).toEqual(['UPDATE app.driver_wallets', 'UPDATE app.system_owned_bank_accounts', 'UPDATE app.wallet_topup_requests', 'UPDATE app.wallet_topup_requests']);
    expect(codeOf('wallet/topup-settlement-repository.ts')).toContain('UPDATE app.driver_wallets');
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code.match(/INSERT\s+INTO\s+app\.wallet_ledger_entries/gi)).toHaveLength(1);
    expect(codeOf('wallet/topup-settlement-repository.ts')).toMatch(/INSERT INTO app\.wallet_ledger_entries[^`]*VALUES \(\$1::uuid, \$2::uuid, \$3::bigint, 'TOPUP'/);
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

  it('M04-B2.2b: the only inserts are the wallet, the request, an INACTIVE system account, the bank record, the topup and its TOPUP ledger row; no receiving switch to true by literal', () => {
    const code = walletCode();
    expect([...(code.match(/INSERT\s+INTO\s+app\.\w+/gi) ?? [])].sort()).toEqual([
      'INSERT INTO app.driver_wallets',
      'INSERT INTO app.system_owned_bank_accounts',
      'INSERT INTO app.wallet_bank_transactions',
      'INSERT INTO app.wallet_ledger_entries',
      'INSERT INTO app.wallet_topup_requests',
      'INSERT INTO app.wallet_topups',
    ]);
    // A receiving account is only ever inserted NOT receiving (the literal false); the switch takes its value from the SYSTEM command, never a literal true.
    expect(code).toContain('SELECT $1::uuid, $2, $3, $4, false, 1, clock.t, clock.t');
    expect(code).not.toMatch(/can_receive\s*=\s*true/i);
    expect(code).not.toMatch(/(UPDATE|DELETE\s+FROM)\s+app\.(wallet_topups|wallet_bank_transactions|wallet_ledger_entries)/i);
    // The bank record and the topup are written only by the settlement repository.
    for (const file of walletFiles().filter((name) => name !== 'wallet/topup-settlement-repository.ts')) {
      expect(codeOf(file)).not.toMatch(/INSERT\s+INTO\s+app\.(wallet_topups|wallet_bank_transactions|wallet_ledger_entries)/i);
    }
    // Outside the wallet package nothing issues SQL on these tables, and the topup modules issue no SQL at all.
    const outside = productionFiles().filter((name) => !name.startsWith('wallet/') && /app\.(system_owned_bank_accounts|wallet_topup_requests|wallet_bank_transactions|wallet_topups)\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });

  it('has no withdrawal, adjustment, hold or commission command', () => {
    expect(walletCode()).not.toMatch(/\b(requestWithdraw|postAdjustment|reserve|capture|release|chargeCommission|debitWallet|creditWallet)\b/);
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
