# M01-ADMIN — lời mời/kích hoạt chạy thật ở local test
13/10/2026. ChatGPT contract, Claude code. Nhánh feat/m01-admin-activation-test. Đây là phần đang dở của luồng ADMIN, không phải audit toàn module.

## Đã có / thiếu / kết quả
Login SYSTEM/ADMIN + TOTP, provisioning/invitations, activation và UI đã có trên main. Không dựng lại auth/lời mời.
Owner đã gặp link mới mở bị báo hết hạn; dữ liệu chẩn đoán có 404 NOT_FOUND và config ADMIN_ACTIVATION_ORIGIN=https://localhost:8443, OTP_MODE=TEST_DISPLAY. Đây không chứng minh token hết hạn: kiểm feature wiring, route proxy/backend và error mapping trước. Không kéo dài TTL để che lỗi.
Backend setPassword hiện chỉ nhận OTP_VERIFIED và otp_verified_at; DB CHECK/trigger bắt STARTED→OTP_VERIFIED→PASSWORD_SET. Quyết định test không xác minh/không OTP giả chưa triển khai cho activation.
Đầu ra: SYSTEM có TOTP → tạo lời mời → mở link → đặt mật khẩu → đăng ký/xác nhận Authenticator → hoàn tất → login ADMIN + TOTP. Thực hiện local/CI, không VPS. Không list/lock/grants API mới, reset, Android, quán/xế hoặc M02.

## Contract test chốt trước code
1. Thêm ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=REQUIRED|DISABLED_TEST, unset mặc định REQUIRED; mode lạ từ chối startup. DISABLED_TEST chỉ APP_ENV development/test + HOST loopback + ADMIN_AUTH_ENABLED và ADMIN_ACTIVATION_ENABLED. Staging/production/non-loopback từ chối. Không client/header nào bật được.
2. DISABLED_TEST không yêu cầu OTP_PROVIDER cho riêng activation và không khởi tạo provider test. Không request/verify OTP, không FAKE/TEST_DISPLAY/TEST_INBOX, không tạo proof hoặc giả otp_verified_at. Config của OTP client khác giữ tương thích; không xóa engine.
3. Attempt mới ghi phone_verification_mode REQUIRED hoặc DISABLED_TEST từ config server; immutable. Migration append-only thêm cột NOT NULL DEFAULT REQUIRED vào bảng attempt hiện có. Không sửa migration cũ.
4. REQUIRED giữ nguyên state machine. DISABLED_TEST đi STARTED→PASSWORD_SET trực tiếp, otp_verified_at NULL suốt vòng đời; tiếp theo PASSWORD_SET→TOTP_ISSUED→COMPLETED vẫn bắt TOTP thật. Sửa CHECK/trigger bằng migration mới để cho đúng nhánh theo mode, giữ bảo vệ secrets/counters và chỉ chuyển trạng thái hợp lệ; không bỏ trigger/constraint toàn cục.
5. Gate setPassword recheck mode process + mode attempt, token/cookie/CSRF, thời gian/invitation PENDING và phone conflict trước hash rồi dưới lock như code hiện hữu. Deadline test tính từ created_at + passwordDeadlineSeconds và không vượt expires_at; không mượn timestamp OTP. Restart giữ mode attempt; tắt mode không cho tiếp tục attempt DISABLED_TEST.
6. Trên response start/state/restart và safe details STEP_INVALID, thêm phone_verification_mode cho live attempt. UI đọc mode từ server: STARTED + DISABLED_TEST mở bước đặt mật khẩu, không màn OTP. Thiếu field trên response cũ chỉ được coi REQUIRED, không disabled; giá trị lạ báo lỗi an toàn. Các terminal response COMPLETED giữ shape hiện hữu; không secrets trong config/state. UI không tự đoán môi trường.
7. Nhánh DISABLED_TEST từ chối OTP request/verify bằng STEP_INVALID (safe current state), không tạo delivery/proof; audit passwordSet ghi from_state STARTED, không ghi OTP_VERIFIED giả.
8. Mật khẩu + TOTP + origin ADMIN_PROVISIONED + invitation permissions vẫn theo cơ chế hiện hữu; không grant SYSTEM, không nhận grants từ người kích hoạt. Login/CSRF/cookie/step-up/quota/revoke/expiry production giữ nguyên. Không đưa dữ liệu test hoặc bí mật vào production/PR/log.
9. Lỗi kỹ thuật NOT_FOUND/backend unavailable/config sai không hiển thị “lời mời hết hạn”. Token lời mời sai/hết hạn/thu hồi vẫn dùng message LINK_INVALID thống nhất theo bảo mật hiện có, không lộ nguyên nhân nội bộ. Không bypass token hoặc tự tạo tài khoản vì endpoint lỗi.

## File/tài liệu dùng lại
- apps/backend/src/config/admin-activation-config.ts, app-config.ts; app.module.ts và activation module wiring đang có (tra import thực tế).
- apps/backend/src/admin-activation/admin-activation-service.ts: start/state/restart/setPassword; admin-activation-repository.ts, admin-activation-views.ts, controller, config provider.
- database/migrations/1792281600000_create-admin-activation.sql chỉ tham chiếu CHECK/trigger; migration mới Claude đặt sau timestamp cuối nhánh.
- apps/admin-web/src/core/activation-api.ts, activation-controller.ts, messages.ts; dom/activation-view.ts; scripts/admin-web-dev.mjs; provisioning-api.ts chỉ khi cần tái hiện tạo link.
- docs/tasks/M01-D-ADMIN-WEB-api-inventory.md §1–3; M01-D-ADMIN-1C-technical-contract.md đúng operation/schema setPassword/state/TTL; M01-D-LOGIN-backend-checklist.md phần login/TOTP.
- docs/ui/m01-admin-web.md D04–D07. UI chỉ ghi bước/hiển thị, không chép business contract.
Đọc AGENTS/CLAUDE/quy trình/workstreams một lần đầu phiên; không rà tất cả M01 hoặc mở lại design cũ.

## Kiểm tra và trả việc
Dùng fixture/harness hiện có, một smoke Chrome/front/backend/DB test thật cho SYSTEM invitation→activation không OTP→TOTP→ADMIN login; thêm ca config từ chối production và REQUIRED vẫn bắt OTP, mode mismatch không bypass. Chạy phần ảnh hưởng và CI bắt buộc, không full local rồi lặp CI, không audit sâu/race/mutation matrix mới.
Owner cho tạo 1 ADMIN đầy đủ grants trong phạm vi ADMIN để test local/CI bằng cơ chế hiện hữu, giữ TOTP; không SYSTEM, không tạo/sửa tài khoản đó trên VPS. Không cần seed người dùng/secret vào repo; CI fixture độc lập dùng DB disposable.
Không đụng DB Owner/VPS hoặc reset dữ liệu để chạy suite. Local thiếu deps/Chrome thì ghi giới hạn, dùng CI, không sa vào sửa harness/polling liên tục.
Cập nhật runbook/env example đúng cách bật activation + mode, không ghi đã deploy. Một Draft PR: SHA, hành vi bổ sung, link checks, cách thử và giới hạn. Không tự merge/đóng M01/sang phần quản lý tài khoản.
