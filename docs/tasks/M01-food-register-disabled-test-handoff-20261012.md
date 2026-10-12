# M01 — tiếp tục đăng ký 11Food, không xác minh ở bản test
Ngày 12/10/2026. ChatGPT chốt contract kỹ thuật theo quyết định Owner; Claude triển khai. Phạm vi lần giao này: hoàn thiện luồng đăng ký đang dở ở PR #82. Quy trình: [kế hoạch theo luồng](../current/M01-workstreams-20261012.md) §1, §3–5.

## 1. Đã có và còn thiếu
- Main đọc tại e67a586af165c69d5fa2a0a4e74b3a613ce67858: backend register/login/me/context/logout, CUSTOMER/profile/consent và shared auth đã có. #80 đã merge tại 82b400730f000b3ab40cb34b786fd395931feb20; code head 5081deeba8b5b6a256f66ce92ed5296e76e22755.
- PR #82 đang Draft, head code đối chiếu 1f1757268ee3f73921d404c6c61359a9e3f1abc8, nhánh feat/m01-07-food-register-otp. Có form F11, F12, controller đăng ký, adapter, proxy và test. Kế thừa trên nhánh đó; cập nhật main và xử lý đúng xung đột nếu có, không dựng nhánh triển khai thay thế từ đầu.
- #82 mô tả 220/220 client-shell local; CI Verify/Launcher trên head trên còn chạy khi giao. Đây là bằng chứng phần cũ, không chứng minh phần thay đổi dưới đây đã chạy.
- Thiếu: đăng ký test trực tiếp không OTP/proof, origin chưa xác minh, eligibility cho tài khoản test và nối F11 vào nhánh đăng ký đó. F12 không được xuất hiện trong chế độ này.
- Backend hiện yêu cầu proof; parser exact 6 field; insertRegistered lấy verified_at qua proof; provisioning chỉ nhận PHONE_VERIFIED. Không bỏ một if rồi ghi giả PHONE_VERIFIED.
- Mobile hiện mới shell/health và khóa auth. Luồng native, signing follow-up và ADMIN activation không nằm trong lần code này; không suy rằng đã kết nối từ endpoint/web có sẵn.

## 2. Contract test — chốt trước code
### 2.1 Phạm vi môi trường và bật/tắt
Thêm CLIENT_AUTH_PHONE_VERIFICATION_MODE với hai giá trị REQUIRED (mặc định khi không đặt) và DISABLED_TEST. Giá trị khác từ chối startup. DISABLED_TEST chỉ hợp lệ khi APP_ENV=development|test và HOST loopback. Staging/production hoặc bind không loopback phải từ chối startup; không tin request/header/app label để bật chế độ.
VPS test có thể dùng backend loopback sau HTTPS reverse proxy; đây không phải quyền deploy hay xác nhận cấu hình VPS đang đúng. Runbook chỉ hướng dẫn cấu hình tương ứng, không đổi VPS.
Giữ cặp consent test đã duyệt; không nới consent cho production, không bật TEST_INBOX/TEST_DISPLAY/FAKE như cách thay thế xác minh. Nhánh DISABLED_TEST không gọi request OTP, verify, tạo/consume proof hoặc giả lập kết quả xác minh. OTP engine và các đường cũ giữ để tương thích REQUIRED, không cần xóa khỏi repo.
LOCAL_WEB và gate ANDROID giữ contract11 §6–7: tắt xác minh SĐT không bỏ proof thiết bị. ANDROID vẫn đóng cho tới triển khai verifier. Không mở WEB ở production.
Đăng ký test mới chỉ qua client-auth; legacy register giữ contract proof. Những thay đổi ADMIN activation/reset được giao riêng đúng luồng, giữ TOTP ADMIN/SYSTEM và các bảo vệ invitation/session/CSRF/rate limit hiện có.

### 2.2 Wire contract
Dùng POST /v1/client-auth/register và Idempotency-Key hiện có.
- REQUIRED: exact body cũ {phone,password,verification_token,device,full_name,consent}; proof hiện hữu bắt buộc.
- DISABLED_TEST: exact body {phone,password,device,full_name,consent}; không có verification_token, OTP hoặc cờ bypass do client gửi. Body có field đó/role/permission/accepted_at bị 400 BAD_REQUEST.
Validation phone/password/full_name/device/consent và success201 identity + access_token + session giữ đúng primitive/shape hiện hữu. Không tự thêm field vào exact identity làm hỏng shared parser.
Thêm GET /v1/client-auth/config, public, không query/body, no-store; response exact {data:{registration_verification:"REQUIRED"|"DISABLED_TEST"}} lấy từ config server đã validate. Không trả secrets, không cấp quyền. UI không nhận được config hợp lệ thì khóa submit, báo lỗi/thử lại; không tự đoán disabled hoặc fallback.
Proxy Food chỉ thêm route GET config cần thiết vào allowlist hiện có; không wildcard /v1. Không thêm route Ship/UI Ship trong lần giao này.

### 2.3 Dữ liệu và quyền
Thêm account_origin=TEST_UNVERIFIED bằng migration append-only sau timestamp cuối trên nhánh tích hợp; phone_verified_at phải NULL. Giữ valid origins/rows cũ và guard admin membership chỉ ADMIN_PROVISIONED; không sửa migration đã áp dụng.
Tài khoản này chỉ được đăng ký, đăng nhập, dùng bearer và tái kiểm transaction/replay khi đúng DISABLED_TEST đang bật trong môi trường cho phép. Khi tắt flag hoặc ở staging/production, origin này không được application auth chấp nhận (kể cả có token cũ); không tự đổi origin thành PHONE_VERIFIED.
Cho phép CUSTOMER/profile/consent của TEST_UNVERIFIED chỉ qua policy test đã validate, không có admin_memberships. Không backfill/đổi quyền user cũ hoặc sửa STAGING_FIXTURE allowlist mode. Không tạo quyền SHOP/DRIVER/ADMIN từ đăng ký.
Mọi code đọc eligibility/origin của luồng đăng ký và phiên phải thống nhất; dùng AccountOriginPolicy chung và tái kiểm dưới lock. Nếu primitive hiển thị phone verification status được dùng thì map TEST_UNVERIFIED sang UNVERIFIED_TEST, tuyệt đối không VERIFIED. Không đổi exact client identity nếu chưa cần.
Down migration từ chối nếu còn TEST_UNVERIFIED, không xóa user để rollback. Không apply migration remote trong task này.

### 2.4 Transaction/retry
Dùng lại IdempotencyExecutor, hash password, repositories và transaction hiện hữu; không viết auth stack thứ hai.
Nhánh không proof có operation riêng client.auth.register.unverified_test.v1 để không replay chéo với nhánh REQUIRED/legacy. Scope ID là định danh ổn định phía server từ phone normalized trong namespace riêng, phù hợp schema engine; Claude chọn cách mã hóa phù hợp primitive sẵn có, không lấy random mỗi request hoặc user ID client. Fingerprint gồm toàn bộ logical input và mode; password được HMAC fingerprint như hiện có, không plaintext log/store.
Một commit: idempotency → tạo user test (unique phone) → CUSTOMER/profile v1/consent → phiên → audit/outbox → encrypted result. Không tạo proof giả để vừa schema; dùng nhánh insert user phù hợp NULL verified_at. Tái sử dụng helper writes khi phù hợp, tránh nhân bản toàn service.
Audit action dùng operation test riêng; outbox đăng ký giữ payload đã duyệt, không thêm phone/password/proof/token. Unique phone, rollback và replay nguyên tử giữ nguyên.
Cùng key/body trả token/expiry gốc + CURRENT identity khi user/phiên/origin còn hợp lệ; không tạo lại dữ liệu. Mất response giữ key/body, user bấm thử lại; body khác cùng key → IDEMPOTENCY_KEY_REUSED. Tắt mode/revoke/expire/disable khiến sensitive replay không trả token. Không tự retry POST hoặc chuyển mode cho intent đang chưa biết kết quả.

## 3. UI và điểm vào dùng lại
F11 giữ thiết kế/form/consent đã có; label nút phù hợp “Đăng ký” trong DISABLED_TEST; hiển thị ngắn “Bản test: tạm không xác minh số điện thoại”. Submit trực tiếp register → F01/danh tính server; không F12/countdown/resend/OTP giả. REQUIRED giữ flow OTP có sẵn.
Dùng chung controller/adapter có branch theo config server, không nhúng policy vào screen. Duy trì double-submit guard, cancel/reset, stale-response rejection, memory-only secrets và unknown-outcome retry của #82. Không nối login/profile/logout, onboarding hay reset trong lần giao này; đây là bước tiếp theo sau đăng ký.

Điểm vào:
- apps/client-shared/src/register-flow.ts; auth/client.ts, auth/contract.ts, auth/session.ts; consent.ts; screens/register-live.ts, screens/auth.ts.
- apps/food-web/src/screens.ts; scripts/client-web-dev.mjs; không dựng lại F11/F01/components.
- apps/backend/src/client-auth/client-auth.controller.ts, client-auth-validation.ts, client-registration-service.ts, client-auth-policy.ts.
- apps/backend/src/config/client-auth-config.ts và nơi wiring config; auth/account-origin.ts, user-repository.ts, customer-provisioning-participant.ts, customer-profile-repository.ts.
- client-identity-reader.ts, client-session-authority.ts, client-login-service.ts; auth/session-auth.guard.ts và primitive eligibility chỉ đọc/sửa đúng chỗ cần thống nhất origin, không audit lại cả module.
- database/migrations/1792627200000_allow-staging-fixture-account-origin.sql là tham chiếu pattern/schema, không sửa file cũ; migration mới là phần Claude làm.

## 4. Tài liệu chỉ đọc đúng mục
- docs/design/system-v2-20261011/10-m01-client-contract.md §2–4.
- docs/design/system-v2-20261011/11-m01-session-device-contract.md §1–2, §5–6; §7 chỉ để giữ boundary native.
- docs/tasks/M01-03-customer-register-local-handoff.md §3 (consent test), §4–6 nếu cần đối chiếu primitive cũ; yêu cầu OTP cũ nhường contract §2 ở trên trong DISABLED_TEST.
- docs/ui/m01-food-web.md dòng F11/F12/F01 liên quan, cập nhật mô tả liên kết; không chép nghiệp vụ vào UI.
- ops/runbooks/client-register-local.md: cập nhật cách chạy không OTP test; giữ hướng dẫn REQUIRED có nhãn riêng.
- mobile/README.md mục update-in-place chỉ là ràng buộc giai đoạn Android tiếp theo, không kéo build APK vào task web/backend.

## 5. Kiểm tra đủ cho phần mới và trả việc
Chạy focused checks trong khi code; dùng test/harness hiện có, không dựng nhiều ma trận/báo cáo:
1. Startup: mode mặc định; test bật hợp lệ; staging/production/non-loopback không bật được.
2. Backend thật + DB test: register không proof tạo đúng NULL verified_at/CUSTOMER/profile/consent/session; same-key replay không duplicate; unknown response retry; unique phone; mode tắt/token đã revoked không trả token test.
3. Food thật → backend thật: F11 đăng ký tới F01 không request OTP và không F12; cancel/late response không khôi phục phiên. Dùng lại tests/integration/food-register-browser.int.spec.ts và tests/client-shell/register-* của #82, thêm đúng coverage cần.
4. Giữ coverage REQUIRED/legacy và admin/TOTP hiện có; thêm ca phòng ngừa phù hợp rằng origin test không có quyền admin. Không chạy lại toàn suite thủ công sau CI cùng nội dung.
Checks bắt buộc hiện hữu vẫn là gate. Không audit sâu, không tự merge/deploy/đóng M01 hay sang .08. Trả final code SHA + link CI/check còn hiệu lực, hành vi bổ sung, giới hạn và lệnh chạy test ngắn ngay trong PR #82; cập nhật title/body theo scope cuối. Không tạo thêm evidence document chỉ lặp PR.
Sau tất cả các luồng M01 kết nối xong mới có một đợt review tìm lỗi toàn module; sau sửa review delta/phần ảnh hưởng.

## 6. APK khi giao luồng Android sau
Giữ vn.eleven.food.test / vn.eleven.ship.test và khóa ký bền vững đang dùng; tăng versionCode, giữ dữ liệu qua cập nhật. Thiếu signing secrets thì dừng phân phối, không ephemeral fallback. Không coi APK shell hiện có là auth đã chạy; không yêu cầu build/cài lại APK vì task web/backend này.
