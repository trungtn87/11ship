# Prompt Claude — M01 theo slice

Phiên bản **2.0.2**; **HANDOFF_CANDIDATE / GATED**. Chọn một gói đã đủ quyết định và ghi phiên bản UI được Owner duyệt trước khi giao code. [Danh mục33 gói M01](08-work-packages.md) và [revision USER/SMS test](09-m01-user-admin-test-sms.md) có ưu tiên trong scope mới; prompt bên dưới chỉ là chỉ mục, không lệnh làm cả M01.

```text
Triển khai duy nhất gói M01.xx được giao của trungtn87/11ship. Đọc AGENTS.md, docs/process/11ship-delivery-workflow.md, đúng file claude-tasks/M01.xx.md và các phần contract/UI/revision09 liên quan. Không nạp tất cả module để mở rộng scope. ChatGPT thiết kế/review; Claude code/test; Owner nghiệm thu và quyết định merge/LOCK.

Preflight:
- Fetch main và các PR phụ thuộc; ghi base SHA, head từng PR và chênh lệch so với audit e5b50e8567b8928646c83648dd70f577915dc14f.
- Main hiện register chưa cấp role; chỉ hỗ trợ SHOP/DRIVER. CUSTOMER/SHOP_OWNER là yêu cầu đã chốt, cần adapter tương thích thật. Không giả quyền trong UI.
- Giữ opaque session, Argon2id và Admin TOTP. Không tự đổi JWT, refresh token, quyền hoặc chính sách thiết bị.
- Làm trên nhánh riêng, giữ Draft PR. Không merge, deploy production hoặc ghi Owner PASS/LOCK.

CLIENT-BE:
1. Thêm /v1/client-auth theo 04-data-api.md. Cùng primitive Auth/transaction/idempotency/audit/outbox; register commit USER + CUSTOMER + profile + consent + session trong một transaction.
2. Thêm customer_profiles/user_consents bằng migration append-only và grants tường minh. Backfill CUSTOMER chỉ cho tài khoản thường theo origin/membership đã review; loại trừ privileged accounts, không giả tên hoặc phone_verified_at.
3. Giữ storage SHOP và /v1/auth legacy; API mới ánh xạ SHOP thành SHOP_OWNER. Viết regression test old/new register, me, select/context và upgrade.
4. Thêm GET /v1/driver/me để xem hồ sơ của chính mình hoặc null; onboarding vẫn EXTERNAL/PENDING. Thêm logout server thật.
5. D02 chưa duyệt thì không đổi enforcement thiết bị ngầm; D03 chưa duyệt thì không chọn native runtime thay Owner. Vẫn làm các phần backend độc lập đủ contract.

FOOD-AUTH-UI:
- F10–F18 và F20–F23: đăng ký, OTP, login, reset, tài khoản, hồ sơ và quán trong Food.
- CUSTOMER vào giao diện khách. Tài khoản → Quản lý cửa hàng; complete quán bổ sung SHOP_OWNER và giữ CUSTOMER.
- Dùng API mới đúng phiên bản. Khu vực phải do server resolve GPS; không có field nhập UUID hoặc vùng giả. Khi chưa có resolver, cho lưu draft theo contract, chặn complete với lý do.
- Không thực đơn, Order hoặc ví trong M01.

SHIP-AUTH-UI:
- S10–S17 dùng chung form/OTP/reset; brand Ship; onboard/resume hồ sơ xế từ API thật.
- PENDING/SUSPENDED hiển thị lý do; không online/nhận đơn khi chưa đủ điều kiện. Không tự cấp PLATFORM, không giả xác minh bank, GPS hoặc số dư.
- Sửa profile khách không làm thay tên pháp lý/bank proof của xế.

ADMIN-UI:
- Reuse #34/#35 và API #41/#45 sau refresh/review head. Giữ domain permission CUSTOMER/SHOP/DRIVER, không gộp thành FOOD để tăng quyền.
- SYSTEM tạo/reissue/revoke lời mời qua TOTP step-up operation; activation dùng cookie/CSRF/state/OTP/password/TOTP riêng.
- Sau mất response đọc state/operation; không tự gửi lại TOTP. PREAUTH không truy cập Admin protected. Các mutation ngoài môi trường test phải đúng phạm vi Owner cho phép.
- USER Admin trước ở M12.02 nay M01.29–.33: chốt contract/scopes → read backend → D81/D86 read UI → lock backend/UI D87/D88 sau D15. Không tạo USER hộ, sửa SĐT/password/role trực tiếp, khóa SYSTEM/ADMIN hoặc đọc PII ngoài scope. M12 không viết lại core này.

RESET:
- Kế thừa nghiệp vụ Owner duyệt #43: USER/ADMIN chung SMS OTP 5 phút, dùng một lần; giữ role/status/TOTP; revoke mọi session/challenge cũ liên quan; không auto-login; không tạo màn Đổi mật khẩu.
- Request/verify/complete theo 04; proof purpose RESET_PASSWORD; chống enumeration, rate limit, replay, concurrent reset và login/reset race.
- Public API không reset SYSTEM. CLI emergency recovery chưa đủ D05 phải báo BLOCKED, không tự tạo bypass.
- M01.22 TEST_INBOX explicit development/test local, tool PC lấy mã thật do core sinh, không fixed code/auto-verify/public OTP/log secret. Staging/production refuse test-mode, không thay APP_ENV remote để lách guard. Core verify/TTL/rate giữ nguyên. M12.12 SMS vendor thật ở cuối dự án trước production; không chặn M01 test vì vendor.

File scope:
apps/backend/src/auth và module mới client-auth/customer-profile/password-reset theo slice; migration mới trong thư mục hiện có; apps/client-shared, apps/food-web, apps/ship-web; apps/admin-web cho Admin UI. Privileged backend chỉ sửa theo finding hoặc contract được duyệt. Không sửa code menu/delivery/wallet trong M01.

Tests bắt buộc:
Unit parser/injection/Unicode/countdown/router/inbox guard; integration PostgreSQL 17 cho proof purpose/one-use, CUSTOMER grant, ownership/scopes, session/reset race, Admin TOTP replay/state, USER lock/actor revoke races, fresh+upgrade migrations và runtime grants; E2E API/DB thật cho double-click/lost response/resume/logout/F5 theo giới hạn từng client; UA/TS cases revision09, UI360/390/430 và PC. Android Owner test với mã lấy trên PC; SMS thật RS01 ở M12.12 trước production. Không chạy destructive suite vào DEV/staging.

Đầu ra:
Draft PR theo chức năng, base/final full SHA, dependency, migration/compatibility/fix-forward notes, lệnh và kết quả test thực tế, CI URLs, ảnh đúng screen ID, runbook PC và APK khi đã đến slice native, checklist Owner actual để trống, findings còn mở.

PASS: API/DB và quyền thật; đúng contract/UI được duyệt; các case kỹ thuật bắt buộc đạt trên exact head. M01 staging acceptance không thay SMS production hoặc phone acceptance. Chờ ChatGPT review rồi Owner PC/phone; CI xanh không tự đóng module.
```

Tiêu chí và quyết định chặn tại [M01](02-m01.md), [API/data](04-data-api.md), [screen catalog](03-ui-catalog.md), [decision register](06-decisions-and-gates.md). Không giao toàn M01 như một lệnh code không có gate.
