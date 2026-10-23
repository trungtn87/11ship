import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, dataOf, startAuthApp, registerUser } from './support/auth-fixtures';
import { publicShop } from './support/menu-fixtures';
import { createShopOwner, getShop, profileBody, putProfile } from './support/shop-management-fixtures';

const png = readFileSync('tests/fixtures/shop-logo-256.png').toString('base64');
const logo = { content_type: 'image/png', data_base64: png };

describe('shop logo saved with the versioned profile', () => {
  let app: AuthApp;
  beforeAll(async () => { app = await startAuthApp(); });
  afterAll(async () => { await app.close(); });

  it('onboarding: large real PNG saves, replays, rejects changed content under the same key, preserves and removes', async () => {
    const user = await registerUser(app);
    const key = randomUUID();
    const body = { name: 'Ốc 11', contact_phone: '0912345678', address_text: 'Cao Bằng', logo };
    const put = (value: unknown, requestKey = randomUUID()) => app.call('PUT', '/onboarding/shop/profile', { bearer: user.accessToken, body: value, headers: { 'idempotency-key': requestKey } });
    expect(Buffer.from(png, 'base64').length).toBeGreaterThan(65536);
    const first = await put(body, key);
    expect(first.status).toBe(201);
    expect((await put(body, key)).body).toEqual(first.body);
    expect((await put({ ...body, logo: null }, key)).status).toBe(409);
    const read = () => app.call('GET', '/onboarding/shop/profile', { bearer: user.accessToken });
    expect(JSON.stringify((await read()).body)).toContain(png);
    const version = dataOf(first).version;
    const oldClient = { name: body.name, contact_phone: body.contact_phone, address_text: body.address_text };
    const preserved = await put({ ...oldClient, expected_version: version });
    expect(preserved.status).toBe(200);
    expect(JSON.stringify((await read()).body)).toContain(png);
    expect((await put({ ...oldClient, expected_version: dataOf(preserved).version, logo: { ...logo, content_type: 'image/jpeg' } })).status).toBe(400);
    const tooLarge = Buffer.alloc(1048577); Buffer.from(png, 'base64').copy(tooLarge);
    const oversized = await put({ ...oldClient, logo: { ...logo, data_base64: tooLarge.toString('base64') } });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toMatchObject({ error: { code: 'SHOP_LOGO_TOO_LARGE' } });
    expect((await put({ ...oldClient, expected_version: dataOf(preserved).version, logo: null })).status).toBe(200);
    expect(JSON.stringify((await read()).body)).not.toContain(png);
  });

  it('saves and reads back, survives an old client, rejects stale/invalid writes, removes and hides disabled shops', async () => {
    const owner = await createShopOwner(app);
    const key = randomUUID();
    const body = profileBody(owner, { logo });
    const first = await putProfile(app, owner.token, body, key);
    expect(first.status).toBe(200);
    expect((await putProfile(app, owner.token, body, key)).body).toEqual(first.body);
    expect((await putProfile(app, owner.token, { ...body, logo: null }, key)).status).toBe(409);
    const tooLarge = Buffer.alloc(1048577); Buffer.from(png, 'base64').copy(tooLarge);
    const oversized = await putProfile(app, owner.token, { ...body, logo: { ...logo, data_base64: tooLarge.toString('base64') } });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toMatchObject({ error: { code: 'SHOP_LOGO_TOO_LARGE' } });
    expect(dataOf(await getShop(app, owner.token)).logo).toEqual(logo);
    const detail = dataOf(await publicShop(app, owner.shopId));
    expect(detail.logo_url).toBe(`/v1/shops/${owner.shopId}/logo?v=3`);
    expect(detail).not.toHaveProperty('logo');
    const url = `${app.running.baseUrl}/v1/shops/${owner.shopId}/logo`;
    const image = await fetch(url);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(png, 'base64'));
    expect((await putProfile(app, owner.token, profileBody(owner, { expected_version: 3 }))).status).toBe(200);
    expect(dataOf(await getShop(app, owner.token)).logo).toEqual(logo);
    expect((await putProfile(app, owner.token, profileBody(owner, { expected_version: 3, logo: null }))).status).toBe(409);
    expect((await putProfile(app, owner.token, profileBody(owner, { expected_version: 4, logo: { ...logo, content_type: 'image/jpeg' } }))).status).toBe(400);
    expect(dataOf(await getShop(app, owner.token)).logo).toEqual(logo);
    await app.pool.query("UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1", [owner.shopId]);
    expect((await fetch(url)).status).toBe(404);
    await app.pool.query("UPDATE app.shops SET status = 'ACTIVE' WHERE shop_id = $1", [owner.shopId]);
    expect((await putProfile(app, owner.token, profileBody(owner, { expected_version: 4, logo: null }))).status).toBe(200);
    expect(dataOf(await getShop(app, owner.token)).logo).toBeUndefined();
    expect(dataOf(await publicShop(app, owner.shopId)).logo_url).toBeUndefined();
    expect((await fetch(url)).status).toBe(404);
  });
});
