// The public page /delete-account (P5-6a, Owner decision OD-26): the web way to ask for the deletion of an 11Food / 11Ship account.
// Same origin as the API (its script posts to a RELATIVE path, so no host name is written anywhere), no inline script or style (the page's CSP
// allows only its own two files), the three assets are plain strings so nothing depends on a file or a build step on the server.
//
// Authentication is phone + CURRENT password only (no separate OTP). The consequences are shown BEFORE the confirm button and the button stays
// disabled until the person ticks that they understood them. There is no cancel after the confirmation (OD-26).

export const DELETE_ACCOUNT_PAGE_PATH = 'delete-account';
export const DELETE_ACCOUNT_CONFIRM_PATH = '/v1/account-deletion/confirm';

/** The page's own security headers. Everything it loads comes from its own origin; it can talk only to its own API. */
export const DELETE_ACCOUNT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
});

export const DELETE_ACCOUNT_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Xóa tài khoản 11Ship / 11Food</title>
<link rel="stylesheet" href="/delete-account/app.css">
</head>
<body>
<main>
<h1>Xóa tài khoản 11Ship / 11Food</h1>
<p>Trang này dành cho chủ tài khoản muốn xóa tài khoản của mình trên ứng dụng 11Food (khách hàng, quán) hoặc 11Ship (shipper).</p>

<section class="warn" aria-labelledby="warn-title">
<h2 id="warn-title">Hậu quả khi bạn xác nhận</h2>
<ul>
<li><strong>Không thể hủy sau khi xác nhận.</strong> Không có nút hoàn tác.</li>
<li>Bạn bị đăng xuất khỏi mọi thiết bị và không đăng nhập lại được bằng tài khoản này.</li>
<li>Nếu tài khoản <strong>chưa có dữ liệu nào phải lưu</strong> (đơn hàng, chuyến giao, ví, giao dịch, đánh giá, khiếu nại, quán, hồ sơ shipper), tài khoản bị <strong>xóa vĩnh viễn</strong>.</li>
<li>Nếu tài khoản <strong>có dữ liệu phải lưu</strong>, dữ liệu đó <strong>vẫn được giữ lại</strong> theo quy định và tài khoản bị <strong>khóa</strong> thay vì xóa hẳn. Số dư ví còn lại (nếu có) là dữ liệu phải giữ, không bị xóa. Tài khoản bị khóa này có thể được khôi phục bằng mã OTP gửi về số điện thoại.</li>
<li>Nếu bạn <strong>còn đơn hoặc chuyến đang chạy</strong>: từ lúc xác nhận bạn <strong>không nhận hoặc tạo được việc mới</strong> (đặt đơn, gọi shipper, nhận chuyến, yêu cầu nạp/rút ví, quán nhận đơn mới). Bạn vẫn hoàn thành việc đang chạy. Khi hết việc đang chạy, hệ thống tự đăng xuất bạn và khóa hoặc xóa tài khoản.</li>
</ul>
</section>

<form id="form" novalidate autocomplete="off">
<label for="phone">Số điện thoại đăng ký</label>
<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="username" maxlength="20" required>
<label for="password">Mật khẩu hiện tại</label>
<input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required>
<p class="hint">Quên mật khẩu? Hãy dùng chức năng «Quên mật khẩu» (xác thực OTP) trong ứng dụng, sau đó quay lại trang này.</p>
<label class="check"><input id="ack" type="checkbox"> Tôi đã đọc và hiểu các hậu quả ở trên và đồng ý xóa tài khoản này.</label>
<button id="submit" type="submit" disabled>Xác nhận xóa tài khoản</button>
</form>

<p id="result" role="status" aria-live="polite" hidden></p>
<noscript><p>Trang này cần bật JavaScript để gửi yêu cầu.</p></noscript>
</main>
<script src="/delete-account/app.js"></script>
</body>
</html>
`;

export const DELETE_ACCOUNT_CSS = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1b1f; --muted: #5d5d66; --warn-bg: #fff4e5; --warn-bd: #e08a00; --btn: #b3261e; --btn-fg: #ffffff; --bd: #8d8d96; --ok: #146c2e; }
@media (prefers-color-scheme: dark) { :root { --bg: #121214; --fg: #ececf1; --muted: #a6a6b0; --warn-bg: #2a2012; --warn-bd: #e0a040; --btn: #ff8a80; --btn-fg: #1b1b1f; --bd: #6b6b75; --ok: #7bd88f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
h2 { font-size: 1.1rem; margin: 0 0 8px; }
.warn { background: var(--warn-bg); border: 1px solid var(--warn-bd); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
.warn ul { margin: 0; padding-left: 20px; }
.warn li { margin: 6px 0; }
label { display: block; margin: 16px 0 4px; font-weight: 600; }
input[type="tel"], input[type="password"] { width: 100%; padding: 10px 12px; font-size: 1rem; border: 1px solid var(--bd); border-radius: 6px; background: var(--bg); color: var(--fg); }
.check { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; margin-top: 20px; }
.check input { margin-top: 4px; width: 20px; height: 20px; flex: none; }
.hint { color: var(--muted); font-size: 0.9rem; margin: 8px 0 0; }
button { margin-top: 20px; width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; border: 0; border-radius: 6px; background: var(--btn); color: var(--btn-fg); cursor: pointer; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
#result { margin-top: 20px; padding: 12px 16px; border: 1px solid var(--bd); border-radius: 8px; }
#result.ok { border-color: var(--ok); }
#result.err { border-color: var(--btn); }
`;

export const DELETE_ACCOUNT_JS = `(function () {
  'use strict';
  var form = document.getElementById('form');
  var phone = document.getElementById('phone');
  var password = document.getElementById('password');
  var ack = document.getElementById('ack');
  var submit = document.getElementById('submit');
  var result = document.getElementById('result');
  var key = null;
  var keyFor = '';
  var sending = false;

  function newKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') { return window.crypto.randomUUID(); }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (b) { return (b + 256).toString(16).slice(1); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function show(kind, text) {
    result.hidden = false;
    result.className = kind;
    result.textContent = text;
  }

  function sync() {
    submit.disabled = sending || !ack.checked || phone.value.trim() === '' || password.value === '';
  }

  var MESSAGES = {
    DELETED: 'Tài khoản đã được xóa vĩnh viễn.',
    LOCKED: 'Yêu cầu đã được thực hiện: tài khoản đã bị khóa và đăng xuất khỏi mọi thiết bị. Dữ liệu bắt buộc phải lưu vẫn được giữ lại. Bạn có thể khôi phục tài khoản bằng OTP gửi về số điện thoại.',
    PENDING: 'Đã ghi nhận yêu cầu xóa tài khoản. Từ bây giờ bạn không thể nhận hoặc tạo việc mới. Hãy hoàn thành các đơn/chuyến đang chạy; khi hết việc đang chạy, hệ thống sẽ tự đăng xuất bạn và khóa hoặc xóa tài khoản. Yêu cầu này không thể hủy.'
  };

  function finish(kind, text) {
    key = null;
    password.value = '';
    sending = false;
    show(kind, text);
    sync();
  }

  [phone, password, ack].forEach(function (el) { el.addEventListener('input', sync); el.addEventListener('change', sync); });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (submit.disabled) { return; }
    sending = true;
    sync();
    // One key per attempt: a retry after a lost answer reuses it, so the request is never done twice.
    // (A retry with different typed values is a different request, so it gets a new key.)
    var fingerprint = phone.value.trim() + '|' + password.value;
    if (key === null || keyFor !== fingerprint) { key = newKey(); keyFor = fingerprint; }
    fetch('${DELETE_ACCOUNT_CONFIRM_PATH}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ phone: phone.value.trim(), password: password.value }),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (body) { return { status: response.status, body: body }; });
    }).then(function (answer) {
      if (answer.status === 200 && answer.body && answer.body.data && MESSAGES[answer.body.data.result]) {
        finish('ok', MESSAGES[answer.body.data.result]);
      } else if (answer.status === 401) {
        finish('err', 'Thông tin xác thực không đúng.');
      } else if (answer.status === 429) {
        finish('err', 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.');
      } else if (answer.status === 400) {
        finish('err', 'Số điện thoại hoặc mật khẩu không hợp lệ.');
      } else {
        // Keep the key: the request may have been done, and the same key makes a retry safe.
        sending = false;
        show('err', 'Chưa thể hoàn tất yêu cầu. Vui lòng thử lại.');
        sync();
      }
    }).catch(function () {
      sending = false;
      show('err', 'Không kết nối được. Vui lòng thử lại.');
      sync();
    });
  });
  sync();
})();
`;
