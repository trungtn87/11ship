import { describe, expect, it } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverActiveGuard } from './driver-active-guard';
import { DRIVER_STATUSES } from './driver-types';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const DRIVER_ID = '623e4567-e89b-42d3-a456-426614174000';

function contextReturning(rows: Array<Record<string, unknown>>, seen: Array<{ text: string; values: readonly unknown[] }> = []): TransactionContext {
  return {
    isActive: true,
    query: async (text: string, values: readonly unknown[] = []) => {
      seen.push({ text, values });
      return { rows: rows as never[], rowCount: rows.length };
    },
  };
}

async function outcome(context: TransactionContext): Promise<string> {
  try {
    const active = await new DriverActiveGuard().requireDriverActive(context, USER_ID);
    return `OK:${active.driverId}`;
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
}

describe('DriverActiveGuard.requireDriverActive (A03-30)', () => {
  it('ACTIVE passes and names the driver', async () => {
    expect(await outcome(contextReturning([{ driver_id: DRIVER_ID, status: 'ACTIVE' }]))).toBe(`OK:${DRIVER_ID}`);
  });

  it('PENDING is DRIVER_PENDING_APPROVAL', async () => {
    expect(await outcome(contextReturning([{ driver_id: DRIVER_ID, status: 'PENDING' }]))).toBe('DRIVER_PENDING_APPROVAL');
  });

  it('SUSPENDED, CLOSING, CLOSED and a missing profile are all refused, with the existing registry code only', async () => {
    for (const status of ['SUSPENDED', 'CLOSING', 'CLOSED']) {
      expect([status, await outcome(contextReturning([{ driver_id: DRIVER_ID, status }]))]).toEqual([status, 'ROLE_NOT_AVAILABLE']);
    }
    expect(await outcome(contextReturning([]))).toBe('ROLE_NOT_AVAILABLE');
  });

  it('fails closed: ACTIVE is the only status that passes', async () => {
    for (const status of DRIVER_STATUSES) {
      const result = await outcome(contextReturning([{ driver_id: DRIVER_ID, status }]));
      expect([status, result.startsWith('OK:')]).toEqual([status, status === 'ACTIVE']);
    }
  });

  it('decides from the database through the caller context: ONE parameterized read of the user, no lock, no write', async () => {
    const seen: Array<{ text: string; values: readonly unknown[] }> = [];
    await outcome(contextReturning([{ driver_id: DRIVER_ID, status: 'ACTIVE' }], seen));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.values).toEqual([USER_ID]);
    expect(seen[0]?.text).toMatch(/FROM app\.drivers\s+WHERE user_id = \$1::uuid/);
    expect(seen[0]?.text).not.toMatch(/FOR (UPDATE|SHARE)|\b(INSERT|UPDATE|DELETE)\b/);
  });

  // F1. The assertion is on the PROMISE the guard returns: it must reject. (Reading `.driverId` after the call
  // would turn a wrongly resolved `undefined` into a TypeError that merely looks like a denial.)
  it('a status the guard does not know makes the guard promise itself reject with a safe internal error, never resolve', async () => {
    for (const status of ['REJECTED', 'PENDING_BALANCE_RESOLUTION', 'active', '', 'ARCHIVED']) {
      const pending = new DriverActiveGuard().requireDriverActive(contextReturning([{ driver_id: DRIVER_ID, status }]), USER_ID);
      await expect(pending).rejects.toBeInstanceOf(TechnicalError);
      const failure = await pending.catch((error: unknown) => error);
      expect([status, (failure as TechnicalError).kind]).toEqual([status, 'internal']);
      // Not an application error a client could see, and nothing from the row in its message.
      expect(failure).not.toBeInstanceOf(AppError);
      expect((failure as Error).message).not.toContain(DRIVER_ID);
    }
  });

  it('a row with no status at all also rejects instead of resolving', async () => {
    const pending = new DriverActiveGuard().requireDriverActive(contextReturning([{ driver_id: DRIVER_ID }]), USER_ID);
    await expect(pending).rejects.toBeInstanceOf(TechnicalError);
  });
});
