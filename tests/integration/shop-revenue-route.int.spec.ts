import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, dataOf, registerUser, startAuthApp } from './support/auth-fixtures';
import { createShopOwner } from './support/shop-management-fixtures';

// #391 shop revenue, through the HTTP route: the access rules (no session, the wrong role, a shop id from the client) and the empty answer of a shop
// with no completed order (real zeros, not an error). Order data is covered by shop-revenue.int.spec.ts; this file commits no order.

describe('#391 shop revenue routes - access control and the empty answer', () => {
  let app: AuthApp;
  beforeAll(async () => {
    app = await startAuthApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('no session is refused, and a customer (not a shop owner) is refused by role', async () => {
    const customer = await registerUser(app);
    const anonymous = await app.call('GET', '/shop/revenue/summary?from=2026-11-17&to=2026-11-18');
    expect([401, 403]).toContain(anonymous.status);
    const asCustomer = await app.call('GET', '/shop/revenue/summary?from=2026-11-17&to=2026-11-18', { bearer: customer.accessToken });
    expect(asCustomer.status).toBe(403);
    const ordersAsCustomer = await app.call('GET', '/shop/revenue/orders?from=2026-11-17&to=2026-11-18', { bearer: customer.accessToken });
    expect(ordersAsCustomer.status).toBe(403);
  });

  it('a shop owner with no completed order reads zeros for every day, and an empty order list', async () => {
    const owner = await createShopOwner(app);
    const summary = await app.call('GET', '/shop/revenue/summary?from=2026-11-17&to=2026-11-18', { bearer: owner.token });
    expect(summary.status).toBe(200);
    const body = dataOf(summary);
    expect(body).toMatchObject({ summary: { completed_count: 0, items_total_vnd: 0, average_items_vnd: null } });
    expect(body.daily).toEqual([
      { date: '2026-11-17', completed_count: 0, items_total_vnd: 0 },
      { date: '2026-11-18', completed_count: 0, items_total_vnd: 0 },
    ]);
    const orders = await app.call('GET', '/shop/revenue/orders?from=2026-11-17&to=2026-11-18', { bearer: owner.token });
    expect(orders.status).toBe(200);
    expect(dataOf(orders)).toEqual({ items: [], next_cursor: null });
  });

  it('a shop id from the client is refused, a period over 92 days is refused, and a bad cursor is refused', async () => {
    const owner = await createShopOwner(app);
    const withShop = await app.call('GET', `/shop/revenue/summary?from=2026-11-17&to=2026-11-18&shop_id=${owner.shopId}`, { bearer: owner.token });
    expect(withShop.status).toBe(400);
    const tooLong = await app.call('GET', '/shop/revenue/summary?from=2026-07-31&to=2026-10-31', { bearer: owner.token });
    expect(tooLong.status).toBe(400);
    const badCursor = await app.call('GET', '/shop/revenue/orders?from=2026-11-17&to=2026-11-18&cursor=%25%25', { bearer: owner.token });
    expect(badCursor.status).toBe(400);
    const badLimit = await app.call('GET', '/shop/revenue/orders?from=2026-11-17&to=2026-11-18&limit=500', { bearer: owner.token });
    expect(badLimit.status).toBe(400);
  });
});
