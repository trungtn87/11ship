# M01-D-LOGIN — quyết định sau preflight Claude
Ngày09/10/2026. Nguồn: báo cáo Claude Owner chuyển trong hội thoại; đối chiếu trực tiếp AuthModule, audit-entry, CryptoError/error-envelope/filter, remote migrator và migration origin PR#27.
Không có link/full document báo cáo Claude trong lời chuyển; không giả vờ đọc file list/bốn migration spec hoặc hai câu hỏi chưa được cung cấp.
Phụ lục ưu tiên phần kỹ thuật trùng nội dung trong handoff; nghiệp vụ Owner chốt giữ nguyên.
Phạm vi: backend implementation Draft; không UI/M00/deploy/merge. Claude preflight lại base trước code.

## 1. Ingress TOTP
Thêm kind TOTP_REQUEST_IP vào admin_auth_limits. Mọi POST /totp/enrollment,/totp/enrollment/verify,/totp/verify chịu quota30 requests/60s/IP trước parse code/cookie lookup/decrypt/verifier (sau Origin/content-type check). Request malformed/unknown challenge vẫn tốn slot.
Quota fixed window từ request đầu, atomic reserve shared PG, không kéo dài window theo bị chặn. Trả429 Retry-After tới hết window. Key HMAC limiter riêng như contract. User failure budget5/15m giữ nguyên, quota IP không thay budget.
Ingress quota chỉ transaction ngắn trước business; không lấy lại IP bucket sau user lock.
Login quota10/min/IP giữ nguyên. Source IP từ trusted proxy contract dưới, không từ device_id hay arbitrary header.

## 2. Limiter config lifecycle
Migration chỉ tạo table, KHÔNG seed secret/config check. Operator chạy CLI admin-auth:init-limit-config trước app start (development/test/staging đúng target guard).
CLI nhận ADMIN_RATE_LIMIT_HMAC_KEY và ADMIN_RATE_LIMIT_KEY_ID từ cấu hình operator; secret không in/log. Singleton insert dưới advisory lock, conflict existing kiểm ID+key_check constant-time; cùng config no-op, khác config từ chối không UPDATE.
Admin runtime không INSERT config lúc startup. Trước listen kiểm đọc row và key-check; thiếu/schema chưa migrate/sai secret từ chối startup/readiness, log tên cấu hình/fixed code. Integration harness init explicit trước start.
Bootstrap SYSTEM chỉ chạy sau config init thành công. Không auto seed trong migration/start/test production.

## 3. Module boundary
Không export thẳng UserRepository/PASSWORD_HASHER cho toàn module khác. Thêm Auth-owned AdminIdentityParticipant và AdminPasswordVerifier narrow ports:
- verifier verify credentials/dummy, hash bootstrap dùng Argon2 hiện hữu; không tự implementation Argon2 khác.
- identity reader/locker dùng TransactionContext, trả user identity/password binding input cần thiết; insert ADMIN_PROVISIONED bootstrap Auth-owned; không tự transaction trong participant.
AdminAuthModule nhận ports qua AppModule composition nơi AuthModule.register đã được tạo; export ports từ Auth, không import Auth lần hai bằng register khác. Không circular dependency/forwardRef.
SQL app.users tiếp tục do Auth-owned repository/participant sở hữu; Admin repositories chỉ viết admin tables. Origin recheck trong Auth app guard/service/participant theo scope additive đã duyệt.
Claude nêu exact signatures/file list trong preflight; đổi public behavior app cũ hoặc mở rộng port vượt nghiệp vụ phải báo finding.

## 4. Migration và PR#27
Chọn implementation ADMIN trên main hiện tại, KHÔNG phụ thuộc merge #27 vì M00 đang tạm dừng. Đây là thứ tự làm code, không quyền merge.
ADMIN migration tạo account_origin PHONE_VERIFIED/ADMIN_PROVISIONED default/backfill/pairing như contract. Timestamp phải lớn hơn mọi migration trên base đã fetch; không sửa applied history/checkOrder.
PR#27 phải được rebase/hòa giải trước integration: không ADD COLUMN lần2. Khi ADMIN origin đã có trên base, #27 migration mới chỉ mở CHECK để thêm STAGING_FIXTURE, giữ ADMIN_PROVISIONED; account policy fixture không được cấp admin privilege.
Nếu migration #27 đã applied ở bất kỳ DB cần giữ: DỪNG, báo actual history; không rename/edit applied SQL, không cho admin migration ADD COLUMN trên schema đã có. Thiết kế migration reconciliation forward riêng trước deploy.
Nếu #27 chưa applied (cần evidence): gói #27 chưa merge có thể sửa lại pending migration/timestamp trong task Claude riêng sau này. Không giả định “chưa merge” nghĩa “chưa applied”. Không có thao tác DB trong gói hiện tại.
Nếu main đã merge #27 trước Claude code thì dừng và trả thiết kế origin hợp nhất; không âm thầm dùng IF NOT EXISTS để che drift.
Remote migrator checkOrder=true giữ nguyên. Mọi Owner merge quyết định riêng, không ép merge #27 hoặc #30 để code.
Acceptance: fresh main→ADMIN; hypothetical ADMIN→fixture extension; detected fixture-first history refusal; no duplicate migration columns/history.

## 5. Config exact
ADMIN_AUTH_ENABLED: default false; true bật module+startup checks, test harness bật tường minh. Bootstrapping không phụ thuộc public signup.
ADMIN_AUTH_ALLOWED_ORIGINS: JSON array nonempty canonical HTTPS origins không path/query/userinfo/wildcard/trailing slash; require khi enabled. Local dùng HTTPS origin của M00 khi có.
ADMIN_AUTH_TRUSTED_PROXY_IPS: JSON array exact IPv4/IPv6 literal, default []; không CIDR/hops/trust-all trong slice này. Không reuse arbitrary global trust proxy.
Admin ingress: lấy socket remote IP; chỉ nếu remote trong allowlist mới nhận một X-Forwarded-For IP duy nhất từ proxy cuối được vận hành cấu hình overwrite header. Multi-value/malformed/trusted remote thiếu header => từ chối request fixed400; untrusted remote bỏ qua header, dùng socket. Proxy topology nhiều hops ngoài phạm vi, phải thiết kế riêng.
ADMIN_RATE_LIMIT_HMAC_KEY: base64 canonical32byte; ADMIN_RATE_LIMIT_KEY_ID: [A-Za-z0-9_-]{1,64}; required enabled/CLI.
TTL/session/threshold numeric giữ giá trị Owner chốt, constants slice này, không tạo config có thể âm thầm nới gate. DB/keyring/secrets hiện hữu giữ nguyên.
Enabled false không expose admin endpoints; không khởi tạo limiter. CLI vẫn strict guards.
Không secret/env values vào startup lỗi. .env.example chỉ placeholder, không origin host/phone/password thật.

## 6. Bootstrap CLI
Tên npm commands: admin-auth:init-limit-config và admin-auth:bootstrap-system. Scripts mỏng gọi backend compiled composition/ports, không SQL/hash validator duplicate.
APP_ENV development/test/staging được phép, production từ chối trong slice này. test target theo guard hiện có; development require actual DB/user ship11_dev loopback; staging dùng strict TLS/target confirmation/separate operator credential như remote conventions, không dùng runtime role.
Bootstrap nhập JSON stdin {phone,password}; strict shape; không argv credential. Noninteractive stdin không echo; runbook chỉ cách nhập kín terminal tránh shell history, không đưa real value vào command ví dụ.
Không đăng ký SYSTEM bằng OTP giả. Role/count fixed SYSTEM; existing user phone conflict từ chối. Cùng SYSTEM phone no-op không overwrite password, khác SYSTEM phone conflict, không in user/phone/password. Exit0 success/noop, nonzero fixed error.
Audit request UUID server/operator generated; actor SYSTEM cho bootstrap theo convention IDs hợp lệ, không actor credential giả.
Runtime grants đọc config/counters/admin tables, ghi nghiệp vụ cần thiết; operator thêm bootstrap permissions, không đưa operator URL/role vào web service config.
CLI/remote target tests negative, rerun/concurrent singleton; chưa chạy thật Owner DB.

## Tương thích đã xác nhận
Audit action đổi sang admin_auth.system_bootstrapped.v1/login_preauth.v1/totp_enrolled.v1/login_completed.v1/logout.v1; không nới audit validator/DB CHECK để nhận UPPER_SNAKE.
Admin crypto boundary chỉ catch CryptoError/key unavailable ở thao tác admin và map TechnicalError('unavailable')=>503. Không đổi global CryptoError500 cho consumers khác; lỗi lập trình/invalid DTO không blanket503. Test ciphertext corrupt, missing key, RNG failures và regression error envelope cũ.
Retry-After: typed AdminAuthRateLimitError mang retryAfterSeconds finite int>=1; filter chỉ set header với class typed này, status429 fixed registry; không tin arbitrary exception/header. Không đưa số/secret động vào message/details. Test ceil thời gian DB, response header và typed-only negative.
Không thêm dependency/package-lock cho TOTP: node:crypto được phép implementation theo RFC vectors, bắt buộc tests leading zeros/current+previous/replay/window và Google Authenticator thực sau M00. Kết quả6/6 vectors của Claude là báo cáo, chưa thay CI final implementation.
Migration specs hiện hữu phải cập nhật theo inventory Claude đưa; không bỏ assertion để xanh. Runbook grants phải bao phủ admin_auth_limit_config mới, ports/CLI config/errors và origin change.
Chưa có PG17 proof cho DDL: là acceptance bắt buộc, không gọi đã đạt từ đọc tài liệu.

## Gate chuyển
Claude đọc phụ lục+contract hiện hành, trả preflight update ngắn và exact base/file list/test matrix; nếu không còn finding blocking, tiếp backend implementation PR Draft trong phạm vi đã xác định. Không tự code UI/tạo ADMIN/scopes/recovery/M00.
Chưa Owner merge, deploy, local/phone acceptance hoặc M01 đóng. Hai câu hỏi nghiệp vụ Claude nhắc nhưng chưa được chuyển đầy đủ vẫn cần đưa nguyên văn nếu ảnh hưởng code; không đoán nội dung.
