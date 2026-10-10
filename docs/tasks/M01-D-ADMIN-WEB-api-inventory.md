# M01-D-ADMIN-WEB — kiểm kê API thật (client chỉ dùng những gì có ở đây)

Nguồn: code tại head PR #45 `f37c1ad6ad5a5b2e7a6cadabe12f13c02f0ace10` (controller, `*-validation.ts`, `*-views.ts`, `app-errors.ts`,
`error-envelope.ts`), đối chiếu hợp đồng 1B (`M01-D-ADMIN-1B-technical-contract.md`) và 1C (`M01-D-ADMIN-1C-technical-contract.md`).
Không có endpoint nào dưới đây do frontend tự đặt tên; tên trường lấy từ code, không suy đoán.

## Quy ước chung (cả ba nhóm)

- Thân thành công: `{ "data": { … } }`, khóa snake_case, thời gian ISO-8601 UTC. Thân lỗi: `{ "error": { "code", "message", "request_id", "details" } }`.
  `details` chỉ có nội dung ở `ADMIN_ACTIVATION_STEP_INVALID` (trạng thái an toàn của attempt).
- Cookie HttpOnly do backend đặt (`__Host-11admin-pre`, `__Host-11admin`, `__Host-11admin-act`); frontend gửi `credentials: same-origin`, không đọc cookie.
- Mọi POST: `Origin` do trình duyệt tự gửi, phải đúng origin cấu hình; `Content-Type: application/json`. CSRF là header `x-csrf-token`.
  Ba loại token CSRF khác nhau, **không dùng chung**: PREAUTH (đăng nhập / thiết lập), SESSION (admin + `/v1/admin/*`), ACTIVATION (`/v1/admin-activation/*`).
- `Retry-After` chỉ có ở `ADMIN_AUTH_RATE_LIMITED` (429). **`OTP_RATE_LIMITED` (429) không có `Retry-After`**: thời điểm được gửi lại lấy từ `GET /v1/admin-activation/state` (`otp.resend_at`).

## 1. `/v1/admin-auth` (#34) — đăng nhập chung SYSTEM / ADMIN

| Route | Thân / header | Thành công `data` | Lỗi chính |
|---|---|---|---|
| `POST /login` | `{phone, password, device:{device_id, platform:"WEB", app:"ADMIN_WEB"}}` | `{next_step: ENROLL_TOTP\|VERIFY_TOTP, expires_at, csrf_token}` + cookie PREAUTH | 400 `INVALID_PHONE`; 401 `INVALID_CREDENTIALS`; 429 `ADMIN_AUTH_RATE_LIMITED` |
| `GET /state` | — | `{state: SESSION\|PREAUTH, next_step: null\|…, expires_at, csrf_token}` | 401 `ADMIN_PREAUTH_INVALID` / `ADMIN_SESSION_INVALID` |
| `POST /totp/enrollment` | `{}` + `x-csrf-token` (PREAUTH) | `{secret, otpauth_uri, expires_at}` | 401 `ADMIN_PREAUTH_INVALID`; 403 `ADMIN_CSRF_INVALID`; 409 `ADMIN_ENROLLMENT_NOT_ALLOWED`; 429 |
| `POST /totp/enrollment/verify` | `{code}` + CSRF PREAUTH | `{user_id, admin_role, expires_at, csrf_token}` + cookie SESSION | 400 `ADMIN_TOTP_INVALID`; 401; 403; 429 |
| `POST /totp/verify` | `{code}` + CSRF PREAUTH | như trên | như trên |
| `GET /me` | — | `{user_id, admin_role: SYSTEM\|ADMIN, expires_at, csrf_token}` (CSRF SESSION) | 401 `ADMIN_SESSION_INVALID` |
| `POST /logout` | `{}` + CSRF SESSION | 204 (không thân) | 401; 403 |

Đã có trong #35, không đổi hợp đồng.

## 2. `/v1/admin` (1B) — chỉ SYSTEM (cookie SESSION + CSRF SESSION)

POST: Origin chính xác → JSON → quota IP → parser chặt (khóa lạ ⇒ 400 `ADMIN_INPUT_INVALID`). GET: không CSRF; `Origin` tùy chọn.
Phiên ADMIN ⇒ 403 `ADMIN_FORBIDDEN`; phiên sai/hết hạn ⇒ 401 `ADMIN_SESSION_INVALID`.

| Route | Thân / header | Thành công `data` | Lỗi chính |
|---|---|---|---|
| `POST /operations` | `{action, payload}`; `action` ∈ `CREATE_INVITATION` `{full_name, phone, note?, permissions}`, `REISSUE_INVITATION` `{invitation_id, expected_version, reason, permissions?}`, `REVOKE_INVITATION` `{invitation_id, expected_version, reason}` | 201 `{operation_id, action, status:"PENDING", expires_at}` (sống 120 s; thay operation cũ của SYSTEM) | 400 `ADMIN_INPUT_INVALID`; 404 `ADMIN_INVITATION_NOT_FOUND`; 409 `ADMIN_VERSION_CONFLICT` / `ADMIN_INVITATION_NOT_PENDING` / `ADMIN_INVITATION_PENDING_EXISTS` / `ADMIN_PHONE_CONFLICT`; 429 |
| `POST /operations/:id/verify` | `{code}` (6 số TOTP mới) | 200 `{operation_id, status:"VERIFIED", expires_at}` | 400 `ADMIN_TOTP_INVALID`; 403 `ADMIN_STEP_UP_REQUIRED` (một mã cho mọi lý do, không đếm); 429 + `Retry-After` |
| `GET /operations/:id` | — | `{operation_id, action, status, expires_at, expired, verifiable, usable, attempts_remaining, verified_at, consumed_at, invalidated_reason}` | 403 `ADMIN_STEP_UP_REQUIRED` |
| `POST /invitations` | `Idempotency-Key` (UUID) + `{operation_id, full_name, phone, note?, permissions}` | 201 `{invitation:{invitation_id, status, version, full_name, phone_masked, note, permissions[], created_at, expires_at}, activation_link}` | 400/409 `IDEMPOTENCY_*`; 403 `ADMIN_STEP_UP_REQUIRED`; 409 `ADMIN_INVITATION_PENDING_EXISTS` / `ADMIN_PHONE_CONFLICT` / `ADMIN_INVITATION_NOT_REPLAYABLE`; 503 `TRANSACTION_OUTCOME_UNKNOWN` |
| `GET /invitations?status&limit&cursor` | `status` ∈ 6 giá trị; `limit` 1–50 (mặc định 20); `cursor` opaque | `{items:[{invitation_id, status, version, full_name, phone_masked, note, created_at, expires_at, terminal_at, successor_id, expired}], next_cursor}` | 400 `ADMIN_INPUT_INVALID` |
| `GET /invitations/:id` | — | `{invitation:{…như trên, permissions[], terminal_at, successor_id, expired}, activation:{state:"NONE"}}` | 404 `ADMIN_INVITATION_NOT_FOUND` (chỉ với SYSTEM hợp lệ) |
| `POST /invitations/:id/reissue` | `Idempotency-Key` + `{operation_id, expected_version, reason, permissions?}` (vắng `permissions` = sao chép; `null`/`[]` tường minh ⇒ 400) | 201 `{invitation:{…bản mới}, superseded_invitation_id, activation_link}` | như create + 404, 409 `ADMIN_VERSION_CONFLICT` / `ADMIN_INVITATION_NOT_PENDING` |
| `POST /invitations/:id/revoke` | `Idempotency-Key` + `{operation_id, expected_version, reason}` | 200 `{invitation:{…, status:"REVOKED", version, terminal_at}}` | như reissue |

Trạng thái lời mời: `PENDING` `ACCEPTED` `REVOKED` `SUPERSEDED` `EXPIRED` `PHONE_CONFLICT`. Cấp lại và thu hồi chỉ nhận `PENDING` (gồm PENDING đã quá hạn).
`activation_link` chỉ có ở response tạo / cấp lại và replay ≤ 15 phút; không bao giờ ở GET.

## 3. `/v1/admin-activation` (1C) — công khai, cookie ACTIVATION + CSRF ACTIVATION (không đăng nhập admin)

POST: `Origin` = `ADMIN_ACTIVATION_ORIGIN`, JSON ≤ 4 KiB, quota IP. Token lời mời chỉ ở thân `POST /start`, lấy từ fragment `#t=<43 ký tự base64url>`.

| Route | Thân / CSRF | Thành công `data` | Lỗi chính |
|---|---|---|---|
| `POST /start` | `{token}` (không CSRF; cookie tùy chọn, cookie sai bị bỏ qua) | 201 `{state:"STARTED", csrf_token, expires_at}` + cookie; hoặc 200 tiếp tục `{state, …, csrf_token}` / 200 `{state:"COMPLETED", next:"LOGIN"}` | 404 `ADMIN_ACTIVATION_LINK_INVALID` (đồng nhất); 409 `ADMIN_PHONE_CONFLICT`; 400 `ADMIN_INPUT_INVALID`; 429 |
| `GET /state` | cookie | `{state, expires_at?, csrf_token?, …}` xem bảng bên dưới | 401 `ADMIN_ACTIVATION_SESSION_INVALID` (xóa cookie) |
| `POST /otp/request` | `{}` + CSRF | 202 `{resend_at, delivery:"SUBMITTED", displayed_code?}` (`displayed_code` chỉ ở `TEST_DISPLAY`) | 429 `OTP_RATE_LIMITED` (**không Retry-After**); 503 `SERVICE_UNAVAILABLE`; 409 STEP_INVALID / `ADMIN_PHONE_CONFLICT` |
| `POST /otp/verify` | `{code}` (6 số) + CSRF | 200 `{state:"OTP_VERIFIED"}` | 400 `OTP_INVALID` / `OTP_EXPIRED`; 429 `OTP_RATE_LIMITED`; 409 STEP_INVALID |
| `POST /password` | `{password}` (8–128 code point, như đăng ký) + CSRF | 200 `{state:"PASSWORD_SET"}` | 400 `ADMIN_INPUT_INVALID`; 409 STEP_INVALID (+ `restart_required`) |
| `POST /totp/enrollment` | `{}` + CSRF | 200 `{state:"TOTP_ISSUED", otpauth_uri, secret}` (gọi lại ⇒ cùng bí mật) | 409 STEP_INVALID |
| `POST /complete` | `{code}` (TOTP 6 số) + CSRF | 200 `{state:"COMPLETED", next:"LOGIN"}` (không cấp phiên admin) | 400 `ADMIN_TOTP_INVALID`; 409 `ADMIN_PHONE_CONFLICT` / STEP_INVALID; 429 `ADMIN_AUTH_RATE_LIMITED` + Retry-After |
| `POST /restart` | `{}` + CSRF (không token) | 201 `{state:"STARTED", csrf_token, expires_at}` + cookie mới | 401; 409 STEP_INVALID; 404 `…LINK_INVALID`; 409 `ADMIN_PHONE_CONFLICT` |

Mọi 4xx/5xx và 2xx có no-store. `ADMIN_ACTIVATION_STEP_INVALID` (409) mang `error.details = {state, …}` (cùng dạng `GET state`).
`ADMIN_CSRF_INVALID` (403): thiếu/sai CSRF hoặc Origin.

`GET /state` theo trạng thái (không bao giờ có SĐT, tên, quyền, id):

| `state` | Trường khác |
|---|---|
| `STARTED` | `expires_at`, `csrf_token`, `otp:{status: NONE\|SUBMITTED\|EXPIRED\|LOCKED\|FAILED, resend_at?, attempts_left?}` |
| `OTP_VERIFIED` | `expires_at`, `csrf_token`, `password_deadline`, `restart_required` |
| `PASSWORD_SET` | `expires_at`, `csrf_token` |
| `TOTP_ISSUED` | `expires_at`, `csrf_token`, `totp_attempts_left` (không trả lại bí mật) |
| `COMPLETED` | `next:"LOGIN"` (không CSRF) |
| `INVALIDATED` | `reason: REPLACED\|LINK_UNAVAILABLE\|PHONE_CONFLICT\|ATTEMPTS_EXHAUSTED`, `can_restart`, `csrf_token` chỉ khi `ATTEMPTS_EXHAUSTED` |

## 4. Khoảng trống đã xác nhận (không giả lập thành chức năng sản phẩm)

Không có API cho: khóa/mở khóa ADMIN, đổi quyền sau kích hoạt, khôi phục 2FA, nhật ký, quản lý người dùng app (Khách/Quán/Xế), danh sách tài khoản ADMIN đã kích hoạt.
`GET /invitations/:id` luôn trả `activation.state = "NONE"` (1B); trạng thái kích hoạt thật chỉ ở `/v1/admin-activation/state` của người được mời.
