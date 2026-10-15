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

## 2b. Đọc tài khoản (M01 account read, 2026-10-13) — chỉ đọc

Cookie phiên ADMIN (đã xong TOTP), `Cache-Control: no-store`, không CSRF, `Origin` tùy chọn. PREAUTH, Bearer hoặc không cookie ⇒ 401 `ADMIN_SESSION_INVALID`. Mỗi lần đọc kiểm lại actor trong transaction (user→membership→factor→session, giờ DB). SYSTEM đọc đầy đủ; ADMIN theo `can_view` HIỆN TẠI. Không audit, outbox hay idempotency; không migration.

| Route | Truy vấn | Thành công `data` | Lỗi chính |
|---|---|---|---|
| `GET /v1/admin-auth/permissions` | — | `{admin_role, permissions:[{app, can_view, can_review_profile, can_lock}]}` (SYSTEM: 3 app, mọi quyền true) | 401 |
| `GET /v1/admin/users` | `q` (≤120 ký tự, không phân biệt hoa/thường và dấu tiếng Việt, `%` `_` là ký tự thường; tên, tên quán, tên shipper, SĐT), `role` ∈ `CUSTOMER` `SHOP_OWNER` `DRIVER`, `status` ∈ `ACTIVE` `DISABLED`, `limit` 1–50 (mặc định 20), `cursor` | `{items:[{user_id, display_name, phone_masked, roles_visible[], account_status, created_at}], next_cursor, available_role_filters[]}` | 400 `ADMIN_INPUT_INVALID`; 403 `ADMIN_FORBIDDEN` (không có quyền xem nào, hoặc `role` ngoài phạm vi) |
| `GET /v1/admin/users/:user_id` | — | mục trên + `{updated_at, version, profiles:{customer?:{full_name}, shop?:{name,status}, driver?:{status}}, allowed_actions:[]\|["LOCK"]\|["UNLOCK"]}` | 404 `USER_NOT_AVAILABLE` (id không tồn tại và id ngoài phạm vi giống hệt nhau); 403 |
| `GET /v1/admin/administrators` | `q`, `status` ∈ `ACTIVE` `DISABLED`, `limit`, `cursor` | `{items:[{user_id, full_name, phone_masked, admin_role:"ADMIN", status, permissions[], created_at}], next_cursor}` | 403 `ADMIN_FORBIDDEN` với ADMIN |

- USER = tài khoản không phải `ADMIN_PROVISIONED` và không có `admin_memberships` (kể cả membership DISABLED). Vai trò: CUSTOMER→CUSTOMER, SHOP→`SHOP_OWNER`, DRIVER→DRIVER. ADMIN chỉ thấy user có ≥1 vai trò trong phạm vi; `roles_visible`, hồ sơ, tìm kiếm bị giới hạn theo phạm vi ngay trong SQL. SYSTEM còn thấy tài khoản cũ không có vai trò.
- `display_name`: tên khách (góc nhìn CUSTOMER), rồi tên quán, rồi tên shipper; không có ⇒ `null`. SĐT luôn là `phone_masked`; không trả mật khẩu, OTP, TOTP, token, ngân hàng, GPS.
- Danh sách quản trị viên: chỉ ADMIN đã kích hoạt (có membership và hồ sơ); không có SYSTEM, không có lời mời đang chờ. `status` hiệu lực = `DISABLED` nếu tài khoản hoặc membership bị khóa.
- `cursor` opaque, keyset `(created_at, user_id)` giảm dần, ràng buộc bằng HMAC vào endpoint, bộ lọc, actor, vân tay quyền và phiên bản membership. Đổi bộ lọc/quyền/actor hoặc cursor giả ⇒ 400 `ADMIN_INPUT_INVALID`; trang bỏ cursor và đọc lại trang 1.
- `allowed_actions`: gợi ý cho UI, `["LOCK"]` khi tài khoản ACTIVE, `["UNLOCK"]` khi DISABLED, `[]` khi thiếu quyền theo D15, tài khoản không thuộc loại thường mà policy hiện hành chấp nhận, hoặc gate khóa/mở đang đóng (mục 2c). Mutation luôn kiểm lại.

## 2c. Khóa / mở khóa USER (D15, 2026-10-13)

Nguồn hiện hành: [M01-admin-account-lock-handoff-20261013](M01-admin-account-lock-handoff-20261013.md). SYSTEM khóa/mở mọi tài khoản thường (kể cả chưa có vai trò); ADMIN cần `can_view` **và** `can_lock` cho TẤT CẢ domain của target (CUSTOMER, SHOP, DRIVER), không suy từ vai trò đang chọn. Không target ADMIN/SYSTEM (kể cả membership DISABLED) hay origin ngoài policy hiện hành. Khóa thu hồi mọi phiên Food/Ship chưa thu hồi của target trong cùng giao dịch (giữ dòng/TTL, không đụng `admin_sessions`); mở khóa không cấp vai trò, không sửa hồ sơ, không khôi phục phiên.

| Route | Header / thân | Thành công | Lỗi chính |
|---|---|---|---|
| `POST /v1/admin/users/:user_id/lock` và `/unlock` | cookie SESSION đã TOTP, `Origin` đúng, `Content-Type: application/json`, `x-csrf-token` SESSION, `Idempotency-Key` UUID; thân đúng `{expected_version, reason}` (reason 1..500 code point sau trim) | 200 `{command_id, user_id, account_status:"ACTIVE"\|"DISABLED", version, changed_at}` (xác nhận ý định, không phải trạng thái hiện tại) | 400 `ADMIN_INPUT_INVALID` / `IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY`; 401 `ADMIN_SESSION_INVALID`; 403 `ADMIN_CSRF_INVALID`, `ADMIN_FORBIDDEN` (nhìn được nhưng thiếu view+lock một domain); 404 `USER_NOT_AVAILABLE` (không có / ADMIN / SYSTEM / ngoài policy / ADMIN không đọc được); 409 `USER_ACCOUNT_VERSION_CONFLICT`, `USER_ACCOUNT_ALREADY_IN_STATE` (version đúng, trạng thái đích đã có), `USER_ACCOUNT_IMPACT_REVIEW_REQUIRED` (gate đóng), `IDEMPOTENCY_KEY_REUSED`; 429 `ADMIN_AUTH_RATE_LIMITED` |

- Executor idempotency hiện có: operation `admin.user.lock.v1` / `admin.user.unlock.v1`, scope `admin_user` theo UUID actor, fingerprint gồm target, `expected_version`, lý do đã chuẩn hóa. Cùng key + cùng thân = trả lại xác nhận gốc, sau khi kiểm lại actor/phiên/quyền hiện tại/target thường/toàn bộ vai trò; không chạy lại version check, update, thu hồi, audit hay outbox. Khác thân cùng key ⇒ `IDEMPOTENCY_KEY_REUSED`. Không có bảng/migration mới.
- Thứ tự khóa: idempotency → actor (user, membership, factor, session; chia sẻ) → target `users` FOR UPDATE → vai trò → giờ DB → quyền/gate → version/trạng thái → `users` UPDATE + thu hồi phiên theo `session_id` → audit → outbox → bản ghi idempotency. Lỗi bất kỳ ⇒ rollback toàn bộ.
- Audit `admin.user.lock.v1` / `admin.user.unlock.v1` (actor SYSTEM|ADMIN, target, from/to, version, lý do, số phiên thu hồi khi khóa) đúng một lần. Outbox `user.account.locked.v1` / `unlocked.v1` schema 1, payload `{user_id, account_status, version}` (không SĐT, token, lý do).
- Gate: `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED` mặc định false ⇒ mutation trả 409 `USER_ACCOUNT_IMPACT_REVIEW_REQUIRED` và detail không có action. `true` chỉ hợp lệ khi `APP_ENV` development/test, `HOST` loopback và `ADMIN_AUTH_ENABLED=true`; giá trị lạ hoặc bật ngoài môi trường đó ⇒ backend từ chối khởi động (chỉ nêu tên biến). UI không tự bật. M01 không hủy đơn, xử lý tiền hay nghĩa vụ giao hàng; impact thật thuộc module sau.

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

Không có API cho: khóa/mở khóa ADMIN (khóa/mở USER thường: mục 2c), đổi quyền sau kích hoạt, khôi phục 2FA, nhật ký, quản lý người dùng app (Khách/Quán/Shipper), danh sách tài khoản ADMIN đã kích hoạt.
`GET /invitations/:id` luôn trả `activation.state = "NONE"` (1B); trạng thái kích hoạt thật chỉ ở `/v1/admin-activation/state` của người được mời.
