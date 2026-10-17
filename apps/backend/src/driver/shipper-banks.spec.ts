import { describe, expect, it } from '@jest/globals';
import { NotIntegratedDriverWalletPort } from './driver-wallet-port';
import { comparableName, findBank, holderMatchesName, SHIPPER_BANKS } from './shipper-banks';

describe('Shipper bank account rules (M03)', () => {
  it('compares names the way a bank prints them: capitals, no marks, đ as d, any white space', () => {
    expect(holderMatchesName('Nguyễn Văn Đạt', 'NGUYEN VAN DAT')).toBe(true);
    expect(holderMatchesName('Nguyễn  Văn Đạt', ' nguyen van dat ')).toBe(true);
    expect(holderMatchesName('Trần Thị B', 'TRAN THI B.')).toBe(true);
    expect(comparableName('Lê-Hoàng')).toBe('LE HOANG');
  });

  it('refuses a different person, a different order, a missing or an added word', () => {
    expect(holderMatchesName('Nguyễn Văn A', 'NGUYEN VAN B')).toBe(false);
    expect(holderMatchesName('Nguyễn Văn A', 'VAN NGUYEN A')).toBe(false);
    expect(holderMatchesName('Nguyễn Văn A', 'NGUYEN VAN')).toBe(false);
    expect(holderMatchesName('Nguyễn Văn A', 'NGUYEN VAN A JR')).toBe(false);
    expect(holderMatchesName('   ', '   ')).toBe(false);
  });

  it('has a closed list of unique bank codes', () => {
    const codes = SHIPPER_BANKS.map((bank) => bank.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z0-9]{2,16}$/.test(code))).toBe(true);
    expect(findBank('VCB')?.name).toBe('Vietcombank');
    expect(findBank('vcb')).toBeUndefined();
    expect(findBank('NOPE')).toBeUndefined();
  });

  it('until M04 provides a wallet, nothing is ready and nothing is settled (no balance is invented)', async () => {
    const port = new NotIntegratedDriverWalletPort();
    expect(await port.readinessForOrders()).toEqual({ ready: false, reason: 'WALLET_NOT_AVAILABLE' });
    expect(await port.settlementForClosure()).toEqual({ settled: false, reason: 'WALLET_NOT_AVAILABLE' });
  });
});
