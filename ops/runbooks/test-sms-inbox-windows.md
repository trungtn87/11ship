# Hộp OTP test và công cụ đọc mã trên PC — Windows

Task M01.22. **Chỉ dùng trên máy local, DEV/TEST.** Không phải SMS thật, không chạy ở staging/production.

Backend có thể giao OTP vào một hộp thư **trong bộ nhớ**; công cụ `tools\local\11ship-test-sms.cmd` trên PC chỉ **đọc** hộp đó để bạn lấy mã. Công cụ không gửi lại OTP, không xác minh, không đăng ký, không đăng nhập.

## Bật hộp thư (một lần)

1. Trong `.env` (không commit) thêm một hoặc cả hai dòng:
   - `OTP_PROVIDER=TEST_INBOX` — OTP đăng ký (REGISTER).
   - `ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX` — OTP kích hoạt Admin (cần `ADMIN_ACTIVATION_ENABLED=true`).
2. Giữ `APP_ENV=development`, `HOST=127.0.0.1` (hoặc để trống) và `DATABASE_URL` trỏ `127.0.0.1`. Sai một trong các điều kiện này backend **từ chối khởi động** và chỉ in tên biến.
3. Chạy `tools\local\11Ship-Update.cmd` (có build), rồi `tools\local\11Ship-Start.cmd`.

Không đặt các dòng trên = hộp thư tắt: không có cổng nghe nào được mở, hành vi FAKE/TEST_DISPLAY giữ nguyên.

## Lấy mã OTP

1. Trên app/web làm bước "gửi OTP" như bình thường.
2. **Double-click `tools\local\11ship-test-sms.cmd`.**
3. Chọn `1` (tin mới nhất), `2` (lọc theo mục đích: Đăng ký / Kích hoạt Admin / Quên mật khẩu) hoặc `3` (lọc theo số điện thoại).
4. Danh sách chỉ hiện giờ nhận, mục đích và số đã che (`*********567`). Nhập **số thứ tự** để xem **MÃ OTP** và số đầy đủ trên màn hình.
5. Nhập `q` để thoát. Cửa sổ giữ mở cho tới khi bạn nhấn phím (khi mở bằng double-click). Từ terminal thì thoát ngay; đặt `SHIP11_NO_PAUSE=1` để không bao giờ dừng.

Mã chỉ nằm trên màn hình: không tự sao chép clipboard, không ghi file, không nằm trong tham số dòng lệnh/URL/log.

## Điều cần biết

- **Hết hạn:** tin tồn tại tối đa 10 phút trong hộp (OTP thật hết hạn sau 5 phút theo luật cũ); tối đa 100 tin, tin cũ nhất bị bỏ trước. Đọc hộp **không** kéo dài hạn OTP, không reset số lần nhập sai.
- **Backend khởi động lại:** hộp thư bị xoá và token đổi. Công cụ báo "Backend vừa khởi động lại…" và tự kết nối lại tối đa 3 lần; hãy gửi lại OTP từ app.
- **Backend chưa chạy / đã dừng:** công cụ báo rõ và thoát mã 1; không treo.
- **Giới hạn đọc:** quá nhanh sẽ báo "bị giới hạn tần suất", chờ vài giây.
- **Dữ liệu kết nối** (cổng ngẫu nhiên + token) nằm ở `.11ship-local\test-sms\state.json`, thư mục này chỉ tài khoản Windows của bạn truy cập được (ACL riêng). Công cụ chỉ dùng file này sau khi kiểm tra: đúng repo, đúng người dùng, tiến trình backend còn sống với đúng thời điểm khởi động. File cũ/của repo khác/PID bị tái sử dụng bị bỏ qua, không gửi token đi đâu.
- Không có quên mật khẩu (M01.16) ở gói này; mục đích "Quên mật khẩu" chỉ là chỗ chuẩn bị.

## Mã thoát và lỗi thường gặp

| Hiện tượng | Ý nghĩa | Cách xử lý |
|---|---|---|
| "Backend chưa chạy ở chế độ TEST_INBOX" | Không có dữ liệu kết nối | Kiểm tra `.env`, chạy Start |
| "Backend đã dừng hoặc khởi động lại" | State cũ | Chạy Start lại |
| "Thông tin kết nối không an toàn…" | Quyền thư mục/file sai hoặc không thuộc bạn/repo | Xoá thư mục `.11ship-local\test-sms` khi backend dừng rồi Start lại |
| "Chưa build backend" | Thiếu `apps\backend\dist` | `npm run build` hoặc `11Ship-Update.cmd` |
| Backend thứ hai của cùng repo báo `STATE_IN_USE` | Mỗi repo chỉ một backend TEST_INBOX; backend thứ nhất không bị ảnh hưởng | Dừng backend đang chạy trước khi bật cái khác |
| Backend không lên, log `Startup failed (TEST_INBOX_…)` | Mã cố định: `NOT_LOCAL`, `REPO_UNRESOLVED`, `STATE_NOT_PRIVATE`, `STATE_IN_USE` (đã có backend khác của repo này đang chạy), `STATE_WRITE_FAILED`, `LISTENER_FAILED`, `PLATFORM_UNSUPPORTED` | Theo mã; không cần gửi token |

## Kiểm thử

- Máy dev: `npm run build` rồi `npm run test-sms:test` (công cụ + file riêng tư thật; trên Windows chạy cả wrapper `.cmd`).
- Unit: `npm run test:unit`; tích hợp PostgreSQL TEST5433: `npm run test:integration` (suite `test-sms-*`).
- Windows thật (ACL, double-click) do Owner chạy theo `docs/evidence/M01-22.md` mục Owner checklist.
