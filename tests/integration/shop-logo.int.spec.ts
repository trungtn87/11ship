import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import { createShopOwner, getShop, profileBody, putProfile } from './support/shop-management-fixtures';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEklEQVR4nGN8tEOeAQaYGJAAACppAb0V3EgsAAAAAElFTkSuQmCC';
const logo = { content_type: 'image/png', data_base64: png };

describe('shop logo saved with the versioned profile', () => {
  let app: AuthApp;
  beforeAll(async () => { app = await startAuthApp(); });
  afterAll(async () => { await app.close(); });

  it('saves and reads back, survives an old client, rejects stale/invalid writes, removes and hides disabled shops', async () => {
    const owner = await createShopOwner(app);
    expect((await putProfile(app, owner.token, profileBody(owner, { logo }))).status).toBe(200);
    expect(dataOf(await getShop(app, owner.token)).logo).toEqual(logo);
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
    expect((await fetch(url)).status).toBe(404);
  });
});
