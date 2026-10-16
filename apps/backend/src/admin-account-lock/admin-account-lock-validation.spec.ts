import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { parseLockBody, parseTargetUserId } from './admin-account-lock-validation';

const ID = '11111111-1111-4111-8111-111111111111';
const refused = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ADMIN_INPUT_INVALID');
    return;
  }
  throw new Error('expected a refusal');
};

describe('parseLockBody', () => {
  it('accepts exactly {expected_version, reason} and trims the reason', () => {
    expect(parseLockBody({ expected_version: 3, reason: '  vi phạm  ' })).toEqual({ expectedVersion: 3, reason: 'vi phạm', lockReason: 'VIOLATION' });
    expect(parseLockBody({ expected_version: 1, reason: 'x'.repeat(500) }).reason).toHaveLength(500);
  });

  it('the lock command (and only it) may name the category of the lock: VIOLATION or SECURITY, never DELETE_REQUEST', () => {
    expect(parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'SECURITY' }, true)).toEqual({ expectedVersion: 3, reason: 'r', lockReason: 'SECURITY' });
    expect(parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'VIOLATION' }, true).lockReason).toBe('VIOLATION');
    refused(() => parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'DELETE_REQUEST' }, true));
    refused(() => parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'security' }, true));
    // unlock and delete take exactly two fields
    refused(() => parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'SECURITY' }));
    refused(() => parseLockBody({ expected_version: 3, reason: 'r', lock_reason: 'SECURITY', extra: 1 }, true));
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    expect(parseLockBody({ expected_version: 1, reason: '😀'.repeat(500) }).reason).toHaveLength(1000);
    refused(() => parseLockBody({ expected_version: 1, reason: '😀'.repeat(501) }));
  });

  it.each([
    ['empty reason', { expected_version: 1, reason: '' }],
    ['blank reason', { expected_version: 1, reason: '   ' }],
    ['501 chars', { expected_version: 1, reason: 'x'.repeat(501) }],
    ['reason not a string', { expected_version: 1, reason: 5 }],
    ['version 0', { expected_version: 0, reason: 'r' }],
    ['negative version', { expected_version: -1, reason: 'r' }],
    ['fractional version', { expected_version: 1.5, reason: 'r' }],
    ['unsafe version', { expected_version: 2 ** 53, reason: 'r' }],
    ['string version', { expected_version: '1', reason: 'r' }],
    ['missing version', { reason: 'r' }],
    ['missing reason', { expected_version: 1 }],
    ['extra status', { expected_version: 1, reason: 'r', status: 'DISABLED' }],
    ['extra roles', { expected_version: 1, reason: 'r', roles: [] }],
    ['extra actor', { expected_version: 1, reason: 'r', actor_user_id: ID }],
    ['array', [1, 'r']],
    ['null', null],
    ['string', 'x'],
  ])('refuses %s', (_name, body) => {
    refused(() => parseLockBody(body));
  });
});

describe('parseTargetUserId', () => {
  it('accepts a canonical UUID only', () => {
    expect(parseTargetUserId(ID)).toBe(ID);
    refused(() => parseTargetUserId('not-a-uuid'));
    refused(() => parseTargetUserId('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'));
    refused(() => parseTargetUserId(undefined));
  });
});
