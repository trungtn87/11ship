# M01-D-ADMIN — kiểm kê backend và đề xuất gói bước 1 (tạo lời mời / kích hoạt ADMIN)

Loại tài liệu: báo cáo kiểm kê read-only (Claude) để ChatGPT chốt hợp đồng implementation. **Không phải** hợp đồng đã chốt, không phải nghiệm thu, không có code sản phẩm, migration, deploy, seed hay merge đi kèm.
Phân công theo [AGENTS.md](../../AGENTS.md) và [workflow](../process/11ship-delivery-workflow.md): ChatGPT thiết kế/review; Claude code/test; Owner duyệt và nghiệm thu.
Nguồn nghiệp vụ/UI: Owner duyệt nghiệp vụ và 5 bộ ảnh (`11Ship-Admin-UI-01/02`, `11Ship-Accounts-UI-03/04/05`) ngày 09/10/2026 theo gói `11Ship-Admin-Handoff-2026-10-09.md`. Ảnh chỉ duyệt bố cục/luồng; số liệu minh họa.
Quy ước nhãn: **CÓ** (có trong code, ghi rõ main hay PR), **THIẾU** (không thấy trong code đã đọc), **CHƯA KIỂM CHỨNG** (không đủ bằng chứng từ repo). Mọi "đề xuất" là phương án để ChatGPT cân nhắc, không phải thiết kế đã chốt.

## 1. Mốc đã fetch (09/10/2026)

| Đối tượng | SHA | Ghi chú |
|---|---|---|
| `main` | `b8bff4b093da0cc233b0d53955b7cc9024c82b22` | Commit bot `chore(progress)`. Từ `1174433` (base #34) đến nay `main` chỉ thêm commit bot đổi `docs/PROGRESS.md`; `git diff 1174433 main` ngoài file đó rỗng. |
| #34 `feat/m01-d-login-backend` → `main` | head `4d20660eb3b0656b626a084df6e55d4385ee405a`, base `117443303e5c7fd4fb006d3137698a583bc9ca51` | Draft, mở, chưa merge. Head **khớp** mốc đã biết. |
| #35 `feat/m01-d-login-ui` → `feat/m01-d-login-backend` | head `7b116c3d4551bf0028fa544278449598acf5991c`, base `4d20660eb3b0656b626a084df6e55d4385ee405a` | Draft, mở, chưa merge. Head **khớp**; base đúng head hiện tại của #34, nên không cần đối chiếu diff khác. Stacked: phải có #34 trước. |
| #27 `feat/m00-d2-staging-fixtures` → `main` | head `c8b410ef7e8a96737e898f95d33d52a26c0a9681`, base `737e66a7f6cc09b08a2ec68857c70b1ddea94d97` | Draft, chưa merge. Nhánh cũ hơn main (tách trước commit `0206918`). |
| #30 `design/m01-complete-roadmap` | head `bb5d6c97ab2f1b2853765d218ad76cc9816c9952` | Draft; chứa thiết kế M01-D (business design, handoff). Chưa merge. |
| #33 `design/m00-local-m01-restart` | head `aa7082b42c65deaa247ade16e3e2b5071d5cf619` | Draft; thiết kế M00 local (OTP thử). Chưa merge. |

CI: tra check run qua REST trên cả hai head. "Verify (Node 24, PostgreSQL 17)" = `success` tại `4d20660` và `7b116c3`. Đây chỉ là trạng thái CI; không phải review, local, thiết bị thật hay nghiệm thu. Số test trong mô tả PR không được kiểm lại độc lập. Mọi phần dưới về #34/#35 là code **chưa merge**. Lưu ý mô tả PR #34 ghi `main` `12d9faa`, cũ hơn main hiện tại; không ảnh hưởng vì không có thay đổi code giữa chúng.

Phương pháp: đọc trực tiếp file theo SHA ở trên; không chạy test, không kết nối DB, không chạy migration. Chưa audit toàn bộ repo; mục "không thấy" nghĩa là không thấy trong các file đã mở (danh sách route trên main lấy bằng `git grep` mọi decorator `@Controller/@Get/@Post/@Put/@Patch/@Delete`).

## 2. Kiểm kê schema và migration

### 2.1 Trên `main` (`b8bff4b`)
Migration cuối: `1791763200000_create-shop-business-hours.sql`. Migration auth: `database/migrations/1791504000000_create-auth-core.sql`.

| Bảng | Cột/ràng buộc chính (thực tế) | Liên quan |
|---|---|---|
| `app.users` | `user_id` PK; `phone_normalized varchar(16)` **UNIQUE** (`users_phone_normalized_uq`) + CHECK E.164; `password_hash` CHECK `^\$argon2id\$`; `phone_verified_at timestamptz NOT NULL`; `status IN ('ACTIVE','DISABLED')`; `version`. **Không có** `account_origin`, **không có** cột tên hiển thị. | SĐT duy nhất; khóa tài khoản = `status`; không có lý do/người khóa. |
| `app.user_roles` | PK `(user_id, role)`; `role` token UPPER_SNAKE, "ADMIN/SYSTEM never provisioned by Auth Core" (comment). | Vai trò nghiệp vụ SHOP/DRIVER. |
| `app.phone_verifications` | `purpose varchar(32)` token tự do (CHECK regex), mặc định chỉ code phát `REGISTER`; `otp_digest` HMAC; `status`, `attempt_count`, `expires_at`, `resend_not_before`; index `(phone_normalized, purpose, created_at DESC)`. **Không có** cột gắn người nhận/lời mời. | OTP. |
| `app.verification_proofs` | 1 proof / verification (`UNIQUE verification_id`), `token_digest` UNIQUE, `phone_normalized`, `purpose`, `consumed_at`; không bao giờ xóa. | Proof gắn **(SĐT, purpose)** — không gắn lời mời. |
| `app.sessions` | Bearer app: `token_digest`, `device_id`, `platform`, `app`, `active_role`, `expires_at`, `revoked_at`; unique index `sessions_active_shop_per_user_uq` chỉ cho `active_role='SHOP'` chưa revoke. | Chỉ SHOP bị ràng 1 phiên; không có ràng buộc tương đương cho DRIVER/Khách. |
| `app.audit_logs` | `actor_type` token (`ANONYMOUS, USER, ADMIN, SYSTEM, …` theo comment), `actor_id`, `action` dotted-versioned, `resource_type/id/version`, `outcome`, `reason_code`, `metadata jsonb` (app từ chối metadata trông như bí mật). | Audit append qua `AuditWriter`. |
| `app.idempotency_records` | M00-C1A1; scope/operation/key, replay mã hóa. | Idempotency. |
| `app.shops` | `status IN ('INCOMPLETE','ACTIVE','DISABLED')`, `accepting_orders`; `app.shop_members`. | Quán. **Không có** trạng thái hồ sơ "Chờ duyệt/Đã duyệt/Yêu cầu bổ sung". |
| `app.drivers` | `driver_type IN ('EXTERNAL','PLATFORM')`, `status IN ('PENDING','ACTIVE','SUSPENDED','CLOSING','CLOSED')`, `accepting_deliveries`, `full_name`. | Xế. **Không** thấy bảng ngân hàng/ví. |
| Outbox | `app.outbox_events` (M00-C1B/C). | Không dùng cho bước 1. |

Không có bảng admin, lời mời, scope/quyền, factor/challenge/session quản trị, limiter trên `main`.

### 2.2 Thêm bởi #34 (`4d20660`) — chưa merge
| File | Nội dung |
|---|---|
| `database/migrations/1791936000000_add-users-account-origin.sql` | `users.account_origin varchar(24) NOT NULL DEFAULT 'PHONE_VERIFIED'`; `phone_verified_at` thành nullable; `users_account_origin_ck` ∈ {`PHONE_VERIFIED`,`ADMIN_PROVISIONED`}; `users_origin_verified_ck`: PHONE_VERIFIED ⇒ `phone_verified_at NOT NULL`, ADMIN_PROVISIONED ⇒ `phone_verified_at IS NULL`. Down từ chối chạy nếu còn origin khác. |
| `database/migrations/1792022400000_create-admin-auth.sql` | `app.admin_memberships` (PK `user_id`, `admin_role IN ('SYSTEM','ADMIN')`, `status IN ('ACTIVE','DISABLED')`, `version`; unique partial index `admin_memberships_single_system_uq` — **SYSTEM duy nhất**), `app.admin_auth_challenges` (preauth, `csrf_nonce`, `password_binding`, `membership_version`, attempt ≤5), `app.admin_totp_factors` (1/admin, `state PENDING/ACTIVE`, secret AES-GCM, `last_accepted_step`), `app.admin_sessions` (cookie digest, CSRF, `membership_version`, `factor_*`, unique partial index `admin_sessions_active_per_user_uq` — **1 phiên quản trị còn hiệu lực/admin**), `app.admin_auth_limit_config` (singleton), `app.admin_auth_limits` (`kind IN ('LOGIN_PHONE','LOGIN_IP','LOGIN_REQUEST_IP','TOTP_USER','TOTP_REQUEST_IP')`). Không CASCADE, không seed. |

**THIẾU trong #34** (đối chiếu yêu cầu bước 1/2): bảng lời mời; bảng scope/quyền theo app (Khách/Quán/Xế × Xem/Duyệt hồ sơ/Khóa-mở khóa); tên hiển thị ADMIN; ghi chú; trạng thái "chờ kích hoạt" (membership chỉ có ACTIVE/DISABLED); lý do/người khóa; bảng kind limiter cho OTP kích hoạt (CHECK `kind` là danh sách đóng); ràng buộc DB buộc membership chỉ đi với `account_origin='ADMIN_PROVISIONED'` (hiện chỉ code quyết định; comment migration: "membership - not the account origin - decides the right").

### 2.3 Thêm bởi #27 (`c8b410e`) — chưa merge
`database/migrations/1791849600000_add-users-account-origin.sql`: cùng cột `account_origin`, cùng tên constraint `users_account_origin_ck` / `users_origin_verified_ck`, nhưng giá trị ∈ {`PHONE_VERIFIED`,`STAGING_FIXTURE`}. Xem mục 8.

## 3. Kiểm kê route, service, guard

### 3.1 `main`
Route thực tế (toàn bộ decorator route trong `apps/backend/src`):
`POST /auth/phone-verifications`, `POST /auth/phone-verifications/:id/verify`, `POST /auth/register`, `POST /auth/login`, `POST /auth/role/select` (guard), `GET /auth/me` (guard); `POST /onboarding/driver`; `GET|PUT /onboarding/shop/profile`, `POST /onboarding/shop/complete`; `GET /shop/me`, `PUT /shop/me/profile`, `PUT /shop/me/business-hours`; `GET /health/live|ready`.
- **Không có route quản trị nào**, không có đăng xuất/thu hồi phiên app, không khóa/mở khóa tài khoản, không liệt kê tài khoản, không đọc audit.
- OTP: `VerificationService.requestOtp` chỉ `purpose=REGISTER` (`auth-validation.ts` `parseOtpRequestBody` từ chối purpose khác); từ chối `PHONE_ALREADY_REGISTERED` nếu SĐT đã có trong `app.users`; `verifyOtp` trả `purpose` **hằng `REGISTER_PURPOSE`**; port `OtpProvider` chỉ có `sendRegisterOtp(phone, otp)`.
- Đăng ký: `RegistrationService` (idempotent qua `IdempotencyExecutor`, scope `verification_proof`): kiểm proof (purpose REGISTER, SĐT khớp, chưa dùng/hết hạn), `insertRegistered` → user `ACTIVE`, tiêu thụ proof, tạo phiên app không role. Tính SĐT duy nhất do UNIQUE constraint quyết định khi race.
- Phone: `normalizeVietnamPhone` — chỉ di động VN → `+84XXXXXXXXX`.
- Guard: `SessionAuthGuard` (bearer app) + `SessionAuthorizationParticipant` (kiểm lại dưới khóa). Chưa có guard quản trị.
- Rate limit OTP app: cooldown theo (SĐT, purpose) + `attempt_count` tối đa; không có limiter theo IP.
- OTP provider: `bindOtpProvider` (`auth/otp-provider-binding.ts`) chỉ bind `FakeOtpProvider` (in-memory, test) ở `development|test`; staging/production **từ chối khởi động** (`StartupConfigError(['OTP_PROVIDER'])`). Không có adapter SMS trong repo.
- Audit: `AuditWriter.append(context, …)` trong transaction; `StandaloneAuditRecorder` best-effort.

### 3.2 Thêm bởi #34 (chưa merge) — `apps/backend/src/admin-auth/`, bật bằng `ADMIN_AUTH_ENABLED=true` (mặc định tắt)
| Route `/v1/admin-auth` | File | Ghi chú |
|---|---|---|
| `POST login` | `admin-auth.controller.ts`, `admin-login-service.ts` | SĐT + mật khẩu → **preauth** (cookie `__Host-11admin-pre`, 5 phút) hoặc 429/401 `INVALID_CREDENTIALS`; Argon2id ngoài transaction, dummy-verify nếu không có tài khoản; chỉ cấp preauth khi user `ACTIVE` **và** membership `ACTIVE`. |
| `GET state`, `GET me` | `admin-session-service.ts` | Cookie `__Host-11admin` (8h tuyệt đối). `me` trả `user_id, admin_role, expires_at, csrf_token` — **chưa có scope/quyền**. |
| `POST totp/enrollment`, `.../enrollment/verify`, `totp/verify` | `admin-totp-service.ts` | TOTP RFC 6238 (SHA-1/6 số/30s, cửa sổ current+previous), chống replay bằng `last_accepted_step`; chỉ MFA thành công mới cấp phiên và thu hồi phiên cũ. |
| `POST logout` | `admin-session-service.ts` | 204, CSRF bắt buộc. |
| Lệnh vận hành | `admin-auth-cli.ts`, `scripts/admin-auth-*.js` | `admin-auth:init-limit-config`, `admin-auth:bootstrap-system` (stdin, target guard). **Đường duy nhất tạo SYSTEM.** |

Cơ chế an toàn đã có: Origin phải khớp chính xác danh sách (`#assertPostTransport`, `ADMIN_CSRF_INVALID` 403); JSON content-type; CSRF dẫn xuất HMAC (preauth/session riêng), header `x-csrf-token`; cookie `Secure; HttpOnly; SameSite=Strict; Path=/` với tiền tố `__Host-`; `Cache-Control: no-store`; XFF chỉ tin proxy khai báo chính xác; limiter lưu PostgreSQL (10 request login/phút/IP; 10 sai mật khẩu/15 phút theo SĐT và theo IP, khóa 15 phút; 5 sai TOTP/15 phút, 5 lần/challenge); mỗi request kiểm lại dưới khóa theo thứ tự user → membership → factor → session (`AdminCredentialChecks`: tài khoản ACTIVE, `password_binding` còn khớp, membership ACTIVE đúng `membership_version`, factor ACTIVE đúng phiên bản); xoay khóa CRYPTO có test.
Cách ly app: `login-service.ts`, `session-service.ts`, `session-authorization-participant.ts` từ chối `accountOrigin !== 'PHONE_VERIFIED'` (INVALID_CREDENTIALS/SESSION_INVALID); kiểm lại dưới khóa.
Mã lỗi quản trị đã có: `ADMIN_PREAUTH_INVALID` 401, `ADMIN_TOTP_INVALID` 400, `ADMIN_AUTH_RATE_LIMITED` 429, `ADMIN_CSRF_INVALID` 403, `ADMIN_SESSION_INVALID` 401, `ADMIN_ENROLLMENT_NOT_ALLOWED` 409.
Audit action đã có: `admin_auth.system_bootstrapped|login_preauth|totp_enrolled|login_completed|logout .v1` (actor `USER` cho admin, `SYSTEM` cho bootstrap).

**THIẾU / không tái dùng được ngay:** guard/CSRF cho route quản trị nghiệp vụ (kiểm Origin nằm trong private method của `AdminAuthController`; kiểm phiên nằm trong service từng endpoint; không có `@UseGuards` nào trong `admin-auth`); xác nhận 2FA bước hai (step-up) cho thao tác nhạy cảm; idempotency cho route quản trị (module `admin-auth` không dùng `IdempotencyExecutor`); đọc audit; mọi route tạo/quản lý ADMIN.

### 3.3 Web quản trị #35 (`7b116c3`) — chưa merge
`apps/admin-web` (TypeScript thuần, `src/core` + `src/dom`): chỉ các màn `checking`, `login`, `enroll`, `verify`, `unavailable`, shell hiển thị vai trò, đăng xuất. 7 route `/v1/admin-auth`. HTTPS local qua `scripts/admin-web-dev.mjs`. Không có menu "Tài khoản ADMIN/ứng dụng/Nhật ký", không có màn kích hoạt. Ảnh UI-01…05 **không có trong repo** (checklist #35 ghi rõ); gói zip Owner là nguồn.

## 4. Bảng đối chiếu chức năng đã duyệt với backend

Cột "Đã có" ghi `main` / `#34` / `#35` (chưa merge). Không endpoint/schema nào dưới đây là đã chốt; cột "Phần thiếu" chỉ nêu khoảng trống.

### 4.1 ADMIN (UI-01, UI-02)
| Chức năng | Đã có | Phần thiếu | File/API liên quan | Dependency |
|---|---|---|---|---|
| Đăng nhập quản trị + 2FA + F5/logout | #34 + #35 (CI xanh, chưa review/Owner) | Chưa merge; chưa Owner local | `admin-auth/*`, `apps/admin-web` | #34 → #35 |
| SYSTEM duy nhất | #34: unique index + bootstrap CLI | Chưa test "không route nào ghi SYSTEM" cho route mới | `admin_memberships_single_system_uq`, `admin-bootstrap-service.ts` | #34 |
| Danh sách ADMIN (UI-01 §01) + bộ lọc phạm vi/trạng thái + đếm Đang hoạt động/Chờ kích hoạt/Đã khóa | — | Toàn bộ: route đọc, phân trang, tên, SĐT che, trạng thái "chờ kích hoạt", cột 2FA | (chưa có) | Bước 1 |
| Tạo lời mời ADMIN (UI-01 §02: họ tên, SĐT, ma trận quyền, ghi chú) | — | Bảng lời mời; chuẩn hóa/kiểm SĐT trùng; ma trận quyền; ghi chú; audit; idempotency; xác nhận người tạo là SYSTEM | `normalizeVietnamPhone`, `UserRepository.isPhoneRegistered` (tái dùng) | #34, bảng mới |
| Nhận lời mời (cách chuyển token/link) | — | **Không có cả trong thiết kế UI**: màn hiển thị link/mã sau khi tạo, màn đầu vào của người nhận | — | Quyết định D2 |
| Kích hoạt bước 1 OTP (UI-02 §04.1) | `main`: OTP REGISTER; hạ tầng OTP ở mức primitive | Purpose mới; gắn proof với đúng lời mời + người nhận; port gửi OTP kích hoạt; **không có provider SMS/OTP thử ngoài dev/test** | `verification-service.ts`, `otp-provider*.ts`, #33 (thiết kế) | Quyết định D5, M00-LOCAL-OTP |
| Kích hoạt bước 2 đặt mật khẩu | `main`: Argon2id hasher, quy tắc 8–128 | Route đặt mật khẩu theo proof lời mời; tạo user `ADMIN_PROVISIONED` + membership nguyên tử | `registration-service.ts` (mẫu), `AdminIdentityParticipant.insertProvisioned` (#34) | Migration D4 |
| Kích hoạt bước 3 2FA | #34: enrollment + verify TOTP | Nối kích hoạt → preauth/enrollment hiện có mà không cho phiên trước khi xong 2FA | `admin-totp-service.ts` | #34 |
| Ma trận quyền theo app (Xem / Duyệt hồ sơ / Khóa-mở khóa; Khách không có "Duyệt") | — | Schema quyền, ràng buộc "Xem là điều kiện", bump version thu hồi phiên, trả quyền qua `me` | `admin_memberships.version`, `AdminCredentialChecks` (cơ chế version) | Bước 1–2 |
| Chi tiết ADMIN: Thông tin/Phân quyền/Bảo mật/Lịch sử | — | Đọc chi tiết, sửa phân quyền + lý do, đọc lịch sử | audit | Bước 2 |
| Xác nhận 2FA SYSTEM khi lưu thay đổi / khôi phục 2FA (UI-01 §03, UI-02 §06) | — | Step-up TOTP; xung đột với replay guard `last_accepted_step` | `admin-totp-service.ts` | Quyết định D7 |
| Khôi phục 2FA ADMIN; thu hồi phiên ADMIN (UI-02 §05) | #34 có factor/session nhưng không có thao tác xóa/thay | Thu hồi factor/challenge/session, buộc enroll lại, lý do, audit | `admin_totp_factors`, `admin_sessions` | Bước 2 |
| Khóa/mở khóa ADMIN | #34: `membership.status` DISABLED chặn login/phiên | Route + lý do + audit + thu hồi phiên | `admin-membership-repository.ts` | Bước 2 |
| Lời mời hết hạn/thu hồi/cấp lại; màn lỗi (UI-05 §13) | — | Toàn bộ trạng thái và mã lỗi | — | Bước 1 |

### 4.2 Tài khoản Khách / Quán / Xế (UI-03, 04, 05)
| Chức năng | Đã có | Phần thiếu | File/API liên quan | Dependency |
|---|---|---|---|---|
| Danh sách + tìm kiếm + lọc | — | Mọi route đọc quản trị; "Khách" **không có role/hồ sơ trong hệ thống** (`SUPPORTED_ROLES = ['DRIVER','SHOP']`; không có bảng khách; `users` không có tên) | `auth-constants.ts`, `app.users` | Thiết kế module Khách; bước 3 |
| Chỉ hiện app/thao tác trong phạm vi quyền | — | Guard theo quyền từng app ở server | — | Bước 1–2 |
| Chi tiết Quán (hồ sơ, điều kiện hoạt động, GPS/vùng) | `app.shops`, `service_areas`, onboarding + shop-management trên `main` | Đọc cho quản trị; trạng thái hồ sơ Chờ duyệt/Đã duyệt/Bổ sung **chưa có** (shop chỉ `INCOMPLETE/ACTIVE/DISABLED`) | `onboarding/*`, `shop-management/*` | Bước 4 + thiết kế duyệt |
| Duyệt hồ sơ / Yêu cầu bổ sung | — | Workflow duyệt, trạng thái, lý do, audit | — | Bước 4–5 |
| Chi tiết Xế (loại xế, ngân hàng, điều kiện ví) | `app.drivers` (type/status) | Không thấy bảng ngân hàng/ví; verify | `driver/*`, `driver-onboarding-*` | Bước 5; không tự làm ví |
| Khóa/mở khóa tài khoản + lý do | `users.status` ACTIVE/DISABLED được login và session kiểm tra (`ACCOUNT_DISABLED`) | Route quản trị, lý do, người thực hiện, thu hồi phiên trong cùng transaction, "mở khóa giữ nguyên hồ sơ, không tự bật online" | `login-service.ts`, `session-authorization-participant.ts` | Bước 3 |
| Thu hồi phiên app | `sessions.revoked_at`; chỉ có thu hồi phiên SHOP cũ khi chọn role | Thu hồi toàn bộ phiên của một user theo yêu cầu quản trị | `session-repository.ts` | Bước 3 |
| Lịch sử tài khoản + chi tiết (người, lý do, trước/sau, mã thao tác) | `audit_logs` ghi được | **Đọc/lọc audit** (index theo resource? CHƯA KIỂM CHỨNG), lý do/trước-sau chỉ trong `metadata`, "mã thao tác ACT-…" chưa có | `audit-writer.ts` | Bước 3 |
| Mất phản hồi khi lưu (UI-05) | M00 idempotency có sẵn (`IdempotencyExecutor`, replay mã hóa, mặc định replay 900s/dedupe 7 ngày) | Dùng cho route quản trị; thao tác "kiểm tra kết quả" | `idempotency/*` | Mọi bước |
| Khóa Quán/Xế đang có đơn không tự hủy đơn/đổi ví | Chưa có module đơn/ví trên `main` | Thiết kế nghĩa vụ tiếp tục xử lý trước rollout | — | M03/M04, bước 4–5 |
| "1 tài khoản = 1 thiết bị online" | Chỉ SHOP có unique index phiên; Khách/Xế **không** có ràng buộc | Đối chiếu yêu cầu thực; chưa suy từ SHOP | `sessions_active_shop_per_user_uq` | Quyết định riêng |
| App quản lý Android | — | Hợp đồng xác thực native (cookie `__Host-`/CSRF web không dùng cho Android) | — | Bước 6 |

## 5. Phân tích riêng: tạo / kích hoạt ADMIN

### 5.1 Điều đã bảo đảm một phần (sau khi #34 merge) và điều còn phải làm
| Yêu cầu | Hiện trạng | Việc còn lại |
|---|---|---|
| Chỉ SYSTEM tạo ADMIN | Chưa có route. Phiên quản trị có `admin_role` từ membership. | Guard: `admin_role='SYSTEM'` kiểm lại dưới khóa; không đọc quyền từ client. |
| SYSTEM duy nhất | Unique index + chỉ CLI bootstrap. | Test: không route nào ghi `admin_role='SYSTEM'`; payload lời mời không có trường role. |
| ADMIN không tạo ADMIN / không cấp SYSTEM | Chưa có route nên chưa có vi phạm. | Test quyền âm tính ở bước 1. |
| Không ghi đè/nâng quyền tài khoản app trùng SĐT | `users.phone_normalized` UNIQUE; `isPhoneRegistered`. | Từ chối lời mời nếu SĐT đã có user (bất kể origin); khi kích hoạt, insert dựa UNIQUE và trả "SĐT đã tồn tại" nếu một tài khoản app đăng ký trong lúc lời mời còn chờ. Không bao giờ UPDATE user có sẵn. |
| Pending chưa truy cập quản trị | Nếu lời mời nằm ở bảng riêng, chưa có `users`/membership ⇒ #34 login trả `INVALID_CREDENTIALS`; phiên chỉ cấp sau TOTP. | Giữ nguyên: không tạo user/membership trước khi OTP+mật khẩu xong (xem D3). |
| Hoàn tất sau OTP → mật khẩu → 2FA | #34 chỉ có enrollment sau login mật khẩu. | Thiết kế cách nối (D3, D6) để "Hoàn tất kích hoạt" chỉ thành công khi TOTP đúng. |
| `ADMIN_PROVISIONED` không dùng luồng app | #34 từ chối ở login, bearer và participant. | Giữ; thêm test cho ADMIN kích hoạt qua OTP. Hiện **không có ràng buộc DB** nối membership với origin (xem D4). |
| Cấp lại/thu hồi/hết hạn; OTP+proof đúng người nhận | Không có. `phone_verifications/proofs` chỉ gắn (SĐT, purpose); `verifyOtp` trả purpose cố định REGISTER; proof chỉ đăng ký tiêu thụ. | OTP/proof phải gắn `invitation_id` + SĐT; proof không dùng được cho `/auth/register` (và ngược lại). |
| Gửi lặp, đồng thời, mất response | `IdempotencyExecutor` (main) + mẫu replay nhạy cảm của register. TOTP replay guard của #34. | Mỗi mutation: Idempotency-Key, khóa hàng lời mời `FOR UPDATE`, trạng thái một chiều; kích hoạt hai lần đồng thời → đúng 1 user, 1 membership, tối đa 1 phiên. |

### 5.2 Rủi ro và điểm lệch phát hiện khi kiểm kê
1. **Mâu thuẫn tài liệu cũ vs. luồng đã duyệt.** `docs/tasks/M01-D-business-design.md` (#30) ghi "mật khẩu tạm sinh ngẫu nhiên, chỉ hiển thị một lần để giao riêng"; Owner đã duyệt luồng lời mời → OTP → tự đặt mật khẩu → 2FA. Cần ChatGPT cập nhật/loại bỏ đoạn cũ để Claude không bám nhầm.
2. **Ràng buộc DB lệch ngữ nghĩa.** `users_origin_verified_ck` (#34) bắt `ADMIN_PROVISIONED ⇒ phone_verified_at IS NULL`. ADMIN kích hoạt qua OTP **đã xác minh SĐT** → cần quyết định: ghi `phone_verified_at` (phải đổi CHECK bằng migration mới) hay giữ NULL và ghi bằng chứng xác minh ở bảng lời mời. Bootstrap SYSTEM vẫn không xác minh SĐT.
3. **OTP không chạy được ngoài dev/test.** Không có adapter SMS; staging/production từ chối khởi động nếu thiếu provider; `FakeOtpProvider` giữ OTP trong bộ nhớ nên Owner local chưa đọc được mã (#33 ghi rõ và đề xuất "OTP thử hiển thị" cho local/staging được phép, chưa thiết kế/code). Owner cấm OTP giả ở production. ⇒ Bước kích hoạt chưa thể test thật cho tới khi có kênh gửi (SMS thật hoặc OTP thử giới hạn môi trường).
4. **Race đăng ký app trước kích hoạt.** Nếu lời mời chỉ nằm ở bảng riêng, một người đăng ký app bằng cùng SĐT trong thời gian lời mời chờ sẽ chiếm UNIQUE. Hành vi đúng (không ghi đè) nhưng UX phải trả lỗi "SĐT đã tồn tại" (đã có trong UI-05) và lời mời phải về trạng thái lỗi/hủy, không tạo ADMIN.
5. **Đường OTP REGISTER công khai với SĐT được mời.** Hiện bất kỳ ai có thể xin OTP REGISTER cho SĐT bất kỳ chưa đăng ký (kể cả SĐT đã mời). Không nâng quyền được, nhưng cần quyết định có chặn đăng ký app trên SĐT đang có lời mời pending không (đề xuất: **không chặn**, theo nguyên tắc không để lời mời của quản trị ảnh hưởng người dùng app; chỉ báo lỗi ở bước kích hoạt).
6. **Step-up 2FA vs. replay guard.** `last_accepted_step` theo 1 factor: mã TOTP dùng khi đăng nhập không dùng lại được trong cùng bước 30s ⇒ thao tác "xác nhận 2FA của SYSTEM" ngay sau đăng nhập phải chờ bước kế (cửa sổ current+previous). Cần quy tắc rõ (D7).
7. **Đổi quyền và phiên.** #34 thu hồi hiệu lực phiên cũ khi `membership.version` đổi (phiên ghi `membership_version`; kiểm lại mỗi request). Đây là cơ chế sẵn dùng để "scope bị gỡ mất hiệu lực với phiên cũ"; cần quyết định cấp thêm quyền có bump version không (đề xuất: mọi thay đổi quyền bump).
8. **Limiter `kind` đóng.** Thêm OTP kích hoạt cần mở rộng CHECK `kind` (migration) hoặc dùng bảng/limiter riêng.
9. **Audit actor.** Admin dùng `actor_type='USER'` trong #34; thao tác quản trị mới nên ghi `ADMIN`/`SYSTEM` để lọc "Người thực hiện" (UI-04 §12) — cần chốt.

## 6. Quyết định cần ChatGPT chốt (kèm đề xuất, chưa triển khai)

| # | Quyết định | Đề xuất | Lý do |
|---|---|---|---|
| D1 | TTL lời mời; cấp lại; thu hồi; số lần | TTL 72 giờ (cấu hình cố định trong code như `admin-auth-constants.ts`, không đọc env); cấp lại = lời mời mới, vô hiệu bản cũ nguyên tử; mỗi SĐT tối đa 1 lời mời `PENDING`; thu hồi về `REVOKED` một chiều | Cùng triết lý hằng số cố định của #34; một lời mời sống/SĐT tránh nhầm người nhận. Con số 72h là đề xuất, cần Owner/ChatGPT xác nhận. |
| D2 | Cách nhận lời mời | SYSTEM nhận link một lần (token 32 byte, lưu digest SHA-256, đặt trong **URL fragment** để không vào log máy chủ/Referer), tự giao riêng; không gửi SMS chứa token. Hiện thiết kế UI **thiếu** màn "lời mời đã tạo" (copy link, hết hạn, cấp lại, thu hồi) và màn vào bằng link | UI-02 §04 chỉ có màn từ bước 1; token không được vào log (handoff). Cần ảnh bổ sung, Owner duyệt trước code UI. |
| D3 | Schema: lời mời ở bảng riêng hay user "pending" | Bảng riêng (`admin_invitations` và OTP kích hoạt do module admin sở hữu); user + membership chỉ tạo ở bước hoàn tất | `users.password_hash NOT NULL` + Argon2id CHECK; membership chỉ ACTIVE/DISABLED; #34 login coi user+membership ACTIVE là dùng được ⇒ bảng riêng giữ "pending không truy cập" mà không đụng Auth Core |
| D4 | Ràng buộc origin | Migration mới sau #34: cho phép `ADMIN_PROVISIONED` có `phone_verified_at` (SYSTEM NULL, ADMIN kích hoạt NOT NULL) và ràng buộc DB membership ⇒ user `ADMIN_PROVISIONED` (FK kép hoặc trigger) | Hiện ngữ nghĩa lệch (mục 5.2-2) và không có chốt DB ngăn membership gắn user app |
| D5 | OTP: dùng lại `phone_verifications` hay OTP riêng; purpose; hết hạn; kênh | OTP/proof riêng của module admin, purpose `ADMIN_ACTIVATION`, gắn `invitation_id`; **không** sửa `VerificationService`/`/auth/register` | `verifyOtp` hằng REGISTER, `requestOtp` chặn SĐT đã đăng ký, port chỉ `sendRegisterOtp`; tái dùng buộc sửa Auth Core đã merge. Kênh gửi: phụ thuộc M00-LOCAL-OTP (#33) / SMS thật — Owner đã nêu "OTP thử" cho local/staging, cần thiết kế contract trước. |
| D6 | Cách nối OTP → mật khẩu → 2FA | Một "activation session" ngắn hạn (cookie preauth-giống #34); hoàn tất: transaction tạo user+membership ADMIN `ACTIVE` + quyền, rồi cấp preauth để dùng enrollment/verify hiện có; "kích hoạt hoàn tất" = TOTP đầu tiên đúng (lời mời `ACCEPTED` khi phiên đầu tiên được cấp) | Tái dùng toàn bộ kiểm tra #34; Owner yêu cầu hoàn tất chỉ sau 2FA nên trạng thái hiển thị "Chờ kích hoạt" kéo dài đến khi có factor ACTIVE |
| D7 | Step-up 2FA SYSTEM | Mã TOTP **mới** (bước TOTP chưa dùng) gắn với một thao tác duy nhất; hoặc challenge step-up riêng có `last_accepted_step` cùng factor | Tránh replay; chấp nhận chờ ≤30s |
| D8 | Mã lỗi | Đặt tên mới có tiền tố `ADMIN_` (vd. lời mời hết hạn/thu hồi/không hợp lệ, SĐT đã tồn tại, thiếu quyền, phiên bản đổi, thao tác chưa xác định kết quả); chống liệt kê: token sai/hết hạn/thu hồi trả cùng mã công khai | Map với UI-05 §13; cần danh sách và status HTTP do ChatGPT khóa |
| D9 | Replay/idempotency | `Idempotency-Key` bắt buộc cho tạo/cấp lại/thu hồi/đổi quyền/khóa; tạo & cấp lại dùng replay "sensitive" (token chỉ giải mã sau khi kiểm quyền lại); TTL replay mặc định 900s ⇒ sau đó SYSTEM phải **cấp lại** (token mới), không đọc lại token cũ | Khớp mô hình register; token chỉ hiện một lần |
| D10 | Khôi phục 2FA | Chỉ SYSTEM, lý do bắt buộc, step-up (D7): xóa factor + hủy challenge + thu hồi phiên, ADMIN phải enroll lại sau đăng nhập mật khẩu; **SYSTEM mất 2FA/bị khóa vẫn chưa có đường khôi phục** (rủi ro #34 chấp nhận) ⇒ cần quyết định riêng (lệnh vận hành) | Handoff: khôi phục không được bỏ qua 2FA |
| D11 | Mô hình quyền | Bảng quyền `(admin, app, action)` với action ∈ {VIEW, REVIEW_PROFILE, LOCK}; CHECK: REVIEW/LOCK ⇒ có VIEW; Khách không có REVIEW; gắn `membership.version`; trả qua `me`. Phạm vi "Quản lý" (app quản lý) trong business-design **không có trong ma trận UI** ⇒ cần chốt có/không | UI-01 §02 và §03 |
| D12 | Hợp đồng app quản lý Android | Chưa thiết kế; không dùng cookie web. Chỉ ghi nhận | Bước 6 |
| D13 | Danh tính hiển thị | Họ tên ADMIN lưu ở bảng lời mời/profile admin (không thêm cột vào `app.users`); "Khách" cần định nghĩa (user chưa có role?) vì không có role/hồ sơ khách | UI-03/04 |
| D14 | Audit đọc | Chốt cấu trúc `metadata` (reason, before/after), actor `ADMIN/SYSTEM`, mã thao tác hiển thị, index đọc | UI-04 §11–12; cấm secret trong audit |
| D15 | Gỡ mâu thuẫn tài liệu | Cập nhật `M01-D-business-design.md` (mật khẩu tạm) và ghi nguồn thắng thế | Mục 5.2-1 |

## 7. Môi trường kiểm thử (OTP) — báo cáo
- Dev/test: `FakeOtpProvider` in-memory (`auth/fake-otp-provider.ts`), chỉ test truy cập `lastOtpFor`; **Owner chưa có đường đọc OTP local** (xác nhận trong #33).
- Staging/production: không có provider; #27 chỉ thêm `DisabledOtpProvider` để **đóng** OTP/register trong fixture mode, không gửi mã.
- Không dùng OTP giả ở production; không bỏ Origin/CSRF/Secure (#34/#35 giữ nguyên, `__Host-` buộc HTTPS; local dùng chứng chỉ tự ký qua `admin-web:cert`).
- Chưa kiểm tra môi trường Owner test hay DB nào đã áp migration nào (CHƯA KIỂM CHỨNG); không kết nối DB trong task này.

## 8. Rủi ro migration `account_origin` giữa #27 và #34

**Bằng chứng từ repo (không suy diễn lịch sử DB):**
| | #27 | #34 |
|---|---|---|
| File | `1791849600000_add-users-account-origin.sql` | `1791936000000_add-users-account-origin.sql` |
| Giá trị `account_origin` | `PHONE_VERIFIED`, `STAGING_FIXTURE` | `PHONE_VERIFIED`, `ADMIN_PROVISIONED` |
| Constraint | `users_account_origin_ck`, `users_origin_verified_ck` (cùng tên) | cùng tên |
| Cột | `ADD COLUMN account_origin` | `ADD COLUMN account_origin` |
- Cả hai cùng `ADD COLUMN` và `ALTER COLUMN phone_verified_at DROP NOT NULL`; không `IF NOT EXISTS` (cố ý, để lỗi hiện rõ). Runner từ xa dùng `node-pg-migrate` với `checkOrder: true` (`scripts/db-migrate-remote.js`; local `scripts/db-migrate.js` chưa xác nhận).
- Hệ quả theo kịch bản (suy luận từ file, **không** biết DB nào ở trạng thái nào):
  1. DB đã áp #27 rồi chạy #34 → `ADD COLUMN` lỗi, rollback nguyên khối (không hỏng dữ liệu nhưng #34 không áp được).
  2. DB đã áp #34 rồi chạy #27 → vi phạm thứ tự (`1791849600000` < migration đã chạy) và trùng cột.
  3. Cả hai chưa áp ở đâu → bên merge sau phải được viết lại trước khi merge.
- `main` hiện **không chứa** cột này. Mô tả #27 nói rõ "chưa migrate/seed Supabase thật"; mô tả #34 nói nếu #27 đã apply ở đâu thì phải dừng và đối chiếu lịch sử DB. Cả hai là **lời khai trong PR, không phải bằng chứng trạng thái DB**.
- Xung đột mã: `git merge-tree` giữa #34 và #27 báo xung đột ở `role-context-service.spec.ts`, `session-authorization-participant.ts`, `session-repository.ts`, `session-service.ts`, `user-repository.ts`, `app-config.ts`, `all-exceptions.filter.spec.ts` và nhiều test migration; kèm xung đột **ngữ nghĩa**: #34 từ chối mọi origin ≠ PHONE_VERIFIED ở app, trong khi #27 chủ đích cho `STAGING_FIXTURE` đăng nhập app trong fixture mode. #27 còn tách từ main cũ nên so hai chiều với `main` hiện "xóa" `AGENTS.md`, `CLAUDE.md`, workflow, checklist (merge ba chiều giữ nguyên, nhưng cần rebase trước review).
- Đề xuất (cho ChatGPT chốt): nghe theo `M01-D-LOGIN-preflight-decisions.md` (#30 dòng 29–30) — #34 sở hữu `ADD COLUMN`; #27 phải rebase sau #34 và migration của #27 chỉ mở rộng CHECK thêm `STAGING_FIXTURE`; chính sách app phải phân biệt rõ `ADMIN_PROVISIONED` luôn bị từ chối.
- **Gate trước mọi merge/deploy** (Owner/operator thực hiện, read-only): liệt kê `name` trong bảng lịch sử migration của từng môi trường (remote: `app.pgmigrations`; local/CI: `public.pgmigrations`), ghi có/không cho `1791849600000` và `1791936000000`/`1792022400000`. Không reset DB Owner test; không chạy migration/seed trong task này; không chạy suite phá dữ liệu vào DB Owner test/staging.

## 9. Đề xuất các gói nhỏ

| Gói | Phạm vi | Dependency | Test kỹ thuật tối thiểu | Review | Gate Owner |
|---|---|---|---|---|---|
| 0 (gate) | Hòa giải #34/#27 + kiểm lịch sử DB; ChatGPT chốt D1–D15; ảnh UI bổ sung (màn lời mời đã tạo, vào bằng link, cấp lại/thu hồi, tab Thông tin/Lịch sử ADMIN) | #34 được review; Owner duyệt ảnh mới | Kiểm kê lịch sử migration (read-only) | ChatGPT | Duyệt ảnh bổ sung |
| 1. Tạo lời mời + kích hoạt ADMIN | Migration (lời mời, OTP kích hoạt, quyền ban đầu, mở rộng CHECK origin/limiter nếu D4/D8); guard + CSRF quản trị dùng lại; route SYSTEM tạo/cấp lại/thu hồi; route công khai nhận lời mời (OTP → mật khẩu → nối enrollment); audit; idempotency; web: màn tạo + màn kích hoạt trên nền #35 | #34 merge; #35 (nếu UI chung); D1–D9, D11; kênh OTP thử (M00-LOCAL-OTP) | Quyền âm tính (ADMIN tạo ADMIN, SYSTEM thứ hai, payload role); SĐT trùng + race đăng ký app; lời mời hết hạn/thu hồi/cấp lại; OTP sai/hết/replay/khác người nhận; proof không dùng cho `/auth/register`; chưa 2FA không có phiên; kích hoạt đồng thời & mất response; rollback/unknown commit; audit không chứa secret; origin cô lập app | ChatGPT review đúng SHA cuối | Local web: tạo lời mời → kích hoạt → đăng nhập; thiết bị thật: Authenticator thật; kênh OTP thử đã ghi trong evidence |
| 2. Quản lý ADMIN | Danh sách/chi tiết, đổi quyền (bump version), khóa/mở khóa, khôi phục 2FA, thu hồi phiên; step-up D7 | Gói 1 đã review + Owner local | Quyền theo phạm vi; đổi/khóa trong lúc request; phiên cũ bị từ chối; replay | ChatGPT | Local + Authenticator thật |
| 3. Khách | Danh sách, chi tiết, khóa/mở khóa, thu hồi phiên, lịch sử | Gói 2; định nghĩa "Khách" (D13); đọc audit (D14) | Khóa + thu hồi phiên nguyên tử; mở khóa không đổi hồ sơ; lịch sử không secret | ChatGPT | Local web + app Khách (nếu có) |
| 4. Quán | Hồ sơ, duyệt/bổ sung, trạng thái tài khoản | Gói 3; thiết kế workflow duyệt (shop chưa có trạng thái duyệt); đối chiếu onboarding/điều kiện hoạt động | Duyệt không tự bật nhận đơn; khóa không hủy đơn/đổi ví | ChatGPT | Local + thiết bị Quán |
| 5. Xế | Hồ sơ, xác minh, trạng thái | Gói 4; đối chiếu driver/wallet (không tự làm ví) | Như trên + loại xế | ChatGPT | Local + thiết bị Xế |
| 6 | App quản lý + hồi quy liên thông | Hợp đồng xác thực native riêng | — | ChatGPT | Thiết bị thật |

Mỗi gói: giữ nền web quản trị #35 (`apps/admin-web`), không tạo ứng dụng song song. Gate từng app theo [mẫu module](../templates/module-delivery-checklist.md); một app đạt không kéo cả bước đạt.

## 10. Phần thiết kế UI chưa có (trả về ChatGPT/Owner, không tự đổi bố cục)
Ảnh đã duyệt không có: màn sau khi tạo lời mời (link/mã một lần, copy, cấp lại, thu hồi); màn vào bằng link lời mời; tab "Thông tin" và "Lịch sử" của ADMIN; trạng thái và nút cho ADMIN "Chờ kích hoạt"; khóa/mở khóa ADMIN; xác nhận thu hồi phiên Khách/ADMIN; tab Hồ sơ/Bảo mật của Quán/Xế; form "Yêu cầu bổ sung"/"Duyệt hồ sơ"; "Tổng quan", "Nhật ký quản trị", "Cài đặt"; lỗi "chưa đủ quyền theo phạm vi" ở cấp từng màn. Phạm vi "Quản lý" có trong business-design nhưng không có trong ma trận UI-01.

## 11. Checklist gate (chưa có mục nào được tick)
Theo mẫu: kiểm kê nguồn (tài liệu này, đang chờ review) → Owner duyệt nghiệp vụ/API/dữ liệu/ca lỗi → ảnh UI (đã có 5 bộ, còn thiếu mục 10) → gói giao Claude → code/CI → ChatGPT review → Owner local → bản điện thoại → Owner thiết bị thật → liên thông → Owner nghiệm thu. Trạng thái: NGHIỆP VỤ + 5 BỘ UI OWNER ĐÃ DUYỆT; KIỂM KÊ BACKEND XONG (tài liệu này); HỢP ĐỒNG IMPLEMENTATION CHƯA KHÓA; CHƯA CÓ CODE; #34/#35 CHƯA MERGE/NGHIỆM THU; M01 CHƯA ĐÓNG.
