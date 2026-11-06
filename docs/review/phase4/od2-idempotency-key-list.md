# OD-2 — danh sách handler ghi không đòi `Idempotency-Key` (đề xuất)

**Trạng thái:** ĐỀ XUẤT của Claude Lead, chờ Codex duyệt rồi Owner. Chưa có PR sửa code. Nguồn: quét tĩnh `apps/backend/src/**/*.controller.ts`, handler `@Post/@Put/@Patch/@Delete`; một handler "có khóa" nếu thân nó đọc header `idempotency-key`. Kết quả tái hiện số của Phase 3: **234 handler ghi, 182 có khóa, 52 không có khóa**. Đây là cận dưới/ước lượng tĩnh; một handler gọi dịch vụ có tự dedupe theo cách khác vẫn tính là "không khóa".

**Quyết định Owner (OD-2, 05/11):** không bắt khóa máy móc. Bắt buộc cho thao tác mà retry có thể gây hậu quả kép (tiền, chuyển trạng thái order/delivery, tạo resource hoặc side-effect quan trọng). Miễn: location/telemetry, OTP/login/logout, preview, PUT tự idempotent thật sự.

## Phân loại
- **A** — miễn theo nhóm Owner đã nêu (OTP, đăng nhập/đăng xuất, telemetry/vị trí, preview).
- **B** — miễn vì tự idempotent thật sự (đặt trạng thái đích hoặc không ghi), đề xuất.
- **C** — cần Codex xác nhận từng mục trước khi quyết (có thể thuộc danh sách bắt buộc).
- **X** — sẽ bị gỡ bởi OD-1.

Tổng: A=29, B=12, C=9, X=2.

**Nhận xét chính:** trong 52 handler, **không có handler nào về tiền hoặc chuyển trạng thái order/delivery** chưa có khóa: các thao tác đó (nạp, rút, hoàn tất, nhận đơn, hủy...) đã nằm trong nhóm 182 handler có khóa. Phần cần quyết thật sự chỉ là nhóm C (9 mục). Đề xuất: sau khi Codex duyệt, đưa mục nào Codex xếp "bắt buộc" vào một PR nhỏ (kèm test), còn lại ghi vào baseline M00-R-02 như ngoại lệ có chủ ý.

## Bảng 52 handler
| # | Vị trí | Route | Loại | Lý do / ghi chú |
|---|---|---|---|---|
| 1 | `account-recovery/account-recovery.controller.ts:49` | `POST /account-recovery/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 2 | `account-recovery/account-recovery.controller.ts:58` | `POST /account-recovery/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 3 | `account-recovery/account-recovery.controller.ts:92` | `POST /account-recovery/locked/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 4 | `account-recovery/account-recovery.controller.ts:100` | `POST /account-recovery/locked/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 5 | `account-recovery/account-recovery.controller.ts:153` | `POST /account-recovery/otp` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 6 | `account-recovery/account-recovery.controller.ts:161` | `POST /account-recovery/otp/:verificationId/verify` | A | Miễn (OTP): khôi phục tài khoản; mỗi bước dùng mã OTP dùng một lần và hạn chế tần suất |
| 7 | `admin-activation/admin-activation.controller.ts:86` | `POST /start` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 8 | `admin-activation/admin-activation.controller.ts:95` | `POST /restart` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 9 | `admin-activation/admin-activation.controller.ts:118` | `POST /otp/request` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 10 | `admin-activation/admin-activation.controller.ts:131` | `POST /otp/verify` | A | Miễn (OTP và khởi động/khởi động lại luồng kích hoạt bằng thử thách dùng một lần) |
| 11 | `admin-activation/admin-activation.controller.ts:144` | `POST /password` | C | Cần Codex xác nhận: các bước kích hoạt đổi trạng thái lời mời; đề xuất miễn vì máy trạng thái và thử thách dùng một lần từ chối lặp, nhưng `complete` tạo tài khoản |
| 12 | `admin-activation/admin-activation.controller.ts:157` | `POST /totp/enrollment` | C | Cần Codex xác nhận: các bước kích hoạt đổi trạng thái lời mời; đề xuất miễn vì máy trạng thái và thử thách dùng một lần từ chối lặp, nhưng `complete` tạo tài khoản |
| 13 | `admin-activation/admin-activation.controller.ts:170` | `POST /complete` | C | Cần Codex xác nhận: các bước kích hoạt đổi trạng thái lời mời; đề xuất miễn vì máy trạng thái và thử thách dùng một lần từ chối lặp, nhưng `complete` tạo tài khoản |
| 14 | `admin-auth/admin-auth.controller.ts:71` | `POST /admin-auth/login` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 15 | `admin-auth/admin-auth.controller.ts:98` | `POST /admin-auth/totp/enrollment` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 16 | `admin-auth/admin-auth.controller.ts:115` | `POST /admin-auth/totp/enrollment/verify` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 17 | `admin-auth/admin-auth.controller.ts:135` | `POST /admin-auth/totp/verify` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 18 | `admin-auth/admin-auth.controller.ts:163` | `POST /admin-auth/logout` | A | Miễn (đăng nhập, TOTP, đăng xuất của Admin) |
| 19 | `admin-provisioning/admin-provisioning.controller.ts:59` | `POST /admin/operations` | C | Cần Codex xác nhận: tạo/xác minh thao tác cấp quyền Admin bằng CSRF thay vì Idempotency-Key; đề xuất thuộc danh sách bắt buộc nếu một lần gửi lặp có thể tạo hai thao tác |
| 20 | `admin-provisioning/admin-provisioning.controller.ts:72` | `POST /admin/operations/:operation_id/verify` | C | Cần Codex xác nhận: tạo/xác minh thao tác cấp quyền Admin bằng CSRF thay vì Idempotency-Key; đề xuất thuộc danh sách bắt buộc nếu một lần gửi lặp có thể tạo hai thao tác |
| 21 | `auth/auth.controller.ts:43` | `POST /auth/phone-verifications` | A | Miễn (OTP) |
| 22 | `auth/auth.controller.ts:56` | `POST /auth/phone-verifications/:verificationId/verify` | A | Miễn (OTP) |
| 23 | `auth/auth.controller.ts:82` | `POST /auth/login` | X | Sẽ bị gỡ bởi OD-1 (route legacy), không cần xét |
| 24 | `auth/auth.controller.ts:89` | `POST /auth/role/select` | X | Sẽ bị gỡ bởi OD-1 (route legacy), không cần xét |
| 25 | `client-auth/client-auth.controller.ts:156` | `POST /client-auth/logout` | A | Miễn (đăng xuất) |
| 26 | `client-device/client-device.controller.ts:17` | `POST /client-auth/device/challenges` | A | Miễn (thử thách thiết bị là mã dùng một lần) |
| 27 | `delivery/delivery-customer.controller.ts:90` | `POST /customers/me/deliveries/:delivery_id/tracking-link` | C | Cần Codex xác nhận: tạo liên kết theo dõi; đề xuất miễn nếu lặp lại trả về liên kết đang hoạt động thay vì tạo thêm |
| 28 | `delivery/delivery-customer.controller.ts:103` | `POST /customers/me/deliveries/:delivery_id/tracking-link/toggle-location` | B | Miễn tự nhiên: đặt trạng thái đích (bật/tắt, thu hồi), lặp lại không đổi kết quả |
| 29 | `delivery/delivery-customer.controller.ts:110` | `POST /customers/me/deliveries/:delivery_id/tracking-link/revoke` | B | Miễn tự nhiên: đặt trạng thái đích (bật/tắt, thu hồi), lặp lại không đổi kết quả |
| 30 | `delivery/delivery-shipper.controller.ts:110` | `POST /driver/deliveries/:delivery_id/fail` | B | Miễn: route chỉ trả từ chối cố định cho app cũ, không ghi gì |
| 31 | `delivery/delivery-shipper.controller.ts:118` | `PUT /driver/location` | A | Miễn (đo vị trí) |
| 32 | `discovery-route/discovery-route.controller.ts:13` | `POST /discovery/route-distances` | B | Miễn: tính khoảng cách, không ghi dữ liệu (tương đương preview) |
| 33 | `feedback/complaint.controller.ts:54` | `POST /` | C | Cần Codex xác nhận: tải ảnh khiếu nại; lặp lại tạo thêm ảnh mồ côi, bộ dọn ảnh mồ côi xóa sau 24 giờ; đề xuất miễn |
| 34 | `menu/menu.controller.ts:37` | `POST /shop/me/menu/images` | C | Cần Codex xác nhận: tải ảnh món; lặp lại tạo thêm ảnh chưa gắn; đề xuất miễn nếu không có ảnh mồ côi tích tụ không giới hạn |
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
| 51 | `sms-gateway/sms-gateway.controller.ts:36` | `POST /sms-gateway/jobs/claim` | C | Cần Codex xác nhận: nhận việc gửi SMS có khóa thuê (lease); đề xuất miễn vì thuê và attempt_id chặn nhận đôi |
| 52 | `sms-gateway/sms-gateway.controller.ts:58` | `POST /sms-gateway/jobs/:jobId/ack` | A | Miễn (giao thức thiết bị cổng SMS: nhịp tim, xác nhận) |

## Cách tái tạo
Quét mọi `*.controller.ts` dưới `apps/backend/src`, với mỗi decorator `@Post|@Put|@Patch|@Delete` lấy khối đến decorator HTTP kế tiếp và kiểm tra có chuỗi `idempotency-key` (không phân biệt hoa thường). Lưu ý `account-recovery.controller.ts` khai báo hai controller cùng đường dẫn con nên có hai cặp trùng tên route.
