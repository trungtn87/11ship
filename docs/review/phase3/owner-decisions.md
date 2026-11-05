# Phase 3 — Các quyết định cần Owner (gom riêng)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Mỗi mục: câu hỏi ngắn, đề xuất của Lead, tham chiếu. Lead không tự quyết xóa hay giữ. Đề xuất không có hiệu lực cho tới khi Owner trả lời.

| # | Câu hỏi | Đề xuất của Lead | Tham chiếu |
|---|---|---|---|
| OD-1 | Bốn route legacy `/v1/auth/register`, `/login`, `/role/select`, `/me` (không client nào trong repo gọi, đường login legacy không qua `ClientLoginLimiter`) giữ hay gỡ? | Gỡ ở Phase 8 sau khi Codex xác nhận không còn client; trong lúc chờ, ghi vào Phase 5 kiểm giới hạn đăng nhập | open-questions Q1, public-routes #7-#8 |
| OD-2 | 52 handler ghi dữ liệu không đòi `Idempotency-Key` (vd. `PUT location`, giỏ hàng, thông báo, logout): chấp nhận như ngoại lệ có chủ ý hay bắt buộc khóa? | Cho phép ngoại lệ có chủ ý cho đo vị trí, OTP, đăng nhập, logout, preview; bắt buộc khóa cho phần còn lại sau khi Codex duyệt danh sách 52 | M00-R-02 |
| OD-3 | `wallet.adjustment.post` hiện không cấp được cho ADMIN (chỉ SYSTEM post điều chỉnh). Cho phép cấp hay ghi baseline là SYSTEM-only? | Ghi baseline là SYSTEM-only cho tới khi có nhu cầu; không mở quyền tiền mới ở Phase 8 | M04-R-09, M11-R-06 |
| OD-4 | Mã giao dịch ngân hàng duy nhất khi Admin xác nhận nạp (M04-R-05) có bắt buộc không? | Hoãn; chỉ làm khi có quy trình đối soát thủ công (B04-08) | M04-R-05, M04-R-07 |
| OD-5 | `POST /v1/shop/me/deliveries` còn tạo DIRECT mới và `ShopCallScreen` chưa nối: khóa route mới (giữ đọc DIRECT cũ) và xóa màn? | Khóa tạo mới ở backend, đọc/xử lý DIRECT cũ giữ nguyên; xóa `ShopCallScreen` ở dọn dẹp Phase 4 | M07-R-05, C-11 |
| OD-6 | Đơn đã xác nhận mà chưa gọi shipper (C-22): mốc nhắc quán và mốc vào hàng đợi Admin là bao nhiêu phút? Source chưa có chức năng này | Cấu hình bởi SYSTEM, không đặt mặc định; nếu cần con số khởi đầu thì đề xuất 20 phút nhắc quán, 40 phút vào hàng đợi, nhưng chỉ khi Owner duyệt | M10-R-26 |
| OD-7 | Khôi phục tài khoản DELETE_REQUEST sau OTP + mật khẩu mới đưa về ACTIVE ngay. Baseline nói "không tự kích hoạt lại". Giữ hành vi code hay đổi? | Sửa baseline cho khớp (OTP + mật khẩu mới là xác nhận chủ tài khoản) | M01-R-20 |
| OD-8 | Mặc định `pickup_service_seconds`=120 và `handoff_service_seconds`=60 của ghép đơn chưa được duyệt: duyệt, đổi, hay tạm giữ? | Tạm giữ, ghi rõ chưa duyệt, đo thực tế ở Phase 6 | M06-R-07 |
| OD-9 | Ngưỡng vị trí: 120 s (live, lọc đơn) và 600 s (stale, bản đồ Admin) cùng tồn tại. Chuẩn hóa vào baseline? | Ghi cả hai ngưỡng vào M06-R-10 và M14-R-02 | M06-R-10, M14-R-02 |
| OD-10 | Nhắc lấy hàng mỗi 5 phút không có số lần tối đa riêng (bị chặn gián tiếp bởi hủy tự động phút 60). Chấp nhận? | Chấp nhận nhưng ghi rõ trong baseline | M08-R-04, delivery-sweeper.md |
| OD-11 | `IdempotencyCleanup` không được gọi theo lịch: lên lịch (job nền hoặc lệnh ops) hay bỏ? | Lên lịch dọn hằng ngày ở Phase 8 (bảng `idempotency_records` chỉ tăng) | open-questions Q7 |
| OD-12 | Quyền riêng cho từng thao tác ngoại lệ đơn (C-28, vd. hủy đơn): code đang dựa quyền app VIEW/review. Tách khóa quyền riêng? | Tách `admin.order.cancel` ở Phase 8 | M12-R-13 |
| OD-13 | `NotIntegratedCommissionAdjustmentPort` là ứng viên mã chết duy nhất: xóa? | Xóa ở dọn dẹp (Phase 4) sau Codex xác nhận 0 tham chiếu | Q4 |
| OD-14 | Hai ý nghĩa của "Skip": route `fee/skip` (bỏ qua đề nghị phí) có phải vi phạm "không có nút Bỏ qua" không? | Không vi phạm; sửa baseline nói rõ "không bỏ qua đơn" | M07-R-10 |
| OD-15 | Sau lấy hàng, đổi địa chỉ bị chặn (`CANNOT_CHANGE_AFTER_PICKUP`) trong khi baseline M10-R-18 mô tả nhánh "sau lấy": thống nhất hành vi | Giữ code (chặn), sửa baseline | M10-R-18 |
| OD-16 | Giới hạn liên kết liên hệ quán: 160 hay 300 ký tự | Sửa baseline theo code (300) nếu Owner không có lý do cho 160 | M02-R-08 |
| OD-17 | Thêm yêu cầu vào baseline cho chức năng đã có mà chưa có hàng: mức nạp/rút tối thiểu, chính sách hoa hồng, ẩn/khôi phục đánh giá, đối soát lệch sổ, middleware truyền tải admin/client | Thêm vào baseline v0.8 theo đúng hành vi đã đọc | b00-semantic-review.md |
| OD-18 | Chuẩn hóa nơi lưu giỏ hàng và mô tả hai mặc định địa chỉ trong baseline (M10-R-01, M05-R-03) | Sửa baseline theo code | discrepancies.md §6 |
