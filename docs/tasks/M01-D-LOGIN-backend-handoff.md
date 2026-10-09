# M01-D-LOGIN-BE — contract và handoff backend
Ngày09/10/2026. Thiết kế kỹ thuật để review trước implementation. Owner đã chốt nghiệp vụ/tham số; chưa có CI/review code/local/thiết bị.
Nguồn: M01-D-login-contract-draft.md, M01-D-business-design.md, ADR-002, workflow main.
Phụ lục này thay phần transport/API/schema tạm trong draft: web dùng cookie, không response bearer. Không tự khóa toàn bộ M01.
ChatGPT thiết kế/review; Claude code/migration/tests; Owner local/thiết bị/merge. UI trang chủ/tạo ADMIN ở task tiếp.

## Handoff
Claude đọc main AGENTS.md/workflow, fetch main và ghi base SHA thật; đọc các file thiết kế ở PR#30 tại head chứa phụ lục này. Không bắt đầu từ nhánh UI #31.
Tách backend thành PR Draft riêng. Không code UI trong PR này; không sửa Auth app cũ hoặc M00 runtime. Nếu technical contract mâu thuẫn schema thực tế, báo finding trước thay đổi.
Giao bộ backend bootstrap, enrollment/challenge/session cookie/me/logout; tạo ADMIN, scope editor/recovery không nằm ở gói này.
Không auto-merge, seed/deploy thật hoặc ghi Owner nghiệm thu.

## Cookie, CSRF và origins
Public origin quản trị HTTPS được cấu hình tường minh; frontend/API cùng origin qua proxy. API vận hành dưới /v1/admin-auth.
Session cookie __Host-11admin: Secure; HttpOnly; SameSite=Strict; Path=/; không Domain. Max-Age tới hết TTL8h server, không sliding.
Preauth cookie __Host-11admin-pre: thuộc tính tương tự, TTL5m. Cookie hết hạn/xóa với cùng attrs; không trả token trong JSON.
POST login bắt buộc Origin khớp allowlist chính xác; kiểm application/json. Thiếu/sai Origin từ chối; không wildcard/CORS credentials origin tùy ý.
Mọi POST sau login kiểm Origin và X-CSRF-Token 32byte ngẫu nhiên, lưu digest, bind preauth/session tương ứng. GET /state trả csrf_token mới và next_step cho preauth, hoặc trạng thái session; GET /me trả csrf_token mới cho session. Rotate token dưới khóa; tab nhận lỗi CSRF được fetch lại state/me nhưng không auto-retry mutation.
Không dùng GET để ghi nghiệp vụ; token CSRF rotate chỉ là credential vận hành.
Response xác thực/QR/state/me no-store; không token/QR trong telemetry/log. Bất kỳ admin cookie nào không được guard app coi là app bearer.
Local HTTP không được hạ Secure; test HTTP harness kiểm Set-Cookie riêng, browser acceptance cần M00 HTTPS.

## API exact body và response
Device login dùng object device_id/platform/app; platform=WEB, app=ADMIN_WEB, device_id theo regex auth hiện có; không bằng chứng cấp quyền.
Strict object, từ chối field lạ. Phone/password parser tái sử dụng validator hiện có, không policy password mới.
| Endpoint | Body | 2xx data |
|---|---|---|
| POST /login | phone,password,device | 200 next_step ENROLL_TOTP/VERIFY_TOTP,expires_at,csrf_token; Set-Cookie preauth |
| GET /state | Không | 200 state PREAUTH/SESSION,next_step nullable,expires_at,csrf_token; cần cookie hợp lệ |
| POST /totp/enrollment | {} | 200 secret,otpauth_uri,expires_at; preauth+CSRF; chỉ factor chưa active |
| POST /totp/enrollment/verify | code | 200 user_id,admin_role,scopes,expires_at,csrf_token; cookie session, xóa preauth |
| POST /totp/verify | code | Như trên |
| GET /me | Không | 200 user_id,admin_role,scopes,expires_at,csrf_token; chỉ session đã2FA |
| POST /logout | {} | 204; revoke cookie session, xóa cookie; valid CSRF với session còn hoạt động |
code là string đúng6 ASCII digits, không trim. active role SYSTEM/ADMIN do server lấy membership. SYSTEM scopes=[] với semantics toàn quyền; ADMIN scopes từ membership, chưa có API cấp scope trong gói này.
Logout thiếu/expired/revoked session: với Origin hợp lệ trả204 và xóa cookie; không mutation. Với session hợp lệ vẫn phải CSRF.
GET/state không trả factor secret. Enrollment rerun cùng pending challenge trả cùng secret pending, không tạo secret mới; QR client dựng từ otpauth_uri.
Không Idempotency-Key ở login/verify: challenge one-use; không auto-retry cấp phiên. Lost response: GET/me nếu cookie đã được browser nhận; nếu không nhận phiên thì login mới và mã TOTP mới. Chưa xác minh outcome thì không báo thành công.

## Errors (giữ envelope/filter hiện hữu)
INVALID_PHONE400, BAD_REQUEST400, INVALID_CREDENTIALS401 giữ definition cũ.
No membership/inactive/wrong password login: INVALID_CREDENTIALS để không lộ privilege.
ADMIN_PREAUTH_INVALID401: “The authentication step is not valid”.
ADMIN_TOTP_INVALID400: “The authentication code is not valid” — sai/window/replay cùng code.
ADMIN_AUTH_RATE_LIMITED429: “Too many authentication attempts; try again later”; Retry-After giây lock còn lại.
ADMIN_CSRF_INVALID403: “The request could not be verified”.
ADMIN_SESSION_INVALID401: “The administration session is not valid” — missing/revoke/expire/no active membership.
ADMIN_ENROLLMENT_NOT_ALLOWED409: “Authenticator setup is not available”.
Crypto/storage lỗi dùng SERVICE_UNAVAILABLE503 hiện hữu; outcome unknown giữ TRANSACTION_OUTCOME_UNKNOWN503. Không echo dữ liệu/constraint/secret.
Code enum phải thêm vào registry, không trả lỗi động.

## Schema relational — migration additive
UUID IDs theo repo, timestamps timestamptz DB clock; digest lowercase hex SHA256. Không FK cascade xóa audit.
| Table | Cột và constraint chính |
|---|---|
| app.admin_memberships | user_id PK/FK users, admin_role SYSTEM/ADMIN CHECK, status ACTIVE/DISABLED CHECK, version bigint positive, created_at/updated_at; partial UNIQUE trên admin_role WHERE SYSTEM (mọi status), không tạo SYSTEM thứ2 |
| app.admin_totp_factors | user_id PK/FK membership, factor_id UUID UNIQUE, state PENDING/ACTIVE, version bigint positive, key_id,ciphertext,iv,tag, last_accepted_step bigint nullable, pending_challenge_id UUID nullable, created_at/activated_at; state/activated_at và pending binding CHECK |
| app.admin_auth_challenges | challenge_id PK,user_id FK,token_digest UNIQUE,csrf_digest,password_binding keyed digest,membership_version,factor_version nullable,device_id,expires_at,attempt_count0..5,consumed_at,created_at; no plaintext password/preauth |
| app.admin_sessions | session_id PK,user_id FK,token_digest UNIQUE,csrf_digest,membership_version,factor_version,device_id,mfa_completed_at,expires_at,revoked_at,created_at; partial UNIQUE user_id WHERE revoked_at IS NULL |
| app.admin_auth_limits | bucket_key PK (HMAC identity, không phone plaintext),kind LOGIN_PHONE/LOGIN_IP/TOTP_USER,window_started_at,failure_count>=0,locked_until nullable,updated_at |
Constraints chi tiết pending_factor/challenge FK cycle phải dùng FK deferred/nullable hợp lệ; enrollment verify chuyển ACTIVE và clear pending binding atomic.
Revoking stale unrevoked expired sessions trước insert session mới giữ unique constraint.
Bootstrap không insert phone_verified_at giả: users hiện hữu có invariant verified cần được đối chiếu đầy đủ trước SQL. Nếu không thể tạo SYSTEM unverified đúng invariant, dùng explicit migration account-origin quản trị riêng, phải trả thiết kế bổ sung trước code, không set verified timestamp để lách. Đây là blocker schema còn cần giải quyết khi đọc migration users.
Không dùng token digest cho password binding: HMAC theo context user+password PHC version với keyring; bí mật không lưu plaintext.
TOTP secret20byte CSPRNG, Base32, SHA1/6digits/30s; issuer11, label phone Owner cấu hình; secret mã hóa AEAD purpose riêng, AAD user/factor/version. Chỉ current/previous timestep; last_accepted_step tăng monotonic dưới khóa, không replay. Keyring lịch sử để decrypt; thiếu/hỏng fail closed.

## Transaction và rate limits
Password hash verify ngoài transaction; recheck hash/binding và ACTIVE dưới khóa.
Lock order toàn nghiệp vụ: user → membership → factor → challenge → sessions; giới hạn bucket cập nhật trong transaction riêng ngắn trước business, thứ tự bucket_key lexical.
Rate-limit failure phải commit độc lập outcome business; không rollback mất attempt. TOTP failure attempt_count và budget persistent; kết quả lỗi sau commit counters. Storage lỗi không cho verify tiếp.
Đơn vị giờ DB sau locks. 5 TOTP failures/15m user và5/challenge; 10 password failures/15m phone/IP; đạt ngưỡng lock15m. Login request rate10/phút/IP trước Argon2 để giới hạn tải, không suy từ header IP do client cấp.
Theo deployment loopback/default không trust X-Forwarded-For; proxy trust config phải là IP/hops allowlist, không trust all. Khi proxy chưa khóa, không public deploy.
Success consume challenge + activate factor(if needed) + revoke sessions cũ + insert mới + audit cùng transaction. Admin session verified phải có membership active/version match và factor ACTIVE/version match mỗi request.
Mutation luôn authorization recheck dưới locks. Session mới chỉ được cấp sau commit thành công; audit exception rollback toàn bộ.
Audit action names ADMIN_SYSTEM_BOOTSTRAPPED,ADMIN_LOGIN_PREAUTH,ADMIN_TOTP_ENROLLED,ADMIN_LOGIN_COMPLETED,ADMIN_LOGOUT; metadata chỉ ID/version không credential/phone/code.
Không implementation recovery hoặc privileged reset tự động.

## Bootstrap và recovery giới hạn
CLI operator ngoài HTTP, nguồn credential stdin không argv/env output; DB target guard dev/staging được chỉ định, production command không tự chạy trong task này.
Singleton transaction serialize, no-op khi cùng SYSTEM phone; refuse conflict existing user/different phone. Không password default.
Chưa có SYSTEM recovery: giữ keyring backup và runbook bảo toàn factor, không bỏ 2FA khi mất máy. Không rollout vận hành chính thức trước task recovery đạt.
Cần đọc users migration để giải quyết account origin blocker nêu trên trước handoff được đánh ready.

## Test/evidence
Unit validators/config/crypto/TOTP vectors; integration PG17 concurrent bootstrap/enroll/verify/replay/rate-limit/revoke, cookie/Origin/CSRF/audience, ciphertext/key unavailable, loss-response, logout.
Regression auth/onboarding cũ; lint/typecheck/build/unit/integration theo guard DB test; CI final head.
Fixture ADMIN test chỉ DB test protected, không tạo public API/role override.
Runbook migrate additive/backup/restore; rollback không drop factor/user/audit hoặc bật auth thiếu2FA.
PR evidence ghi base/head/version/results/limits; backend CI chưa chứng minh browser reload hay Google Authenticator thật. Local/device chờ M00.

## Gate
Nghiệp vụ/param đã Owner chốt. Backend contract đang hoàn thiện: users origin đã có phương án ở phụ lục dưới; vẫn cần review kỹ thuật độc lập trước READY_FOR_CLAUDE.
Web login Owner duyệt trong phạm vi đã nói, UI integration/states chưa toàn bộ đạt.
App quản lý/Khách/Quán/Xế chưa nghiệm thu; chỉ regression backend gói này. Không merge/đóng module.

## Bổ sung sau đối chiếu migration users — nguồn tài khoản quản trị
Đã đọc database/migrations/1791504000000_create-auth-core.sql trên main (blob c3330b2a2e3fa3f0c5ed5667a3f85a1b8726f2ca): phone_verified_at NOT NULL. Không thể bootstrap đúng nếu chỉ thêm admin_memberships.
Thiết kế giải quyết: migration additive thêm account_origin PHONE_VERIFIED/ADMIN_PROVISIONED; backfill user cũ PHONE_VERIFIED; cho phone_verified_at nullable với CHECK:
PHONE_VERIFIED => phone_verified_at IS NOT NULL; ADMIN_PROVISIONED => phone_verified_at IS NULL.
SYSTEM bootstrap tạo users ADMIN_PROVISIONED + membership SYSTEM atomic. Không tạo OTP/proof giả và không tự ghi timestamp verified.
Giữ uniqueness phone toàn users. Origin không mang quyền; membership và MFA vẫn quyết định quyền quản trị.
ADMIN_PROVISIONED không được /auth/login hoặc app session authorization chấp nhận trong gói này; trả INVALID_CREDENTIALS/SESSION_INVALID. Đây là guard additive bắt buộc, không thay behavior PHONE_VERIFIED cũ. Kiểm lại dưới khóa trong participant, không chỉ login/HTTP guard.
Khi membership bị khóa, origin không tự biến tài khoản thành app user. App/role onboarding của tài khoản quản trị chưa thuộc gói này.
PR#27 chưa merge cũng thêm account_origin: Claude không cherry-pick implementation fixture. Nếu main có thay đổi origin trước bắt đầu, dừng báo reconciliation; không tạo hai migration cùng cột hoặc làm mất STAGING_FIXTURE policy.
Migration xuống không được phục hồi NOT NULL khi còn ADMIN_PROVISIONED; fail rõ và bảo toàn dữ liệu, không tự xóa user quản trị. Production rollout/rollback chỉ sau runbook và review.
Bổ sung tests: backfill verified giữ nguyên, CHECK combinations, bootstrap origin admin/null verified, app guard từ chối admin-provisioned, regression verified vẫn đăng nhập, migration rollback refusal.
Phụ lục này thay blocker bootstrap origin trong các đoạn trước. Thiết kế thay đổi account origin/guard phải được review cùng gói, không gọi đã code hoặc đạt CI.
