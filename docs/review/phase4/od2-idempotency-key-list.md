# OD-2 — danh sách handler ghi không đòi `Idempotency-Key` (đề xuất)

**Trạng thái:** ĐỀ XUẤT của Claude Lead đã nhận kết quả Codex cho 9 mục C (review PR #311); chờ Owner xác nhận nhóm R rồi mới mở PR code. Chưa có PR sửa code. Nguồn: quét tĩnh `apps/backend/src/**/*.controller.ts`, handler `@Post/@Put/@Patch/@Delete`; một handler "có khóa" nếu thân nó đọc header `idempotency-key`. Kết quả tái hiện số của Phase 3: **234 handler ghi, 182 có khóa, 52 không có khóa**. Đây là cận dưới/ước lượng tĩnh; một handler gọi dịch vụ có tự dedupe theo cách khác vẫn tính là "không khóa".

**Quyết định Owner (OD-2, 05/11):** không bắt khóa máy móc. Bắt buộc cho thao tác mà retry có thể gây hậu quả kép (tiền, chuyển trạng thái order/delivery, tạo resource hoặc side-effect quan trọng). Miễn: location/telemetry, OTP/login/logout, preview, PUT tự idempotent thật sự.

## Phân loại
- **A** — miễn theo nhóm Owner đã nêu (OTP, đăng nhập/đăng xuất, telemetry/vị trí, preview).
- **B** — miễn vì tự idempotent thật sự (đặt trạng thái đích hoặc không ghi), đề xuất.
- **R** — BẮT BUỘC có `Idempotency-Key` hoặc cơ chế tương đương (retry gây hậu quả kép). Đây là danh sách cần sửa code.
- **C** — (không còn) từng là nhóm chờ Codex; Codex đã xếp 9 mục vào B hoặc R.
- **X** — sẽ bị gỡ bởi OD-1.

Tổng sau review Codex (06/11): A=29, B=16, R=5, X=2, C=0.

**Nhận xét chính:** không có handler tiền hoặc chuyển trạng thái order/delivery bị thiếu khóa (Codex xác nhận độc lập). Có **5 mục bắt buộc (R)** cần PR code riêng: tạo thao tác cấp quyền Admin, tạo liên kết theo dõi, tải ảnh khiếu nại, tải ảnh món, nhận việc (`claim`) của cổng SMS. Riêng `claim` cần thiết kế theo giao thức (mã yêu cầu ổn định), không dùng kho phản hồi idempotency chung vì chứa nội dung SMS.

## Bảng 52 handler
| # | Vị trí | Route | Loại | Lý do / ghi chú |
|---|---|---|---|---|
| 1 | `account-recovery/account-recovery.controller.ts:49` | `POST /account-recovery/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 2 | `account-recovery/account-recovery.controller.ts:58` | `POST /account-recovery/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 3 | `account-recovery/account-recovery.controller.ts:92` | `POST /account-recovery/locked/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 4 | `account-recovery/account-recovery.controller.ts:100` | `POST /account-recovery/locked/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 5 | `account-recovery/account-recovery.controller.ts:153` | `POST /account-recovery/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 6 | `account-recovery/account-recovery.controller.ts:161` | `POST /account-recovery/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 7 | `admin-activation/admin-activation.controller.ts:86` | `POST /admin-activation/start` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 8 | `admin-activation/admin-activation.controller.ts:95` | `POST /admin-activation/restart` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 9 | `admin-activation/admin-activation.controller.ts:118` | `POST /admin-activation/otp/request` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 10 | `admin-activation/admin-activation.controller.ts:131` | `POST /admin-activation/otp/verify` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 11 | `admin-activation/admin-activation.controller.ts:144` | `POST /admin-activation/password` | B | Miễn: chỉ chuyển state sang `PASSWORD_SET`; retry hoặc đồng thời sau lần thắng bị state gate từ chối, không ghi lần hai (Codex, `admin-activation-service.ts:519-582`) |
| 12 | `admin-activation/admin-activation.controller.ts:157` | `POST /admin-activation/totp/enrollment` | B | Miễn: khi đã `TOTP_ISSUED` dịch vụ mở lại và trả cùng secret, không tạo factor thứ hai, không audit lần hai (Codex, `admin-activation-service.ts:585-639`) |
| 13 | `admin-activation/admin-activation.controller.ts:170` | `POST /admin-activation/complete` | B | Miễn: `COMPLETED` trả lại câu trả lời đã hoàn tất; khóa và máy trạng thái ngăn tạo tài khoản hay factor lần hai (Codex, `admin-activation-service.ts:642-649`) |
| 14 | `admin-auth/admin-auth.controller.ts:71` | `POST /admin-auth/login` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 15 | `admin-auth/admin-auth.controller.ts:98` | `POST /admin-auth/totp/enrollment` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 16 | `admin-auth/admin-auth.controller.ts:115` | `POST /admin-auth/totp/enrollment/verify` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 17 | `admin-auth/admin-auth.controller.ts:135` | `POST /admin-auth/totp/verify` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 18 | `admin-auth/admin-auth.controller.ts:163` | `POST /admin-auth/logout` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 19 | `admin-provisioning/admin-provisioning.controller.ts:59` | `POST /admin/operations` | R | BẮT BUỘC: mỗi lần gọi tạo UUID mới, đổi thao tác live cũ thành `REPLACED`, chèn thao tác mới và audit mới; retry sau mất phản hồi vô hiệu thao tác vừa nhận (Codex, `admin-operation-service.ts:99-178`). Admin dùng CSRF nên cần cơ chế khóa tương đương cho tạo thao tác |
| 20 | `admin-provisioning/admin-provisioning.controller.ts:72` | `POST /admin/operations/:operation_id/verify` | B | Miễn: bước xác thực dùng một lần (TOTP, state, khóa dòng) chỉ cho `PENDING` chuyển một lần, retry không thi hành nghiệp vụ lần hai (Codex, `admin-operation-service.ts:193+`) |
| 21 | `auth/auth.controller.ts:43` | `POST /auth/phone-verifications` | A | Miễn (OTP) |
| 22 | `auth/auth.controller.ts:56` | `POST /auth/phone-verifications/:verificationId/verify` | A | Miễn (OTP) |
| 23 | `auth/auth.controller.ts:82` | `POST /auth/login` | X | Sẽ bị gỡ bởi OD-1 (route legacy), không cần xét |
| 24 | `auth/auth.controller.ts:89` | `POST /auth/role/select` | X | Sẽ bị gỡ bởi OD-1 (route legacy), không cần xét |
| 25 | `client-auth/client-auth.controller.ts:156` | `POST /client-auth/logout` | A | Miễn (đăng xuất) |
| 26 | `client-device/client-device.controller.ts:17` | `POST /client-auth/device/challenges` | A | Miễn (thử thách thiết bị là mã dùng một lần) |
| 27 | `delivery/delivery-customer.controller.ts:90` | `POST /customers/me/deliveries/:delivery_id/tracking-link` | R | BẮT BUỘC: code hiện thu hồi liên kết cũ rồi sinh token và tracking_id mới, nên retry làm URL vừa trả mất hiệu lực (Codex, `delivery-customer-service.ts:447-483`). Đã sửa lý do ở bản trước (tài liệu nói "miễn nếu trả liên kết đang hoạt động", không đúng với code) |
| 28 | `delivery/delivery-customer.controller.ts:103` | `POST /customers/me/deliveries/:delivery_id/tracking-link/toggle-location` | B | Miễn tự nhiên: đặt trạng thái đích (bật/tắt, thu hồi), lặp lại không đổi kết quả |
| 29 | `delivery/delivery-customer.controller.ts:110` | `POST /customers/me/deliveries/:delivery_id/tracking-link/revoke` | B | Miễn tự nhiên: đặt trạng thái đích (bật/tắt, thu hồi), lặp lại không đổi kết quả |
| 30 | `delivery/delivery-shipper.controller.ts:110` | `POST /driver/deliveries/:delivery_id/fail` | B | Miễn: route chỉ trả từ chối cố định cho app cũ, không ghi gì |
| 31 | `delivery/delivery-shipper.controller.ts:118` | `PUT /driver/location` | A | Miễn (đo vị trí) |
| 32 | `discovery-route/discovery-route.controller.ts:13` | `POST /discovery/route-distances` | B | Miễn: tính khoảng cách, không ghi dữ liệu (tương đương preview) |
| 33 | `feedback/complaint.controller.ts:54` | `POST /customers/me/complaints/attachments`, `POST /shop/me/complaints/attachments`, `POST /driver/complaints/attachments` (một handler, ba route) | R | BẮT BUỘC: mỗi retry chèn attachment UUID mới và chiếm một trong 20 chỗ chưa gắn; bộ dọn 24 giờ chỉ dọn hậu quả (Codex, `complaint-service.ts:63-72`, `feedback-constants.ts:47`) |
| 34 | `menu/menu.controller.ts:37` | `POST /shop/me/menu/images` | R | BẮT BUỘC: mỗi retry chèn ảnh mới và chiếm hạn mức 400 ảnh mỗi quán, không thấy bộ dọn ảnh món; có thể tích tụ tới khi chặn tải hợp lệ (Codex, `menu-service.ts:183-194`, `menu-constants.ts:22`) |
| 35 | `notifications/notification.controller.ts:43` | `PUT /notifications/settings` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 36 | `notifications/notification.controller.ts:49` | `POST /notifications/read` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 37 | `notifications/notification.controller.ts:55` | `POST /notifications/read-all` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 38 | `notifications/notification.controller.ts:62` | `PUT /notifications/push-token` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 39 | `notifications/notification.controller.ts:68` | `DELETE /notifications/push-token` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 40 | `notifications/notification.controller.ts:75` | `POST /notifications/:notification_id/open` | B | Miễn tự nhiên: cài đặt, đã đọc, đăng ký/hủy push token, mở thông báo đều đặt trạng thái đích |
| 41 | `ops/ops-client.controller.ts:25` | `POST /ops/ingest/probe` | A | Miễn (telemetry và nhận báo cáo vận hành) |
| 42 | `ops/ops-client.controller.ts:32` | `POST /ops/ingest/backup` | A | Miễn (telemetry và nhận báo cáo vận hành) |
| 43 | `ops/ops-client.controller.ts:39` | `POST /ops/ingest/deploy` | A | Miễn (telemetry và nhận báo cáo vận hành) |
| 44 | `ops/ops-client.controller.ts:49` | `POST /ops/client/logs` | A | Miễn (telemetry và nhận báo cáo vận hành) |
| 45 | `ops/ops-client.controller.ts:56` | `POST /ops/client/version` | A | Miễn (telemetry và nhận báo cáo vận hành) |
| 46 | `orders/order-customer.controller.ts:39` | `PUT /customers/me/cart` | B | Miễn tự nhiên: thay thế hoặc xóa toàn bộ giỏ hàng của khách |
| 47 | `orders/order-customer.controller.ts:44` | `DELETE /customers/me/cart` | B | Miễn tự nhiên: thay thế hoặc xóa toàn bộ giỏ hàng của khách |
| 48 | `orders/order-customer.controller.ts:50` | `POST /customers/me/orders/preview` | A | Miễn (xem trước, không ghi) |
| 49 | `shipping-policy/shipping-fee-policy.controller.ts:82` | `POST /admin/shipping-fee-policy/preview` | A | Miễn (xem trước, không ghi) |
| 50 | `sms-gateway/sms-gateway.controller.ts:29` | `POST /sms-gateway/heartbeat` | A | Miễn (giao thức thiết bị cổng SMS: nhịp tim, xác nhận) |
| 51 | `sms-gateway/sms-gateway.controller.ts:36` | `POST /sms-gateway/jobs/claim` | R | BẮT BUỘC xử lý theo giao thức, không được ghi miễn bằng lý do hiện tại: lease và `attempt_id` do server sinh chỉ chặn nhận đôi cùng một job; nếu phản hồi claim mất, retry không biết `attempt_id` cũ và có thể nhận job QUEUED kế tiếp, job đầu hết lease thành `UNKNOWN`. Cần mã yêu cầu claim ổn định giữ qua retry và server trả lại cùng claim trong lease. Không lưu plaintext SMS lâu trong kho idempotency chung (Codex, `sms-queue-service.ts:235-272`, `sms-gateway-repository.ts:223-268`, `mobile/gateway/tool/GatewayApi.kt:126-131`) |
| 52 | `sms-gateway/sms-gateway.controller.ts:58` | `POST /sms-gateway/jobs/:jobId/ack` | A | Miễn (giao thức thiết bị cổng SMS: nhịp tim, xác nhận) |

## Cách tái tạo
Quét mọi `*.controller.ts` dưới `apps/backend/src`, với mỗi decorator `@Post|@Put|@Patch|@Delete` lấy khối đến decorator HTTP kế tiếp và kiểm tra có chuỗi `idempotency-key` (không phân biệt hoa thường). Lưu ý `account-recovery.controller.ts` khai báo hai controller cùng đường dẫn con nên có hai cặp trùng tên route.
