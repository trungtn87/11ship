# M01-D-ADMIN-WEB — chạy thử: SYSTEM mời → ADMIN kích hoạt → đăng nhập bằng Authenticator

Hướng dẫn cho Owner/dev chạy local. Đây là hướng dẫn, không phải bằng chứng đã test local.
Nền: [M01-D-LOGIN-UI-local-run](M01-D-LOGIN-UI-local-run.md) (HTTPS cùng origin, chứng chỉ, front). Phần dưới chỉ ghi điểm khác.

## Điểm khác so với bản đăng nhập
- Front local `scripts/admin-web-dev.mjs` chuyển tiếp **ba** prefix: `/v1/admin-auth/`, `/v1/admin-activation/`, `/v1/admin/`. Mọi đường dẫn API khác trả 404 từ front.
- Front trả trang cho các route phía client: `/activate` và `/invitations…`. Đường dẫn khác không có file thì 404.
- Có thêm cookie thứ ba `__Host-11admin-act` (phiên kích hoạt). Ba họ cookie/CSRF không dùng lẫn nhau.

## Cấu hình thêm trong `.env` (placeholder, không commit)
```
ADMIN_AUTH_ENABLED=true
ADMIN_AUTH_ALLOWED_ORIGINS=["https://localhost:8443"]
ADMIN_AUTH_TRUSTED_PROXY_IPS=[]
ADMIN_RATE_LIMIT_HMAC_KEY=<base64 của 32 byte ngẫu nhiên>
ADMIN_RATE_LIMIT_KEY_ID=local-limiter-1
ADMIN_ACTIVATION_ORIGIN=https://localhost:8443
ADMIN_ACTIVATION_ENABLED=true
ADMIN_ACTIVATION_OTP_MODE=TEST_DISPLAY
```
- `ADMIN_ACTIVATION_ORIGIN` phải là một trong `ADMIN_AUTH_ALLOWED_ORIGINS`. Liên kết mời được tạo trên origin này.
- `TEST_DISPLAY` chỉ chạy ở APP_ENV development/test. Chưa có nhà cung cấp SMS: backend hiện mã OTP ngay trên trang để thử, kèm dòng "Môi trường thử nghiệm: mã không gửi tin nhắn thật.".
- **Lỗi "liên kết hết hạn" khi vừa mở link:** thường không phải link hết hạn mà là backend chưa bật kích hoạt (thiếu `ADMIN_ACTIVATION_ENABLED=true` → route `/v1/admin-activation/start` trả 404). Trang giờ hiện "Chưa thể kết nối. Vui lòng thử lại." cho mọi lỗi kỹ thuật (404, origin/CSRF, 5xx); chỉ link sai/hết hạn/đã thu hồi mới hiện "Liên kết kích hoạt không hợp lệ hoặc đã hết hiệu lực." Bật đúng cấu hình rồi bấm "Thử lại" (không cần xin link mới).
- Lưu ý: dòng chữ này và các câu chữ mới của màn mời/kích hoạt chưa có trong thiết kế đã duyệt (xem checklist), Owner cần duyệt.

## Chế độ thử không xác minh SĐT (DISABLED_TEST) — chỉ local
Thay `ADMIN_ACTIVATION_OTP_MODE` bằng:
```
ADMIN_ACTIVATION_ENABLED=true
ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=DISABLED_TEST
```
- Không đặt `ADMIN_ACTIVATION_OTP_MODE`, không cần nhà cung cấp OTP; không có OTP giả, không có mã hiện trên trang. Mở link vào thẳng bước mật khẩu → Authenticator → hoàn tất → đăng nhập ADMIN (mật khẩu và TOTP vẫn thật).
- Chỉ chạy khi `APP_ENV` là development/test, `HOST` là loopback (127.0.0.1/localhost/::1), `ADMIN_AUTH_ENABLED=true` và `ADMIN_ACTIVATION_ENABLED=true`. Staging/production hoặc host không loopback: backend từ chối khởi động. Không có header/client nào bật được chế độ này. Không đặt biến (hoặc `REQUIRED`) = giữ nguyên bước OTP.
- Mỗi lần kích hoạt ghi chế độ lúc tạo (`phone_verification_mode`) và giữ nguyên; tắt chế độ rồi thì phiên kích hoạt dở của chế độ cũ không được tiếp tục (mở lại link để tạo phiên mới). Tài khoản tạo ra có `phone_verified_at` rỗng trong hồ sơ ADMIN (chưa xác minh SĐT), vẫn là ADMIN_PROVISIONED.
- Migration `1792800000000_add-admin-activation-phone-verification-mode` phải được áp trước (`npm run db:migrate` như các bước DB dev: `npm run db:migrate`).
- Chưa triển khai ở đâu; không dùng cho VPS/staging/production.

## Các bước
1. Làm các bước 1–5 của bản đăng nhập (database dev, `init-limit-config`, `bootstrap-system`, chạy backend, `npm run admin-web:cert`, `npm run build:admin-web`, `npm run admin-web:dev`).
2. **SYSTEM đăng nhập:** mở `https://localhost:8443`, nhập SĐT + mật khẩu của SYSTEM, quét QR bằng Google Authenticator lần đầu, nhập mã. Vào shell, menu bên trái có "Lời mời ADMIN".
3. **SYSTEM tạo lời mời:** Lời mời ADMIN → Tạo lời mời → họ tên, SĐT (số ADMIN sẽ dùng, khác SĐT của SYSTEM), chọn quyền theo ứng dụng → Tiếp tục → nhập mã Authenticator hiện tại → màn kết quả hiện liên kết. Bấm "Sao chép liên kết".
   - Liên kết dạng `https://localhost:8443/activate#t=<43 ký tự>`; chỉ hiện một lần ở màn này. Rời màn là mất; muốn có lại thì "Cấp lại liên kết" ở chi tiết lời mời.
4. **ADMIN kích hoạt:** mở liên kết ở cửa sổ ẩn danh (hoặc trình duyệt khác, để không lẫn cookie với SYSTEM).
   - Thanh địa chỉ đổi ngay thành `/activate` (phần sau `#` bị xóa).
   - Chế độ DISABLED_TEST: bỏ qua phần OTP, trang mở thẳng ô mật khẩu. Chế độ mặc định (REQUIRED): bấm "Gửi mã xác minh" → mã 6 số hiện trên trang (TEST_DISPLAY) → nhập → đặt mật khẩu (8–128 ký tự) → quét QR bằng Google Authenticator của ADMIN (hoặc "Hiện khóa thiết lập") → nhập mã 6 số → "Tài khoản đã được kích hoạt".
   - Kích hoạt **không** tự đăng nhập.
5. **ADMIN đăng nhập:** "Đến trang đăng nhập" → SĐT + mật khẩu vừa đặt → mã Authenticator → shell, vai trò ADMIN, không có menu lời mời.
6. Thử thêm: F5 ở từng bước kích hoạt; mở liên kết cũ sau khi SYSTEM cấp lại; nhập sai mã Authenticator 5 lần rồi "Bắt đầu lại"; SYSTEM thu hồi lời mời đang chờ.

## Đọc tài khoản (chỉ đọc)
Không cần cấu hình thêm; các route mới nằm dưới prefix đã có (`/v1/admin-auth/permissions`, `/v1/admin/users`, `/v1/admin/users/:id`, `/v1/admin/administrators`), front không mở prefix mới.
1. SYSTEM đăng nhập → menu **Người dùng** (`/accounts/users`: tìm kiếm theo tên/SĐT không dấu, lọc, "Tải thêm"; mở một dòng để xem chi tiết) và **Quản trị viên** (`/accounts/administrators`, chỉ ADMIN đã kích hoạt).
2. ADMIN (sau bước 5 trên) chỉ thấy các mục theo quyền xem được cấp; gọi trực tiếp ngoài phạm vi trả 403/404.
3. Cần có người dùng trong DB dev (đăng ký từ ứng dụng khách) để thấy dòng. Nút Khóa/Mở khóa chỉ hiện khi bật gate (mục dưới).
4. Test: `tests/integration/admin-account-read.int.spec.ts` (API + một smoke Chrome thật) cần DB `ship11_test` và Chrome; chạy trong CI bắt buộc.

## Khóa / mở khóa USER (D15) — chỉ local
Thêm vào `.env`: `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED=true`. Hợp lệ khi `APP_ENV` development/test, `HOST` loopback (127.0.0.1/localhost/::1) và `ADMIN_AUTH_ENABLED=true`; ở staging/production hoặc host khác backend từ chối khởi động, giá trị lạ cũng bị từ chối. Mặc định (không đặt/`false`) mutation trả `USER_ACCOUNT_IMPACT_REVIEW_REQUIRED` và trang không có nút. Front `scripts/admin-web-dev.mjs` không đổi: route mới nằm dưới prefix `/v1/admin/` đã có.
1. SYSTEM đăng nhập → Người dùng → mở một người dùng thường → **Khóa tài khoản** → nhập lý do → **Khóa**. Mọi phiên Food/Ship của họ bị thu hồi ngay; đăng nhập lại báo tài khoản bị khóa.
2. **Mở khóa** → lý do → xác nhận: tài khoản ACTIVE, vai trò/hồ sơ giữ nguyên, phiên cũ vẫn chết, đăng nhập mới dùng được.
3. ADMIN chỉ thấy nút khi có Xem **và** Khóa cho mọi domain của người đó (ví dụ vừa Khách vừa Shipper cần cả hai); thiếu một domain ⇒ không có nút, gọi thẳng trả 403. Không khóa được ADMIN/SYSTEM.
4. Test: `tests/integration/admin-account-lock.int.spec.ts` (API + một smoke Chrome thật qua front) cần DB `ship11_test` và Chrome; chạy trong CI bắt buộc.

## Giới hạn
- Dùng chung giới hạn tốc độ theo địa chỉ `127.0.0.1` (front không thêm header chuyển tiếp). Nhập sai liên kết nhiều lần sẽ bị khóa tạm theo Retry-After; chờ hết hoặc xóa trạng thái limiter ở DB dev.
- Mã Authenticator đã dùng trong cùng một bước 30 giây bị từ chối: đợi mã kế tiếp.
- Front này không dùng cho staging/production.
