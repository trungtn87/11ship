import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { encodeCursor, parseCancelTopupRequest, parseCreateTopupRequest, parseRequestIdParam, parseTopupListQuery } from './topup-request-validation';

const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

describe('M04-B2.1 top-up request validation', () => {
  it('create: exactly {amount_vnd}, a safe integer >= 1 (the minimum is a database parameter)', () => {
    expect(parseCreateTopupRequest({ amount_vnd: 100000 })).toEqual({ amountVnd: 100000 });
    expect(parseCreateTopupRequest({ amount_vnd: 1 })).toEqual({ amountVnd: 1 });
    for (const bad of [undefined, null, [], {}, { amount_vnd: 0 }, { amount_vnd: -5 }, { amount_vnd: 1.5 }, { amount_vnd: '1000' }, { amount_vnd: 9007199254740992 }, { amount_vnd: Number.NaN },
      { amount_vnd: 1000, driver_id: ID }, { amount_vnd: 1000, wallet_id: ID }, { amount_vnd: 1000, state: 'CONFIRMED' }, { amount: 1000 }]) {
      expect(() => parseCreateTopupRequest(bad)).toThrow(BadRequestException);
    }
  });

  it('cancel: exactly {expected_version}, a safe integer >= 1', () => {
    expect(parseCancelTopupRequest({ expected_version: 3 })).toEqual({ expectedVersion: 3 });
    for (const bad of [{}, { expected_version: 0 }, { expected_version: 1.2 }, { expected_version: '1' }, { expected_version: 1, state: 'CANCELLED' }, null]) {
      expect(() => parseCancelTopupRequest(bad)).toThrow(BadRequestException);
    }
  });

  it('a path id that is not a canonical UUID reads as not found, like an unknown one', () => {
    expect(parseRequestIdParam(ID)).toBe(ID);
    for (const bad of ['1', ID.toUpperCase(), `${ID} `, '../x', '']) {
      expect(() => parseRequestIdParam(bad)).toThrow(AppError);
    }
  });

  it('list: only status / limit / cursor, limit 1..50, a known status and a well-formed cursor', () => {
    expect(parseTopupListQuery(undefined)).toEqual({ state: undefined, limit: 20, after: undefined });
    expect(parseTopupListQuery({ status: 'PENDING', limit: '50' })).toEqual({ state: 'PENDING', limit: 50, after: undefined });
    expect(parseTopupListQuery({ cursor: encodeCursor(1_760_000_000_000, ID) }).after).toEqual({ createdAtMs: 1_760_000_000_000, requestId: ID });
    for (const bad of [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: ['1', '2'] }, { status: 'LOST' }, { status: 'pending' }, { driver_id: ID }, { cursor: 'not a cursor' },
      { cursor: Buffer.from('1.nope', 'utf8').toString('base64url') }, { cursor: Buffer.from(`x.${ID}`, 'utf8').toString('base64url') }, []]) {
      expect(() => parseTopupListQuery(bad)).toThrow(BadRequestException);
    }
  });
});
