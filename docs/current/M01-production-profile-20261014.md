# Quyết định Owner 14/10/2026 — VPS là bản vận hành thật

**Hiệu lực:** thay thế mọi chỉ đạo trước đó về “VPS test”, `DISABLED_TEST`, hộp SMS PC/`TEST_INBOX` cho VPS `103.9.78.67`. Tài liệu cũ giữ nguyên làm lịch sử; khi mâu thuẫn, tài liệu này thắng. Không làm lại phần M01 đã hoàn thành. Không đóng/LOCK M01, không mở M02.

## Quyết định
- VPS chạy `APP_ENV=production` trên **cùng** PostgreSQL và database `ship11_staging`. Tên database không quyết định môi trường; không đổi tên, không chuyển dữ liệu, không reset/drop/down.
- Origin giữ nguyên: `https://103.9.78.67.sslip.io`. Không đổi tên miền. Service giữ tên `11ship-staging` và file `/etc/11ship/staging.env` để không phải đổi systemd/nginx (chỉ nội dung env đổi).
- Food và Ship chỉ phát hành **app điện thoại**; Web Admin vẫn là web. Không mở bản web Food/Ship. Bản web Food/Ship trong repo chỉ là công cụ thiết kế/dev.
- `applicationId` (`vn.eleven.food.test`, `vn.eleven.ship.test`, `vn.eleven.gateway.test`) và khóa ký bền vững giữ nguyên; `versionCode` = số lần chạy workflow (luôn tăng); cài đè không gỡ app. Không đổi package chỉ để bỏ chữ “test”.

## Cổng production (chính sách tường minh, có test từ chối cấu hình sai)
| Cổng | Production được chấp nhận khi | Vẫn từ chối |
|---|---|---|
| Đích vận hành SELF_HOSTED (`db-remote-target.js`, `cli-target-guard.ts`) | `APP_ENV=production` **và** `DB_REMOTE_TARGET=SELF_HOSTED`, đúng `localhost:5432/ship11_staging`, role `ship11_migrator`/`ship11_app` khác nhau, TLS xác minh, gõ lại `MIGRATION_CONFIRM_TARGET`, server tự báo đúng danh tính | production không selector hoặc `SUPABASE`; host IP/DB/role/port khác; TLS tắt; `staging:seed-fixtures` (chỉ staging) |
| Android binding (`CLIENT_AUTH_ANDROID_ENABLED`) | bind loopback (sau nginx) + đủ 4 đầu vào tin cậy: environment, file signer cố định, file attestation roots pin sẵn, snapshot revocation ≤ 24 giờ | staging, bind không loopback, thiếu bất kỳ đầu vào nào; không fixture, không accept-all, không WEB |
| Cặp điều khoản/quyền riêng tư | production, dev, test | staging |
| Admin web (`ADMIN_WEB_STAGING_ENABLED`, tên cũ giữ nguyên) | staging hoặc production, có `ADMIN_AUTH_ENABLED` | dev/test |
| Khóa/mở USER (`ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED`) | production + loopback + admin auth | staging, bind khác. **Phải duyệt lại khi có đơn/ví** (tác động khóa lên nghiệp vụ chưa làm) |
| OTP | chỉ `SMS_GATEWAY_ENABLED=true`; đăng ký `REQUIRED`; reset `SMS_OTP`; kích hoạt Admin `SMS` | mọi `DISABLED_TEST`, `FAKE`, `TEST_DISPLAY`, `TEST_INBOX`, fixture staging, `reset-test` |

## OTP kích hoạt lời mời ADMIN qua SMS Gateway
Dùng lại hàng đợi `sms_jobs` và provider của #102/#103 (không tạo gateway thứ hai). Purpose riêng `ADMIN_ACTIVATION` (tách khỏi `REGISTER`, `RESET_PASSWORD`); job gắn **một** challenge kích hoạt (`activation_challenge_id`, ràng buộc CHECK đúng một chủ), challenge gắn attempt ↔ lời mời nên OTP chỉ dùng cho đúng lời mời; vẫn bắt buộc đặt mật khẩu và TOTP. Challenge ở `PENDING_DELIVERY` (không xác minh được) đến khi máy gateway báo SENT/UNKNOWN; FAILED → `DELIVERY_FAILED`; không bao giờ gửi lại tự động; challenge bị thay thế không được giao cho gateway. Gateway tắt/offline/số ngoài allowlist/vượt trần → 503 trung thực. Không có route tạo job; không có đường nào để tài khoản thường tạo ADMIN.
Ghi chú migration: `1792972800000_create-sms-gateway.sql` (#103, chưa áp ở đâu) được sửa tại chỗ để thêm cột/ràng buộc này, vì chưa từng chạy trên database nào.

## Giao diện bản vận hành
- Food/Ship: bỏ banner “Bản chạy thử”, hộp “Bản test: không xác minh số điện thoại”, nhánh `DISABLED_TEST`/`reset-test` (app chỉ đăng ký bằng mã SMS và đặt lại mật khẩu bằng mã SMS); mục “Chính sách và điều khoản” mở nội dung thật; chức năng chưa có giữ “Sắp có”/khóa kèm lý do; không dựng quán/đơn/ví/doanh thu giả.
- Admin: trang đặt lại mật khẩu dùng SMS_OTP (SĐT → mã → mật khẩu mới); trang kích hoạt hiện “đang gửi SMS” và chỉ mở ô nhập mã khi gateway đã gửi; bỏ nhãn “Môi trường thử nghiệm”.
- Điều khoản/quyền riêng tư: [M01-terms-privacy-20261014.md](M01-terms-privacy-20261014.md) — **chờ Owner duyệt nội dung** trước khi phát hành app.

## Kết nối bền vững
`config/endpoints.json` là nơi duy nhất ghi origin API (và định danh môi trường thiết bị `ship11-test`, giữ nguyên để không vô hiệu hóa binding thiết bị hiện có). Workflow `Mobile APK` và `SMS Gateway APK` đọc file này; Admin web cùng origin nên không có địa chỉ để cấu hình. Đổi server = sửa một file.

## Việc cần Owner/vận hành (không thể làm từ repo)
Xem [hướng dẫn cập nhật](../../ops/runbooks/vps-production-update-20261014.md): duyệt điều khoản; cung cấp file roots attestation đã pin; chạy cập nhật trên VPS; ghép cặp máy Gateway; quyết định `SMS_GATEWAY_RECIPIENT_MODE=OPEN` sau khi xác nhận điều khoản SIM/nhà mạng. **Chưa kiểm:** mọi luồng trên VPS thật và máy Android thật.
