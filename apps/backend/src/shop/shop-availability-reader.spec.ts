import { describe, expect, it, jest } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { evaluateAvailability, RawShopSnapshot, ShopAvailabilityReader, toShopSnapshot } from './shop-availability-reader';
import { OWNER_SNAPSHOT_SQL, PRODUCTION_CLOCK, SHOP_SNAPSHOT_SQL } from './shop-availability-sql';

const AT = '2026-10-05T03:00:00.000Z';

describe('evaluateAvailability: reason precedence (A08)', () => {
  it('ONLINE only when ACTIVE, area ACTIVE, has hours and inside one', () => {
    expect(evaluateAvailability('ACTIVE', 'ACTIVE', true, true, AT)).toEqual({ online: true, reason: 'ONLINE', evaluatedAt: AT });
  });

  it('DISABLED beats everything else', () => {
    expect(evaluateAvailability('DISABLED', 'INACTIVE', false, false, AT).reason).toBe('SHOP_DISABLED');
    expect(evaluateAvailability('DISABLED', null, true, true, AT).online).toBe(false);
  });

  it('INCOMPLETE beats area and hours', () => {
    expect(evaluateAvailability('INCOMPLETE', null, false, false, AT).reason).toBe('SHOP_INCOMPLETE');
  });

  it('inactive area beats hours', () => {
    expect(evaluateAvailability('ACTIVE', 'INACTIVE', true, true, AT).reason).toBe('SERVICE_AREA_INACTIVE');
  });

  it('no hours beats outside hours; outside hours otherwise', () => {
    expect(evaluateAvailability('ACTIVE', 'ACTIVE', false, false, AT).reason).toBe('NO_BUSINESS_HOURS');
    expect(evaluateAvailability('ACTIVE', 'ACTIVE', true, false, AT).reason).toBe('OUTSIDE_BUSINESS_HOURS');
  });

  it('an unknown status, area status or timestamp is a technical error, never ONLINE', () => {
    expect(() => evaluateAvailability('WEIRD', 'ACTIVE', true, true, AT)).toThrow(TechnicalError);
    expect(() => evaluateAvailability('ACTIVE', 'WEIRD', true, true, AT)).toThrow(TechnicalError);
    expect(() => evaluateAvailability('ACTIVE', null, true, true, AT)).toThrow(TechnicalError);
    expect(() => evaluateAvailability('ACTIVE', 'ACTIVE', true, true, 'yesterday')).toThrow(TechnicalError);
  });
});

function raw(patch: Partial<RawShopSnapshot> = {}): RawShopSnapshot {
  return {
    shop_id: '123e4567-e89b-42d3-a456-426614174000',
    name: 'Quán',
    contact_phone_normalized: '+84987654321',
    zalo: null,
    facebook: null,
    address_text: 'Addr',
    pickup_lat: 21,
    pickup_lng: 105,
    service_area_id: '223e4567-e89b-42d3-a456-426614174000',
    status: 'ACTIVE',
    version: '3',
    area_status: 'ACTIVE',
    evaluated_at: AT,
    hours: [{ weekday: 1, start_minute: 0, end_minute: 60, end_day_offset: 0 }],
    has_hours: true,
    in_hours: true,
    ...patch,
  };
}

describe('toShopSnapshot', () => {
  it('maps the row, parsing the version and the hours', () => {
    const snapshot = toShopSnapshot(raw());
    expect(snapshot.version).toBe(3);
    expect(snapshot.hours).toEqual([{ weekday: 1, startMinute: 0, endMinute: 60, endDayOffset: 0 }]);
    expect(snapshot.availability.online).toBe(true);
  });

  it('refuses a malformed row', () => {
    expect(() => toShopSnapshot(raw({ status: 'X' }))).toThrow(TechnicalError);
    expect(() => toShopSnapshot(raw({ hours: 'nope' }))).toThrow(TechnicalError);
    expect(() => toShopSnapshot(raw({ has_hours: 'yes' as unknown as boolean }))).toThrow(TechnicalError);
  });
});

describe('ShopAvailabilityReader', () => {
  function contextReturning(rows: unknown[]): { context: TransactionContext; query: ReturnType<typeof jest.fn> } {
    const query = jest.fn(async () => ({ rows }));
    return { context: { query } as unknown as TransactionContext, query };
  }

  it('reads an owner snapshot with exactly one statement', async () => {
    const { context, query } = contextReturning([raw()]);
    const snapshot = await new ShopAvailabilityReader().snapshotOfOwner(context, 'u');
    expect(snapshot?.availability.reason).toBe('ONLINE');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(OWNER_SNAPSHOT_SQL, ['u']);
  });

  it('returns undefined when the user owns no shop', async () => {
    const { context } = contextReturning([]);
    expect(await new ShopAvailabilityReader().snapshotOfOwner(context, 'u')).toBeUndefined();
  });

  it('availabilityOf uses one statement and throws SHOP_NOT_FOUND for no shop', async () => {
    const found = contextReturning([raw()]);
    expect((await new ShopAvailabilityReader().availabilityOf(found.context, 's')).online).toBe(true);
    expect(found.query).toHaveBeenCalledWith(SHOP_SNAPSHOT_SQL, ['s']);
    const missing = contextReturning([]);
    await expect(new ShopAvailabilityReader().availabilityOf(missing.context, 's')).rejects.toBeInstanceOf(AppError);
  });

  it('production statements sample the database clock once, materialized', () => {
    for (const sql of [OWNER_SNAPSHOT_SQL, SHOP_SNAPSHOT_SQL]) {
      expect(sql.split(PRODUCTION_CLOCK)).toHaveLength(2);
      expect(sql).toContain('MATERIALIZED');
      expect(sql).not.toContain('accepting_orders');
      expect(sql).not.toMatch(/\bnow\(\)/i);
    }
  });
});
