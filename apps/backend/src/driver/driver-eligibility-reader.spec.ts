import { describe, expect, it } from '@jest/globals';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverEligibilityReader } from './driver-eligibility-reader';
import { DRIVER_STATUSES, DriverStatus } from './driver-types';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';

function contextReturning(rows: Array<Record<string, unknown>>, seen: Array<{ text: string; values: readonly unknown[] }> = []): TransactionContext {
  return {
    isActive: true,
    query: async (text: string, values: readonly unknown[] = []) => {
      seen.push({ text, values });
      return { rows: rows as never[], rowCount: rows.length };
    },
  };
}

describe('DriverEligibilityReader.ownerDriverEligibility', () => {
  const reader = new DriverEligibilityReader();

  it('no profile: NOT_STARTED and not selectable', async () => {
    expect(await reader.ownerDriverEligibility(contextReturning([]), USER_ID)).toEqual({
      onboarding: 'NOT_STARTED',
      selectable: false,
    });
  });

  it('maps every status of the table: PENDING is PENDING_APPROVAL; only CLOSED is not selectable', async () => {
    const expected: Record<DriverStatus, [string, boolean]> = {
      PENDING: ['PENDING_APPROVAL', true],
      ACTIVE: ['ACTIVE', true],
      SUSPENDED: ['SUSPENDED', true],
      CLOSING: ['CLOSING', true],
      CLOSED: ['CLOSED', false],
    };
    expect(Object.keys(expected).sort()).toEqual([...DRIVER_STATUSES].sort());
    for (const status of DRIVER_STATUSES) {
      const result = await reader.ownerDriverEligibility(contextReturning([{ status }]), USER_ID);
      expect([status, result.onboarding, result.selectable]).toEqual([status, expected[status][0], expected[status][1]]);
    }
  });

  it('reads ONE parameterized statement for the given user and takes no lock', async () => {
    const seen: Array<{ text: string; values: readonly unknown[] }> = [];
    await reader.ownerDriverEligibility(contextReturning([], seen), USER_ID);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.values).toEqual([USER_ID]);
    expect(seen[0]?.text).toMatch(/FROM app\.drivers\s+WHERE user_id = \$1::uuid/);
    expect(seen[0]?.text).not.toMatch(/FOR (UPDATE|SHARE)|\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('answers only what Auth needs: no driver id, name, plate, type or flag leaves the port', async () => {
    const result = await reader.ownerDriverEligibility(
      contextReturning([{ status: 'PENDING', driver_id: 'x', full_name: 'Secret Name', plate_number: 'SECRET-PLATE' }]),
      USER_ID,
    );
    expect(Object.keys(result).sort()).toEqual(['onboarding', 'selectable']);
    expect(JSON.stringify(result)).not.toMatch(/Secret|SECRET/);
  });
});
