import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { sessionCookies } from './support/admin-fixtures';
import { adminData, adminErrorCode, AdminResponse } from './support/admin-fixtures';
import { dataOf, errorCode } from './support/auth-fixtures';
import { completeSetup, createShopOwner } from './support/shop-management-fixtures';
import { AdminLogin, Json, M11World, PNG_BASE64, Shipper } from './support/m11-harness';

// M11.03 on a REAL Nest pipeline and PostgreSQL, through the REAL administration pipeline (session cookie, CSRF, idempotency): who may read and who may
// change, the complaint workflow with what each side is shown, assignment, reconsideration, hiding and restoring a rating (the original is kept and a hidden
// rating counts for nothing), outcome adjustments that never touch the delivery, the money right that complaint handling does not include, and the M08
// notifications. Deliveries go through the real M07 routes; the stand-ins are the M10 order adapter and the M04 adjustment port (neither is built).

describe('M11.03 — administration, moderation and adjustments', () => {
  let w: M11World;
  let system: AdminLogin;
  let handler: AdminLogin; // ADMIN: view + review on DRIVER
  let viewer: AdminLogin; // ADMIN: view only on SHOP
  let shipper: Shipper;

  beforeAll(async () => {
    w = await M11World.start({ admin: true });
    system = w.systemLogin();
    handler = await w.adminWith('DRIVER', { review: true });
    viewer = await w.adminWith('SHOP', { review: false });
    shipper = await w.newShipper();
  });
  afterAll(async () => {
    // The grant row of the money-right test points at administrator accounts that close() removes (the application never deletes a grant).
    const client = await w.app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER USER');
      await client.query(`DELETE FROM app.admin_finance_grants WHERE permission_key = 'wallet.adjustment.post'`);
      await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await w.close();
  });

  const body = (stars = 5, comment: string | undefined = 'Ngon') => ({ stars, ...(comment === undefined ? {} : { comment }) });
  const codeOf = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  const data = (r: AdminResponse): Json => {
    if (r.status === 500) {
      console.error(w.app.running.logs.slice(-4).join('\n'));
    }
    expect([r.status, r.text.slice(0, 300)]).toEqual([200, r.text.slice(0, 300)]);
    return adminData(r) as Json;
  };
  const q = (sql: string, values: unknown[] = []): Promise<Json[]> => w.app.pool.query(sql, values).then((r) => r.rows as Json[]);

  /** A complaint opened by the shop about a delivery (default: a failed one with the goods still with the Shipper). */
  async function file(over: Json = {}, deliveryId?: string): Promise<{ id: string; code: string; deliveryId: string; version: number }> {
    const delivery = deliveryId ?? (await w.failed(shipper));
    const created = await w.asShop('POST', '/shop/me/complaints', { category: 'GOODS', body: 'Hàng chưa về quán', delivery_id: delivery, ...over });
    expect([created.status, created.text.slice(0, 300)]).toEqual([201, created.text.slice(0, 300)]);
    const c = (dataOf(created) as Json).complaint as Json;
    return { id: String(c.complaint_id), code: String(c.code), deliveryId: delivery, version: Number(c.version) };
  }
  const act = (who: AdminLogin, id: string, action: string, payload: Json, key?: string): Promise<AdminResponse> => w.adminPost(who, `/complaints/${id}/actions/${action}`, payload, key);
  const detail = async (who: AdminLogin, id: string): Promise<Json> => data(await w.adminGet(who, `/complaints/${id}`));
  const versionOf = async (id: string): Promise<number> => Number(((await detail(system, id)).complaint as Json).version);

  // ---- rights ----------------------------------------------------------------------------------------------------------------------

  it('reading needs VIEW; changing needs the review right; no session or an unknown filter is refused', async () => {
    const c = await file();
    expect(codeOf(await w.adminGet(undefined, '/complaints'))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    expect(codeOf(await w.adminGet(system, '/complaints?bogus=1')).status).toBe(400);
    expect(codeOf(await w.adminGet(system, '/complaints?status=NOPE')).status).toBe(400);
    expect(codeOf(await w.adminGet(system, '/reviews?stars=9')).status).toBe(400);
    for (const who of [system, handler, viewer]) {
      expect((await w.adminGet(who, `/complaints?q=${c.code}`)).status).toBe(200);
    }
    expect(codeOf(await act(viewer, c.id, 'receive', { expected_version: c.version }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await detail(viewer, c.id)).can).toEqual([]);
    expect(codeOf(await act(handler, c.id, 'receive', { expected_version: c.version })).status).toBe(200);
    // Unknown actions and bodies that try to set a status are not routes.
    expect(codeOf(await act(system, c.id, 'set-status', { expected_version: 2, status: 'RESOLVED' })).status).toBe(400);
    expect(codeOf(await act(system, c.id, 'note', { expected_version: await versionOf(c.id), body: 'x', status: 'RESOLVED' })).status).toBe(400);
    expect(codeOf(await act(system, randomUUID(), 'receive', { expected_version: 1 })).code).toBe('COMPLAINT_NOT_FOUND');
  });

  // ---- workflow ---------------------------------------------------------------------------------------------------------------------

  it('the workflow: receive, ask, supplement, conclude; each side sees only what it may; the internal note never leaves the Administration', async () => {
    const c = await file({ body: 'Hàng chưa về quán, bên giao nói đã trả' });
    const list = data(await w.adminGet(system, `/complaints?q=${c.code}&status=PENDING`));
    expect((list.items as Json[]).map((i) => i.code)).toEqual([c.code]);
    expect(list.counters).toMatchObject({ pending: expect.any(Number) });
    const first = await detail(system, c.id);
    expect(first.can).toEqual(expect.arrayContaining(['receive', 'note', 'assign', 'close']));
    expect(first.can).not.toContain('conclude');
    // The delivery as the Administration reads it: the history, the goods, the Shipper; no recipient contact.
    expect(first.delivery).toMatchObject({ state: 'failed', incident: { status: 'OPEN', custody: 'SHIPPER' } });
    expect(JSON.stringify(first)).not.toMatch(/\+84912345678|0912345678/);

    // Stale version: nothing changes.
    expect(codeOf(await act(system, c.id, 'receive', { expected_version: 99 })).code).toBe('VERSION_CONFLICT');
    const received = data(await act(system, c.id, 'receive', { expected_version: c.version }));
    expect(received.complaint).toMatchObject({ status: 'IN_PROGRESS', assigned_to: { user_id: system.userId } });
    expect(codeOf(await act(system, c.id, 'receive', { expected_version: await versionOf(c.id) })).code).toBe('COMPLAINT_STATE_CONFLICT');

    await act(system, c.id, 'note', { expected_version: await versionOf(c.id), body: 'GHI CHÚ NỘI BỘ: nghi vấn shipper' });
    // The shop reads its file: received, nothing internal.
    const shopView = dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`)) as Json;
    expect(shopView.status).toBe('IN_PROGRESS');
    expect((shopView.messages as Json[]).map((m) => m.kind)).toEqual(['SUBMITTED', 'RECEIVED']);
    expect(JSON.stringify(shopView)).not.toMatch(/NỘI BỘ|visibility|author_user_id|internal/i);
    // The Shipper (a related party) has been shown nothing: the file is not even listed for it.
    expect(errorCode(await w.asShipper(shipper, 'GET', `/driver/complaints/${c.id}`))).toBe('COMPLAINT_NOT_FOUND');
    expect(((dataOf(await w.asShipper(shipper, 'GET', '/driver/complaints')) as Json).involving_me as Json[]).map((i) => i.code)).not.toContain(c.code);

    // Ask the SHIPPER: now it is a related party, sees the question only (never the text of the complaint or its pictures), and may answer.
    expect(codeOf(await act(system, c.id, 'request-info', { expected_version: await versionOf(c.id), from: 'SHOP', body: 'x' })).code).toBe('COMPLAINT_STATE_CONFLICT');
    const asked = data(await act(system, c.id, 'request-info', { expected_version: await versionOf(c.id), from: 'SHIPPER', body: 'Vui lòng cho biết hàng được giao lại cho ai?' }));
    expect(asked.complaint).toMatchObject({ status: 'AWAITING_INFO', awaiting_from: 'SHIPPER' });
    const partyView = dataOf(await w.asShipper(shipper, 'GET', `/driver/complaints/${c.id}`)) as Json;
    expect(partyView).toMatchObject({ relation: 'PARTY', awaiting_you: true, can_supplement: true, body: null });
    expect((partyView.messages as Json[]).map((m) => m.kind)).toEqual(['REQUEST_INFO']);
    expect(JSON.stringify(partyView)).not.toMatch(/chưa về quán|NỘI BỘ/);
    expect(((dataOf(await w.asShipper(shipper, 'GET', '/driver/complaints')) as Json).involving_me as Json[]).map((i) => i.code)).toContain(c.code);
    // The shop (the submitter) is not told the Shipper was asked.
    expect(((dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`)) as Json).messages as Json[]).map((m) => m.kind)).toEqual(['SUBMITTED', 'RECEIVED']);
    // Only the party asked may answer; the answer moves the file back to "being handled" and is shown to the Administration only.
    const answered = await w.asShipper(shipper, 'POST', `/driver/complaints/${c.id}/supplement`, { body: 'Đã trả cho nhân viên quán' });
    expect([answered.status, answered.text.slice(0, 200)]).toEqual([200, answered.text.slice(0, 200)]);
    expect(await detail(system, c.id)).toMatchObject({ complaint: { status: 'IN_PROGRESS', awaiting_from: null } });
    expect(errorCode(await w.asShipper(shipper, 'POST', `/driver/complaints/${c.id}/supplement`, { body: 'lại' }))).toBe('COMPLAINT_STATE_CONFLICT');
    expect(JSON.stringify((await detail(system, c.id)).messages)).toContain('Đã trả cho nhân viên quán');
    expect(JSON.stringify(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`)))).not.toContain('Đã trả cho nhân viên quán');

    // Ask the submitter: its supplement answers.
    expect(data(await act(system, c.id, 'request-info', { expected_version: await versionOf(c.id), from: 'SUBMITTER', body: 'Cho xin ảnh phiếu giao' })).complaint).toMatchObject({ status: 'AWAITING_INFO', awaiting_from: 'SUBMITTER' });
    expect(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`))).toMatchObject({ awaiting_you: true, can_supplement: true });
    expect((await w.asShop('POST', `/shop/me/complaints/${c.id}/supplement`, { body: 'Đây là phiếu giao' })).status).toBe(200);
    expect(await detail(system, c.id)).toMatchObject({ complaint: { status: 'IN_PROGRESS' } });

    // Conclude: both the submitter and the related Shipper read it.
    const done = data(await act(handler, c.id, 'conclude', { expected_version: await versionOf(c.id), conclusion: 'Đã xác minh: hàng được trả cho quán lúc 14:00.' }));
    expect(done.complaint).toMatchObject({ status: 'RESOLVED', closure_no: 1 });
    expect(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`))).toMatchObject({ status: 'RESOLVED', conclusion: 'Đã xác minh: hàng được trả cho quán lúc 14:00.', can_request_reconsideration: true });
    expect(dataOf(await w.asShipper(shipper, 'GET', `/driver/complaints/${c.id}`))).toMatchObject({ status: 'RESOLVED', conclusion: 'Đã xác minh: hàng được trả cho quán lúc 14:00.', body: null });
    // The Shipper (a party, not the submitter) cannot ask for another review.
    expect(errorCode(await w.asShipper(shipper, 'POST', `/driver/complaints/${c.id}/reconsideration`, { reason: 'tôi' }))).toBe('COMPLAINT_NOT_FOUND');
    // Nothing more can be done to a closed file but the reconsideration.
    for (const [action, payload] of [['request-info', { from: 'SHOP', body: 'x' }], ['conclude', { conclusion: 'y' }], ['close', { reason: 'z' }], ['receive', {}]] as const) {
      expect([action, codeOf(await act(system, c.id, action, { expected_version: await versionOf(c.id), ...payload })).code]).toEqual([action, 'COMPLAINT_STATE_CONFLICT']);
    }
    // Closing the file did not change who holds the goods, the delivery, the money.
    expect((await q('SELECT status, custody FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [c.deliveryId]))[0]).toEqual({ status: 'OPEN', custody: 'SHIPPER' });
    expect((await q('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [c.deliveryId]))[0]?.state).toBe('failed');
  });

  it('closing without action needs a reason, shows it to the submitter and leaves the delivery and the goods exactly as they were', async () => {
    const c = await file({ category: 'OTHER', body: 'Khác' });
    const before = { wallet: await w.wallet(shipper), ledger: await w.ledgerCount(shipper), delivery: (await q('SELECT state, version FROM app.deliveries WHERE delivery_id = $1::uuid', [c.deliveryId]))[0], incident: (await q('SELECT status, custody, version FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [c.deliveryId]))[0] };
    expect(codeOf(await act(system, c.id, 'close', { expected_version: c.version, reason: '' })).status).toBe(400);
    expect(codeOf(await act(system, c.id, 'close', { expected_version: c.version })).status).toBe(400);
    const closed = data(await act(system, c.id, 'close', { expected_version: c.version, reason: 'Trùng với hồ sơ khác' }));
    expect(closed.complaint).toMatchObject({ status: 'CLOSED_NO_ACTION', close_reason: 'Trùng với hồ sơ khác' });
    expect(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`))).toMatchObject({ status: 'CLOSED_NO_ACTION', close_reason: 'Trùng với hồ sơ khác', can_request_reconsideration: true });
    expect({ wallet: await w.wallet(shipper), ledger: await w.ledgerCount(shipper), delivery: (await q('SELECT state, version FROM app.deliveries WHERE delivery_id = $1::uuid', [c.deliveryId]))[0], incident: (await q('SELECT status, custody, version FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [c.deliveryId]))[0] }).toEqual(before);
  });

  it('assignment: only an administrator who can handle complaints can be assigned; the list shows who', async () => {
    const c = await file({ category: 'SERVICE', body: 'Thái độ' });
    const handlers = (data(await w.adminGet(system, '/complaint-handlers')).handlers as Json[]).map((h) => h.user_id);
    expect(handlers).toEqual(expect.arrayContaining([system.userId, handler.userId]));
    expect(handlers).not.toContain(viewer.userId);
    expect(codeOf(await act(system, c.id, 'assign', { expected_version: c.version, assignee_user_id: viewer.userId })).code).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(await act(system, c.id, 'assign', { expected_version: c.version, assignee_user_id: randomUUID() })).code).toBe('ADMIN_INPUT_INVALID');
    const assigned = data(await act(system, c.id, 'assign', { expected_version: c.version, assignee_user_id: handler.userId }));
    expect((assigned.complaint as Json).assigned_to).toMatchObject({ user_id: handler.userId });
    expect(((data(await w.adminGet(system, `/complaints?assignee=${handler.userId}`)).items as Json[]).map((i) => i.code))).toContain(c.code);
    expect(((data(await w.adminGet(system, '/complaints?assignee=NONE')).items as Json[]).map((i) => i.code))).not.toContain(c.code);
    expect(codeOf(await act(system, c.id, 'assign', { expected_version: await versionOf(c.id), assignee_user_id: handler.userId })).code).toBe('COMPLAINT_STATE_CONFLICT');
    // A handler's own session sees "mine".
    expect(((data(await w.adminGet(handler, '/complaints?assignee=ME')).items as Json[]).map((i) => i.code))).toContain(c.code);
  });

  it('a retried action (same key) answers the same and changes nothing twice; two administrators racing: one wins', async () => {
    const c = await file({ category: 'MONEY_FEE', body: 'Thu khác phí' });
    const key = randomUUID();
    const a = await act(system, c.id, 'receive', { expected_version: c.version }, key);
    const b = await act(system, c.id, 'receive', { expected_version: c.version }, key);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await w.count(`SELECT 1 FROM app.complaint_messages WHERE complaint_id = $1::uuid AND kind = 'RECEIVED'`, [c.id])).toBe(1);
    const v = await versionOf(c.id);
    const [x, y] = await Promise.all([act(system, c.id, 'note', { expected_version: v, body: 'A' }), act(handler, c.id, 'note', { expected_version: v, body: 'B' })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await w.count(`SELECT 1 FROM app.complaint_messages WHERE complaint_id = $1::uuid AND kind = 'NOTE'`, [c.id])).toBe(1);
  });

  // ---- reconsideration ----------------------------------------------------------------------------------------------------------------

  it('reconsideration: the Administration decides; REOPEN brings the file back with a reason, REJECT keeps the result; a duplicate open file blocks a reopen', async () => {
    const c = await file({ category: 'DELIVERY_RESULT', body: 'Sai kết quả' });
    await act(system, c.id, 'close', { expected_version: c.version, reason: 'Không đủ căn cứ' });
    const asked = await w.asShop('POST', `/shop/me/complaints/${c.id}/reconsideration`, { reason: 'Có thêm bằng chứng' });
    expect(asked.status).toBe(200);
    const detailBefore = await detail(system, c.id);
    expect(detailBefore.can).toContain('decide-reconsideration');
    expect((detailBefore.reconsiderations as Json[])[0]).toMatchObject({ status: 'PENDING', reason: 'Có thêm bằng chứng' });
    expect(((data(await w.adminGet(system, `/complaints?q=${c.code}`)).items as Json[])[0] as Json).reconsideration_pending).toBe(true);
    expect(codeOf(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'MAYBE', reason: 'x' })).status).toBe(400);
    expect(codeOf(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'REOPEN' })).status).toBe(400);
    // A new file about the same thing was opened meanwhile: the reopen is refused, the file stays closed.
    const again = await w.asShop('POST', '/shop/me/complaints', { category: 'DELIVERY_RESULT', body: 'Lại', delivery_id: c.deliveryId });
    expect(again.status).toBe(201);
    expect(codeOf(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'REOPEN', reason: 'Mở lại' })).code).toBe('COMPLAINT_STATE_CONFLICT');
    const newId = String(((dataOf(again) as Json).complaint as Json).complaint_id);
    await act(system, newId, 'close', { expected_version: Number(((dataOf(again) as Json).complaint as Json).version), reason: 'Gộp vào hồ sơ cũ' });
    const reopened = data(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'REOPEN', reason: 'Chấp nhận bằng chứng mới' }));
    expect(reopened.complaint).toMatchObject({ status: 'IN_PROGRESS', closed_at: null, conclusion: null, close_reason: null });
    expect(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`))).toMatchObject({ status: 'IN_PROGRESS', can_supplement: true, can_request_reconsideration: false });
    expect(JSON.stringify(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`)))).toContain('Chấp nhận bằng chứng mới');
    // Closed again: a NEW closing gets its own 7 days and its own request.
    await act(system, c.id, 'conclude', { expected_version: await versionOf(c.id), conclusion: 'Kết luận lần hai' });
    expect((await w.asShop('POST', `/shop/me/complaints/${c.id}/reconsideration`, { reason: 'Lần hai' })).status).toBe(200);
    const rejected = data(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'REJECT', reason: 'Giữ nguyên kết luận' }));
    expect(rejected.complaint).toMatchObject({ status: 'RESOLVED', closure_no: 2 });
    expect(dataOf(await w.asShop('GET', `/shop/me/complaints/${c.id}`))).toMatchObject({ status: 'RESOLVED', can_request_reconsideration: false });
    expect(codeOf(await act(system, c.id, 'decide-reconsideration', { expected_version: await versionOf(c.id), decision: 'REOPEN', reason: 'sau khi từ chối' })).code).toBe('COMPLAINT_STATE_CONFLICT');
    // Deciding changed the file, never the delivery.
    expect((await q('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [c.deliveryId]))[0]?.state).toBe('failed');
  });

  // ---- pictures ------------------------------------------------------------------------------------------------------------------------

  it('the Administration opens the pictures of a complaint; an anonymous caller and another complaint\'s id cannot', async () => {
    const pic = await w.app.call('POST', '/shop/me/complaints/attachments', { bearer: w.shop.token, body: { content_type: 'image/png', data_base64: PNG_BASE64 } });
    const attachmentId = String((dataOf(pic) as Json).attachment_id);
    const c = await file({ attachment_ids: [attachmentId] });
    const other = await file({ category: 'OTHER' });
    const cookieHeader = (who: AdminLogin): Record<string, string> => ({ cookie: Object.entries(sessionCookies(who)).map(([k, v]) => `${k}=${v}`).join('; ') });
    const read = (who: AdminLogin | undefined, complaintId: string) => fetch(`${w.app.running.baseUrl}/v1/admin/complaints/${complaintId}/attachments/${attachmentId}`, { headers: who === undefined ? {} : cookieHeader(who) });
    const ok = await read(handler, c.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect((await read(undefined, c.id)).status).toBe(401);
    expect((await read(system, other.id)).status).toBe(404);
    expect(JSON.stringify(((await detail(system, c.id)).messages as Json[])[0])).toContain(attachmentId);
  });

  // ---- ratings: hide and restore -------------------------------------------------------------------------------------------------------

  it('hiding a rating needs a reason, keeps the original, removes it from the page and from the score; restoring brings it back; stars and text are never editable', async () => {
    const shop2 = await createShopOwner(w.app);
    await completeSetup(w.app, shop2);
    const customer = await w.newCustomer('Lê Thu Hà');
    const other = await w.newCustomer('Người Khác');
    const bad = w.newOrder(customer, { shopId: shop2.shopId });
    const good = w.newOrder(other, { shopId: shop2.shopId });
    await w.asCustomer(customer, 'POST', `/customers/me/orders/${bad.orderId}/reviews/shop`, body(1, 'Đồ ăn tệ, giao hàng quá lâu'));
    await w.asCustomer(other, 'POST', `/customers/me/orders/${good.orderId}/reviews/shop`, body(5, 'Tuyệt vời'));
    const page = async (): Promise<Json> => dataOf(await w.app.call('GET', `/shops/${shop2.shopId}/reviews`)) as Json;
    expect((await page()).summary).toMatchObject({ average: 3, count: 2 });

    const list = data(await w.adminGet(system, '/reviews?stars=1&kind=SHOP_BY_CUSTOMER'));
    const line = (list.items as Json[]).find((i) => (i.shop as Json).shop_id === shop2.shopId) as Json;
    expect(line).toMatchObject({ stars: 1, visibility: 'VISIBLE' });
    const id = String(line.review_id);
    const hide = (who: AdminLogin, over: Json = {}, key?: string): Promise<AdminResponse> => w.adminPost(who, `/reviews/${id}/actions/hide`, { expected_version: 1, reason_code: 'WRONG_ORDER', ...over }, key);
    expect(codeOf(await hide(viewer))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await hide(system, { reason_code: undefined })).status).toBe(400);
    expect(codeOf(await hide(system, { reason_code: 'BECAUSE' })).status).toBe(400);
    expect(codeOf(await hide(system, { reason_code: 'OTHER' })).status).toBe(400);
    expect(codeOf(await hide(system, { stars: 5 })).status).toBe(400);
    expect(codeOf(await hide(system, { comment: 'sửa' })).status).toBe(400);
    expect(codeOf(await hide(system, { expected_version: 7 })).code).toBe('VERSION_CONFLICT');
    expect((await page()).summary).toMatchObject({ count: 2 });

    const key = randomUUID();
    const hidden = data(await hide(handler, { reason_note: 'Nhầm đơn của khách khác' }, key));
    expect(hidden).toMatchObject({ visibility: 'HIDDEN', stars: 1, comment: 'Đồ ăn tệ, giao hàng quá lâu', version: 2 });
    expect((await hide(handler, { reason_note: 'Nhầm đơn của khách khác' }, key)).status).toBe(200);
    expect(hidden.moderations).toHaveLength(1);
    expect(codeOf(await hide(system, { expected_version: 2 })).code).toBe('ADMIN_ACTION_NOT_ALLOWED');
    // A hidden rating counts for nothing: not in the list, not in the average, not in the count; the customer's own record and the original text remain.
    expect((await page()).summary).toMatchObject({ average: 5, count: 1 });
    expect(((await page()).items as Json[]).map((r) => r.stars)).toEqual([5]);
    expect(((await q('SELECT stars, comment, visibility FROM app.reviews WHERE review_id = $1::uuid', [id]))[0])).toEqual({ stars: 1, comment: 'Đồ ăn tệ, giao hàng quá lâu', visibility: 'HIDDEN' });
    expect(((dataOf(await w.asShop('GET', '/shop/me/reviews')) as Json).items as Json[]).map((r) => r.review_id)).not.toContain(id);
    expect(errorCode(await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Xin lỗi bạn' }))).toBe('REVIEW_NOT_FOUND');
    // The Administration still reads the hidden one with its history.
    expect(((data(await w.adminGet(system, '/reviews?visibility=HIDDEN')).items as Json[]).map((i) => i.review_id))).toContain(id);

    const restored = data(await w.adminPost(system, `/reviews/${id}/actions/restore`, { expected_version: 2, reason_code: 'MISTAKE_RESOLVED' }));
    expect(restored).toMatchObject({ visibility: 'VISIBLE', version: 3 });
    expect((restored.moderations as Json[]).map((m) => [m.action, m.reason_code])).toEqual([['HIDE', 'WRONG_ORDER'], ['RESTORE', 'MISTAKE_RESOLVED']]);
    expect((await page()).summary).toMatchObject({ average: 3, count: 2 });
    expect(await w.count(`SELECT 1 FROM app.audit_logs WHERE resource_type = 'review' AND resource_id = $1 AND action LIKE 'admin.feedback.action.v1.%'`, [id])).toBe(2);
    // No way to edit stars or text, or to delete: no such action, and the database refuses.
    expect(codeOf(await w.adminPost(system, `/reviews/${id}/actions/edit`, { expected_version: 3, stars: 5 })).status).toBe(400);
    await expect(w.app.pool.query(`UPDATE app.reviews SET stars = 5, version = version + 1 WHERE review_id = $1::uuid`, [id])).rejects.toThrow(/REVIEW_IMMUTABLE/);
  });

  // ---- outcome adjustments -------------------------------------------------------------------------------------------------------------

  it('a wrong result is corrected by a row that points at the original; the delivery, its capture and the wallet stay as they were; it shows in the history; once only', async () => {
    const deliveryId = await w.completed(shipper);
    const c = await file({ category: 'DELIVERY_RESULT', body: 'Đơn báo giao thành công nhưng tôi chưa nhận được hàng' }, deliveryId);
    const before = { wallet: await w.wallet(shipper), ledger: await w.ledgerCount(shipper), delivery: (await q('SELECT state, version, ended_at FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId]))[0], assignment: (await q('SELECT status, version FROM app.delivery_assignments WHERE delivery_id = $1::uuid', [deliveryId])), hold: (await q('SELECT h.status FROM app.wallet_holds h JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id WHERE a.delivery_id = $1::uuid', [deliveryId])) };
    // Not before the file is being handled; not the same result; not without a reason.
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: c.version, corrected_result: 'NOT_DELIVERED', reason: 'x', history_reviewed: false })).code).toBe('ADMIN_ACTION_NOT_ALLOWED');
    await act(system, c.id, 'receive', { expected_version: c.version });
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), corrected_result: 'DELIVERED', reason: 'x', history_reviewed: false })).code).toBe('ADMIN_ACTION_NOT_ALLOWED');
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), corrected_result: 'NOT_DELIVERED', reason: '', history_reviewed: false })).status).toBe(400);
    expect(codeOf(await act(viewer, c.id, 'adjust-result', { expected_version: await versionOf(c.id), corrected_result: 'NOT_DELIVERED', reason: 'x', history_reviewed: false })).code).toBe('ADMIN_FORBIDDEN');
    const key = randomUUID();
    const payload = { corrected_result: 'NOT_DELIVERED', reason: 'Khách xác nhận chưa nhận; shipper không có bằng chứng', history_reviewed: false };
    const v = await versionOf(c.id);
    const adjusted = data(await act(system, c.id, 'adjust-result', { expected_version: v, ...payload }, key));
    expect((adjusted.adjustments as Json[])).toHaveLength(1);
    expect((adjusted.adjustments as Json[])[0]).toMatchObject({ kind: 'DELIVERY_RESULT', original_state: 'completed', original_assignment_status: 'COMPLETED', corrected_result: 'NOT_DELIVERED', status: 'RECORDED', successor_delivery_ids: [] });
    expect((await act(system, c.id, 'adjust-result', { expected_version: v, ...payload }, key)).status).toBe(200);
    expect(await w.count('SELECT 1 FROM app.complaint_adjustments WHERE complaint_id = $1::uuid', [c.id])).toBe(1);
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), ...payload })).code).toBe('COMPLAINT_STATE_CONFLICT');
    expect((await detail(system, c.id)).can).not.toContain('adjust-result');
    // The original result stands: no second completion, no second capture, the Order and the hold untouched.
    expect({ wallet: await w.wallet(shipper), ledger: await w.ledgerCount(shipper), delivery: (await q('SELECT state, version, ended_at FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId]))[0], assignment: (await q('SELECT status, version FROM app.delivery_assignments WHERE delivery_id = $1::uuid', [deliveryId])), hold: (await q('SELECT h.status FROM app.wallet_holds h JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id WHERE a.delivery_id = $1::uuid', [deliveryId])) }).toEqual(before);
    expect(await w.count(`SELECT 1 FROM app.wallet_ledger_entries l JOIN app.wallet_holds h ON h.wallet_id = l.wallet_id WHERE h.commission_assignment_id IN (SELECT assignment_id FROM app.delivery_assignments WHERE delivery_id = $1::uuid) AND l.delta_vnd < 0`, [deliveryId])).toBe(1);
    // It shows on the delivery's own history, for the Administration and for the shop.
    const events = await q(`SELECT note FROM app.delivery_events WHERE delivery_id = $1::uuid AND event_type = 'delivery.result_adjusted'`, [deliveryId]);
    expect(events).toHaveLength(1);
    expect(String(events[0]?.note)).toContain(c.code);
    expect(JSON.stringify(((await detail(system, c.id)).delivery as Json).timeline)).toContain('delivery.result_adjusted');
    expect(JSON.stringify(dataOf(await w.asShop('GET', `/shop/me/deliveries/${deliveryId}`)))).toContain('delivery.result_adjusted');
    // The complaint's own conclusion is a separate step: the adjustment did not close or resolve anything.
    expect((await detail(system, c.id)).complaint).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('with a later delivery in the chain the whole history must have been reviewed first; the later delivery is never changed', async () => {
    const first = await w.failed(shipper);
    const recalled = await w.asShop('POST', `/shop/me/deliveries/${first}/recall`, {});
    // The goods must be back before a new call; settle custody the way the shop does, then call again.
    if (recalled.status !== 201) {
      expect((await w.asShop('POST', `/shop/me/deliveries/${first}/custody`, { resolution: 'RETURNED_TO_SHOP', expected_version: 1 })).status).toBeGreaterThanOrEqual(200);
    }
    const c = await file({ category: 'DELIVERY_RESULT', body: 'Kết quả sai' }, first);
    await act(system, c.id, 'receive', { expected_version: c.version });
    let successors = await q('SELECT delivery_id FROM app.deliveries WHERE previous_delivery_id = $1::uuid', [first]);
    if (successors.length === 0) {
      // Test-only: the chain of a later call (the shop's own recall route needs the goods settled first).
      await w.app.pool.query(`UPDATE app.delivery_incidents SET status = 'CLOSED', custody = 'SHOP', closed_at = now(), closed_by = $2::uuid, version = version + 1 WHERE delivery_id = $1::uuid AND status = 'OPEN'`, [first, w.shop.userId]);
      const again = await w.asShop('POST', `/shop/me/deliveries/${first}/recall`, {});
      expect([again.status, again.text.slice(0, 200)]).toEqual([201, again.text.slice(0, 200)]);
      successors = await q('SELECT delivery_id FROM app.deliveries WHERE previous_delivery_id = $1::uuid', [first]);
    }
    expect(successors).toHaveLength(1);
    const next = String(successors[0]?.delivery_id);
    const nextBefore = (await q('SELECT state, version FROM app.deliveries WHERE delivery_id = $1::uuid', [next]))[0];
    const payload = { corrected_result: 'DELIVERED', reason: 'Có bằng chứng giao tận tay', history_reviewed: false };
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), ...payload })).code).toBe('ADJUSTMENT_HISTORY_REVIEW_REQUIRED');
    expect(await w.count('SELECT 1 FROM app.complaint_adjustments WHERE complaint_id = $1::uuid', [c.id])).toBe(0);
    const ok = data(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), ...payload, history_reviewed: true }));
    expect(((ok.adjustments as Json[])[0] as Json).successor_delivery_ids).toEqual([next]);
    expect(((await detail(system, c.id)).chain as Json[]).map((d) => d.delivery_id)).toEqual([first, next]);
    expect((await q('SELECT state, version FROM app.deliveries WHERE delivery_id = $1::uuid', [next]))[0]).toEqual(nextBefore);
    expect((await q('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [first]))[0]?.state).toBe('failed');
  });

  it('a delivery that did not end, or a complaint with no delivery, cannot be adjusted', async () => {
    const running = (await w.deliver(shipper)).id;
    const c = await file({ category: 'DELIVERY_RESULT', body: 'Đang giao' }, running);
    await act(system, c.id, 'receive', { expected_version: c.version });
    expect(codeOf(await act(system, c.id, 'adjust-result', { expected_version: await versionOf(c.id), corrected_result: 'NOT_DELIVERED', reason: 'x', history_reviewed: false })).code).toBe('ADMIN_ACTION_NOT_ALLOWED');
    expect((await detail(system, c.id)).can).not.toContain('adjust-result');
    expect(await w.count('SELECT 1 FROM app.complaint_adjustments WHERE complaint_id = $1::uuid', [c.id])).toBe(0);
  });

  it('the money part: the right to handle complaints is not the money right; M04 answers decide the status; the wallet is never written here', async () => {
    const finance = w.finance;
    if (finance === undefined) {
      throw new Error('the world has no M04 stand-in');
    }
    const run = async (answer: Json, over: Json = {}, who: AdminLogin = system): Promise<{ id: string; res: AdminResponse }> => {
      const deliveryId = await w.completed(shipper);
      const c = await file({ category: 'MONEY_FEE', body: 'Hoa hồng sai' }, deliveryId);
      await act(system, c.id, 'receive', { expected_version: c.version });
      finance.answer = answer as never;
      return { id: c.id, res: await act(who, c.id, 'adjust-commission', { expected_version: await versionOf(c.id), direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, reason: 'Hoàn hoa hồng', history_reviewed: false, ...over }) };
    };
    const walletBefore = await w.wallet(shipper);
    const ledgerBefore = await w.ledgerCount(shipper);
    // Handling is not enough.
    const refused = await run({ kind: 'POSTED' }, {}, handler);
    expect(codeOf(refused.res)).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(await w.count('SELECT 1 FROM app.complaint_adjustments WHERE complaint_id = $1::uuid', [refused.id])).toBe(0);
    expect((await detail(handler, refused.id)).can).not.toContain('adjust-commission');
    expect((await detail(handler, refused.id)).finance).toMatchObject({ allowed: false });
    expect(finance.requests).toHaveLength(0);
    // SYSTEM holds the right: M04 says no balance -> waiting for finance, with the reason; nothing is invented.
    const lacking = await run({ kind: 'INSUFFICIENT_BALANCE' });
    expect(((data(lacking.res).adjustments as Json[])[0] as Json)).toMatchObject({ kind: 'COMMISSION', direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, status: 'PENDING_FINANCE', pending_reason: 'INSUFFICIENT_BALANCE', original_assignment_status: 'COMPLETED' });
    const unavailable = await run({ kind: 'UNAVAILABLE' }, { direction: 'CHARGE_TO_SHIPPER' });
    expect(((data(unavailable.res).adjustments as Json[])[0] as Json)).toMatchObject({ status: 'PENDING_FINANCE', pending_reason: 'M04_UNAVAILABLE' });
    const posted = await run({ kind: 'POSTED' });
    expect(((data(posted.res).adjustments as Json[])[0] as Json)).toMatchObject({ status: 'EXECUTED', pending_reason: null });
    expect(finance.requests).toHaveLength(3);
    expect(finance.requests[0]).toMatchObject({ driverId: shipper.driverId, amountVnd: 1000, actorUserId: system.userId });
    // M11 itself never writes the wallet or the ledger: the only movements are the four commissions captured by the four deliveries this test completed.
    expect(await w.wallet(shipper)).toEqual({ balance: walletBefore.balance - 4000, held: walletBefore.held });
    expect(await w.ledgerCount(shipper)).toBe(ledgerBefore + 4);
  });

  it('an administrator who was granted the money right can request it; revoking it closes the door again', async () => {
    const finance = w.finance;
    if (finance === undefined) {
      throw new Error('the world has no M04 stand-in');
    }
    const money = await w.adminWith('DRIVER', { review: true });
    await w.app.pool.query(
      `INSERT INTO app.admin_finance_grants (user_id, permission_key, state, granted_by_user_id, granted_at, version, created_at, updated_at) VALUES ($1::uuid, 'wallet.adjustment.post', 'GRANTED', $2::uuid, now(), 1, now(), now())`,
      [money.userId, system.userId],
    );
    finance.answer = { kind: 'POSTED' };
    const deliveryId = await w.completed(shipper);
    const c = await file({ category: 'MONEY_FEE', body: 'Hoa hồng' }, deliveryId);
    await act(system, c.id, 'receive', { expected_version: c.version });
    expect((await detail(money, c.id)).can).toContain('adjust-commission');
    const ok = await act(money, c.id, 'adjust-commission', { expected_version: await versionOf(c.id), direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, reason: 'Hoàn', history_reviewed: false });
    expect(ok.status).toBe(200);
    await w.app.pool.query(`UPDATE app.admin_finance_grants SET state = 'REVOKED', revoked_by_user_id = granted_by_user_id, revoked_at = now(), version = version + 1, updated_at = now() WHERE user_id = $1::uuid AND permission_key = 'wallet.adjustment.post'`, [money.userId]);
    const second = await file({ category: 'MONEY_FEE', body: 'Lại' }, await w.completed(shipper));
    await act(system, second.id, 'receive', { expected_version: second.version });
    expect(codeOf(await act(money, second.id, 'adjust-commission', { expected_version: await versionOf(second.id), direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, reason: 'Hoàn', history_reviewed: false })).code).toBe('ADMIN_FORBIDDEN');
  });

  // ---- M08 notifications --------------------------------------------------------------------------------------------------------------

  it('M08: the shop gets ONE reminder to rate a finished delivery; the Administration\'s steps notify the right people; opening re-checks the right', async () => {
    await w.shopFoodToken();
    const deliveryId = await w.completed(shipper);
    await w.dispatch();
    await w.dispatch();
    const reminders = ((await w.inbox(await w.shopFoodToken())).filter((n) => n.kind === 'REVIEW_REMINDER' && (n.target as Json).id === deliveryId));
    expect(reminders).toHaveLength(1);
    expect(JSON.stringify(reminders[0])).not.toMatch(/\+84|địa chỉ/);
    // Rating is optional: the reminder is not a gate.
    expect(await w.count(`SELECT 1 FROM app.reviews WHERE delivery_id = $1::uuid`, [deliveryId])).toBe(0);

    const c = await file({ category: 'SERVICE', body: 'Thái độ shipper' }, deliveryId);
    await w.dispatch();
    expect((await w.inbox(await w.shopFoodToken())).filter((n) => n.kind === 'COMPLAINT_UPDATED' && (n.target as Json).id === c.id)).toHaveLength(0);
    await act(system, c.id, 'receive', { expected_version: c.version });
    await act(system, c.id, 'request-info', { expected_version: await versionOf(c.id), from: 'SHIPPER', body: 'Giải trình giúp' });
    await w.dispatch();
    const shopCards = (await w.inbox(await w.shopFoodToken())).filter((n) => n.kind === 'COMPLAINT_UPDATED' && (n.target as Json).id === c.id);
    expect(shopCards.map((n) => n.title)).toEqual(['Phản ánh đã được tiếp nhận']);
    const shipperCards = (await w.inbox(shipper.token, 'SHIP')).filter((n) => n.kind === 'COMPLAINT_UPDATED' && (n.target as Json).id === c.id);
    expect(shipperCards.map((n) => n.title)).toEqual(['Cần bạn giải trình']);
    expect(JSON.stringify([...shopCards, ...shipperCards])).not.toMatch(/Thái độ shipper|Giải trình giúp/);
    const opened = dataOf(await w.asShipper(shipper, 'POST', `/notifications/${shipperCards[0]?.notification_id}/open`, {})) as Json;
    expect(opened).toMatchObject({ outcome: 'OK', target: { type: 'COMPLAINT', id: c.id }, object_state: 'AWAITING_INFO' });
    await act(system, c.id, 'conclude', { expected_version: await versionOf(c.id), conclusion: 'Đã xong' });
    await w.dispatch();
    expect(((await w.inbox(shipper.token, 'SHIP')).filter((n) => n.kind === 'COMPLAINT_UPDATED' && (n.target as Json).id === c.id)).map((n) => n.title).sort()).toEqual(['Cần bạn giải trình', 'Phản ánh liên quan đã có kết luận']);
    // The submitter is told of the conclusion; a stranger opening the same id gets nothing.
    expect(((await w.inbox(await w.shopFoodToken())).filter((n) => n.kind === 'COMPLAINT_UPDATED' && (n.target as Json).id === c.id)).map((n) => n.title).sort()).toEqual(['Phản ánh đã có kết quả', 'Phản ánh đã được tiếp nhận']);
    const stranger = await w.newShipper();
    expect(errorCode(await w.asShipper(stranger, 'POST', `/notifications/${shipperCards[0]?.notification_id}/open`, {}))).toBe('NOTIFICATION_NOT_FOUND');
  });
});
