import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, Login, permission, postAs, purgeGrants, systemLoginOf } from './support/m12-fixtures';

// OD-27: every wallet.* right of the administration needs the DRIVER app scope (a current can_view row for DRIVER) on top of the grant row. Matrix:
// {holds the wallet.* rights, holds none} x {DRIVER only, SHOP only, both, SYSTEM} against every admin endpoint that asks a wallet.* right, plus the
// counters (overview tiles, action queue) and the caller's own rights read. An ADMIN with the rights but without DRIVER is refused with 403
// ADMIN_FORBIDDEN, or sees FORBIDDEN in a counter; SYSTEM is exempt. No compatibility fallback is tested for because there is none.

const WALLET_RIGHTS = ['wallet.read', 'wallet.topup.record', 'wallet.withdrawal.process', 'wallet.withdrawal.confirm', 'wallet.withdrawal.reconcile'] as const;
const ghost = (): string => randomUUID();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Endpoint {
  readonly name: string;
  readonly call: (who: Login) => Promise<AdminResponse>;
}

describe('OD-27 — wallet.* rights need the DRIVER scope', () => {
  let admin: AdminApp;
  let system: SystemSession;
  const actors = new Map<string, ActivatedAdmin>();

  const get = (path: string): Endpoint => ({ name: `GET ${path}`, call: (who) => getAs(admin, who, path) });
  const post = (path: string, body: unknown = {}): Endpoint => ({ name: `POST ${path}`, call: (who) => postAs(admin, who, path, body) });
  const endpoints = (): Endpoint[] => [
    get('/finance/overview'),
    get('/finance/wallets'),
    get(`/finance/wallets/${ghost()}`),
    get('/finance/transactions'),
    get('/finance/reconciliation'),
    post('/finance/reconciliation/check'),
    get('/finance/withdrawals'),
    get(`/finance/withdrawals/${ghost()}`),
    post(`/finance/withdrawals/${ghost()}/start-processing`, { expected_version: 1 }),
    post(`/finance/withdrawals/${ghost()}/mark-paid`, {
      expected_version: 1,
      destination_checked: true,
      actual_amount_vnd: 50_000,
      bank_id: 'VCB',
      system_owned_account_id: ghost(),
      canonical_transaction_id: `OD27-${ghost()}`,
      paid_at: new Date(Date.now() - 30_000).toISOString(),
    }),
    post(`/finance/withdrawals/${ghost()}/report-reconciliation`, { expected_version: 1, reason_code: 'UNKNOWN_OUTCOME' }),
    post(`/finance/withdrawals/${ghost()}/reconcile`, { expected_version: 1, outcome: 'UNKNOWN', reason_code: 'STILL_UNCLEAR' }),
    get('/finance/topup-requests'),
    get(`/finance/topup-requests/${ghost()}`),
    post(`/finance/topup-requests/${ghost()}/reject`, { expected_version: 1, reason_code: 'NOT_RECEIVED' }),
    post(`/finance/topup-requests/${ghost()}/confirm`, {
      expected_version: 1,
      actual_amount_vnd: 100_000,
      bank_id: 'VCB',
      system_owned_account_id: ghost(),
      canonical_transaction_id: `OD27-${ghost()}`,
      received_at: new Date(Date.now() - 60_000).toISOString(),
    }),
    get('/business/requests'),
  ];

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    const scopes: Array<[string, Record<string, unknown>[]]> = [
      ['driver', [permission('DRIVER')]],
      ['shop', [permission('SHOP')]],
      ['both', [permission('SHOP'), permission('DRIVER')]],
    ];
    for (const [scope, permissions] of scopes) {
      for (const holds of [true, false]) {
        const who = await activatedAdmin(admin, system, permissions, `OD27 ${scope} ${holds ? 'with' : 'without'} rights`);
        actors.set(`${scope}/${holds ? 'rights' : 'none'}`, who);
        if (holds) {
          for (const right of [...WALLET_RIGHTS, 'report.read'] as string[]) {
            expect((await changeGrant(admin, system, 'grant', who.userId, right, 0)).status).toBe(200);
          }
        }
      }
    }
  });

  afterAll(async () => {
    try {
      await purgeGrants(admin.pool);
    } finally {
      await admin.close();
    }
  });

  const person = (key: string): ActivatedAdmin => actors.get(key) as ActivatedAdmin;
  const actor = (key: string): Login => person(key).login;
  /** The matrix: who passes the wallet guard. */
  const passes = (key: string): boolean => key === 'system' || key === 'driver/rights' || key === 'both/rights';
  const CASES = ['driver/rights', 'shop/rights', 'both/rights', 'driver/none', 'shop/none', 'both/none', 'system'];
  const loginOf = (key: string): Login => (key === 'system' ? systemLoginOf(system) : actor(key));

  it('every wallet.* endpoint: 403 ADMIN_FORBIDDEN unless SYSTEM, or an ADMIN with the right AND the DRIVER scope', async () => {
    const seen: string[] = [];
    for (const endpoint of endpoints()) {
      for (const key of CASES) {
        const response = await endpoint.call(loginOf(key));
        if (passes(key)) {
          // Past the guard: the answer is the endpoint's own (200, 404 for a made-up id, 409 ...), never an authorization refusal.
          expect([endpoint.name, key, response.status, response.status === 401 || response.status === 403 ? response.text.slice(0, 200) : '']).toEqual([endpoint.name, key, response.status, '']);
        } else {
          expect([endpoint.name, key, response.status, adminErrorCode(response)]).toEqual([endpoint.name, key, 403, 'ADMIN_FORBIDDEN']);
        }
        seen.push(`${endpoint.name} ${key}`);
      }
    }
    expect(seen.length).toBe(endpoints().length * CASES.length);
  });

  it('SYSTEM-only grant routes are untouched, and a missing scope does not turn an allowed GET into a 404 or 500', async () => {
    // The grant table is still readable by SYSTEM for the ADMIN that has the rights but not the scope (the stored fact is unchanged).
    const shopWithRights = person('shop/rights');
    const response = await getAs(admin, systemLoginOf(system), `/finance/access/admins/${shopWithRights.userId}`);
    expect(response.status).toBe(200);
    const granted = (adminData(response).permissions as Array<{ permission_key: string; state: string }>).filter((row) => row.state === 'GRANTED').map((row) => row.permission_key);
    expect(granted).toEqual(expect.arrayContaining([...WALLET_RIGHTS]));
    for (const key of ['driver/rights', 'both/rights']) {
      expect((await getAs(admin, actor(key), '/finance/wallets')).status).toBe(200);
    }
  });

  it('own rights read (finance/access/me) lists wallet.* only with the DRIVER scope; non-wallet rights are unaffected; SYSTEM is implicit', async () => {
    const mine = async (key: string): Promise<string[]> => {
      const response = await getAs(admin, loginOf(key), '/finance/access/me');
      expect(response.status).toBe(200);
      return adminData(response).permissions as string[];
    };
    for (const key of ['driver/rights', 'both/rights']) {
      expect(await mine(key)).toEqual(expect.arrayContaining([...WALLET_RIGHTS]));
    }
    const shopOnly = await mine('shop/rights');
    expect(shopOnly.filter((right) => right.startsWith('wallet.'))).toEqual([]);
    expect(shopOnly).toContain('report.read');
    expect(await mine('shop/none')).toEqual([]);
    expect(await mine('system')).toEqual(expect.arrayContaining([...WALLET_RIGHTS]));
  });

  it('counters: the overview money tiles and the wallet to-do counters are FORBIDDEN without the scope, OK with it, and the action queue hides the wallet items', async () => {
    const overview = async (key: string): Promise<Json> => {
      const response = await getAs(admin, loginOf(key), '/overview?range=today');
      expect(response.status).toBe(200);
      return adminData(response) as Json;
    };
    const todo = (body: Json, name: string): Json => (body.todo as Json[]).find((item) => item.key === name) as Json;
    for (const key of CASES) {
      const body = await overview(key);
      const expected = passes(key) ? 'OK' : 'FORBIDDEN';
      expect([key, body.groups.money_now.metrics.wallet_balance_vnd.status]).toEqual([key, expected]);
      expect([key, body.groups.money_now.metrics.topup_pending.status]).toEqual([key, expected]);
      expect([key, body.groups.money_period.metrics.commission_vnd.status]).toEqual([key, expected]);
      expect([key, todo(body, 'topups_pending').status]).toEqual([key, expected]);
      expect([key, todo(body, 'withdrawals_pending').status]).toEqual([key, expected]);
    }
    for (const key of ['driver/rights', 'shop/rights', 'both/rights']) {
      const response = await getAs(admin, loginOf(key), '/overview/action-queue');
      expect([key, response.status]).toEqual([key, 200]);
      const areas = ((adminData(response).items ?? []) as Array<{ area?: string }>).map((item) => item.area);
      if (!passes(key)) {
        expect([key, areas.filter((area) => area === 'finance-topup' || area === 'finance-withdrawal')]).toEqual([key, []]);
      }
    }
  });

  it('money reports: the money report needs wallet.read AND the scope; a non-money report is not affected', async () => {
    for (const key of CASES.filter((candidate) => candidate !== 'driver/none' && candidate !== 'shop/none' && candidate !== 'both/none')) {
      const response = await getAs(admin, loginOf(key), '/reports/money?range=today');
      if (passes(key)) {
        expect([key, response.status]).toEqual([key, 200]);
      } else {
        expect([key, response.status]).toEqual([key, 403]);
      }
    }
    expect((await getAs(admin, actor('shop/rights'), '/reports/shops?range=today')).status).not.toBe(403);
  });

  it('the rule is read on every call: giving the DRIVER scope to a SHOP-only ADMIN opens the wallet, taking it back closes it at once', async () => {
    const who = person('shop/rights');
    expect((await getAs(admin, who.login, '/finance/wallets')).status).toBe(403);
    // Move the permission rows directly (test database): the guard reads the CURRENT rows, nothing is cached between calls.
    await admin.pool.query(`INSERT INTO app.admin_app_permissions (user_id, app, can_view, can_review_profile, can_lock) VALUES ($1::uuid, 'DRIVER', true, false, false)`, [who.userId]);
    try {
      expect((await getAs(admin, who.login, '/finance/wallets')).status).toBe(200);
    } finally {
      await admin.pool.query(`UPDATE app.admin_app_permissions SET can_view = false WHERE user_id = $1::uuid AND app = 'DRIVER'`, [who.userId]);
    }
    expect((await getAs(admin, who.login, '/finance/wallets')).status).toBe(403);
  });
});
