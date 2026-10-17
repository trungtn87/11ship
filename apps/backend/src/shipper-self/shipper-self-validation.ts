import { BadRequestException } from '@nestjs/common';
import { exactObject } from '../auth/auth-validation';
import { normalizeFullName } from '../client-auth/client-auth-validation';
import { DRIVER_PLATE_NUMBER_MAX_LENGTH } from '../onboarding/onboarding-constants';
import { findBank, ShipperBank } from '../driver/shipper-banks';

// Strict parsers of the Shipper's own M03 commands. Every body is an exact object: no key may be added, so no status, type, review
// state, driver id or user id can arrive from a client. Failures never echo the offending key or value (a plain 400).

function reject(): never {
  throw new BadRequestException();
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return reject();
  }
  return value;
}

export interface ProfileUpdateInput {
  readonly expectedVersion: number;
  readonly fullName: string;
  readonly plateNumber: string | null;
}

/** PUT /v1/driver/me/profile: exact {expected_version, full_name, plate_number}. plate_number is a string or null. */
export function parseProfileUpdate(body: unknown): ProfileUpdateInput {
  const parsed = exactObject(body, ['expected_version', 'full_name', 'plate_number']);
  const plate = parsed.plate_number;
  let plateNumber: string | null = null;
  if (plate !== null) {
    if (typeof plate !== 'string') {
      return reject();
    }
    const trimmed = plate.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (trimmed !== '' && ([...trimmed].length > DRIVER_PLATE_NUMBER_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(trimmed))) {
      return reject();
    }
    plateNumber = trimmed === '' ? null : trimmed;
  }
  return { expectedVersion: version(parsed.expected_version), fullName: normalizeFullName(parsed.full_name), plateNumber };
}

export interface BankUpdateInput {
  readonly expectedVersion: number;
  readonly bank: ShipperBank;
  /** Digits only, 6..20. */
  readonly accountNumber: string;
  /** NFC, collapsed, trimmed (same normalization as a person's name). */
  readonly accountHolder: string;
}

/** PUT /v1/driver/me/bank: exact {expected_version, bank_code, account_number, account_holder}. */
export function parseBankUpdate(body: unknown): BankUpdateInput {
  const parsed = exactObject(body, ['expected_version', 'bank_code', 'account_number', 'account_holder']);
  const code = parsed.bank_code;
  const bank = typeof code === 'string' ? findBank(code) : undefined;
  const number = parsed.account_number;
  if (bank === undefined || typeof number !== 'string') {
    return reject();
  }
  const digits = number.replace(/[\s-]/gu, '');
  if (!/^[0-9]{6,20}$/u.test(digits)) {
    return reject();
  }
  return { expectedVersion: version(parsed.expected_version), bank, accountNumber: digits, accountHolder: normalizeFullName(parsed.account_holder) };
}

export interface VersionOnlyInput {
  readonly expectedVersion: number;
}

/** POST /v1/driver/me/submit and /closure-cancel: exact {expected_version}. */
export function parseVersionOnly(body: unknown): VersionOnlyInput {
  return { expectedVersion: version(exactObject(body, ['expected_version']).expected_version) };
}

export interface AcceptingInput {
  readonly expectedVersion: number;
  readonly accepting: boolean;
}

/** POST /v1/driver/me/accepting: exact {expected_version, accepting}. */
export function parseAccepting(body: unknown): AcceptingInput {
  const parsed = exactObject(body, ['expected_version', 'accepting']);
  if (typeof parsed.accepting !== 'boolean') {
    return reject();
  }
  return { expectedVersion: version(parsed.expected_version), accepting: parsed.accepting };
}

export interface ClosureRequestInput {
  readonly expectedVersion: number;
  readonly note: string | null;
}

/** POST /v1/driver/me/closure-request: exact {expected_version, note}. note is a string (<= 500 characters) or null. */
export function parseClosureRequest(body: unknown): ClosureRequestInput {
  const parsed = exactObject(body, ['expected_version', 'note']);
  const note = parsed.note;
  let value: string | null = null;
  if (note !== null) {
    if (typeof note !== 'string') {
      return reject();
    }
    const trimmed = note.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if ([...trimmed].length > 500 || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      return reject();
    }
    value = trimmed === '' ? null : trimmed;
  }
  return { expectedVersion: version(parsed.expected_version), note: value };
}
