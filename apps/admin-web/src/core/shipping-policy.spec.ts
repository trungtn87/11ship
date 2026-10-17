import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { createShippingPolicySource, parseConditions, parseState, ShippingPolicyApi } from './shipping-policy-api';
import { CONDITION_BOUNDS, describeChanges, EditingModel, formatFee, formatKm, formatMinutes, parseBounded, parseFee, parseKm, parseMinutes, PolicyTable, toEditing, validateEditing } from './shipping-policy';
import { canOpenRoute, visibleMenu } from './menu';
import { formatRoute, parseRoute } from './routes';

const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
function scripted(...answers: TransportResponse[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  const transport: Transport = (request) => {
    requests.push(request);
    const next = queue.shift();
    return next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
  };
  return { transport, requests };
}
const session = (csrf: string | null = 'csrf-1') => ({ csrf: () => csrf ?? undefined, refresh: () => Promise.resolve(true) });

const TABLE: PolicyTable = {
  tiers: [
    { fromM: 0, toM: 3000, feeVnd: 10000 },
    { fromM: 3000, toM: 6000, feeVnd: 15000 },
    { fromM: 6000, toM: 10000, feeVnd: 20000 },
  ],
};
const wire = { tiers: [{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }] };
const version = { version_no: 2, legacy: false, ...wire, tail: null, note: null, applied_by: '11111111-1111-4111-8111-111111111111', applied_at: '2026-10-17T03:00:00.000Z' };
const legacyVersion = {
  version_no: 1,
  legacy: true,
  tiers: [{ from_m: 0, to_m: 2000, fee_vnd: 10000 }, { from_m: 2000, to_m: 4000, fee_vnd: 12000 }, { from_m: 4000, to_m: 7000, fee_vnd: 15000 }, { from_m: 7000, to_m: 10000, fee_vnd: 20000 }],
  tail: { base_fee_vnd: 20000, step_m: 1000, step_fee_vnd: 3000 },
  note: null,
  applied_by: '11111111-1111-4111-8111-111111111111',
  applied_at: '2026-10-16T03:00:00.000Z',
};
const state = { active: version, draft: { version: 3, tiers: null, updated_by: null, updated_at: '2026-10-17T03:00:00.000Z' }, history: [version, legacyVersion] };

describe('M06-A admin web - typing', () => {
  it('reads km with at most three decimals into whole metres, never rounding', () => {
    expect(parseKm('0')).toBe(0);
    expect(parseKm('3')).toBe(3000);
    expect(parseKm('5.5')).toBe(5500);
    expect(parseKm('5,5')).toBe(5500);
    expect(parseKm('0.125')).toBe(125);
    expect(parseKm('1.9999')).toBeUndefined(); // a fourth decimal would need rounding: refused
    for (const bad of ['', '-1', '1e3', 'abc', '1.', '.5', '10000']) {
      expect(parseKm(bad)).toBeUndefined();
    }
    expect(formatKm(3000)).toBe('3');
    expect(formatKm(5500)).toBe('5.5');
    expect(formatKm(125)).toBe('0.125');
  });

  it('reads fees as whole non-negative VND within the limit', () => {
    expect(parseFee('10000')).toBe(10000);
    expect(parseFee('10.000')).toBe(10000);
    expect(parseFee('0')).toBe(0);
    for (const bad of ['', '-1', '1.5e3', '12,5', 'x', '10000001']) {
      expect(parseFee(bad)).toBeUndefined();
    }
    expect(formatFee(15000)).toBe('15.000đ');
  });
});

describe('M06-A admin web - validateEditing (three fixed bands, same rules as the server)', () => {
  const model = (bounds: [string, string, string], fees: [string, string, string] = ['10000', '15000', '20000']): EditingModel => ({ bounds, fees });

  it('accepts three increasing bounds and returns three continuous bands in metres', () => {
    expect(validateEditing(model(['3', '6', '10'])).table).toEqual(TABLE);
    expect(validateEditing(toEditing(TABLE)).table).toEqual(TABLE);
    expect(validateEditing(model(['3', '6', '14'])).table?.tiers[2]).toEqual({ fromM: 6000, toM: 14000, feeVnd: 20000 }); // about 10 km is not a hard limit
  });

  it('always has exactly three bands (the model cannot hold a fourth) and starts empty when nothing is applied', () => {
    expect(toEditing(null).bounds).toHaveLength(3);
    expect(toEditing(null).fees).toHaveLength(3);
    expect(toEditing({ tiers: TABLE.tiers.slice(0, 2) }).bounds).toEqual(['', '', '']); // not a v1.1 table: not shown as one
    expect(validateEditing(toEditing(null)).table).toBeUndefined();
  });

  it('names a bound that is not above the previous one (0 < b1 < b2 < b3), a bad number or a bad fee', () => {
    expect(validateEditing(model(['0', '6', '10'])).problems.bounds[0]).toContain('lớn hơn 0');
    expect(validateEditing(model(['3', '3', '10'])).problems.bounds[1]).toContain('lớn hơn mốc');
    expect(validateEditing(model(['3', '6', '5'])).problems.bounds[2]).toContain('lớn hơn mốc');
    expect(validateEditing(model(['x', '6', '10'])).problems.bounds[0]).toContain('Nhập số km');
    expect(validateEditing(model(['3', '6', '10'], ['-5', '15000', '20000'])).problems.fees[0]).toBeDefined();
    expect(validateEditing(model(['3', '6', '10'], ['10000', '', '20000'])).problems.fees[1]).toBeDefined();
    for (const bad of [model(['0', '6', '10']), model(['3', '3', '10']), model(['3', '6', '10'], ['10000', '15000', '10000001']), model(['3', '6', '1.2345'])]) {
      expect(validateEditing(bad).table).toBeUndefined();
    }
  });

  it('describes what changed between two versions; an old-format version is not compared line by line', () => {
    expect(describeChanges(null, TABLE)).toEqual(['Bảng giá đầu tiên.']);
    expect(describeChanges(TABLE, TABLE)).toEqual(['Không đổi nội dung.']);
    const changed: PolicyTable = { tiers: [{ fromM: 0, toM: 2500, feeVnd: 9000 }, TABLE.tiers[1] as never, TABLE.tiers[2] as never] };
    const lines = describeChanges(TABLE, changed).join('|');
    expect(lines).toContain('Khung 1');
    expect(lines).not.toContain('Khung 2');
    expect(describeChanges({ tiers: [] }, TABLE, true)[0]).toContain('định dạng cũ');
  });
});

describe('M06-A admin web - api', () => {
  it('parses the state strictly: a current version has exactly three bands and no tail; an old one may differ and is marked legacy', () => {
    const parsed = parseState(state);
    expect(parsed?.active).toMatchObject({ versionNo: 2, legacy: false, tail: null });
    expect(parsed?.history[1]).toMatchObject({ versionNo: 1, legacy: true, tail: { baseFeeVnd: 20000, stepM: 1000, stepFeeVnd: 3000 } });
    expect(parsed?.history[1]?.tiers).toHaveLength(4);
    expect(parseState({ ...state, active: null, history: [] })?.active).toBeNull();
    expect(parseState({ ...state, draft: { ...state.draft, tiers: wire.tiers } })?.draft.table).toEqual(TABLE);
    for (const bad of [
      { ...state, history: 'x' },
      { ...state, active: { ...version, version_no: 0 } },
      { ...state, active: { ...version, legacy: false, tiers: wire.tiers.slice(0, 2) } }, // a current version with two bands
      { ...state, active: { ...version, tail: { base_fee_vnd: 1, step_m: 1, step_fee_vnd: 1 } } }, // a current version with a tail
      { ...state, active: { ...version, tiers: [{ from_m: 0.5, to_m: 1, fee_vnd: 1 }, ...wire.tiers.slice(1)] } },
      { ...state, draft: { ...state.draft, tiers: wire.tiers.slice(0, 2) } },
    ]) {
      expect(parseState(bad)).toBeUndefined();
    }
  });

  it('reads, saves a draft with the draft version and key (three bands, no tail), applies with a note, and maps refusals', async () => {
    const s = scripted(reply(200, { data: state }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(s.transport), session()).read()).toMatchObject({ kind: 'ready' });
    expect(s.requests[0]).toMatchObject({ method: 'GET', path: '/admin/shipping-fee-policy' });

    const saved = scripted(reply(200, { data: { active: null, draft: state.draft } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(saved.transport), session()).saveDraft({ version: 3, table: TABLE, key: 'k1' })).toEqual({ kind: 'ok' });
    expect(saved.requests[0]).toMatchObject({ method: 'POST', path: '/admin/shipping-fee-policy/draft', csrf: 'csrf-1', idempotencyKey: 'k1', body: { expected_version: 3, ...wire } });
    expect(JSON.stringify(saved.requests[0]?.body)).not.toContain('tail');

    const applied = scripted(reply(200, { data: { active: version, draft: state.draft } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(applied.transport), session()).apply({ version: 4, note: 'ghi chú', key: 'k2' })).toEqual({ kind: 'ok' });
    expect(applied.requests[0]).toMatchObject({ path: '/admin/shipping-fee-policy/apply', body: { expected_version: 4, note: 'ghi chú' } });

    const cases: Array<[number, string, unknown]> = [
      [409, 'SHIPPING_DRAFT_VERSION_CONFLICT', { kind: 'conflict' }],
      [403, 'ADMIN_FORBIDDEN', { kind: 'forbidden' }],
      [401, 'ADMIN_SESSION_INVALID', { kind: 'session-expired' }],
      [400, 'SHIPPING_POLICY_INVALID', { kind: 'refused', code: 'SHIPPING_POLICY_INVALID' }],
      [409, 'SHIPPING_POLICY_UNCHANGED', { kind: 'refused', code: 'SHIPPING_POLICY_UNCHANGED' }],
      [503, 'TRANSACTION_OUTCOME_UNKNOWN', { kind: 'unknown' }],
    ];
    for (const [status, code, expected] of cases) {
      const answer = scripted(reply(status, errorBody(code)));
      expect(await createShippingPolicySource(new ShippingPolicyApi(answer.transport), session()).apply({ version: 1, note: null, key: 'k' })).toEqual(expected);
    }
    const lost = scripted();
    expect(await createShippingPolicySource(new ShippingPolicyApi(lost.transport), session()).saveDraft({ version: 1, table: TABLE, key: 'k' })).toEqual({ kind: 'unknown' });
  });

  it('sends nothing without a session token or an unwired session, and never prices from a failed preview; beyond the last band is "unpriced", not 0', async () => {
    const none = scripted();
    expect(await createShippingPolicySource(new ShippingPolicyApi(none.transport), session(null)).saveDraft({ version: 1, table: TABLE, key: 'k' })).toEqual({ kind: 'session-expired' });
    expect(await createShippingPolicySource(new ShippingPolicyApi(none.transport)).apply({ version: 1, note: null, key: 'k' })).toEqual({ kind: 'not-wired' });
    expect(none.requests).toHaveLength(0);

    const priced = scripted(reply(200, { data: { status: 'PRICED', fee_vnd: 15000, distance_m: 5500, based_on: 'EDITING', policy_version_no: null, band: 1 } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(priced.transport), session()).preview(5500, TABLE)).toEqual({ kind: 'priced', feeVnd: 15000, band: 1, basedOn: 'EDITING' });
    expect(priced.requests[0]).toMatchObject({ path: '/admin/shipping-fee-policy/preview', body: { distance_m: 5500, ...wire } });
    const outside = scripted(reply(200, { data: { status: 'UNPRICED', fee_vnd: null, distance_m: 12000, based_on: 'ACTIVE', reason: 'OUT_OF_PRICE_RANGE' } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(outside.transport), session()).preview(12000, null)).toEqual({ kind: 'unpriced', reason: 'OUT_OF_PRICE_RANGE' });
    const broken = scripted(reply(200, { data: { status: 'PRICED', fee_vnd: 0 } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(broken.transport), session()).preview(1, null)).toEqual({ kind: 'failed' });
  });
});

describe('M06-A admin web - route and menu', () => {
  it('has a route, a menu entry visible to SYSTEM and ADMIN (the server decides who writes)', () => {
    expect(parseRoute('/system/shipping-fee-policy')).toEqual({ name: 'shipping-policy' });
    expect(formatRoute({ name: 'shipping-policy' })).toBe('/system/shipping-fee-policy');
    expect(canOpenRoute('ADMIN', new Set() as never, { name: 'shipping-policy' })).toBe(true);
    expect(canOpenRoute('SYSTEM', new Set() as never, { name: 'shipping-policy' })).toBe(true);
    const labels = (role: 'SYSTEM' | 'ADMIN'): string[] => visibleMenu(role, new Set() as never).flatMap((group) => group.items.map((item) => item.id));
    expect(labels('SYSTEM')).toContain('shipping-policy');
    expect(labels('ADMIN')).toContain('shipping-policy');
  });
});

const conditions = {
  version: 2,
  external_max_deliveries: 3,
  batch_max_delay_seconds: 300,
  pickup_service_seconds: 120,
  handoff_service_seconds: 60,
  updated_by: null,
  updated_at: '2026-10-17T03:00:00.000Z',
  fixed: { search_radius_m: 3000, platform_unlimited: true },
  history: [],
};

describe('M06-B/C admin web - conditions', () => {
  it('reads minutes and bounded whole numbers, nothing else', () => {
    expect(parseMinutes('5')).toBe(300);
    expect(parseMinutes('5,5')).toBe(330);
    expect(parseMinutes('0')).toBe(0);
    expect(parseMinutes('60')).toBe(3600);
    for (const bad of ['', '61', '-1', 'x', '5.555', '1e2']) {
      expect(parseMinutes(bad)).toBeUndefined();
    }
    expect(formatMinutes(300)).toBe('5');
    expect(formatMinutes(330)).toBe('5.5');
    expect(parseBounded('3', CONDITION_BOUNDS.externalMax)).toBe(3);
    for (const bad of ['0', '21', '1.5', '-2', '', 'x']) {
      expect(parseBounded(bad, CONDITION_BOUNDS.externalMax)).toBeUndefined();
    }
  });

  it('parses the state strictly (fixed radius included) and refuses a malformed one', () => {
    expect(parseConditions(conditions)).toMatchObject({ version: 2, externalMax: 3, delaySeconds: 300, pickupSeconds: 120, handoffSeconds: 60, searchRadiusM: 3000 });
    const change = { version_after: 3, old: { external_max_deliveries: 3, batch_max_delay_seconds: 300, pickup_service_seconds: 120, handoff_service_seconds: 60 }, new: { external_max_deliveries: 4, batch_max_delay_seconds: 300, pickup_service_seconds: 120, handoff_service_seconds: 60 }, changed_by: 'u', changed_at: '2026-10-17T04:00:00.000Z' };
    expect(parseConditions({ ...conditions, history: [change] })?.history[0]).toMatchObject({ versionAfter: 3, new: { externalMax: 4 } });
    for (const bad of [{ ...conditions, fixed: {} }, { ...conditions, version: 0 }, { ...conditions, external_max_deliveries: 1.5 }, { ...conditions, history: [{ ...change, new: {} }] }, { ...conditions, history: 'x' }]) {
      expect(parseConditions(bad)).toBeUndefined();
    }
  });

  it('saves with the version, the key and the four values, and maps a stale screen to a conflict', async () => {
    const values = { externalMax: 4, delaySeconds: 360, pickupSeconds: 90, handoffSeconds: 30 };
    const saved = scripted(reply(200, { data: { ...conditions, version: 3 } }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(saved.transport), session()).saveConditions({ version: 2, values, key: 'k' })).toEqual({ kind: 'ok' });
    expect(saved.requests[0]).toMatchObject({ method: 'POST', path: '/admin/shipping-eligibility-policy', csrf: 'csrf-1', idempotencyKey: 'k', body: { expected_version: 2, external_max_deliveries: 4, batch_max_delay_seconds: 360, pickup_service_seconds: 90, handoff_service_seconds: 30 } });
    const stale = scripted(reply(409, errorBody('SHIPPING_ELIGIBILITY_VERSION_CONFLICT')));
    expect(await createShippingPolicySource(new ShippingPolicyApi(stale.transport), session()).saveConditions({ version: 1, values, key: 'k' })).toEqual({ kind: 'conflict' });
    const forbidden = scripted(reply(403, errorBody('ADMIN_FORBIDDEN')));
    expect(await createShippingPolicySource(new ShippingPolicyApi(forbidden.transport), session()).saveConditions({ version: 2, values, key: 'k' })).toEqual({ kind: 'forbidden' });
    const read = scripted(reply(200, { data: conditions }));
    expect(await createShippingPolicySource(new ShippingPolicyApi(read.transport), session()).readConditions()).toMatchObject({ kind: 'ready' });
    expect(read.requests[0]).toMatchObject({ method: 'GET', path: '/admin/shipping-eligibility-policy' });
  });
});
