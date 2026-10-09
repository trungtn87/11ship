# M01-D-LOGIN-BE — contract và handoff backend
Ngày09/10/2026. Thiết kế kỹ thuật để review trước implementation. Owner đã chốt nghiệp vụ/tham số; chưa có CI/review code/local/thiết bị.
Nguồn: M01-D-login-contract-draft.md, M01-D-business-design.md, ADR-002, workflow main.
Phụ lục này thay phần transport/API/schema tạm trong draft: web dùng cookie, không response bearer. Không tự khóa toàn bộ M01.
ChatGPT thiết kế/review; Claude code/migration/tests; Owner local/thiết bị/merge. UI trang chủ/tạo ADMIN ở task tiếp.

## Handoff
Claude đọc main AGENTS.md/workflow, fetch main và ghi base SHA thật; đọc các file thiết kế ở PR#30 tại head chứa phụ lục này. Không bắt đầu từ nhánh UI #31.
Tách backend thành PR Draft riêng. Không code UI trong PR này; chỉ sửa Auth app cũ ở account-origin repository/guard/participant và registration default như contract dưới; giữ behavior PHONE_VERIFIED. Không sửa M00 runtime. Nếu technical contract mâu thuẫn schema thực tế, báo finding trước thay đổi.
Giao bộ backend bootstrap, enrollment/challenge/session cookie/me/logout; tạo ADMIN, scope editor/recovery không nằm ở gói này.
Không auto-merge, seed/deploy thật hoặc ghi Owner nghiệm thu.

## Cookie, CSRF và origins
Public origin quản trị HTTPS được cấu hình tường minh; frontend/API cùng origin qua proxy. API vận hành dưới /v1/admin-auth.
Session cookie __Host-11admin: Secure; HttpOnly; SameSite=Strict; Path=/; không Domain. Max-Age tới hết TTL8h server, không sliding.
Preauth cookie __Host-11admin-pre: thuộc tính tương tự, TTL5m. Cookie hết hạn/xóa với cùng attrs; không trả token trong JSON.
POST login bắt buộc Origin khớp allowlist chính xác; kiểm application/json. Thiếu/sai Origin từ chối; không wildcard/CORS credentials origin tùy ý.
Mọi POST sau login kiểm Origin và X-CSRF-Token, bind preauth/session. Token CSRF ổn định trong lifetime credential: HMAC-SHA256 bằng keyring purpose riêng trên canonical tuple(type,credential_id,csrf_nonce), base64url32byte. DB lưu csrf_nonce CSPRNG32byte và csrf_key_id, không csrf_digest. GET /state và /me derive lại cùng token, không rotate hoặc ghi DB; constant-time verify. Key lịch sử phải còn đến expiry, thiếu key fail503; không fallback key mới.
Rotate CSRF khi cấp preauth mới hoặc cấp session mới; preauth token không hợp lệ cho session. Reload/multiple tabs không invalidate token của credential đang còn hoạt động. CSRF không kéo dài TTL. Không auto-retry mutation sau network error.
Không dùng GET để ghi nghiệp vụ hoặc thay credential.
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
| POST /totp/enrollment/verify | code | 200 user_id,admin_role,expires_at,csrf_token; cookie session, xóa preauth |
| POST /totp/verify | code | Như trên |
| GET /me | Không | 200 user_id,admin_role,expires_at,csrf_token; chỉ session đã2FA |
| POST /logout | {} | 204; revoke cookie session, xóa cookie; valid CSRF với session còn hoạt động |
code là string đúng6 ASCII digits, không trim. active role SYSTEM/ADMIN do server lấy membership. Gói login chưa trả scopes và chưa cấp quyền module cho ADMIN; task tạo ADMIN/phân quyền sẽ thêm schema/API scopes riêng. SYSTEM toàn quyền theo admin_role phía server; ADMIN chỉ vào account/auth shell, không có quyền nghiệp vụ mặc định. Client không được coi thiếu scopes là toàn quyền.
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
| app.admin_auth_challenges | challenge_id PK,user_id FK,token_digest UNIQUE,csrf_nonce,csrf_key_id,password_binding,password_key_id keyed digest,membership_version,factor_id nullable,factor_version nullable,device_id,expires_at,attempt_count0..5,consumed_at,created_at; no plaintext password/preauth |
| app.admin_sessions | session_id PK,user_id FK,token_digest UNIQUE,csrf_nonce,csrf_key_id,password_binding,password_key_id,membership_version,factor_id,factor_version,device_id,mfa_completed_at,expires_at,revoked_at,created_at; partial UNIQUE user_id WHERE revoked_at IS NULL |
| app.admin_auth_limit_config | singleton_id PK CHECK=1, limiter_key_id NOT NULL, key_check HMAC digest NOT NULL; init dưới khóa, config khác từ chối, không overwrite khi startup |
| app.admin_auth_limits | bucket_key PK (HMAC identity bằng limiter key riêng ổn định, không phone plaintext),kind LOGIN_PHONE/LOGIN_IP/LOGIN_REQUEST_IP/TOTP_USER,window_started_at,failure_count>=0,locked_until nullable,updated_at |
Pending factor binding: pending_challenge_id FK challenge (challenges không FK factor), factor_id/factor_version trong challenge là snapshot scalar (không FK tới generation có thể xóa). Không FK cycle. Một factor PENDING/user, owner challenge cố định.
Login mới khi factor chưa ACTIVE supersede challenge preauth chưa consumed trước đó dưới user lock, clear pending factor của challenge cũ nếu có; không ảnh hưởng admin session. Tab cũ trở thành ADMIN_PREAUTH_INVALID. Đây là quy tắc tường minh thay “hai challenge sống tùy implementation”.
POST enrollment: khóa theo thứ tự đã chốt, kiểm challenge chưa consumed/chưa hết hạn/password/member snapshot còn hợp lệ. Khi chưa có pending factor, tạo factor_id UUID mới, version1, state PENDING và pending_challenge_id=current challenge; update challenge.factor_id=factor_id mới và challenge.factor_version=1 trong cùng transaction. Không trả secret trước commit.
Enrollment cùng challenge trả cùng factor/secret chỉ khi factor owner và snapshot version khớp. Snapshot null với factor đã tồn tại hoặc mismatch trả ADMIN_PREAUTH_INVALID, không tự sửa snapshot.
Enrollment verify yêu cầu factor PENDING, pending_challenge_id khớp, challenge.factor_id=factor.factor_id và challenge.factor_version=factor.version; xác nhận đúng mã chuyển ACTIVE nhưng GIỮ factor_id/version (version định danh generation secret, không là version mọi UPDATE), clear pending binding, set activated_at và last_accepted_step, consume challenge và tạo session.factor_id/factor_version cùng generation atomic. Reset/replacement tương lai đổi factor_id/version và re-encrypt AAD, không nằm gói này.
Factor ACTIVE login mới snapshot active factor.factor_id và factor.version ngay khi tạo challenge; không được start enrollment. Supersede pending xóa pending generation cũ rồi generation mới dùng factor_id mới, version1; challenge cũ invalid và không thể dùng lại. AAD gồm factor_id nên version1 không làm reuse binding generation.
Enrollment cùng challenge trả cùng factor/secret. Challenge khác không sửa/reuse factor đang sống; nếu login mới supersede thì tạo factor_id/version và secret mới, invalidate QR cũ.
GET/state không auto-clear factor. Challenge expired không thể verify; login kế tiếp clear pending stale dưới lock rồi tạo challenge mới. Active factor không bị supersede/reset. Enrollment verify chuyển ACTIVE, clear pending binding và consume challenge atomic. ACTIVE factor không thay version khi verify/login; không reset last_accepted_step. Rotation encryption key giữ factor generation/version, decrypt/re-encrypt cùng AAD; replacement secret là quy trình riêng.
Tests phải chứng minh hai tab, supersession, expiry/reissue, loss-response và không overwrite active factor.
Revoking stale unrevoked expired sessions trước insert session mới giữ unique constraint.
Bootstrap theo schema account_origin phía dưới; không tạo phone_verified_at hoặc proof giả.
Password binding challenge VÀ session: HMAC purpose riêng trên tuple(user_id,current_password_hash), lưu binding và password_key_id. Mỗi /state,/me,verify và mutation đọc password hiện tại dưới user lock, recompute bằng stored historical key; khác thì invalidate credential. Key thiếu fail503, không miễn check. Mọi writer password tương lai đổi hash và revoke admin challenges/sessions cùng user transaction; binding là chốt an toàn bổ sung. Password PHC không trả/log trong metadata.
TOTP secret20byte CSPRNG, Base32, SHA1/6digits/30s; issuer11, label phone Owner cấu hình; secret mã hóa AEAD purpose riêng, AAD user/factor/version. Chỉ current/previous timestep; last_accepted_step tăng monotonic dưới khóa, không replay. Keyring lịch sử để decrypt; thiếu/hỏng fail closed.

## Transaction và rate limits
Password hash verify ngoài transaction; recheck hash/binding và ACTIVE dưới khóa.
Lock order TOTP business: TOTP_USER rate bucket → user → membership → factor → challenge → sessions; mọi enrollment/verify/cancel/new preauth cùng user dùng thứ tự này nếu cần bucket. Không lấy bucket sau user lock. Không có transaction lồng nhau.
Verify khóa bucket trước và đọc giờ DB fresh: nếu lock còn hiệu lực hoặc challenge đã invalid/expired/consumed thì từ chối trước verifier. Với challenge hợp lệ, kiểm attempts dưới khóa; code malformed bị validation400, vẫn chịu ingress request quota.
Sai TOTP: tăng challenge attempt và user failure_count cùng transaction; đạt5 thì locked_until=now+15m, challenge đạt5 bị consumed/invalid. Commit counters rồi mới trả ADMIN_TOTP_INVALID hoặc RATE_LIMITED; không throw trong callback gây rollback. Kiểm code thành công, consume/revoke/session/audit cũng trong transaction đó. Budget không reset theo challenge mới hoặc login mật khẩu đúng.
Window15m bắt đầu failure đầu tiên; hết window và không còn lock thì reset trước failure mới. Lock không kéo dài theo requests bị chặn; success không reset failure budget. Concurrent request sau failure thứ5 thấy lock dưới cùng bucket lock, không chạy verifier.
Login request quota10/phút/IP trước Argon2: atomic reserve request slot trong store shared, không rollback khi password sai; kind LOGIN_REQUEST_IP bổ sung schema. Phone/IP password failure budgets10/15m dùng atomic locks ordered bucket_key. Password result phải quyết định và update failures/check lock dưới cả bucket locks trước user/member; login request đã qua Argon2 cũng recheck lock trước cấp preauth. Chặn failures đã tới ngưỡng, không cấp challenge sau lockout. Quota request hạn chế concurrency Argon2, không diễn giải password failure quota là tối đa số hash chạy.
Counters commit khi credential invalid; lỗi storage fail closed. Không tách TOTP attempt và user failure thành transactions có crash gap. Sai password counter transaction không ghi session; thành công preauth rechecks user/password/member và rate locks.
Limiter key contract: ADMIN_RATE_LIMIT_HMAC_KEY là secret32byte riêng, bắt buộc khi module admin bật; không thuộc CRYPTO_ACTIVE_KEY_ID/keyring. Bucket=HMAC-SHA256(key,canonical tuple(kind,identity)); phone normalized, IP normalized binary/canonical string, TOTP user UUID. Không thay key/format giữa instances; deployment kiểm limiter_key_id cấu hình cố định cùng DB.
Bảng app.admin_auth_limit_config singleton lưu limiter_key_id và key_check HMAC trên context constant; module kiểm khớp secret/id trước nhận request. Không plaintext key trong DB. Crypto keyring rotation không đổi limiter bucket, counters hoặc lockouts. Sai/mất limiter key => startup/readiness fail closed, không tạo namespace bucket mới.
Gói này không hỗ trợ live rotation limiter key: operator không tự đổi biến để reset locks. Nếu cần rotation riêng phải maintenance, ngừng toàn bộ writers, giữ old key để ánh xạ identity hoặc migration bảo toàn lock state có thiết kế/review; chưa có runbook được duyệt thì không rotate. Restore limiter config+counters cùng DB; không truncate/reset khi restart.
Tests khóa user/IP rồi rotate CRYPTO key, restart và nhiều instances giữ cùng lock; limiter key khác/thiếu bị từ chối, không nhận login. Thêm strict response GET/me không scopes và enrollment snapshot/generation tests.
Theo deployment loopback/default không trust X-Forwarded-For; proxy trust config phải là IP/hops allowlist, không trust all. Khi proxy chưa khóa, không public deploy.
Success consume challenge + activate factor(if needed) + revoke sessions cũ + insert mới + audit cùng transaction. Admin session verified phải có user ACTIVE, password binding match, membership ACTIVE/version match và factor ACTIVE/id+version match mỗi request.
Mutation luôn authorization recheck dưới locks. Session mới chỉ được cấp sau commit thành công; audit exception rollback toàn bộ.
Audit action names ADMIN_SYSTEM_BOOTSTRAPPED,ADMIN_LOGIN_PREAUTH,ADMIN_TOTP_ENROLLED,ADMIN_LOGIN_COMPLETED,ADMIN_LOGOUT; metadata chỉ ID/version không credential/phone/code.
Không implementation recovery hoặc privileged reset tự động.

## Bootstrap và recovery giới hạn
CLI operator ngoài HTTP, nguồn credential stdin không argv/env output; DB target guard dev/staging được chỉ định, production command không tự chạy trong task này.
Singleton transaction serialize, no-op khi cùng SYSTEM phone; refuse conflict existing user/different phone. Không password default.
Chưa có SYSTEM recovery: giữ keyring backup và runbook bảo toàn factor, không bỏ 2FA khi mất máy. Không rollout vận hành chính thức trước task recovery đạt.
Migration users đã đối chiếu; áp dụng origin contract phía dưới, không blocker bootstrap còn treo.

## Test/evidence
Unit validators/config/crypto/TOTP vectors; integration PG17 concurrent bootstrap/enroll/verify/replay/rate-limit/revoke, cookie/Origin/CSRF/audience, ciphertext/key unavailable, loss-response, logout.
Regression auth/onboarding cũ; lint/typecheck/build/unit/integration theo guard DB test; CI final head.
Fixture ADMIN test chỉ DB test protected, không tạo public API/role override.
Runbook migrate additive/backup/restore; rollback không drop factor/user/audit hoặc bật auth thiếu2FA.
PR evidence ghi base/head/version/results/limits; backend CI chưa chứng minh browser reload hay Google Authenticator thật. Local/device chờ M00.

## Gate
Nghiệp vụ/param đã Owner chốt. Backend contract đang hoàn thiện: F01–F06 và R01–R03 được sửa trong contract này; cần re-review đúng head mới, không dùng review head cũ để mở code.
Web login Owner duyệt trong phạm vi đã nói, UI integration/states chưa toàn bộ đạt.
App quản lý/Khách/Quán/Xế chưa nghiệm thu; chỉ regression backend gói này. Không merge/đóng module.

## Bổ sung sau đối chiếu migration users — nguồn tài khoản quản trị
Đã đọc database/migrations/1791504000000_create-auth-core.sql trên main (blob c3330b2a2e3fa3f0c5ed5667a3f85a1b8726f2ca): phone_verified_at NOT NULL. Không thể bootstrap đúng nếu chỉ thêm admin_memberships.
Thiết kế giải quyết: migration additive thêm account_origin varchar NOT NULL DEFAULT 'PHONE_VERIFIED', CHECK enum PHONE_VERIFIED/ADMIN_PROVISIONED; backfill user cũ PHONE_VERIFIED; default giữ INSERT registration hiện hữu hoạt động; cho phone_verified_at nullable với CHECK:
PHONE_VERIFIED => phone_verified_at IS NOT NULL; ADMIN_PROVISIONED => phone_verified_at IS NULL.
SYSTEM bootstrap tạo users ADMIN_PROVISIONED + membership SYSTEM atomic. Không tạo OTP/proof giả và không tự ghi timestamp verified.
Giữ uniqueness phone toàn users. Origin không mang quyền; membership và MFA vẫn quyết định quyền quản trị.
ADMIN_PROVISIONED không được /auth/login hoặc app session authorization chấp nhận trong gói này; trả INVALID_CREDENTIALS/SESSION_INVALID. Đây là guard additive bắt buộc, không thay behavior PHONE_VERIFIED cũ. Kiểm lại dưới khóa trong participant, không chỉ login/HTTP guard.
Khi membership bị khóa, origin không tự biến tài khoản thành app user. App/role onboarding của tài khoản quản trị chưa thuộc gói này.
PR#27 chưa merge cũng thêm account_origin: Claude không cherry-pick implementation fixture. Nếu main có thay đổi origin trước bắt đầu, dừng báo reconciliation; không tạo hai migration cùng cột hoặc làm mất STAGING_FIXTURE policy.
Migration xuống không được phục hồi NOT NULL khi còn ADMIN_PROVISIONED; fail rõ và bảo toàn dữ liệu, không tự xóa user quản trị. Production rollout/rollback chỉ sau runbook và review.
Bổ sung tests: backfill verified giữ nguyên, CHECK combinations, bootstrap origin admin/null verified, app guard từ chối admin-provisioned, regression verified vẫn đăng nhập, migration rollback refusal.
Origin là phần contract hiện hành, không blocker hoặc override ngầm. Thiết kế thay đổi account origin/guard phải được review cùng gói, không gọi đã code hoặc đạt CI.
