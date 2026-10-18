import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { parseAccepting, parseBankUpdate, parseClosureRequest, parseProfileUpdate, parseVersionOnly } from './shipper-self-validation';

function refused(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof BadRequestException;
  }
}

describe('Shipper own-command parsers (M03)', () => {
  it('the profile is exactly {expected_version, full_name, plate_number}; the plate may be null or empty', () => {
    expect(parseProfileUpdate({ expected_version: 1, full_name: '  Nguyễn  Văn A ', plate_number: ' 59X1-123.45 ' })).toEqual({ expectedVersion: 1, fullName: 'Nguyễn Văn A', plateNumber: '59X1-123.45' });
    expect(parseProfileUpdate({ expected_version: 1, full_name: 'A', plate_number: null }).plateNumber).toBeNull();
    expect(parseProfileUpdate({ expected_version: 1, full_name: 'A', plate_number: '  ' }).plateNumber).toBeNull();
    for (const bad of [
      { expected_version: 1, full_name: 'A' },
      { expected_version: 1, full_name: '', plate_number: null },
      { expected_version: 0, full_name: 'A', plate_number: null },
      { expected_version: 1, full_name: 'A', plate_number: 5 },
      { expected_version: 1, full_name: 'A', plate_number: 'x'.repeat(33) },
      { expected_version: 1, full_name: 'A', plate_number: null, driver_type: 'PLATFORM' },
      { expected_version: 1, full_name: 'A', plate_number: null, status: 'ACTIVE' },
    ]) {
      expect(refused(() => parseProfileUpdate(bad))).toBe(true);
    }
  });

  it('the bank account needs a listed bank, a 6-20 digit number (spaces and dashes are dropped) and a holder', () => {
    const ok = parseBankUpdate({ expected_version: 2, bank_code: 'VCB', account_number: '0123 4567-89', account_holder: ' NGUYEN VAN A ' });
    expect(ok).toMatchObject({ expectedVersion: 2, accountNumber: '0123456789', accountHolder: 'NGUYEN VAN A' });
    expect(ok.bank.name).toBe('Vietcombank');
    for (const bad of [
      { expected_version: 2, bank_code: 'XXX', account_number: '0123456789', account_holder: 'A' },
      { expected_version: 2, bank_code: 'VCB', account_number: '12345', account_holder: 'A' },
      { expected_version: 2, bank_code: 'VCB', account_number: '1'.repeat(21), account_holder: 'A' },
      { expected_version: 2, bank_code: 'VCB', account_number: '12345a6789', account_holder: 'A' },
      { expected_version: 2, bank_code: 'VCB', account_number: '0123456789', account_holder: '' },
      { expected_version: 2, bank_code: 'VCB', account_number: '0123456789', account_holder: 'A', verification_state: 'VERIFIED' },
      { expected_version: 2, bank_code: 'VCB', account_number: '0123456789' },
    ]) {
      expect(refused(() => parseBankUpdate(bad))).toBe(true);
    }
  });

  it('submit / closure-cancel carry the version only; accepting carries a boolean; closure-request an optional short note', () => {
    expect(parseVersionOnly({ expected_version: 4 })).toEqual({ expectedVersion: 4 });
    expect(refused(() => parseVersionOnly({ expected_version: 4, status: 'ACTIVE' }))).toBe(true);
    expect(parseAccepting({ expected_version: 4, accepting: true })).toEqual({ expectedVersion: 4, accepting: true });
    expect(refused(() => parseAccepting({ expected_version: 4, accepting: 'true' }))).toBe(true);
    expect(parseClosureRequest({ expected_version: 4, note: ' Nghỉ ' })).toEqual({ expectedVersion: 4, note: 'Nghỉ' });
    expect(parseClosureRequest({ expected_version: 4, note: null }).note).toBeNull();
    expect(refused(() => parseClosureRequest({ expected_version: 4, note: 'x'.repeat(501) }))).toBe(true);
    expect(refused(() => parseClosureRequest({ expected_version: 4 }))).toBe(true);
  });
});
