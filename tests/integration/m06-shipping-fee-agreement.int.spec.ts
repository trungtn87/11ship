import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { AgreementAction } from '../../apps/backend/src/shipping-policy/shipping-fee-agreement';
import { AgreementOutcome, ShippingFeeAgreementService } from '../../apps/backend/src/shipping-policy/shipping-fee-agreement-service';
import { ShippingFeeAgreementRepository } from '../../apps/backend/src/shipping-policy/shipping-fee-agreement-repository';
import { ShippingFeePolicyReader, ShippingFeePolicyRepository } from '../../apps/backend/src/shipping-policy/shipping-fee-policy-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';

// M06 v1.1 fee agreement on a REAL PostgreSQL: the proposal / counter-offer / acceptance states, the customer's confirmation, the log, idempotent
// repeats, late answers, simultaneous answers, the locked fee and the rules the database keeps by itself. M07 does not exist yet: its calls are made
// here exactly as it will make them (inside one transaction, through the service).

const NOW = Date.now();
const EXPIRES = NOW + 15 * 60_000;
const TIERS = [{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }];

describe('M06 v1.1 — shipping fee agreement', () => {
  let pool: Pool;
  const phones: string[] = [];
  let shop = '';
  let customer = '';
  let admin = '';
  let driver1 = '';
  let driver2 = '';
  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
  const service = () => new ShippingFeeAgreementService(new ShippingFeeAgreementRepository(), new ShippingFeePolicyReader(new ShippingFeePolicyRepository()), new DriverRepository());
  const repo = new ShippingFeeAgreementRepository();
  const tx = <T>(fn: (context: Parameters<Parameters<ReturnType<typeof manager>['withTransaction']>[0]>[0]) => Promise<T>): Promise<T> => manager().withTransaction(fn);

  async function user(): Promise<string> {
    const phone = randomPhone();
    phones.push(phone.normalized);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [id, phone.normalized],
    );
    return id;
  }
  async function driverOf(userId: string): Promise<string> {
    return createDriverFor(pool, userId, { status: 'ACTIVE' });
  }

  /** The tables of this feature are immutable for every role; a test database is reset by switching their triggers off inside one transaction. */
  async function resetAll(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.shipping_fee_agreement_events DISABLE TRIGGER shipping_fee_agreement_events_append_only');
      await client.query('ALTER TABLE app.shipping_fee_agreements DISABLE TRIGGER shipping_fee_agreements_no_delete');
      await client.query('DELETE FROM app.shipping_fee_agreement_events');
      await client.query('DELETE FROM app.shipping_fee_agreements');
      await client.query('ALTER TABLE app.shipping_fee_agreement_events ENABLE TRIGGER shipping_fee_agreement_events_append_only');
      await client.query('ALTER TABLE app.shipping_fee_agreements ENABLE TRIGGER shipping_fee_agreements_no_delete');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions DISABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('DELETE FROM app.shipping_fee_policy_versions');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions ENABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function applyPolicy(): Promise<void> {
    await pool.query(
      `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at)
       VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
      [randomUUID(), JSON.stringify(TIERS), shop],
    );
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 8 });
    await resetAll();
    shop = await user();
    customer = await user();
    admin = await user();
    driver1 = await driverOf(await user());
    driver2 = await driverOf(await user());
    await applyPolicy();
  });

  afterAll(async () => {
    try {
      await resetAll();
      for (const phone of phones) {
        await purgePhone(pool, phone);
      }
    } finally {
      await pool.end();
    }
  });

  const base = (over: Partial<{ payer: 'CUSTOMER' | 'SHOP'; distanceM: number | null; expiresAtMs: number; requestId: string; deliveryId: string }> = {}) => ({
    deliveryId: randomUUID(),
    payer: 'SHOP' as const,
    distanceM: 5500 as number | null,
    createdBy: shop,
    expiresAtMs: EXPIRES,
    requestId: randomUUID(),
    nowMs: NOW,
    ...over,
  });
  const agreedInput = (over: Parameters<typeof base>[0] = {}, proposedFeeVnd = 25000) => ({ ...base(over), reasonCode: 'URGENT' as const, reasonNote: 'Khách cần gấp', proposedFeeVnd });
  const act = (agreementId: string, expectedVersion: number, action: AgreementAction, over: { nowMs?: number; requestId?: string; actorUserId?: string } = {}): Promise<AgreementOutcome> =>
    tx((context) => service().act(context, { agreementId, expectedVersion, requestId: over.requestId ?? randomUUID(), nowMs: over.nowMs ?? NOW + 1000, action, ...(over.actorUserId === undefined ? {} : { actorUserId: over.actorUserId }) }));
  const create = <T extends 'createStandard' | 'createAgreed'>(kind: T, input: Parameters<ShippingFeeAgreementService[T]>[1]): Promise<AgreementOutcome> => tx((context) => service()[kind](context, input as never));
  const ok = (outcome: AgreementOutcome) => {
    if (outcome.kind !== 'ok') {
      throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
    }
    return outcome.agreement;
  };
  const eventTypes = async (agreementId: string): Promise<string[]> => (await tx((context) => repo.events(context, agreementId))).map((e) => e.eventType);
  const expiresInDb = async (agreementId: string): Promise<number> => Number((await pool.query<{ ms: string }>("SELECT (extract(epoch FROM expires_at) * 1000)::bigint::text AS ms FROM app.shipping_fee_agreements WHERE agreement_id = $1::uuid", [agreementId])).rows[0]?.ms);

  it('STANDARD: the base fee of the three bands is the final fee; with no route, beyond the last band or without a table there is no agreement and no fee (never 0)', async () => {
    const standard = ok(await create('createStandard', base({ distanceM: 5500 })));
    expect(standard).toMatchObject({ feeMode: 'STANDARD', status: 'ACCEPTED', baseFeeVnd: 15000, basePolicyVersionNo: 1, finalFeeVnd: 15000, version: 1 });
    expect(await eventTypes(standard.agreementId)).toEqual(['STANDARD_CREATED']);
    expect(ok(await create('createStandard', base({ distanceM: 10000 }))).finalFeeVnd).toBe(20000); // the last bound is still band 3
    const rows = async (): Promise<number> => Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.shipping_fee_agreements')).rows[0]?.n);
    const before = await rows();
    expect(await create('createStandard', base({ distanceM: 10001 }))).toEqual({ kind: 'unpriced', reason: 'OUT_OF_PRICE_RANGE' });
    expect(await create('createStandard', base({ distanceM: null }))).toEqual({ kind: 'unpriced', reason: 'ROUTE_DATA_UNAVAILABLE' });
    expect(await rows()).toBe(before);
    await resetPolicyOnly();
    expect(await create('createStandard', base())).toEqual({ kind: 'unpriced', reason: 'POLICY_NOT_CONFIGURED' });
    await applyPolicy();
  });

  async function resetPolicyOnly(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions DISABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('DELETE FROM app.shipping_fee_policy_versions');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions ENABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  it('AGREED, shop pays: a Shipper agrees -> the proposed amount (above the base fee) is final and bound to that Shipper; the log names who and what', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    expect(proposed).toMatchObject({ feeMode: 'AGREED', status: 'PROPOSED', baseFeeVnd: 15000, proposedFeeVnd: 25000, finalFeeVnd: null, reasonCode: 'URGENT' });
    const accepted = ok(await act(proposed.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }));
    expect(accepted).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: driver1, version: 2 });
    expect(await eventTypes(proposed.agreementId)).toEqual(['PROPOSED', 'DRIVER_ACCEPTED']);
    const events = await tx((context) => repo.events(context, proposed.agreementId));
    expect(events[0]).toMatchObject({ actorType: 'SHOP', actorId: shop, amountVnd: 25000 });
    expect(events[1]).toMatchObject({ actorType: 'DRIVER', driverId: driver1, amountVnd: 25000, agreementVersion: 2 });
    // A lower-than-standard agreement is as valid as a higher one.
    const lower = ok(await create('createAgreed', agreedInput({}, 9000)));
    expect(ok(await act(lower.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver2 })).finalFeeVnd).toBe(9000);
  });

  it('counter-offer -> the shop REJECTS: the proposal stays, the deadline in the database is unchanged, and the search goes on with another Shipper', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    const deadline = await expiresInDb(proposed.agreementId);
    const countered = ok(await act(proposed.agreementId, 1, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 }));
    expect(countered).toMatchObject({ status: 'COUNTERED', counterFeeVnd: 30000, counterBy: driver1, proposedFeeVnd: 25000 });
    const rejected = ok(await act(proposed.agreementId, 2, { type: 'SHOP_REJECT_COUNTER' }, { actorUserId: shop }));
    expect(rejected).toMatchObject({ status: 'PROPOSED', counterFeeVnd: null, counterBy: null, proposedFeeVnd: 25000, finalFeeVnd: null });
    expect(await expiresInDb(proposed.agreementId)).toBe(deadline); // the search clock was not restarted
    // The rejected Shipper cannot offer the same amount again, but another Shipper can still agree to the ORIGINAL proposal.
    expect(await act(proposed.agreementId, 3, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 })).toEqual({ kind: 'refused', code: 'COUNTER_ALREADY_REJECTED' });
    const other = ok(await act(proposed.agreementId, 3, { type: 'DRIVER_ACCEPT', driverId: driver2 }));
    expect(other).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: driver2 });
    expect(await eventTypes(proposed.agreementId)).toEqual(['PROPOSED', 'COUNTERED', 'COUNTER_REJECTED', 'DRIVER_ACCEPTED']);
    const rejectedEvent = (await tx((context) => repo.events(context, proposed.agreementId))).find((e) => e.eventType === 'COUNTER_REJECTED');
    expect(rejectedEvent).toMatchObject({ actorType: 'SHOP', actorId: shop, driverId: driver1, amountVnd: 30000 });
  });

  it('the shop ACCEPTS a counter-offer (shop pays): it is final at the counter amount and bound to the Shipper who made it', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    ok(await act(proposed.agreementId, 1, { type: 'COUNTER', driverId: driver2, amountVnd: 18000 }));
    const accepted = ok(await act(proposed.agreementId, 2, { type: 'SHOP_ACCEPT_COUNTER' }, { actorUserId: shop }));
    expect(accepted).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 18000, boundDriverId: driver2, counterFeeVnd: null });
  });

  it('customer pays: a changed amount is NOT final until the customer confirms; a declined counter returns to the proposal; a declined proposal ends it', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'CUSTOMER' }, 25000)));
    const waiting = ok(await act(proposed.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }));
    expect(waiting).toMatchObject({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: 25000, finalFeeVnd: null, boundDriverId: driver1 });
    expect(await act(proposed.agreementId, 2, { type: 'CUSTOMER_CONFIRM', approve: true })).toEqual({ kind: 'refused', code: 'ACTOR_REQUIRED' });
    const confirmed = ok(await act(proposed.agreementId, 2, { type: 'CUSTOMER_CONFIRM', approve: true }, { actorUserId: customer }));
    expect(confirmed).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 25000, pendingFeeVnd: null });
    expect((await tx((context) => repo.events(context, proposed.agreementId))).at(-1)).toMatchObject({ eventType: 'CUSTOMER_CONFIRMED', actorType: 'CUSTOMER', actorId: customer });

    // A counter the shop accepts still needs the customer; if the customer declines, the request is back at the proposal and the Shipper is released.
    const second = ok(await create('createAgreed', agreedInput({ payer: 'CUSTOMER' }, 25000)));
    ok(await act(second.agreementId, 1, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 }));
    const afterShop = ok(await act(second.agreementId, 2, { type: 'SHOP_ACCEPT_COUNTER' }, { actorUserId: shop }));
    expect(afterShop).toMatchObject({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: 30000, pendingSource: 'COUNTER', finalFeeVnd: null });
    const declined = ok(await act(second.agreementId, 3, { type: 'CUSTOMER_CONFIRM', approve: false }, { actorUserId: customer }));
    expect(declined).toMatchObject({ status: 'PROPOSED', boundDriverId: null, pendingFeeVnd: null, finalFeeVnd: null, proposedFeeVnd: 25000 });

    // The customer refusing the shop's own proposal ends the agreement.
    const third = ok(await create('createAgreed', agreedInput({ payer: 'CUSTOMER' }, 25000)));
    ok(await act(third.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }));
    expect(ok(await act(third.agreementId, 2, { type: 'CUSTOMER_CONFIRM', approve: false }, { actorUserId: customer })).status).toBe('DECLINED');

    // A proposal equal to the base fee changes nothing for the customer: no confirmation needed.
    const same = ok(await create('createAgreed', agreedInput({ payer: 'CUSTOMER' }, 15000)));
    expect(ok(await act(same.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 })).status).toBe('ACCEPTED');
  });

  it('outside the price table (no base fee) an agreement still works, and a customer who pays must always confirm', async () => {
    const outside = ok(await create('createAgreed', { ...agreedInput({ payer: 'CUSTOMER', distanceM: 12_000 }, 40000), reasonCode: 'OUT_OF_PRICE_RANGE' as const }));
    expect(outside).toMatchObject({ baseFeeVnd: null, basePolicyVersionNo: null, reasonCode: 'OUT_OF_PRICE_RANGE' });
    expect(ok(await act(outside.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 })).status).toBe('AWAITING_CUSTOMER');
    const noRoute = ok(await create('createAgreed', agreedInput({ payer: 'SHOP', distanceM: null }, 40000)));
    expect(noRoute.baseFeeVnd).toBeNull(); // a routing failure never becomes a price, and never switches the mode by itself
  });

  it('a repeated request is applied once: same request id -> replayed, nothing new in the log; a stale version -> conflict; one agreement per delivery', async () => {
    const input = agreedInput({ payer: 'SHOP' }, 25000);
    const first = ok(await create('createAgreed', input));
    expect(await create('createAgreed', input)).toMatchObject({ kind: 'replayed' });
    expect(await create('createAgreed', { ...input, requestId: randomUUID() })).toEqual({ kind: 'refused', code: 'DELIVERY_ALREADY_HAS_AGREEMENT' });
    const requestId = randomUUID();
    ok(await act(first.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }, { requestId }));
    const again = await act(first.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }, { requestId });
    expect(again).toMatchObject({ kind: 'replayed', agreement: { status: 'ACCEPTED', version: 2 } });
    expect(await eventTypes(first.agreementId)).toEqual(['PROPOSED', 'DRIVER_ACCEPTED']);
    expect(await act(first.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver2 })).toMatchObject({ kind: 'conflict', agreement: { boundDriverId: driver1 } });
    expect(await act(randomUUID(), 1, { type: 'LOCK' })).toEqual({ kind: 'refused', code: 'NOT_FOUND' });
    expect(await act(first.agreementId, 2, { type: 'DRIVER_ACCEPT', driverId: randomUUID() })).toEqual({ kind: 'refused', code: 'DRIVER_NOT_FOUND' });
  });

  it('a late answer on an expired offer is refused and the offer is recorded as EXPIRED; nothing else is applied afterwards', async () => {
    const short = ok(await create('createAgreed', agreedInput({ payer: 'SHOP', expiresAtMs: NOW + 60_000 }, 25000)));
    ok(await act(short.agreementId, 1, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 }, { nowMs: NOW + 30_000 }));
    const late = await act(short.agreementId, 2, { type: 'SHOP_ACCEPT_COUNTER' }, { nowMs: NOW + 60_000, actorUserId: shop }); // the deadline instant is already late
    expect(late).toMatchObject({ kind: 'expired', agreement: { status: 'EXPIRED', finalFeeVnd: null } });
    expect(await eventTypes(short.agreementId)).toEqual(['PROPOSED', 'COUNTERED', 'EXPIRED']);
    expect(await act(short.agreementId, 3, { type: 'DRIVER_ACCEPT', driverId: driver2 })).toEqual({ kind: 'refused', code: 'INVALID_STATE' });
    expect(await tx((context) => service().read(context, short.agreementId))).toMatchObject({ status: 'EXPIRED', counterFeeVnd: null, proposedFeeVnd: 25000 });
  });

  it('simultaneous answers: two Shippers agree at once -> exactly one wins; the same request sent twice at once is applied once', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    const results = await Promise.all([act(proposed.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }), act(proposed.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver2 })]);
    expect(results.map((r) => r.kind).sort()).toEqual(['conflict', 'ok']);
    const winner = results.find((r) => r.kind === 'ok') as Extract<AgreementOutcome, { kind: 'ok' }>;
    expect(winner.agreement.status).toBe('ACCEPTED');
    expect((await tx((context) => service().read(context, proposed.agreementId)))?.boundDriverId).toBe(winner.agreement.boundDriverId);
    expect(await eventTypes(proposed.agreementId)).toEqual(['PROPOSED', 'DRIVER_ACCEPTED']);

    const twin = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    const requestId = randomUUID();
    const pair = await Promise.all([act(twin.agreementId, 1, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 }, { requestId }), act(twin.agreementId, 1, { type: 'COUNTER', driverId: driver1, amountVnd: 30000 }, { requestId })]);
    expect(pair.map((r) => r.kind).sort()).toEqual(['ok', 'replayed']);
    expect(await eventTypes(twin.agreementId)).toEqual(['PROPOSED', 'COUNTERED']);

    // Two creates for one delivery at once: one agreement.
    const deliveryId = randomUUID();
    const creates = await Promise.all([create('createAgreed', agreedInput({ deliveryId }, 25000)), create('createAgreed', agreedInput({ deliveryId }, 26000))]);
    expect(creates.map((r) => r.kind).sort()).toEqual(['ok', 'refused']);
    expect(Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]?.n)).toBe(1);
  });

  it('after picked_up the fee is locked: only a logged Admin adjustment with a reason changes it', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    ok(await act(proposed.agreementId, 1, { type: 'DRIVER_ACCEPT', driverId: driver1 }));
    const locked = ok(await act(proposed.agreementId, 2, { type: 'LOCK' }));
    expect(locked).toMatchObject({ status: 'LOCKED', finalFeeVnd: 25000 });
    expect(locked.lockedAtMs).not.toBeNull();
    expect(await act(proposed.agreementId, 3, { type: 'COUNTER', driverId: driver2, amountVnd: 1000 })).toEqual({ kind: 'refused', code: 'INVALID_STATE' });
    expect(await act(proposed.agreementId, 3, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: '  ' }, { actorUserId: admin })).toEqual({ kind: 'refused', code: 'REASON_REQUIRED' });
    expect(await act(proposed.agreementId, 3, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: 'Khách đổi điểm giao' })).toEqual({ kind: 'refused', code: 'ACTOR_REQUIRED' });
    const adjusted = ok(await act(proposed.agreementId, 3, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: 'Khách đổi điểm giao' }, { actorUserId: admin }));
    expect(adjusted).toMatchObject({ status: 'LOCKED', finalFeeVnd: 20000 });
    expect((await tx((context) => repo.events(context, proposed.agreementId))).at(-1)).toMatchObject({ eventType: 'ADMIN_ADJUSTED', actorType: 'ADMIN', actorId: admin, amountVnd: 20000, reason: 'Khách đổi điểm giao' });
  });

  it('the database keeps its own rules: identity and the proposal never change, the deadline never shortens, the version moves by one, no delete, the log is append-only, bad shapes are refused', async () => {
    const proposed = ok(await create('createAgreed', agreedInput({ payer: 'SHOP' }, 25000)));
    const id = proposed.agreementId;
    const code = async (sql: string, values: unknown[] = []): Promise<string | undefined> => {
      try {
        await pool.query(sql, values);
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(await code('UPDATE app.shipping_fee_agreements SET proposed_fee_vnd = 1, version = version + 1 WHERE agreement_id = $1::uuid', [id])).toBe('23001');
    expect(await code("UPDATE app.shipping_fee_agreements SET payer = 'CUSTOMER', version = version + 1 WHERE agreement_id = $1::uuid", [id])).toBe('23001');
    expect(await code("UPDATE app.shipping_fee_agreements SET expires_at = expires_at - interval '1 second', version = version + 1 WHERE agreement_id = $1::uuid", [id])).toBe('23001');
    expect(await code('UPDATE app.shipping_fee_agreements SET reason_note = $2, version = version + 2 WHERE agreement_id = $1::uuid', [id, 'x'])).toBe('23001');
    expect(await code("UPDATE app.shipping_fee_agreements SET status = 'LOCKED', locked_at = now(), final_fee_vnd = 1, bound_driver_id = $2::uuid, version = version + 1 WHERE agreement_id = $1::uuid", [id, driver1])).toBe('23001'); // PROPOSED -> LOCKED is off the graph
    expect(await code('DELETE FROM app.shipping_fee_agreements WHERE agreement_id = $1::uuid', [id])).toBe('23001');
    expect(['0A000', '23001']).toContain(await code('TRUNCATE app.shipping_fee_agreements')); // referenced by the event log's foreign key, or refused by the trigger
    expect(await code('TRUNCATE app.shipping_fee_agreement_events')).toBe('23001');
    expect(await code('UPDATE app.shipping_fee_agreement_events SET amount_vnd = 1')).toBe('23001');
    expect(await code('DELETE FROM app.shipping_fee_agreement_events')).toBe('23001');
    // Shapes: AGREED without a reason or a proposal; STANDARD with a proposal; final fee on an open offer; an amount above the limit; a negative one.
    const insert = (cols: string, vals: string): Promise<string | undefined> =>
      code(`INSERT INTO app.shipping_fee_agreements (agreement_id, delivery_id, expires_at, created_by, created_at, updated_at, ${cols}) VALUES ($1::uuid, $2::uuid, now() + interval '5 minutes', $3::uuid, now(), now(), ${vals})`, [randomUUID(), randomUUID(), shop]);
    expect(await insert('fee_mode, payer, status, proposed_fee_vnd', "'AGREED', 'SHOP', 'PROPOSED', 1000")).toBe('23514'); // no reason
    expect(await insert('fee_mode, payer, status, reason_code', "'AGREED', 'SHOP', 'PROPOSED', 'URGENT'")).toBe('23514'); // no proposal
    expect(await insert('fee_mode, payer, status, reason_code, proposed_fee_vnd, final_fee_vnd', "'AGREED', 'SHOP', 'PROPOSED', 'URGENT', 1000, 1000")).toBe('23514'); // final while open
    expect(await insert('fee_mode, payer, status, reason_code, proposed_fee_vnd', "'AGREED', 'SHOP', 'PROPOSED', 'URGENT', 10000001")).toBe('23514');
    expect(await insert('fee_mode, payer, status, reason_code, proposed_fee_vnd', "'AGREED', 'SHOP', 'PROPOSED', 'URGENT', -1")).toBe('23514');
    expect(await insert('fee_mode, payer, status, base_fee_vnd, base_policy_version_no, proposed_fee_vnd, final_fee_vnd', "'STANDARD', 'SHOP', 'ACCEPTED', 1000, 1, 1000, 1000")).toBe('23514');
    expect(await insert('fee_mode, payer, status, reason_code, proposed_fee_vnd', "'AGREED', 'SHOP', 'AWAITING_CUSTOMER', 'URGENT', 1000")).toBe('23514'); // awaiting without a pending amount
  });
});
