// Browser checks of the web client against the CONTRACT STUB (see stub-api.mjs). Not real-API evidence.
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright SCREENSHOT_DIR=/tmp/shots node tests/web/browser/run-browser-checks.mjs
import assert from 'node:assert/strict';
import { closeBrowser, layoutReport, login, openPage, scenario, shot, startEnvironment, summary, throwawayAccount } from './harness.mjs';

async function withEnv(fn) {
  const env = await startEnvironment();
  try {
    await fn(env);
  } finally {
    await env.close();
  }
}

function expectNoLeaks(seen, account, token) {
  for (const url of seen.urls) {
    assert.equal(url.includes(account.password), false, 'password in a URL');
    assert.equal(/access_token|password|token=/i.test(url), false, `secret-looking URL: ${url}`);
    if (token) assert.equal(url.includes(token), false, 'token in a URL');
  }
  for (const message of seen.console) {
    assert.equal(message.text.includes(account.password), false, 'password in console');
    if (token) assert.equal(message.text.includes(token), false, 'token in console');
  }
  assert.deepEqual(seen.errors, [], 'page errors');
  const csp = seen.console.filter((m) => /content security policy/i.test(m.text));
  assert.deepEqual(csp, [], 'CSP violations');
}

async function storageIsEmpty(page) {
  return page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
}

await scenario('S01 login (fixture account) -> roleless hub, test-environment and unverified-phone notices, registration hidden', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser(account);
    const { page, seen } = await openPage(env, 'desktop');
    await shot(page, 'desktop-01-login');
    assert.ok(await page.getByText('Môi trường thử nghiệm', { exact: true }).isVisible());
    assert.ok(await page.getByText('Đăng ký và xác minh SMS tạm thời chưa mở.').isVisible());
    assert.equal(await page.getByRole('link', { name: /đăng ký/i }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /đăng ký ngay|tạo tài khoản|gửi mã|otp/i }).count(), 0);
    await login(page, account);
    await page.getByRole('heading', { name: 'Hoàn tất hồ sơ' }).waitFor();
    assert.ok(await page.getByText('Tài khoản thử nghiệm — chưa xác minh SĐT', { exact: true }).isVisible());
    assert.ok(await page.getByRole('heading', { name: 'Hồ sơ Quán' }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Tạo hồ sơ quán' }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Đăng ký làm xế' }).isVisible());
    await shot(page, 'desktop-02-hub');
    // The phone number is shown masked, never whole.
    assert.equal(await page.getByText(account.phone).count(), 0);
    for (const token of env.stub.tokensOf(env.stub.user(account.phone))) expectNoLeaks(seen, account, token);
    const storage = await storageIsEmpty(page);
    assert.deepEqual({ local: storage.local, session: storage.session, cookie: storage.cookie }, { local: 0, session: 0, cookie: '' });
  });
});

await scenario('S02 wrong password: Vietnamese error, password cleared and focused, phone kept, no token', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser(account);
    const { page } = await openPage(env, 'phone');
    await login(page, { phone: account.phone, password: 'definitely-wrong-password' });
    await page.getByText('Số điện thoại hoặc mật khẩu chưa đúng.').waitFor();
    assert.equal(await page.getByLabel('Mật khẩu', { exact: false }).first().inputValue(), '');
    assert.equal(await page.getByLabel('Số điện thoại').inputValue(), account.phone);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'password');
    assert.equal(env.stub.count('POST', '/auth/login'), 1);
    await shot(page, 'phone-03-wrong-password');
  });
});

await scenario('S02b client validation blocks an empty or malformed form without calling the API', async () => {
  await withEnv(async (env) => {
    const { page } = await openPage(env, 'desktop');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByText('Số điện thoại chưa hợp lệ.').first().waitFor();
    await page.getByText('Nhập mật khẩu.').waitFor();
    assert.equal(env.stub.count('POST', '/auth/login'), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'phone');
  });
});

await scenario('S03 API unavailable: calm Vietnamese message with request id kept in details, form stays usable', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser(account);
    const { page } = await openPage(env, 'desktop');
    env.stub.faults.failBefore.add('POST /v1/auth/login');
    await login(page, account);
    await page.getByText('Hệ thống tạm thời chưa nhận được yêu cầu này').or(page.getByText('Chưa xác định được yêu cầu')).waitFor();
    await page.getByText('Chi tiết lỗi').click();
    assert.ok(await page.getByText(/Mã yêu cầu: [0-9a-f-]{36}/).isVisible());
    await login(page, account); // retry works
    await page.getByRole('heading', { name: 'Hoàn tất hồ sơ' }).waitFor();
  });
});

await scenario('S04 DRIVER onboarding: double click sends ONE request; PENDING shown; role select; home shows waiting-for-approval', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    const { page } = await openPage(env, 'phone');
    await login(page, account);
    await page.getByRole('button', { name: 'Đăng ký làm xế' }).click();
    await page.getByRole('heading', { name: 'Hồ sơ Xế' }).waitFor();
    await page.getByRole('button', { name: 'Gửi hồ sơ xế' }).click(); // empty -> validation, no call
    await page.getByText('Nhập họ tên.').waitFor();
    assert.equal(env.stub.count('POST', '/onboarding/driver'), 0);
    await page.getByLabel('Họ và tên').fill('  Nguyễn Văn Xế ');
    await page.getByLabel('Biển số xe').fill('11A-123.45');
    env.stub.faults.delayMs.set('POST /v1/onboarding/driver', 400);
    const submit = page.getByRole('button', { name: 'Gửi hồ sơ xế' });
    await submit.dblclick();
    await submit.click({ force: true }).catch(() => {});
    await page.locator('#main').getByText('Đã gửi hồ sơ xế').waitFor();
    assert.equal(env.stub.count('POST', '/onboarding/driver'), 1, 'double submit must reach the server once');
    assert.equal(user.driver.full_name, 'Nguyễn Văn Xế');
    assert.ok(await page.getByText('Chờ vận hành duyệt').first().isVisible());
    await shot(page, 'phone-04-driver-pending');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByRole('heading', { name: 'Chọn vai trò' }).waitFor();
    assert.ok(await page.getByText('Chờ vận hành duyệt').first().isVisible());
    await page.getByRole('button', { name: /^Xế/ }).click();
    await page.getByRole('heading', { name: 'Xế 11Ship' }).waitFor();
    assert.ok(await page.getByText('Hồ sơ đang chờ vận hành duyệt. Bạn chưa nhận đơn được cho tới khi được duyệt.').isVisible());
    assert.equal(await page.getByRole('button', { name: /nhận đơn/i }).count(), 0, 'no fake accept-delivery control');
    assert.equal(env.stub.sessionsOf(user)[0].activeRole, 'DRIVER');
    await shot(page, 'phone-05-driver-home');
  });
});

await scenario('S05 SHOP onboarding: validation, draft save, completion gated by GPS + service area, confirm, role select, home', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    const areaId = env.stub.addArea('ACTIVE');
    const { page } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('button', { name: 'Tạo hồ sơ quán' }).click();
    await page.getByRole('heading', { name: 'Hồ sơ Quán' }).waitFor();
    await page.getByText('Hồ sơ chưa được lưu.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Hoàn tất hồ sơ quán' }).getAttribute('aria-disabled'), 'true');
    await page.getByRole('button', { name: 'Lưu nháp' }).click(); // empty -> validation
    await page.getByText('Nhập tên quán.').waitFor();
    assert.equal(env.stub.count('PUT', '/onboarding/shop/profile'), 0);
    await shot(page, 'desktop-06-shop-validation');

    await page.getByLabel('Tên quán').fill('Quán Cô Ba');
    await page.getByLabel('Số điện thoại liên hệ').fill('0912 345 678');
    await page.getByLabel('Địa chỉ lấy hàng').fill('12 Phố Xanh, Cao Bằng');
    await page.getByRole('button', { name: 'Lưu nháp' }).click();
    await page.locator('#main').getByText('Đã lưu nháp hồ sơ quán.').waitFor();
    assert.equal(user.shop.version, 1);
    assert.equal(user.shop.contact_phone, '+84912345678');
    assert.ok(await page.getByText('Vị trí lấy hàng (GPS) — còn thiếu').isVisible());
    assert.ok(await page.getByText('Khu vực phục vụ — còn thiếu').isVisible());
    assert.equal(await page.getByRole('button', { name: 'Hoàn tất hồ sơ quán' }).getAttribute('aria-disabled'), 'true');
    await shot(page, 'desktop-07-shop-draft');

    await page.getByLabel('Vĩ độ').fill('22,6657');
    await page.getByLabel('Kinh độ').fill('106.2522');
    await page.getByLabel('Mã khu vực phục vụ').fill(areaId);
    // Unsaved edits: completion stays blocked and says why.
    await page.getByText('Bạn có thay đổi chưa lưu.').waitFor();
    await page.getByRole('button', { name: 'Lưu nháp' }).click();
    // The first save's notice is still on screen, so wait for the completion button itself to become available.
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Hoàn tất hồ sơ quán'));
      return button !== undefined && !button.hasAttribute('aria-disabled');
    });
    assert.equal(user.shop.version, 2);

    await page.getByRole('button', { name: 'Hoàn tất hồ sơ quán' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Quay lại' }).click(); // Escape/cancel path: nothing is sent
    assert.equal(env.stub.count('POST', '/onboarding/shop/complete'), 0);
    await page.getByRole('button', { name: 'Hoàn tất hồ sơ quán' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Hoàn tất hồ sơ', exact: true }).click();
    await page.locator('#main').getByText('Đã hoàn tất hồ sơ quán').first().waitFor();
    assert.equal(user.shop.status, 'ACTIVE');
    assert.ok(user.roles.has('SHOP'));
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByRole('heading', { name: 'Chọn vai trò' }).waitFor();
    assert.ok(await page.getByText('Chỉ một phiên Quán hoạt động cùng lúc', { exact: false }).isVisible());
    await page.getByRole('button', { name: /^Quán/ }).click();
    await page.getByRole('heading', { name: 'Quán của bạn' }).waitFor();
    await page.getByText('Quán Cô Ba').waitFor();
    assert.ok(await page.getByText('Đã hoàn tất').first().isVisible());
    assert.equal(env.stub.sessionsOf(user)[0].activeRole, 'SHOP');
    await shot(page, 'desktop-08-shop-home');
  });
});

await scenario('S06 lost response after commit: UNKNOWN panel, Retry resends the SAME key and body, server has ONE profile', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    const { page } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('button', { name: 'Đăng ký làm xế' }).click();
    await page.getByLabel('Họ và tên').fill('Trần Thị Xế');
    env.stub.faults.dropAfterCommit.add('POST /v1/onboarding/driver');
    await page.getByRole('button', { name: 'Gửi hồ sơ xế' }).click();
    await page.getByText('Chưa biết hồ sơ đã được gửi hay chưa').waitFor();
    assert.ok(user.driver !== null, 'the stub committed before dropping the answer');
    await shot(page, 'desktop-09-unknown');
    assert.equal(await page.getByLabel('Họ và tên').isDisabled(), true, 'form is locked while the outcome is unknown');
    await page.getByRole('button', { name: 'Thử lại (giữ nguyên nội dung)' }).click();
    await page.locator('#main').getByText('Đã gửi hồ sơ xế').waitFor();
    const posts = env.stub.calls.filter((c) => c.method === 'POST' && c.path === '/onboarding/driver');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].key, posts[1].key);
    assert.deepEqual(posts[0].body, posts[1].body);
    assert.equal(user.roles.has('DRIVER'), true);
  });
});

await scenario('S06b unknown outcome then "check server": driver exists -> status shown, nothing sent twice', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser(account);
    const { page } = await openPage(env, 'phone');
    await login(page, account);
    await page.getByRole('button', { name: 'Đăng ký làm xế' }).click();
    await page.getByLabel('Họ và tên').fill('Lê Xế');
    env.stub.faults.dropAfterCommit.add('POST /v1/onboarding/driver');
    await page.getByRole('button', { name: 'Gửi hồ sơ xế' }).click();
    await page.getByText('Chưa biết hồ sơ đã được gửi hay chưa').waitFor();
    await page.getByRole('button', { name: 'Kiểm tra lại từ máy chủ' }).click();
    await page.getByText('Máy chủ đã có hồ sơ xế của bạn.').waitFor();
    assert.equal(env.stub.count('POST', '/onboarding/driver'), 1);
  });
});

await scenario('S07 session revoked by a SHOP selection elsewhere: next call returns to login with the reason', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    env.stub.addArea('ACTIVE');
    user.shop = { shop_id: 'x', name: 'Q', contact_phone: '+84900000000', zalo: null, facebook: null, address_text: 'a', pickup_lat: 1, pickup_lng: 1, service_area_id: null, status: 'ACTIVE', accepting_orders: false, version: 2 };
    user.roles.add('SHOP');
    user.roles.add('DRIVER');
    user.driver = { driver_id: 'd', full_name: 'Xế', plate_number: null, status: 'ACTIVE' };
    const { page } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('heading', { name: 'Chọn vai trò' }).waitFor();
    await page.getByRole('button', { name: /^Quán/ }).click();
    await page.getByRole('heading', { name: 'Quán của bạn' }).waitFor();
    // Another device logs in and selects SHOP: this tab's session is revoked server side.
    const other = env.stub.login(account.phone, account.password);
    env.stub.selectRoleDirect(other, 'SHOP');
    await page.getByRole('button', { name: 'Đổi vai trò' }).click();
    await page.getByRole('heading', { name: 'Chọn vai trò' }).waitFor();
    await page.getByRole('button', { name: /^Xế/ }).click();
    await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
    await page.locator('#main [role="alert"], #main [role="status"]').first().waitFor();
  });
});

await scenario('S07b revoked/expired session during a screen action -> login screen with notice, memory forgotten', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    const { page, seen } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('button', { name: 'Đăng ký làm xế' }).click();
    await page.getByLabel('Họ và tên').fill('Phạm Xế');
    // Expire every live session of the user on the server, then act.
    for (const s of env.stub.sessionsOf(user)) s.expired = true;
    await page.getByRole('button', { name: 'Gửi hồ sơ xế' }).click();
    await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
    await page.getByText('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.').waitFor();
    assert.equal(user.driver, null, 'nothing was committed');
    assert.equal(await page.getByLabel('Mật khẩu', { exact: false }).first().inputValue(), '');
    for (const token of env.stub.tokensOf(user)) expectNoLeaks(seen, account, token);
  });
});

await scenario('S08 reload returns to login (token lives in memory only); storage and cookies stay empty', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser(account);
    const { page } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('heading', { name: 'Hoàn tất hồ sơ' }).waitFor();
    assert.deepEqual(await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length, c: document.cookie })), { l: 0, s: 0, c: '' });
    await page.reload();
    await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
    assert.equal(await page.getByLabel('Số điện thoại').inputValue(), '');
  });
});

await scenario('S09 disabled account: typed refusal screen, no retry loop', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    env.stub.addUser({ ...account, status: 'DISABLED' });
    const { page } = await openPage(env, 'desktop');
    await login(page, account);
    await page.getByRole('heading', { name: 'Tài khoản đang bị khóa' }).waitFor();
    assert.ok(await page.getByText('Liên hệ đội vận hành 11Ship').isVisible());
    await page.getByRole('button', { name: 'Về đăng nhập' }).click();
    await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
    assert.equal(env.stub.count('GET', '/auth/me'), 0);
  });
});

await scenario('S10 a late answer of an older session never changes the screen (stale generation)', async () => {
  await withEnv(async (env) => {
    const account = throwawayAccount();
    const user = env.stub.addUser(account);
    user.driver = { driver_id: 'd', full_name: 'X', plate_number: null, status: 'PENDING' };
    user.roles.add('DRIVER');
    const { page } = await openPage(env, 'phone');
    await login(page, account);
    await page.getByRole('heading', { name: 'Chọn vai trò' }).waitFor();
    env.stub.faults.delayMs.set('POST /v1/auth/role/select', 900);
    await page.getByRole('button', { name: /^Xế/ }).click();
    // While the answer is on its way the person clears the browser session.
    await page.getByRole('button', { name: 'Xóa phiên trên trình duyệt' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa phiên' }).click();
    await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).waitFor();
    await page.waitForTimeout(1400); // the late 200 arrives now
    assert.ok(await page.getByRole('heading', { name: 'Đăng nhập 11Ship' }).isVisible(), 'must stay on login');
    assert.equal(await page.getByRole('heading', { name: 'Xế 11Ship' }).count(), 0);
  });
});

await scenario('S11 layout on desktop and phone: no sideways scroll, controls >= 44px, labelled fields, one h1', async () => {
  for (const profile of ['desktop', 'phone']) {
    await withEnv(async (env) => {
      const account = throwawayAccount();
      const user = env.stub.addUser(account);
      const areaId = env.stub.addArea('ACTIVE');
      void areaId;
      const { page } = await openPage(env, profile);
      const checks = [];
      checks.push(['login', await layoutReport(page)]);
      await shot(page, `${profile}-10-login-layout`);
      await login(page, account);
      await page.getByRole('heading', { name: 'Hoàn tất hồ sơ' }).waitFor();
      checks.push(['hub', await layoutReport(page)]);
      await shot(page, `${profile}-11-hub-layout`);
      await page.getByRole('button', { name: 'Tạo hồ sơ quán' }).click();
      await page.getByRole('heading', { name: 'Hồ sơ Quán' }).waitFor();
      await page.getByText('Điều kiện để hoàn tất').waitFor();
      checks.push(['shop-form', await layoutReport(page)]);
      await shot(page, `${profile}-12-shop-form-layout`);
      void user;
      for (const [name, report] of checks) {
        assert.equal(report.overflowX <= 0, true, `${profile}/${name}: horizontal overflow ${report.overflowX}px`);
        assert.deepEqual(report.small, [], `${profile}/${name}: controls under 44px`);
        assert.equal(report.unlabeled, 0, `${profile}/${name}: unlabeled fields`);
        assert.equal(report.lang, 'vi');
        assert.equal(report.h1, 1, `${profile}/${name}: exactly one h1`);
      }
    });
  }
});

await closeBrowser();
const ok = summary();
process.exit(ok ? 0 : 1);
